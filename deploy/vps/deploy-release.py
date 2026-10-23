#!/usr/bin/env python3
"""Deploy one pinned, schema-compatible release on the existing Commons VPS.

Run as root: deploy-release.py SHA ARCHIVE_SHA256 /root/release.tar.gz
BUILD.json must contain source_commit=SHA, ui_commit=SHA, schema_changed=false,
and files={archive-relative path: SHA256} for every file except BUILD.json.
No migrations, credential changes, event/tunnel restarts, or data rollback occur.
"""

from pathlib import Path, PurePosixPath
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener
from html.parser import HTMLParser
import fcntl
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tarfile
import tempfile
import time


BASE = Path("/opt/agentparty-commons")
CURRENT = BASE / "current"
OLD = BASE / "releases/progressive-blur-010d406"
OLD_WORKER = "e885d57e07333cc577d850a69cd62e2d73ac50b9"
OLD_UI = "010d406a64126a9702a5c43a5d1cad7777feaffd"
STATE = Path("/var/lib/agentparty-commons/state")
BACKUPS = Path("/var/backups/agentparty-commons")
HOST = "https://agentparty.402887.xyz"
LOCAL = "http://127.0.0.1:8787"
APP = "agentparty-commons.service"
EVENT = "agentparty-commons-events.service"
TUNNEL = "agentparty-commons-tunnel.service"
MAX_PACKAGE = 256 * 1024 * 1024
MAX_EXPANDED = 512 * 1024 * 1024
HEX40 = re.compile(r"[0-9a-f]{40}\Z")
HEX64 = re.compile(r"[0-9a-f]{64}\Z")
HASHED_ASSET = re.compile(r".+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9.]+\Z")
REQUIRED = {
    "worker/index.js", "worker/index.js.map", "web/dist/index.html",
    "web/dist/commons-theme.css", "web/dist/commons-consent.css",
    "web/dist/third-party-notices.txt", "web/dist/brand/mark.png",
    "web/dist/brand/workspace.png", "web/dist/cli/manifest.json",
    "web/dist/cli/agentcommons.mjs",
}


class DeployError(Exception):
    """Only fixed, non-secret diagnostic codes may be displayed."""


def need(condition, code):
    if not condition:
        raise DeployError(code)


def digest(stream):
    result = hashlib.sha256()
    for chunk in iter(lambda: stream.read(1024 * 1024), b""):
        result.update(chunk)
    return result.hexdigest()


def file_hash(path):
    with path.open("rb") as stream:
        return digest(stream)


def run(args, timeout=60):
    try:
        subprocess.run(args, check=True, stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL, timeout=timeout)
    except (subprocess.SubprocessError, OSError):
        raise DeployError("subprocess_failed") from None


def service(*args):
    run(["systemctl", *args])


def service_pid(unit):
    service("is-active", "--quiet", unit)
    try:
        value = subprocess.check_output(
            ["systemctl", "show", unit, "-p", "MainPID", "--value"],
            text=True, stderr=subprocess.DEVNULL, timeout=15).strip()
    except (subprocess.SubprocessError, OSError):
        raise DeployError("service_identity_unavailable") from None
    need(value.isdigit() and int(value) > 0, "service_pid_missing")
    return value


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


HTTP = build_opener(ProxyHandler({}), NoRedirect())


def request(url, limit=32 * 1024 * 1024):
    req = Request(url, headers={"Accept-Encoding": "identity", "Cache-Control": "no-cache"})
    try:
        response = HTTP.open(req, timeout=10)
    except HTTPError as error:
        response = error
    with response:
        payload = response.read(limit + 1)
        need(len(payload) <= limit, "http_response_too_large")
        return response.code, payload


def get(url):
    status, payload = request(url, 1024 * 1024)
    need(status == 200, "health_http_error")
    result = json.loads(payload)
    need(isinstance(result, dict), "invalid_health_response")
    return result


def wait_health(origin, sha, timeout=90):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            health = get(origin + "/api/health?deployment_check=" + sha)
            if health.get("ok") is True and health.get("commit") == sha:
                need(health.get("author") == "zmnsQ", "unexpected_health_author")
                return
        except (HTTPError, URLError, TimeoutError, OSError, ValueError, DeployError):
            pass
        time.sleep(1)
    raise DeployError("release_health_failed")


def pin_old():
    need(CURRENT.is_symlink() and CURRENT.resolve(strict=True) == OLD, "active_release_changed")
    need(OLD.is_dir() and not OLD.is_symlink(), "unsafe_original_release")
    meta = json.loads((OLD / "BUILD.json").read_text())
    need(meta.get("source_commit") == OLD_WORKER, "active_worker_revision_changed")
    need(meta.get("ui_commit") == OLD_UI, "active_ui_revision_changed")


def overwritten(relative):
    return relative in {"BUILD.json", "worker/index.js", "worker/index.js.map"} or relative == "web/dist" or relative.startswith("web/dist/")


def preserved_tree(root):
    """Hash original code/config without following links into secrets or state."""
    result = {}
    for directory, dirs, files in os.walk(root, followlinks=False):
        for name in dirs[:] + files:
            path = Path(directory) / name
            relative = path.relative_to(root).as_posix()
            if overwritten(relative):
                if name in dirs:
                    dirs.remove(name)
                continue
            if path.is_symlink():
                result[relative] = ("link", os.readlink(path))
                if name in dirs:
                    dirs.remove(name)
            elif path.is_file():
                result[relative] = ("file", file_hash(path), path.stat().st_mode & 0o777)
            elif path.is_dir():
                result[relative] = ("directory", path.stat().st_mode & 0o777)
            else:
                raise DeployError("unexpected_release_file_type")
    return result


def safe_destination(root, relative):
    destination = root / relative
    for path in (destination, *destination.parents):
        if path == root:
            break
        need(not path.is_symlink(), "unsafe_output_symlink")
    return destination


def validate_package(archive, sha):
    entries = archive.getmembers()
    names = [entry.name.rstrip("/") for entry in entries]
    need(len(entries) <= 20000 and len(names) == len(set(names)), "duplicate_or_excessive_archive_paths")
    need(sum(entry.size for entry in entries) <= MAX_EXPANDED, "expanded_package_too_large")
    files = {}
    for entry, name in zip(entries, names):
        path = PurePosixPath(name)
        need(name == str(path) and not path.is_absolute() and ".." not in path.parts and "\\" not in name, "invalid_archive_path")
        need(entry.isfile() or entry.isdir(), "archive_links_or_special_files_forbidden")
        allowed_file = name in {"BUILD.json", "worker/index.js", "worker/index.js.map"} or name.startswith("web/dist/")
        allowed_dir = name in {"worker", "web", "web/dist"} or name.startswith("web/dist/")
        need(allowed_file if entry.isfile() else allowed_dir, "unexpected_archive_payload")
        need(not any(part.startswith((".env", ".dev.vars", "qa-")) or part in {"test", "tests", ".git", ".wrangler"} for part in path.parts), "private_or_test_file_in_package")
        if entry.isfile():
            files[name] = entry
    need(REQUIRED | {"BUILD.json"} <= files.keys(), "required_payload_missing")
    need(files["BUILD.json"].size <= 4 * 1024 * 1024, "build_manifest_too_large")
    with archive.extractfile(files["BUILD.json"]) as stream:
        meta = json.load(stream)
    need(isinstance(meta, dict) and meta.get("source_commit") == sha and meta.get("ui_commit") == sha and meta.get("schema_changed") is False, "build_identity_or_schema_mismatch")
    manifest = meta.get("files")
    need(isinstance(manifest, dict) and set(manifest) == set(files) - {"BUILD.json"}, "incomplete_manifest")
    need(all(isinstance(value, str) and HEX64.fullmatch(value) for value in manifest.values()), "invalid_manifest_checksum")
    return files, manifest


def stage(archive, sha, new):
    files, manifest = validate_package(archive, sha)
    original = preserved_tree(OLD)
    for relative in ["worker/.dev.vars", "worker/.wrangler", "runtime"]:
        need((OLD / relative).is_symlink(), "original_runtime_link_missing")
    need((OLD / "event-egress/gateway.mjs").is_file() and (OLD / "worker/wrangler.json").is_file(), "original_runtime_configuration_missing")
    shutil.copytree(OLD, new, symlinks=True)
    dist = safe_destination(new, "web/dist")
    need(dist.is_dir(), "original_dist_missing")
    shutil.rmtree(dist)
    for relative, entry in files.items():
        destination = safe_destination(new, relative)
        destination.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
        with archive.extractfile(entry) as source, destination.open("wb") as output:
            shutil.copyfileobj(source, output)
        destination.chmod(0o644)
        if relative != "BUILD.json":
            need(file_hash(destination) == manifest[relative], "payload_checksum_mismatch")
    retained = {}
    assets = OLD / "web/dist/assets"
    if assets.is_dir() and not assets.is_symlink():
        for directory, dirs, names in os.walk(assets, followlinks=False):
            dirs[:] = [name for name in dirs if not (Path(directory) / name).is_symlink()]
            for name in names:
                source = Path(directory) / name
                if source.is_symlink() or not source.is_file() or not HASHED_ASSET.fullmatch(name):
                    continue
                relative = source.relative_to(OLD / "web/dist").as_posix()
                destination = safe_destination(dist, relative)
                if destination.exists():
                    continue  # New release wins; never reuse an old index or overwrite a new asset.
                destination.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
                shutil.copy2(source, destination)
                retained[relative] = file_hash(source)
                need(file_hash(destination) == retained[relative], "retained_asset_checksum_mismatch")
    # Include directories created while retaining old chunks under umask 077.
    for directory, _, _ in os.walk(dist):
        Path(directory).chmod(0o755)
    need(original == preserved_tree(new), "preserved_runtime_or_configuration_changed")
    need(sha.encode() in (new / "worker/index.js").read_bytes(), "worker_revision_not_embedded")
    return manifest, retained


class EntryAssets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.paths = set()

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        value = attrs.get("src") if tag == "script" else attrs.get("href") if tag == "link" and attrs.get("rel") in {"stylesheet", "modulepreload"} else None
        if value:
            url = urlsplit(value)
            need(not url.scheme and not url.netloc, "external_entry_asset")
            relative = url.path.removeprefix("/")
            need(relative.startswith("assets/") and ".." not in PurePosixPath(relative).parts, "unexpected_entry_asset")
            self.paths.add(relative)


def verify_release(new, sha, manifest, retained, event_pid, tunnel_pid):
    for origin in [LOCAL, HOST]:
        wait_health(origin, sha)
        need(get(origin + "/api/auth/github/session").get("configured") is True, "github_login_unavailable")
        need(get(origin + "/.well-known/oauth-authorization-server").get("issuer") == HOST, "oauth_discovery_failed")
        for endpoint in ["/api/channels", "/oauth/grants"]:
            need(request(origin + endpoint)[0] == 401, "anonymous_access_not_denied")
    parser = EntryAssets()
    parser.feed((new / "web/dist/index.html").read_text())
    need(any(path.endswith(".js") for path in parser.paths), "entry_script_missing")
    critical = {path.removeprefix("web/dist/") for path in REQUIRED if path.startswith("web/dist/")} | parser.paths
    # Also prove old lazy-loaded chunks still resolve through the new service.
    critical |= {path for path in retained if path.endswith((".js", ".css"))}
    for relative in sorted(critical):
        expected = manifest.get("web/dist/" + relative, retained.get(relative))
        need(expected is not None, "unmanifested_entry_asset")
        url_path = "/" if relative == "index.html" else "/" + quote(relative, safe="/")
        code, payload = request(HOST + url_path + "?deployment_check=" + sha)
        need(code == 200 and hashlib.sha256(payload).hexdigest() == expected, "public_asset_checksum_mismatch")
    need(get("http://127.0.0.1:8798/health").get("ok") is True, "event_health_changed")
    service("is-active", "--quiet", APP)
    need(service_pid(EVENT) == event_pid, "event_service_restarted")
    need(service_pid(TUNNEL) == tunnel_pid, "tunnel_service_restarted")


def switch(target):
    handle, temporary = tempfile.mkstemp(prefix=".release-switch-", dir=BASE)
    os.close(handle)
    os.unlink(temporary)
    try:
        os.symlink(target, temporary)
        os.replace(temporary, CURRENT)
    finally:
        if os.path.lexists(temporary):
            os.unlink(temporary)


def record(path, data):
    with path.open("w") as output:
        json.dump(data, output, indent=2)
        output.write("\n")
        output.flush()
        os.fsync(output.fileno())


def terminate(_signum, _frame):
    raise DeployError("termination_requested")


def main():
    need(os.geteuid() == 0, "root_required")
    os.umask(0o077)
    signal.signal(signal.SIGTERM, terminate)
    need(len(sys.argv) == 4, "usage_SHA_ARCHIVE_SHA256_ROOT_ARCHIVE")
    sha, expected_hash, argument = sys.argv[1:]
    need(HEX40.fullmatch(sha) and HEX64.fullmatch(expected_hash), "invalid_commit_or_archive_hash")
    pack = Path(argument)
    need(pack.parent == Path("/root") and pack.is_file() and not pack.is_symlink(), "invalid_package_path")
    need(pack.stat().st_size <= MAX_PACKAGE, "archive_too_large")
    new = BASE / ("releases/agent-commons-web-" + sha[:12])
    with os.fdopen(os.open("/run/lock/agentparty-commons-rollout.lock", os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600), "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        pin_old()
        need(not os.path.lexists(new), "target_release_already_exists")
        need(STATE.is_dir() and not STATE.is_symlink(), "unsafe_state_directory")
        need(BACKUPS.is_dir() and not BACKUPS.is_symlink(), "backup_directory_missing_or_unsafe")
        service("is-active", "--quiet", APP)
        event_pid, tunnel_pid = service_pid(EVENT), service_pid(TUNNEL)
        wait_health(LOCAL, OLD_WORKER)
        need(get("http://127.0.0.1:8798/health").get("ok") is True, "existing_event_service_unhealthy")
        state_bytes = sum(path.stat().st_size for path in STATE.rglob("*") if path.is_file() and not path.is_symlink())
        need(shutil.disk_usage(BACKUPS).free > state_bytes + MAX_EXPANDED, "insufficient_backup_space")
        with os.fdopen(os.open(pack, os.O_RDONLY | os.O_NOFOLLOW), "rb") as source:
            need(digest(source) == expected_hash, "archive_checksum_mismatch")
            source.seek(0)
            with tarfile.open(fileobj=source, mode="r:gz") as archive:
                manifest, retained = stage(archive, sha, new)
            source.seek(0)
            need(digest(source) == expected_hash, "archive_changed_during_staging")
        pin_old()
        print("STAGED_AND_VERIFIED=" + sha, flush=True)
        backup = Path(tempfile.mkdtemp(prefix="release-" + sha[:12] + "-", dir=BACKUPS))
        report = {"source_commit": sha, "archive_sha256": expected_hash, "previous_release": str(OLD),
                  "previous_worker_commit": OLD_WORKER, "previous_ui_commit": OLD_UI,
                  "new_release": str(new), "backup": str(backup / "state-before.tgz"),
                  "retained_assets": retained, "event_pid": event_pid, "tunnel_pid": tunnel_pid,
                  "schema_changed": False, "status": "staged"}
        record(backup / "deployment.json", report)
        print("BACKUP=" + str(backup), flush=True)
        stop_requested = False
        try:
            stop_requested = True
            service("stop", APP)
            result = subprocess.run(["systemctl", "is-active", "--quiet", APP], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15)
            need(result.returncode == 3, "application_not_fully_stopped")
            snapshot = backup / "state-before.tgz"
            run(["tar", "--numeric-owner", "--acls", "--xattrs", "-czpf", str(snapshot), "-C", str(STATE.parent), STATE.name], timeout=300)
            run(["tar", "-tzf", str(snapshot)], timeout=300)
            with snapshot.open("rb") as saved:
                os.fsync(saved.fileno())
            report.update(status="snapshot_complete", backup_sha256=file_hash(snapshot))
            record(backup / "deployment.json", report)
            print("CONSISTENT_STATE_SNAPSHOT_COMPLETE", flush=True)
            switch(new)
            service("start", APP)
            verify_release(new, sha, manifest, retained, event_pid, tunnel_pid)
            report["status"] = "verified"
            record(backup / "deployment.json", report)
            print("DEPLOY_OK=" + sha, flush=True)
            print("EVENT_AND_TUNNEL_PIDS_UNCHANGED; DATA_AND_CREDENTIALS_PRESERVED", flush=True)
        except BaseException:
            try:
                active = CURRENT.resolve(strict=True)
                need(active in {OLD, new}, "unexpected_release_during_rollback")
                if active == new:
                    service("stop", APP)
                    switch(OLD)
                if stop_requested:
                    service("start", APP)
                    wait_health(LOCAL, OLD_WORKER)
                report["status"] = "program_rolled_back_data_untouched"
                record(backup / "deployment.json", report)
                print("PROGRAM_ROLLBACK_VERIFIED; DATA_NOT_ROLLED_BACK; BACKUP=" + str(backup), file=sys.stderr, flush=True)
            except BaseException:
                print("PROGRAM_ROLLBACK_REQUIRES_ATTENTION; DATA_NOT_ROLLED_BACK; BACKUP=" + str(backup), file=sys.stderr, flush=True)
            raise


if __name__ == "__main__":
    try:
        main()
    except BaseException as error:
        code = str(error) if isinstance(error, DeployError) else type(error).__name__
        print("DEPLOY_FAILED=" + code, file=sys.stderr)
        sys.exit(1)
