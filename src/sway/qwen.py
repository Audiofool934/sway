"""Qwen vision over HTTPS; credentials stay in the backend process."""

import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path

import httpx

from .semantics import conductor_prompt, parse_ensemble


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


def qwen_status():
    """Public diagnostics deliberately exclude credentials and workspace identifiers."""
    try:
        config = QwenConfig.load()
    except (OSError, ValueError) as exc:
        return {"configured": False, "error": str(exc)}
    return {"configured": True, "model": config.model, "region": config.region}


class QwenRequestError(Exception):
    def __init__(self, message, *, retryable=True, backoff=1):
        super().__init__(message)
        self.retryable = retryable
        self.backoff = backoff


class QwenSemanticModel:
    def __init__(self, config=None, *, transport=None):
        self.config = config or QwenConfig.load()
        self.client = httpx.Client(
            base_url=self.config.endpoint + "/",
            headers={"Authorization": f"Bearer {self.config.api_key}"},
            timeout=httpx.Timeout(8, connect=2, write=2, pool=2),
            follow_redirects=False,
            transport=transport,
        )
        self.last_metrics = {"provider": "qwen", "model": self.config.model}

    def close(self):
        self.client.close()

    def interpret(self, frames: list[str], timestamps: list[float], motion: dict):
        if not 2 <= len(frames) <= 4 or len(frames) != len(timestamps):
            raise ValueError("Qwen observations need two to four timestamped frames")
        content = [{"type": "text", "text": conductor_prompt(timestamps, motion)}]
        for frame in frames:
            content.append(
                {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + frame}}
            )
        payload = {
            "model": self.config.model,
            "messages": [{"role": "user", "content": content}],
            "enable_thinking": False,
            "response_format": {"type": "json_object"},
            "max_tokens": 640,
            "stream": False,
        }
        try:
            with self.client.stream("POST", "chat/completions", json=payload) as response:
                code = response.status_code
                if code != 200:
                    # Provider bodies can contain echoed input. Never expose them in status/logs.
                    retryable = code in (408, 429) or code >= 500
                    raise QwenRequestError(
                        f"Qwen returned HTTP {code}. "
                        + (
                            "Interpretation will retry; the current arrangement continues."
                            if retryable
                            else "Check the key, workspace, region, and model access."
                        ),
                        retryable=retryable,
                        backoff=10 if code == 429 else 1,
                    )
                raw = bytearray()
                for chunk in response.iter_bytes():
                    raw.extend(chunk)
                    if len(raw) > 65_536:
                        raise QwenRequestError("Qwen returned an oversized response")
        except httpx.TimeoutException:
            raise QwenRequestError("Qwen timed out; the current arrangement continues") from None
        except httpx.HTTPError:
            raise QwenRequestError(
                "Qwen connection failed; the current arrangement continues"
            ) from None
        try:
            body = json.loads(raw)
            choice = body["choices"][0]
            if not isinstance(choice, dict) or choice.get("finish_reason") != "stop":
                raise ValueError("Incomplete response")
            text = choice["message"]["content"]
            if not isinstance(text, str):
                raise ValueError("Expected text")
            result = parse_ensemble(text)
        except (ValueError, KeyError, TypeError, IndexError):
            raise QwenRequestError("Qwen did not return a complete, valid musical intent") from None
        metrics = {"provider": "qwen", "model": self.config.model}
        model = body.get("model")
        if isinstance(model, str) and re.fullmatch(r"[a-zA-Z0-9._-]{1,128}", model):
            metrics["resolved_model"] = model
        usage = body.get("usage", {})
        if isinstance(usage, dict):
            for key in ("prompt_tokens", "completion_tokens", "total_tokens"):
                value = usage.get(key)
                if type(value) is int and value >= 0:
                    metrics[key] = value
        self.last_metrics = metrics
        return result
