import socket
from pathlib import Path
from unittest import mock

from noto_app.cli import (
    _ensure_app_installed,
    _find_free_port,
    _npm_cli_js,
    _subprocess_env,
)


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


def test_ensure_app_installed_replaces_app_trees_on_reinstall(tmp_path: Path, monkeypatch):
    # A new vendored bundle (marker will mismatch → reinstall path).
    vendor = tmp_path / "vendor"
    (vendor / "dist" / "assets").mkdir(parents=True)
    (vendor / "server").mkdir()
    (vendor / "package.json").write_text('{"version": "2"}')
    (vendor / "dist" / "assets" / "app-NEW.js").write_text("new chunk")
    (vendor / "server" / "index.ts").write_text("server v2")
    monkeypatch.setattr("noto_app.cli.VENDOR_DIR", vendor)

    # An existing install from a previous version, with files the new bundle
    # no longer ships (a merge would leave these behind forever).
    install = tmp_path / "install"
    (install / "dist" / "assets").mkdir(parents=True)
    (install / "server").mkdir()
    (install / "node_modules" / "tsx").mkdir(parents=True)
    (install / "dist" / "assets" / "app-OLD.js").write_text("stale chunk")
    (install / "server" / "renamed-away.ts").write_text("stale module")
    (install / "node_modules" / "tsx" / "cli.mjs").write_text("installed dep")
    (install / ".installed-package-json").write_text('{"version": "1"}')

    with mock.patch("noto_app.cli.subprocess.run") as npm_ci:
        _ensure_app_installed(Path("/cache/node/bin/node"), install)

    # Stale app-code files from the previous version are gone...
    assert not (install / "dist" / "assets" / "app-OLD.js").exists()
    assert not (install / "server" / "renamed-away.ts").exists()
    # ...the new bundle is in place...
    assert (install / "dist" / "assets" / "app-NEW.js").read_text() == "new chunk"
    assert (install / "server" / "index.ts").read_text() == "server v2"
    # ...node_modules/ was left alone for `npm ci` to manage...
    assert (install / "node_modules" / "tsx" / "cli.mjs").exists()
    # ...and the marker now records the new bundle.
    assert (install / ".installed-package-json").read_text() == '{"version": "2"}'
    npm_ci.assert_called_once()
