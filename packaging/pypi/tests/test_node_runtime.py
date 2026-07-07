import hashlib
from pathlib import Path
from unittest import mock

import pytest

from noto_app.node_runtime import (
    NodeRuntimeError,
    _archive_name,
    _platform_key,
    _sha256_file,
    _verify_checksum,
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
