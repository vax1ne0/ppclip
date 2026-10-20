"""Optional build-time install of the checksum-pinned MIT Driver, without perception/Spaces."""
import hashlib
import io
from pathlib import Path
import platform
import tarfile
import urllib.request

URL = "https://github.com/trycua/cua/releases/download/cua-driver-rs-v0.35.4/cua-driver-rs-0.35.4-linux-x86_64-binary.tar.gz"
SHA256 = "0c79ce80d9a9522c3afc93c481d72f7370678d7fb610189358457a17686914fe"
if platform.machine() != "x86_64":
    raise SystemExit("The optional pinned CUA build currently supports Linux x86_64 only")
with urllib.request.urlopen(URL, timeout=120) as response:
    data = response.read(64 * 1024 * 1024 + 1)
if len(data) > 64 * 1024 * 1024 or hashlib.sha256(data).hexdigest() != SHA256:
    raise SystemExit("CUA Driver archive failed checksum verification")
with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
    member = archive.getmember("cua-driver")
    if not member.isfile() or member.size > 128 * 1024 * 1024:
        raise SystemExit("Invalid CUA Driver archive")
    destination = Path("/opt/cua")
    destination.mkdir()
    binary = destination / "cua-driver"
    binary.write_bytes(archive.extractfile(member).read())
    binary.chmod(0o755)
