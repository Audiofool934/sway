import json

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


def test_api_key_can_use_regional_endpoint_without_workspace(credentials):
    credentials.write_text(json.dumps({"api_key": "test-secret-do-not-echo", "region": "beijing"}))
    assert QwenConfig.load().endpoint == "https://dashscope.aliyuncs.com/compatible-mode/v1"
