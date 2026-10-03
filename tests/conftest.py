import json

import pytest

QWEN_ENV = ("DASHSCOPE_API_KEY", "SWAY_QWEN_WORKSPACE_ID", "SWAY_QWEN_REGION", "SWAY_QWEN_MODEL")


@pytest.fixture(autouse=True)
def no_qwen_credentials(tmp_path, monkeypatch):
    """Every test starts with Qwen unconfigured, whatever this machine has set up."""
    monkeypatch.setenv("SWAY_QWEN_CONFIG", str(tmp_path / "absent-qwen.json"))
    for env in QWEN_ENV:
        monkeypatch.delenv(env, raising=False)


@pytest.fixture
def credentials(tmp_path, monkeypatch):
    """A private Qwen credential file with a fake key and workspace."""
    path = tmp_path / "qwen.json"
    path.write_text(json.dumps({"api_key": "test-secret-do-not-echo", "workspace_id": "llm-test"}))
    path.chmod(0o600)
    monkeypatch.setenv("SWAY_QWEN_CONFIG", str(path))
    return path
