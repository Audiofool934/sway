import re
import shlex

import pytest

from sway import app
from sway.cli import arguments
from sway.config import ROOT

ADVICE = [
    app.MISSING_MRT2,
    (ROOT / "web" / "instrument" / "main.js").read_text(),
]


@pytest.mark.parametrize("text", ADVICE, ids=["server", "page"])
def test_the_setup_commands_that_sway_advises_exist(text):
    commands = re.findall(r"sway (setup[^`,.\"]*)", text)
    assert commands
    for command in commands:
        args = arguments().parse_args(shlex.split(command))
        assert args.command == "setup" and not args.instrument_only
