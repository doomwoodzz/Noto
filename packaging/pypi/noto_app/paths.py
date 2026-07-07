"""OS-appropriate local directories for Noto's data (SQLite DB, uploads) and
the cached Node.js runtime + installed app dependencies."""

from __future__ import annotations

import os
import platform
from pathlib import Path


def data_dir() -> Path:
    """Per-OS user-data directory for Noto's database and uploads. Created if missing."""
    system = platform.system()
    if system == "Darwin":
        base = Path.home() / "Library" / "Application Support" / "noto"
    elif system == "Windows":
        base = Path(os.environ.get("APPDATA", str(Path.home() / "AppData" / "Roaming"))) / "noto"
    else:
        xdg = os.environ.get("XDG_DATA_HOME")
        base = Path(xdg) / "noto" if xdg else Path.home() / ".local" / "share" / "noto"
    base.mkdir(parents=True, exist_ok=True)
    return base


def runtime_cache_dir() -> Path:
    """Per-OS cache directory for the downloaded Node.js runtime + installed app deps."""
    system = platform.system()
    if system == "Darwin":
        base = Path.home() / "Library" / "Caches" / "noto"
    elif system == "Windows":
        base = Path(os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData" / "Local"))) / "noto" / "cache"
    else:
        xdg = os.environ.get("XDG_CACHE_HOME")
        base = Path(xdg) / "noto" if xdg else Path.home() / ".cache" / "noto"
    base.mkdir(parents=True, exist_ok=True)
    return base
