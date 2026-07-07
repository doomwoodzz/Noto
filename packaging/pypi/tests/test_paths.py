from pathlib import Path
from unittest import mock

from noto_app.paths import data_dir, runtime_cache_dir


def test_data_dir_on_macos(tmp_path: Path):
    with mock.patch("platform.system", return_value="Darwin"), mock.patch(
        "pathlib.Path.home", return_value=tmp_path
    ):
        d = data_dir()
        assert d == tmp_path / "Library" / "Application Support" / "noto"
        assert d.is_dir()


def test_data_dir_on_linux_respects_xdg(tmp_path: Path, monkeypatch):
    xdg = tmp_path / "xdg-data"
    monkeypatch.setenv("XDG_DATA_HOME", str(xdg))
    with mock.patch("platform.system", return_value="Linux"):
        d = data_dir()
        assert d == xdg / "noto"
        assert d.is_dir()


def test_data_dir_on_linux_without_xdg(tmp_path: Path, monkeypatch):
    monkeypatch.delenv("XDG_DATA_HOME", raising=False)
    with mock.patch("platform.system", return_value="Linux"), mock.patch(
        "pathlib.Path.home", return_value=tmp_path
    ):
        d = data_dir()
        assert d == tmp_path / ".local" / "share" / "noto"


def test_runtime_cache_dir_on_macos(tmp_path: Path):
    with mock.patch("platform.system", return_value="Darwin"), mock.patch(
        "pathlib.Path.home", return_value=tmp_path
    ):
        d = runtime_cache_dir()
        assert d == tmp_path / "Library" / "Caches" / "noto"
        assert d.is_dir()


def test_data_dir_and_cache_dir_are_different(tmp_path: Path):
    with mock.patch("platform.system", return_value="Darwin"), mock.patch(
        "pathlib.Path.home", return_value=tmp_path
    ):
        assert data_dir() != runtime_cache_dir()
