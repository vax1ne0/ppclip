#!/usr/bin/env python3
"""Stream regular profile files only. Restore accepts only an empty destination.

Runs in an offline helper container with only the selected profile volume mounted.
No host paths, archive links, devices, absolute paths, or parent traversal are accepted.
"""
import json
import gzip
import os
from pathlib import Path, PurePosixPath
import shutil
import sys
import tarfile
import tempfile

MAX_BYTES = 2 * 1024 ** 3
MAX_ENTRIES = 100_000
MANIFEST = "ppclip-profile.json"


def backup(root, output):
    total = count = 0
    import io
    with tarfile.open(fileobj=output, mode="w|gz") as archive:
        metadata = json.dumps({"format": "ppclip-profile", "version": 1}).encode()
        info = tarfile.TarInfo(MANIFEST)
        info.size, info.mode = len(metadata), 0o600
        archive.addfile(info, io.BytesIO(metadata))
        for directory, dirs, files in os.walk(root, followlinks=False):
            dirs[:] = sorted(name for name in dirs if not (Path(directory) / name).is_symlink())
            for name in [*dirs, *sorted(files)]:
                source = Path(directory) / name
                if source.is_symlink() or not (source.is_file() or source.is_dir()):
                    continue
                info = archive.gettarinfo(str(source), "profile/" + source.relative_to(root).as_posix())
                total += info.size
                count += 1
                if total > MAX_BYTES or count > MAX_ENTRIES:
                    raise ValueError("Profile exceeds the 2 GiB / 100000 entry archive limit")
                info.uid = info.gid = 1000
                info.uname = info.gname = "agent"
                info.mode &= 0o777
                if source.is_file():
                    with source.open("rb") as content:
                        archive.addfile(info, content)
                else:
                    archive.addfile(info)


def restore(root, source):
    root = Path(root)
    if any(root.iterdir()):
        raise ValueError("Restore requires an empty profile volume; existing profiles are never overwritten")
    stage = Path(tempfile.mkdtemp(prefix=".ppclip-restore-", dir=root))
    committed = []
    try:
        total = count = 0
        seen = set()
        manifest = False
        decompressed = gzip.GzipFile(fileobj=source, mode="rb")
        with tarfile.open(fileobj=decompressed, mode="r|") as archive:
            for member in archive:
                count += 1
                total += member.size
                if count > MAX_ENTRIES or total > MAX_BYTES or member.size < 0:
                    raise ValueError("Archive exceeds the allowed size or entry count")
                name = PurePosixPath(member.name)
                if name.is_absolute() or ".." in name.parts or "\\" in member.name or member.name in seen:
                    raise ValueError("Unsafe or duplicate archive path")
                seen.add(member.name)
                if member.name == MANIFEST:
                    if not member.isfile() or member.size > 1024:
                        raise ValueError("Invalid archive manifest")
                    data = json.load(archive.extractfile(member))
                    if data != {"format": "ppclip-profile", "version": 1}:
                        raise ValueError("Unsupported profile archive format")
                    manifest = True
                    continue
                if not manifest or not name.parts or name.parts[0] != "profile" or len(name.parts) < 2:
                    raise ValueError("Unexpected profile archive entry")
                if not member.isfile() and not member.isdir():
                    raise ValueError("Archive links and special files are not accepted")
                destination = stage.joinpath(*name.parts[1:])
                destination.parent.mkdir(parents=True, exist_ok=True)
                if member.isdir():
                    destination.mkdir(exist_ok=True)
                else:
                    with destination.open("xb") as output:
                        shutil.copyfileobj(archive.extractfile(member), output, 1024 * 1024)
                os.chmod(destination, member.mode & 0o777)
                os.chown(destination, 1000, 1000)
        # Force gzip's CRC/trailer verification before committing any files.
        while decompressed.read(1024 * 1024):
            if decompressed.tell() > MAX_BYTES + MAX_ENTRIES * 1024:
                raise ValueError("Archive decompression exceeds the allowed size")
        decompressed.close()
        if not manifest:
            raise ValueError("Missing profile archive manifest")
        for directory, dirs, _files in os.walk(stage):
            os.chown(directory, 1000, 1000)
            for name in dirs:
                os.chown(Path(directory) / name, 1000, 1000)
        for entry in stage.iterdir():
            destination = root / entry.name
            entry.rename(destination)
            committed.append(destination)
        os.chown(root, 1000, 1000)
    except Exception:
        for entry in committed:
            shutil.rmtree(entry) if entry.is_dir() else entry.unlink()
        raise
    finally:
        shutil.rmtree(stage)


if __name__ == "__main__":
    try:
        if sys.argv[1:] == ["backup"]:
            backup(Path("/profile"), sys.stdout.buffer)
        elif sys.argv[1:] == ["restore"]:
            restore(Path("/profile"), sys.stdin.buffer)
        else:
            raise ValueError("Use backup or restore")
    except Exception as error:
        print(f"Profile operation failed: {error}", file=sys.stderr)
        sys.exit(1)
