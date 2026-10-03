import asyncio
import json

import httpx
import pytest
from fastapi.testclient import TestClient

import sway.app as app_module
from sway import composer
from sway.app import app
from sway.qwen import QwenConfig
from sway.schema import ComposeRequest

WORLD = {
    "name": "Night Drive",
    "key": "A minor",
    "tempo": 100,
    "beats_per_bar": 4,
    "cycle_bars": 4,
    "vocabulary": ["Am", "C", "Dm", "Em", "F", "G"],
    "ladder": ["A3", "C4", "D4", "E4", "G4", "A4", "C5", "D5", "E5", "G5"],
    "levels": ["Air", "Pulse", "Groove", "Drive", "Peak"],
}
PLAN = {
    "chords": ["Dm", "Am", "F", "Em"],
    "texture": "pulse",
    "answer": [{"rung": 4, "at": 28, "len": 3}, {"rung": 2, "at": 60, "len": 4}],
    "caption": "I echo your climb low in bars 2 and 4.",
}


def body(**changes):
    return {
        "world": WORLD,
        "cycle": 5,
        "level": 2,
        "earlier_levels": [1],
        "current": ["Am", "F", "C", "G"],
        "history": ["Am", "F", "C", "G"],
        "phrase": [{"rung": 4, "at": 0, "len": 4}, {"rung": 7, "at": 8, "len": 8}],
        "previous_answer": [],
        **changes,
    }


def request(**changes):
    return ComposeRequest.model_validate(body(**changes))


def test_the_prompt_describes_the_music_so_far():
    text = composer.prompt(request())
    assert "cycle 5" in text
    assert "Groove (2 on a scale of 0 to 4), rising from Pulse" in text
    assert "The band is playing Am F C G" in text and "Before that: Am F C G." in text
    assert "4@0 for 4, 7@8 for 8" in text
    assert "Lead smoothly on from G" in text
    assert "Am, C, Dm, Em, F, G" in text
    rested = composer.prompt(request(phrase=[], earlier_levels=[]))
    assert "the player rested" in rested and "rising" not in rested


def plan(**changes):
    return composer.parse_plan(json.dumps({**PLAN, **changes}), request())


def test_a_good_plan_is_kept_as_written():
    assert plan() == PLAN


@pytest.mark.parametrize(
    "changes",
    [
        {"chords": ["Am", "F", "C"]},  # One per bar.
        {"chords": ["Am", "F", "C", "E"]},  # E major would clash with the ladder.
        {"texture": "strum"},
    ],
)
def test_wrong_harmony_is_refused(changes):
    with pytest.raises(ValueError):
        plan(**changes)


def test_the_answering_line_is_repaired_not_refused():
    repaired = plan(
        answer=[
            {"rung": 5, "at": 40, "len": 4},
            {"rung": 3, "at": 20, "len": 8},
            {"rung": 2, "at": 24, "len": 2},  # Overlaps the note at 20.
            {"rung": 12, "at": 30, "len": 2},  # Off the ladder.
            {"rung": 1, "at": 64, "len": 2},  # After the cycle.
            {"rung": 1, "at": 62, "len": 9},  # Runs past the cycle.
            {"rung": True, "at": 50, "len": 2},  # Not a number.
            "a stray string",
        ],
        caption="Line one\nline\ttwo" + "!" * 200,
    )
    assert repaired["answer"] == [
        {"rung": 3, "at": 20, "len": 8},
        {"rung": 5, "at": 40, "len": 4},
        {"rung": 1, "at": 62, "len": 2},
    ]
    assert repaired["caption"].startswith("Line one line two!")
    assert len(repaired["caption"]) == 90


def run(handler, config=None):
    config = config or QwenConfig(api_key="test-key", model="qwen-test")
    client = composer.Composer(config, transport=httpx.MockTransport(handler))

    async def go():
        try:
            return await client.compose(request())
        finally:
            await client.aclose()

    return asyncio.run(go())


def reply(content, finish="stop", status=200):
    return httpx.Response(
        status,
        json={
            "model": "qwen-test-2026",
            "choices": [{"finish_reason": finish, "message": {"content": content}}],
            "usage": {"prompt_tokens": 448, "completion_tokens": 81},
        },
    )


def test_qwen_is_asked_for_json_with_only_the_musical_prompt():
    sent = []

    def handler(http_request):
        sent.append(http_request)
        return reply(json.dumps(PLAN))

    result = run(handler)
    assert result["plan"] == PLAN and result["cycle"] == 5
    assert result["model"] == "qwen-test-2026"
    assert result["tokens"] == {"prompt_tokens": 448, "completion_tokens": 81}
    assert result["ms"] >= 0
    payload = json.loads(sent[0].content)
    assert sent[0].headers["authorization"] == "Bearer test-key"
    assert payload["model"] == "qwen-test" and payload["enable_thinking"] is False
    assert payload["response_format"] == {"type": "json_object"}
    [message] = payload["messages"]
    assert isinstance(message["content"], str)  # Text only: no camera images.


@pytest.mark.parametrize(
    ("response", "status"),
    [
        (httpx.Response(401, text="invalid key sk-echoed-secret"), 503),
        (httpx.Response(429, text="slow down"), 429),
        (httpx.Response(500, text="provider trace"), 502),
        (reply(json.dumps(PLAN), finish="length"), 502),
        (reply("not json"), 502),
        (reply(json.dumps({**PLAN, "chords": ["Am"]})), 502),
    ],
)
def test_failures_become_plain_errors(response, status):
    with pytest.raises(composer.ComposerError) as error:
        run(lambda http_request: response)
    assert error.value.status == status
    assert "sk-" not in str(error.value) and "trace" not in str(error.value)


def test_a_slow_reply_is_a_timeout():
    def handler(http_request):
        raise httpx.ReadTimeout("slow", request=http_request)

    with pytest.raises(composer.ComposerError) as error:
        run(handler)
    assert error.value.status == 504


class FakeComposer:
    def __init__(self):
        self.requests = []

    async def compose(self, compose_request):
        self.requests.append(compose_request)
        return {"cycle": compose_request.cycle, "plan": PLAN, "ms": 2300, "model": "q"}

    async def aclose(self):
        pass


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(app_module, "COMPOSER", None)
    with TestClient(app) as client:
        yield client


def test_the_page_gets_a_plan_for_the_next_cycle(client, monkeypatch):
    fake = FakeComposer()
    monkeypatch.setattr(app_module, "COMPOSER", fake)
    response = client.post("/api/compose", json=body())
    assert response.status_code == 200
    assert response.json()["plan"] == PLAN
    assert fake.requests[0].cycle == 5


def test_without_a_key_the_page_is_told_qwen_is_not_configured(client, monkeypatch):
    def missing():
        raise ValueError("Set Qwen api_key in the credential file or DASHSCOPE_API_KEY")

    monkeypatch.setattr(composer.QwenConfig, "load", staticmethod(missing))
    response = client.post("/api/compose", json=body())
    assert response.status_code == 503
    assert "not configured" in response.json()["detail"]


def test_composer_errors_reach_the_page_as_their_status(client, monkeypatch):
    class Refusing(FakeComposer):
        async def compose(self, compose_request):
            raise composer.ComposerError("Qwen is limiting requests", 429)

    monkeypatch.setattr(app_module, "COMPOSER", Refusing())
    response = client.post("/api/compose", json=body())
    assert response.status_code == 429


@pytest.mark.parametrize(
    "changes",
    [
        {"current": ["Am", "F", "C", "B7"]},  # Outside the vocabulary.
        {"phrase": [{"rung": 10, "at": 0, "len": 4}]},  # Off the ladder.
        {"level": 5},  # The world has five levels, 0 to 4.
        {"world": {**WORLD, "name": "Night\nDrive"}},
        {"extra": True},
    ],
)
def test_compose_requests_are_validated(client, monkeypatch, changes):
    fake = FakeComposer()
    monkeypatch.setattr(app_module, "COMPOSER", fake)
    assert client.post("/api/compose", json=body(**changes)).status_code == 422
    assert fake.requests == []


def test_compose_is_local_only_and_its_status_hides_the_key(client, monkeypatch, credentials):
    fake = FakeComposer()
    monkeypatch.setattr(app_module, "COMPOSER", fake)
    response = client.post(
        "/api/compose", json=body(), headers={"Origin": "https://elsewhere.example"}
    )
    assert response.status_code == 403 and fake.requests == []
    status = client.get("/api/compose/status").json()
    assert status["configured"]
    shown = json.dumps(status)
    assert not any(secret in shown for secret in json.loads(credentials.read_text()).values())
