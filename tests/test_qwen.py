import json
import queue
import threading
import time

import httpx
import pytest

import sway.semantics as semantics
from sway.ensemble import opening_arrangement
from sway.qwen import QwenConfig, QwenRequestError, QwenSemanticModel, qwen_status
from sway.schema import EnsembleIntent
from sway.workers import semantic_worker


@pytest.fixture
def credentials(tmp_path, monkeypatch):
    path = tmp_path / "qwen.json"
    path.write_text(json.dumps({"api_key": "test-secret-do-not-echo", "workspace_id": "llm-test"}))
    path.chmod(0o600)
    monkeypatch.setenv("SWAY_QWEN_CONFIG", str(path))
    for env in (
        "DASHSCOPE_API_KEY",
        "SWAY_QWEN_WORKSPACE_ID",
        "SWAY_QWEN_REGION",
        "SWAY_QWEN_MODEL",
    ):
        monkeypatch.delenv(env, raising=False)
    return path


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


def response_body(**changes):
    intent = {
        **opening_arrangement("chamber").model_dump(),
        "tempo_direction": "hold",
        "confidence": 0.8,
    }
    body = {
        "model": "qwen3.8-max-0902",
        "usage": {"prompt_tokens": 123, "completion_tokens": 24, "total_tokens": 147},
        "choices": [
            {
                "finish_reason": "stop",
                "message": {"content": json.dumps(intent)},
            }
        ],
    }
    body.update(changes)
    return body


def test_qwen_preserves_frame_order_and_disables_thinking(credentials):
    def handler(request):
        assert str(request.url).endswith("/compatible-mode/v1/chat/completions")
        assert request.headers["authorization"] == "Bearer test-secret-do-not-echo"
        body = json.loads(request.content)
        assert body["enable_thinking"] is False
        assert body["response_format"] == {"type": "json_object"}
        content = body["messages"][0]["content"]
        assert "[0.0, 0.5]" in content[0]["text"]
        assert "BOTH hands independently" in content[0]["text"]
        assert body["max_tokens"] >= 512
        assert [x["image_url"]["url"] for x in content[1:]] == [
            "data:image/jpeg;base64,first",
            "data:image/jpeg;base64,second",
        ]
        return httpx.Response(200, json=response_body())

    model = QwenSemanticModel(transport=httpx.MockTransport(handler))
    try:
        result = model.interpret(["first", "second"], [100, 600], {"hands": 2})
        assert len(result.parts) == 3
        assert result.tempo_direction == "hold"
        assert model.last_metrics["total_tokens"] == 147
        assert model.last_metrics["resolved_model"] == "qwen3.8-max-0902"
    finally:
        model.close()


@pytest.mark.parametrize("code,retryable", [(401, False), (400, False), (429, True), (503, True)])
def test_provider_errors_are_redacted_and_classified(credentials, code, retryable):
    model = QwenSemanticModel(
        transport=httpx.MockTransport(
            lambda request: httpx.Response(code, text="test-secret-do-not-echo")
        )
    )
    try:
        with pytest.raises(QwenRequestError) as error:
            model.interpret(["a", "b"], [0, 1], {})
        assert error.value.retryable is retryable
        assert "test-secret-do-not-echo" not in str(error.value)
    finally:
        model.close()


@pytest.mark.parametrize(
    "body",
    [
        {"choices": []},
        {"choices": [None]},
        response_body(choices=[{"finish_reason": "length", "message": {"content": "{}"}}]),
        response_body(
            choices=[{"finish_reason": "stop", "message": {"content": '{"action":"fly"}'}}]
        ),
    ],
)
def test_invalid_or_truncated_response_is_not_an_intent(credentials, body):
    model = QwenSemanticModel(
        transport=httpx.MockTransport(lambda request: httpx.Response(200, json=body))
    )
    try:
        with pytest.raises(QwenRequestError):
            model.interpret(["a", "b"], [0, 1], {})
    finally:
        model.close()


def test_network_timeout_is_recoverable_and_redacted(credentials):
    def handler(request):
        raise httpx.ReadTimeout("test-secret-do-not-echo", request=request)

    model = QwenSemanticModel(transport=httpx.MockTransport(handler))
    try:
        with pytest.raises(QwenRequestError, match="timed out") as error:
            model.interpret(["a", "b"], [0, 1], {})
        assert error.value.retryable
        assert "test-secret-do-not-echo" not in str(error.value)
    finally:
        model.close()


def test_worker_recovers_without_loading_local_model(monkeypatch):
    stop = threading.Event()
    clips, status = queue.Queue(), queue.Queue()

    class FakeCloud:
        calls = 0
        closed = False

        def interpret(self, *args):
            self.calls += 1
            if self.calls == 1:
                raise QwenRequestError("Temporary connection failure", backoff=0)
            stop.set()
            return EnsembleIntent(**opening_arrangement("chamber").model_dump(), confidence=0.9)

        def close(self):
            self.closed = True

    model = FakeCloud()
    monkeypatch.setattr(semantics, "create_semantic_model", lambda backend: model)
    for _ in range(2):
        clips.put(
            {
                "frames": ["a", "b"],
                "timestamps_ms": [0, 1],
                "motion": {},
                "received_at": time.monotonic(),
            }
        )
    semantic_worker(clips, status, stop, "qwen")
    updates = list(status.queue)
    assert any(u.get("last_error") == "Temporary connection failure" for u in updates)
    assert len(updates[-1]["intent"]["parts"]) == 3
    assert model.closed
