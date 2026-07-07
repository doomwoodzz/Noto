"""
Download, verify, and cache a pinned Node.js runtime for the current platform.

Noto vendors no Node.js of its own — instead, on first run it fetches the
official build for whatever machine it's running on and caches it under the
user's Noto cache directory. This is what lets a single `pip install` work
identically on macOS/Linux/Windows without requiring the user to already have
Node.js installed, and without publishing a different wheel per platform.

The download is verified against nodejs.org's own published SHASUMS256.txt,
fetched alongside the archive, rather than a hash hardcoded in this file — so
verification stays correct if NODE_VERSION is ever bumped without needing to
also update a hash table here.
"""

from __future__ import annotations

import hashlib
import platform
import stat
import tarfile
import urllib.request
import zipfile
from pathlib import Path

NODE_VERSION = "24.18.0"
DIST_BASE = f"https://nodejs.org/dist/v{NODE_VERSION}"


class NodeRuntimeError(RuntimeError):
    pass


def _platform_key() -> tuple[str, str]:
    """Return (nodejs-dist-os, nodejs-dist-arch) for the running machine."""
    system = platform.system()
    machine = platform.machine().lower()

    if system == "Darwin":
        os_name = "darwin"
    elif system == "Linux":
        os_name = "linux"
    elif system == "Windows":
        os_name = "win"
    else:
        raise NodeRuntimeError(f"Unsupported platform: {system}")

    if machine in ("arm64", "aarch64"):
        arch = "arm64"
    elif machine in ("x86_64", "amd64"):
        arch = "x64"
    else:
        raise NodeRuntimeError(f"Unsupported architecture: {machine}")

    return os_name, arch


def _archive_name(os_name: str, arch: str) -> str:
    ext = "zip" if os_name == "win" else "tar.gz"
    return f"node-v{NODE_VERSION}-{os_name}-{arch}.{ext}"


def _download(url: str, dest: Path) -> None:
    with urllib.request.urlopen(url) as resp, open(dest, "wb") as f:
        while True:
            chunk = resp.read(1024 * 1024)
            if not chunk:
                break
            f.write(chunk)


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _verify_checksum(archive_path: Path, archive_name: str, checksums_path: Path) -> None:
    expected = None
    with open(checksums_path, "r", encoding="utf-8") as f:
        for line in f:
            parts = line.split()
            if len(parts) == 2 and parts[1] == archive_name:
                expected = parts[0]
                break
    if expected is None:
        raise NodeRuntimeError(f"No checksum entry found for {archive_name}")
    actual = _sha256_file(archive_path)
    if actual != expected:
        raise NodeRuntimeError(
            f"Checksum mismatch for {archive_name}: expected {expected}, got {actual}"
        )


def _extract(archive_path: Path, dest_dir: Path) -> None:
    if archive_path.suffix == ".zip":
        with zipfile.ZipFile(archive_path) as zf:
            zf.extractall(dest_dir)
    else:
        with tarfile.open(archive_path, "r:gz") as tf:
            # Trusted, checksum-verified official Node.js build — not
            # attacker-controlled input. Prefer the "data" extraction filter
            # (PEP 706) where available: it strips setuid/setgid/sticky bits
            # and blocks path traversal, tightening things further even
            # though the input is already trusted. Python < 3.12 doesn't
            # accept the `filter` kwarg at all, so fall back for those.
            try:
                tf.extractall(dest_dir, filter="data")
            except TypeError:
                tf.extractall(dest_dir)


def ensure_node_runtime(cache_dir: Path) -> Path:
    """
    Ensure a checksum-verified Node.js runtime is present under `cache_dir`,
    downloading it if necessary. Returns the path to the `node` executable.
    """
    os_name, arch = _platform_key()
    install_dir = cache_dir / f"node-v{NODE_VERSION}-{os_name}-{arch}"
    node_bin = (install_dir / "node.exe") if os_name == "win" else (install_dir / "bin" / "node")

    if node_bin.exists():
        return node_bin

    cache_dir.mkdir(parents=True, exist_ok=True)
    archive_name = _archive_name(os_name, arch)
    archive_path = cache_dir / archive_name
    checksums_path = cache_dir / f"SHASUMS256.txt-{NODE_VERSION}"

    _download(f"{DIST_BASE}/{archive_name}", archive_path)
    _download(f"{DIST_BASE}/SHASUMS256.txt", checksums_path)
    _verify_checksum(archive_path, archive_name, checksums_path)

    _extract(archive_path, cache_dir)
    archive_path.unlink()
    checksums_path.unlink()

    if os_name != "win":
        node_bin.chmod(node_bin.stat().st_mode | stat.S_IEXEC)

    if not node_bin.exists():
        raise NodeRuntimeError(f"node executable not found after extraction: {node_bin}")

    return node_bin
