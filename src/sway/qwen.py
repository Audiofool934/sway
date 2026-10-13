"""Qwen credentials and endpoint; they stay in the backend process."""

import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path


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
