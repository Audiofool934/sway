import importlib.util
import json
import socket
import subprocess
import zipfile
from pathlib import Path

import pytest


@pytest.mark.parametrize("model", ["mrt2_base", "demon"])
def test_live_runner_releases_vm_after_allocation_error(tmp_path, monkeypatch, model):
    project = Path(__file__).parents[1]
    path = project / "scripts/run_colab_live.py"
    spec = importlib.util.spec_from_file_location("live_runner", path)
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    for filename in (
        "__init__.py",
        "config.py",
        "music.py",
        "ensemble.py",
        "music_jax.py",
        "workers.py",
        "schema.py",
        "remote_music.py",
        "remote_server.py",
        "flow_audio.py",
        "flow_schema.py",
        "flow_server.py",
    ):
        target = tmp_path / "src/sway" / filename
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("")
    for filename in ("colab_music_trial.py", "colab_live_bootstrap.py", "colab_demon_trial.py"):
        target = tmp_path / "scripts" / filename
        target.parent.mkdir(exist_ok=True)
        target.write_text("")
    monkeypatch.setattr(runner, "ROOT", tmp_path)
    monkeypatch.setattr(runner, "remote_config_path", lambda: tmp_path / "connection.json")
    monkeypatch.setattr(runner, "flow_config_path", lambda: tmp_path / "connection.json")
    monkeypatch.setattr(runner.shutil, "which", lambda command: "/usr/bin/colab")
    monkeypatch.setattr(runner.signal, "signal", lambda *args: None)
    monkeypatch.setattr(runner.os, "umask", lambda mode: None)
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    monkeypatch.setattr("sys.argv", [str(path), "--port", str(port), "--model", model])
    calls = []

    def run(command, **kwargs):
        calls.append(command)
        if "new" in command:
            raise subprocess.CalledProcessError(1, command)
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr(runner.subprocess, "run", run)
    with pytest.raises(subprocess.CalledProcessError):
        runner.main()
    assert calls[-1][3] == "stop"
    result = next((tmp_path / ".cache/colab").glob("*/result.json"))
    assert json.loads(result.read_text())["released"]
    with zipfile.ZipFile(result.parent / "music.zip") as bundle:
        assert "sway/ensemble.py" in bundle.namelist()
    assert not (tmp_path / "connection.json").exists()
