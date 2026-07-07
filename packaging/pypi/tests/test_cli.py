import socket
from pathlib import Path

from noto_app.cli import _find_free_port, _npm_cli_js, _subprocess_env


def test_find_free_port_returns_preferred_when_available():
    port = _find_free_port(41287)
    assert port == 41287


def test_find_free_port_skips_a_port_already_in_use():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as blocker:
        blocker.bind(("127.0.0.1", 0))
        blocker.listen(1)
        busy_port = blocker.getsockname()[1]
        found = _find_free_port(busy_port)
        assert found != busy_port


def test_npm_cli_js_posix_layout():
    node_bin = Path("/cache/node-v24.18.0-darwin-arm64/bin/node")
    assert _npm_cli_js(node_bin) == Path(
        "/cache/node-v24.18.0-darwin-arm64/lib/node_modules/npm/bin/npm-cli.js"
    )


def test_npm_cli_js_windows_layout():
    node_bin = Path("C:/cache/node-v24.18.0-win-x64/node.exe")
    assert _npm_cli_js(node_bin) == Path(
        "C:/cache/node-v24.18.0-win-x64/node_modules/npm/bin/npm-cli.js"
    )


def test_subprocess_env_prepends_node_bin_dir_to_path(monkeypatch):
    monkeypatch.setenv("PATH", "/usr/bin")
    node_bin = Path("/cache/node/bin/node")
    env = _subprocess_env(node_bin)
    assert env["PATH"].startswith("/cache/node/bin")
    assert env["PATH"].endswith("/usr/bin")
