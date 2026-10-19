"""Qwen credentials and endpoint; they stay in the backend process."""

import json
import os
import re
import time
from dataclasses import dataclass, field
from pathlib import Path

import httpx


def credential_path() -> Path:
    return Path(os.environ.get("SWAY_QWEN_CONFIG", "~/.config/sway/qwen.json")).expanduser()


@dataclass(frozen=True)
class QwenConfig:
    api_key: str = field(repr=False)
    workspace_id: str = ""
    region: str = "beijing"
    model: str = "qwen3.8-max"

    @property
    def endpoint(self):
        if not self.workspace_id:
            host = (
                "dashscope.aliyuncs.com"
                if self.region == "beijing"
                else "dashscope-intl.aliyuncs.com"
            )
            return f"https://{host}/compatible-mode/v1"
        region = {"beijing": "cn-beijing", "singapore": "ap-southeast-1"}[self.region]
        return f"https://{self.workspace_id}.{region}.maas.aliyuncs.com/compatible-mode/v1"

    @classmethod
    def load(cls):
        path = credential_path()
        values = {}
        if path.exists():
            if path.stat().st_mode & 0o077:
                raise ValueError("Qwen credential file must be private: chmod 600 " + str(path))
            try:
                values = json.loads(path.read_text())
            except (OSError, ValueError):
                raise ValueError("Qwen credential file must contain valid JSON") from None
            if not isinstance(values, dict):
                raise ValueError("Qwen credential file must contain a JSON object")
        fields = {
            "api_key": ("DASHSCOPE_API_KEY", ""),
            "workspace_id": ("SWAY_QWEN_WORKSPACE_ID", ""),
            "region": ("SWAY_QWEN_REGION", "beijing"),
            "model": ("SWAY_QWEN_MODEL", "qwen3.8-max"),
        }
        settings = {}
        for name, (env, default) in fields.items():
            value = os.environ.get(env, values.get(name, default))
            if not isinstance(value, str) or (not value.strip() and name != "workspace_id"):
                raise ValueError(f"Set Qwen {name} in {path} or {env}")
            settings[name] = value.strip()
        if settings["region"] not in ("beijing", "singapore"):
            raise ValueError("Qwen region must be beijing or singapore")
        if settings["workspace_id"] and not re.fullmatch(
            r"[a-zA-Z0-9-]{1,63}", settings["workspace_id"]
        ):
            raise ValueError("Qwen workspace_id must be a valid workspace identifier")
        if not re.fullmatch(r"[a-zA-Z0-9._-]{1,128}", settings["model"]):
            raise ValueError("Qwen model must be a model identifier")
        if not re.fullmatch(r"[!-~]{1,512}", settings["api_key"]):
            raise ValueError("Qwen api_key must contain only printable ASCII without spaces")
        return cls(**settings)


class QwenError(Exception):
    """A failed request, with the HTTP status a page should see.

    `transient` errors, a timeout, an unreachable service, or a rate limit, may pass on
    their own; the caller keeps playing its own music meanwhile.
    """

    def __init__(self, message, status, *, transient=False):
        super().__init__(message)
        self.status = status
        self.transient = transient


class QwenClient:
    """Asks Qwen for JSON replies; the API key stays in this process."""

    def __init__(self, config=None, *, transport=None, timeout=6.0):
        self.config = config or QwenConfig.load()
        self.http = httpx.AsyncClient(
            base_url=self.config.endpoint + "/",
            headers={"Authorization": f"Bearer {self.config.api_key}"},
            timeout=httpx.Timeout(timeout, connect=2),
            follow_redirects=False,
            transport=transport,
        )

    async def aclose(self):
        await self.http.aclose()

    async def json_reply(self, prompt: str, *, max_tokens: int) -> tuple[dict, float]:
        """Qwen's response body to a text-only prompt, and its time in ms; or QwenError."""
        payload = {
            "model": self.config.model,
            "messages": [{"role": "user", "content": prompt}],
            "enable_thinking": False,
            "response_format": {"type": "json_object"},
            "max_tokens": max_tokens,
            "stream": False,
        }
        started = time.perf_counter()
        try:
            response = await self.http.post("chat/completions", json=payload)
        except httpx.TimeoutException:
            raise QwenError("Qwen took too long", 504, transient=True) from None
        except httpx.HTTPError:
            raise QwenError("Qwen could not be reached", 502, transient=True) from None
        ms = (time.perf_counter() - started) * 1000
        code = response.status_code
        # Provider bodies can echo the request; they are never passed on.
        if code in (401, 403):
            raise QwenError("Qwen refused the request; check the key and model access", 503)
        if code == 429:
            raise QwenError("Qwen is limiting requests", 429, transient=True)
        if code != 200:
            raise QwenError(f"Qwen returned HTTP {code}", 502)
        if len(response.content) > 65_536:
            raise QwenError("Qwen returned an oversized response", 502)
        try:
            body = response.json()
        except ValueError:
            raise QwenError("Qwen returned a response that is not JSON", 502) from None
        if not isinstance(body, dict):
            raise QwenError("Qwen returned a response that is not JSON", 502)
        return body, ms

    def model(self, body: dict) -> str:
        """The model that answered, as Qwen names it, or the configured one."""
        model = body.get("model")
        if isinstance(model, str) and re.fullmatch(r"[a-zA-Z0-9._-]{1,128}", model):
            return model
        return self.config.model


def content(body: dict) -> str:
    """The text of a complete reply; ValueError, KeyError, TypeError, or IndexError if not."""
    choice = body["choices"][0]
    if choice.get("finish_reason") != "stop":
        raise ValueError("Incomplete reply")
    text = choice["message"]["content"]
    if not isinstance(text, str):
        raise TypeError("Reply text is not a string")
    return text


def qwen_status():
    """Public diagnostics deliberately exclude credentials and workspace identifiers."""
    try:
        config = QwenConfig.load()
    except (OSError, ValueError) as exc:
        return {"configured": False, "error": str(exc)}
    return {"configured": True, "model": config.model, "region": config.region}
