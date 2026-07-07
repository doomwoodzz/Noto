import contextlib
import hashlib
from pathlib import Path
from unittest import mock

import pytest

from noto_app.node_runtime import (
    NODE_VERSION,
    NodeRuntimeError,
    _archive_name,
    _download,
    _platform_key,
    _sha256_file,
    _verify_checksum,
    ensure_node_runtime,
)


def test_platform_key_darwin_arm64():
    with mock.patch("platform.system", return_value="Darwin"), mock.patch(
        "platform.machine", return_value="arm64"
    ):
        assert _platform_key() == ("darwin", "arm64")


def test_platform_key_linux_x64():
    with mock.patch("platform.system", return_value="Linux"), mock.patch(
        "platform.machine", return_value="x86_64"
    ):
        assert _platform_key() == ("linux", "x64")


def test_platform_key_windows_x64():
    with mock.patch("platform.system", return_value="Windows"), mock.patch(
        "platform.machine", return_value="AMD64"
    ):
        assert _platform_key() == ("win", "x64")


def test_platform_key_rejects_unknown_os():
    with mock.patch("platform.system", return_value="Plan9"):
        with pytest.raises(NodeRuntimeError):
            _platform_key()


def test_archive_name_uses_zip_for_windows():
    assert _archive_name("win", "x64").endswith(".zip")


def test_archive_name_uses_tar_gz_elsewhere():
    assert _archive_name("darwin", "arm64").endswith(".tar.gz")
    assert _archive_name("linux", "x64").endswith(".tar.gz")


def test_verify_checksum_accepts_matching_hash(tmp_path: Path):
    archive = tmp_path / "node-vX-darwin-arm64.tar.gz"
    archive.write_bytes(b"fake node tarball contents")
    expected = hashlib.sha256(archive.read_bytes()).hexdigest()

    checksums = tmp_path / "SHASUMS256.txt"
    checksums.write_text(f"{expected}  node-vX-darwin-arm64.tar.gz\nsomeotherhash  other-file.tar.gz\n")

    # Should not raise.
    _verify_checksum(archive, "node-vX-darwin-arm64.tar.gz", checksums)


def test_verify_checksum_rejects_mismatched_hash(tmp_path: Path):
    archive = tmp_path / "node-vX-darwin-arm64.tar.gz"
    archive.write_bytes(b"fake node tarball contents")

    checksums = tmp_path / "SHASUMS256.txt"
    checksums.write_text("0" * 64 + "  node-vX-darwin-arm64.tar.gz\n")

    with pytest.raises(NodeRuntimeError):
        _verify_checksum(archive, "node-vX-darwin-arm64.tar.gz", checksums)


def test_verify_checksum_rejects_missing_entry(tmp_path: Path):
    archive = tmp_path / "node-vX-darwin-arm64.tar.gz"
    archive.write_bytes(b"fake node tarball contents")

    checksums = tmp_path / "SHASUMS256.txt"
    checksums.write_text("0" * 64 + "  some-other-archive.tar.gz\n")

    with pytest.raises(NodeRuntimeError):
        _verify_checksum(archive, "node-vX-darwin-arm64.tar.gz", checksums)


def test_sha256_file_matches_hashlib(tmp_path: Path):
    f = tmp_path / "data.bin"
    f.write_bytes(b"some bytes to hash" * 1000)
    assert _sha256_file(f) == hashlib.sha256(f.read_bytes()).hexdigest()


def test_download_uses_60s_timeout(tmp_path: Path):
    dest = tmp_path / "out.bin"
    with mock.patch("urllib.request.urlopen") as urlopen:
        resp = urlopen.return_value.__enter__.return_value
        resp.read.side_effect = [b"payload", b""]
        _download("https://example.invalid/node.tar.gz", dest)

    urlopen.assert_called_once_with("https://example.invalid/node.tar.gz", timeout=60)
    assert dest.read_bytes() == b"payload"


def test_ensure_node_runtime_fresh_install_stages_then_swaps(tmp_path: Path):
    cache = tmp_path / "cache"
    install_dir = cache / f"node-v{NODE_VERSION}-darwin-arm64"

    def fake_download(url: str, dest: Path) -> None:
        Path(dest).write_bytes(b"archive-bytes")

    def fake_extract(archive_path: Path, dest_dir: Path) -> None:
        # Extraction must be staged in a temp dir directly under the cache
        # (same filesystem, so the final move is an atomic os.replace) —
        # never done in-place at the cache root.
        assert Path(dest_dir).parent == cache
        root = Path(dest_dir) / install_dir.name
        (root / "bin").mkdir(parents=True)
        (root / "bin" / "node").write_bytes(b"node-binary")

    with contextlib.ExitStack() as stack:
        stack.enter_context(mock.patch("platform.system", return_value="Darwin"))
        stack.enter_context(mock.patch("platform.machine", return_value="arm64"))
        stack.enter_context(
            mock.patch("noto_app.node_runtime._download", side_effect=fake_download)
        )
        verify = stack.enter_context(mock.patch("noto_app.node_runtime._verify_checksum"))
        stack.enter_context(
            mock.patch("noto_app.node_runtime._extract", side_effect=fake_extract)
        )
        result = ensure_node_runtime(cache)

    assert result == install_dir / "bin" / "node"
    assert result.read_bytes() == b"node-binary"
    verify.assert_called_once()
    # The archive, checksum file, and staging dir must all be cleaned up:
    # only the finished install remains in the cache.
    assert {p.name for p in cache.iterdir()} == {install_dir.name}


def test_ensure_node_runtime_replaces_torn_install(tmp_path: Path):
    cache = tmp_path / "cache"
    install_dir = cache / f"node-v{NODE_VERSION}-darwin-arm64"
    # An interrupted extraction left the install dir present but node missing.
    (install_dir / "lib").mkdir(parents=True)
    (install_dir / "lib" / "torn-leftover.txt").write_text("partial")

    downloaded = []

    def fake_download(url: str, dest: Path) -> None:
        downloaded.append(url)
        Path(dest).write_bytes(b"archive-bytes")

    def fake_extract(archive_path: Path, dest_dir: Path) -> None:
        root = Path(dest_dir) / install_dir.name
        (root / "bin").mkdir(parents=True)
        (root / "bin" / "node").write_bytes(b"node-binary")

    with contextlib.ExitStack() as stack:
        stack.enter_context(mock.patch("platform.system", return_value="Darwin"))
        stack.enter_context(mock.patch("platform.machine", return_value="arm64"))
        stack.enter_context(
            mock.patch("noto_app.node_runtime._download", side_effect=fake_download)
        )
        stack.enter_context(mock.patch("noto_app.node_runtime._verify_checksum"))
        stack.enter_context(
            mock.patch("noto_app.node_runtime._extract", side_effect=fake_extract)
        )
        result = ensure_node_runtime(cache)

    assert result == install_dir / "bin" / "node"
    assert result.read_bytes() == b"node-binary"
    # The torn contents were replaced wholesale, not merged into.
    assert not (install_dir / "lib" / "torn-leftover.txt").exists()
    # A torn install (node binary missing) must trigger a full re-download.
    assert len(downloaded) == 2


def test_ensure_node_runtime_short_circuits_on_complete_install(tmp_path: Path):
    cache = tmp_path / "cache"
    node_bin = cache / f"node-v{NODE_VERSION}-darwin-arm64" / "bin" / "node"
    node_bin.parent.mkdir(parents=True)
    node_bin.write_bytes(b"node-binary")

    with contextlib.ExitStack() as stack:
        stack.enter_context(mock.patch("platform.system", return_value="Darwin"))
        stack.enter_context(mock.patch("platform.machine", return_value="arm64"))
        download = stack.enter_context(mock.patch("noto_app.node_runtime._download"))
        result = ensure_node_runtime(cache)

    assert result == node_bin
    download.assert_not_called()
