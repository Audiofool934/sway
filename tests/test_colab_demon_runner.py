"""Failures must release the charged VM, even when the CLI hides remote failure."""

import importlib.util
import json
import subprocess
import zipfile
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf


@pytest.fixture
def runner(tmp_path, monkeypatch):
    path = Path(__file__).parents[1] / "scripts/run_colab_demon_trial.py"
    spec = importlib.util.spec_from_file_location("demon_runner", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    source = tmp_path / "source.wav"
    sf.write(source, np.zeros((480_000, 2), dtype=np.float32), 48000)
    monkeypatch.setattr(module, "ROOT", tmp_path)
    monkeypatch.setattr(module.shutil, "which", lambda command: "/usr/bin/colab")
    monkeypatch.setattr(module.signal, "signal", lambda *args: None)
    monkeypatch.setattr("sys.argv", [str(path), "--input", str(source)])
    return module


@pytest.mark.parametrize("stage", ["new", "upload", "exec"])
def test_cleanup_after_failed_stage(runner, monkeypatch, stage):
    calls = []

    def run(command, **kwargs):
        calls.append(command)
        if command[3] == stage:
            raise subprocess.TimeoutExpired(command, 1)
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr(runner.subprocess, "run", run)
    with pytest.raises(subprocess.TimeoutExpired):
        runner.main()
    assert calls[-1][3] == "stop"
    assert calls[-1][-1] == calls[0][-3]
    report = next((runner.ROOT / "outputs/colab").glob("*/session.json"))
    assert json.loads(report.read_text())["released"]


def test_remote_failure_is_not_hidden_by_cli_success(runner, monkeypatch):
    calls = []

    def run(command, **kwargs):
        calls.append(command)
        if command[3] == "download":
            with zipfile.ZipFile(command[-1], "w") as archive:
                archive.writestr("remote-status.json", '{"returncode":1}')
                archive.writestr("failure.txt", "Model setup failed")
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr(runner.subprocess, "run", run)
    with pytest.raises(RuntimeError, match="Remote trial failed"):
        runner.main()
    assert calls[-1][3] == "stop"
    assert (
        next((runner.ROOT / "outputs/colab").glob("*/failure.txt")).read_text()
        == "Model setup failed"
    )


def test_failed_release_is_reported(runner, monkeypatch):
    def run(command, **kwargs):
        if command[3] == "exec":
            raise subprocess.CalledProcessError(1, command)
        return subprocess.CompletedProcess(command, 1 if command[3] == "stop" else 0)

    monkeypatch.setattr(runner.subprocess, "run", run)
    with pytest.raises(subprocess.CalledProcessError):
        runner.main()
    report = next((runner.ROOT / "outputs/colab").glob("*/session.json"))
    assert not json.loads(report.read_text())["released"]
