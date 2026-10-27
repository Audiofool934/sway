import json

import pytest

from sway.qwen import QwenConfig, qwen_status


def test_private_config_and_status_do_not_expose_key(credentials, monkeypatch):
    config = QwenConfig.load()
    assert config.endpoint == "https://llm-test.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"
    assert config.api_key not in repr(config)
    assert config.api_key not in json.dumps(qwen_status())
    assert "llm-test" not in json.dumps(qwen_status())
    monkeypatch.setenv("SWAY_QWEN_REGION", "singapore")
    assert "ap-southeast-1" in QwenConfig.load().endpoint
    credentials.chmod(0o644)
    assert not qwen_status()["configured"]


def test_invalid_config_never_echoes_values(credentials):
    for contents in (
        '{"api_key":"test-secret-do-not-echo", broken',
        '{"api_key":"test-secret-do-not-echo","workspace_id":"https://evil.example"}',
        '{"api_key":"test-secret-do-not-echo","workspace_id":"llm-test","region":"secret"}',
    ):
        credentials.write_text(contents)
        result = qwen_status()
        assert not result["configured"]
        assert "test-secret-do-not-echo" not in json.dumps(result)


@pytest.mark.parametrize(
    ("region", "workspace", "host"),
    [
        ("beijing", "", "dashscope.aliyuncs.com"),
        ("singapore", "", "dashscope-intl.aliyuncs.com"),
        ("us-east-1", "", "dashscope-us.aliyuncs.com"),
        ("beijing", "llm-test", "llm-test.cn-beijing.maas.aliyuncs.com"),
        ("singapore", "llm-test", "llm-test.ap-southeast-1.maas.aliyuncs.com"),
        ("us-east-1", "ws-test", "ws-test.us-east-1.maas.aliyuncs.com"),
    ],
)
def test_api_key_routes_to_its_region_and_workspace(credentials, region, workspace, host):
    credentials.write_text(
        json.dumps(
            {"api_key": "test-secret-do-not-echo", "region": region, "workspace_id": workspace}
        )
    )
    assert QwenConfig.load().endpoint == f"https://{host}/compatible-mode/v1"


def test_environment_can_select_us_workspace(credentials, monkeypatch):
    monkeypatch.setenv("SWAY_QWEN_REGION", "us-east-1")
    monkeypatch.setenv("SWAY_QWEN_WORKSPACE_ID", "ws-us-test")
    config = QwenConfig.load()
    assert config.endpoint == "https://ws-us-test.us-east-1.maas.aliyuncs.com/compatible-mode/v1"
    assert qwen_status() == {"configured": True, "model": "qwen3.8-max", "region": "us-east-1"}
