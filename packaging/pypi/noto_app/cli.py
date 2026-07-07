"""
`noto` CLI entry point.

Ensures a Node.js runtime is available, installs the vendored app's
production dependencies on first run, then launches the server in the
foreground and opens the browser. Ctrl+C stops the server.
"""

from __future__ import annotations

import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path

from .node_runtime import ensure_node_runtime
from .paths import data_dir, runtime_cache_dir

VENDOR_DIR = Path(__file__).parent / "_vendor"
DEFAULT_PORT = 8787


def _find_free_port(preferred: int) -> int:
    """Return `preferred` if free, else the first free port after it."""
    for port in (preferred, *range(preferred + 1, preferred + 20)):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    raise RuntimeError(f"No free port found near {preferred}")


def _npm_cli_js(node_bin: Path) -> Path:
    """
    npm's JS entry point inside the official Node distribution. npm is always
    invoked as `node npm-cli.js ...` rather than via the `npm`/`npm.cmd`
    shims: the shims assume a `node` on PATH (there may be none — that's the
    point of this package) and `.cmd` files aren't directly spawnable.
    """
    if node_bin.name == "node.exe":
        return node_bin.parent / "node_modules" / "npm" / "bin" / "npm-cli.js"
    return node_bin.parent.parent / "lib" / "node_modules" / "npm" / "bin" / "npm-cli.js"


def _subprocess_env(node_bin: Path, **extra: str) -> dict:
    """Process env for children: our Node's bin dir first on PATH, so npm's
    internal `node` spawns resolve to the managed runtime, not the system."""
    env = {**os.environ, **extra}
    env["PATH"] = str(node_bin.parent) + os.pathsep + env.get("PATH", "")
    return env


def _install_dir(cache_dir: Path) -> Path:
    install_dir = cache_dir / "app"
    install_dir.mkdir(parents=True, exist_ok=True)
    return install_dir


def _ensure_app_installed(node_bin: Path, install_dir: Path) -> None:
    """Copy the vendored app into the cache dir and `npm ci` it once."""
    marker = install_dir / ".installed-package-json"
    vendor_package_json = (VENDOR_DIR / "package.json").read_text()
    if marker.exists() and marker.read_text() == vendor_package_json:
        return  # already installed for this exact vendored bundle

    print("Setting up Noto (first run only, this can take a minute)...")
    shutil.copytree(VENDOR_DIR, install_dir, dirs_exist_ok=True)
    subprocess.run(
        [str(node_bin), str(_npm_cli_js(node_bin)), "ci", "--omit=dev", "--no-audit", "--no-fund"],
        cwd=install_dir,
        env=_subprocess_env(node_bin),
        check=True,
    )
    marker.write_text(vendor_package_json)


def main() -> None:
    if not (VENDOR_DIR / "package.json").exists():
        print(
            "noto: this installation has no vendored app bundle (development checkout?).\n"
            "Run landing/scripts/build-pypi-bundle.mjs before building the wheel.",
            file=sys.stderr,
        )
        sys.exit(1)

    cache_root = runtime_cache_dir()
    node_bin = ensure_node_runtime(cache_root / "runtime")
    install_dir = _install_dir(cache_root)
    _ensure_app_installed(node_bin, install_dir)

    port = _find_free_port(DEFAULT_PORT)
    tsx_cli = install_dir / "node_modules" / "tsx" / "dist" / "cli.mjs"

    proc = subprocess.Popen(
        [str(node_bin), str(tsx_cli), str(install_dir / "server" / "index.ts")],
        cwd=install_dir,
        env=_subprocess_env(
            node_bin,
            NODE_ENV="production",
            PORT=str(port),
            APP_ORIGIN=f"http://127.0.0.1:{port}",
            DATABASE_PATH=str(data_dir() / "noto.sqlite"),
        ),
    )

    def open_browser() -> None:
        time.sleep(1.5)
        webbrowser.open(f"http://127.0.0.1:{port}")

    threading.Thread(target=open_browser, daemon=True).start()

    try:
        proc.wait()
    except KeyboardInterrupt:
        proc.terminate()
        proc.wait()
        sys.exit(0)


if __name__ == "__main__":
    main()
