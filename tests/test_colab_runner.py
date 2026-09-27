import importlib.util
import json
import subprocess
from pathlib import Path

import pytest


@pytest.fixture
def runner(tmp_path, monkeypatch):
    path = Path(__file__).parents[1] / "scripts/run_colab_trial.py"
    spec = importlib.util.spec_from_file_location("colab_runner", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setattr(module, "ROOT", tmp_path)
    monkeypatch.setattr(module.shutil, "which", lambda command: "/usr/bin/colab")
    monkeypatch.setattr(module.signal, "signal", lambda *args: None)
    monkeypatch.setattr("sys.argv", [str(path)])
    return module


def test_colab_session_released_after_remote_failure(runner, monkeypatch):
    calls = []

    def run(command, **kwargs):
        calls.append(command)
        if "exec" in command:
            raise subprocess.CalledProcessError(1, command)
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr(runner.subprocess, "run", run)
    with pytest.raises(subprocess.CalledProcessError):
        runner.main()
    assert calls[-1][3] == "stop"
    assert calls[-1][-1] == calls[0][5]
    assert all("--config" in command for command in calls)
    report = next((runner.ROOT / "outputs/colab").glob("*/session.json"))
    assert json.loads(report.read_text())["released"]


def test_colab_cleanup_failure_is_recorded(runner, monkeypatch):
    def run(command, **kwargs):
        if "exec" in command:
            raise subprocess.TimeoutExpired(command, 10)
        return subprocess.CompletedProcess(command, 1 if "stop" in command else 0)

    monkeypatch.setattr(runner.subprocess, "run", run)
    with pytest.raises(subprocess.TimeoutExpired):
        runner.main()
    report = next((runner.ROOT / "outputs/colab").glob("*/session.json"))
    assert not json.loads(report.read_text())["released"]


def test_remote_failure_detected_when_cli_reports_success(runner, monkeypatch):
    calls = []

    def run(command, **kwargs):
        calls.append(command)
        if "download" in command:
            Path(command[-1]).write_text('{"returncode":1}')
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr(runner.subprocess, "run", run)
    with pytest.raises(RuntimeError, match="Remote trial failed"):
        runner.main()
    assert calls[-1][3] == "stop"
