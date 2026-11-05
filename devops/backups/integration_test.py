"""Exercise the actual MySQL 8.4 tools on disposable, internally networked containers."""

import base64
import hashlib
import io
import json
import os
import shutil
import subprocess  # nosec B404 # Disposable fixture tools use argv and shell=False.
import tempfile
import time
import uuid
from pathlib import Path

from mysql_backup import BackupError, Database, backup
from restore_backup import restore


class MemoryS3:
    """An in-memory S3 transport; all MySQL export/import work remains real."""

    def __init__(self):
        """Keep archive and manifest bytes in this fixture only."""
        self.parts = []
        self.objects = {}

    def create_multipart_upload(self, **kwargs):
        self.parts = []
        return {"UploadId": "fixture-upload"}

    def upload_part(self, **kwargs):
        block = kwargs["Body"]
        assert (
            kwargs["ChecksumSHA256"]
            == base64.b64encode(hashlib.sha256(block).digest()).decode()
        )
        self.parts.append(block)
        return {
            "ETag": str(kwargs["PartNumber"]),
            "ChecksumSHA256": kwargs["ChecksumSHA256"],
        }

    def complete_multipart_upload(self, **kwargs):
        self.objects[(kwargs["Key"], "archive-version")] = b"".join(self.parts)
        return {"VersionId": "archive-version"}

    def abort_multipart_upload(self, **kwargs):
        self.parts = []

    def put_object(self, **kwargs):
        self.objects[(kwargs["Key"], "manifest-version")] = kwargs["Body"]
        return {"VersionId": "manifest-version"}

    def get_object(self, **kwargs):
        return {"Body": io.BytesIO(self.objects[(kwargs["Key"], kwargs["VersionId"])])}


class ContainerDatabase(Database):
    """Route standard MySQL tool arguments into the scratch server's network namespace."""

    client = ""

    def executable(self, tool):
        """Use the fixed tool paths in the official MySQL fixture image."""
        if tool not in ("mysql", "mysqldump"):
            raise BackupError("Unsupported fixture database executable")
        return f"/usr/bin/{tool}"

    def command(self, tool, defaults):
        args = super().command(tool, defaults)
        # Docker Desktop presents Windows bind files as world-writable; MySQL
        # correctly refuses such option files. Copy into private tmpfs instead.
        private = f"/run/backup-client/{Path(defaults).name}"
        # Static shell script, quoted positional path, fixed Docker exec operation.
        # nosemgrep: python.lang.security.audit.dangerous-subprocess-use-audit.dangerous-subprocess-use-audit
        subprocess.run(  # nosec B603 # Static shell program; private path is quoted $1.
            [
                host_executable("docker"),
                "exec",
                "-i",
                self.client,
                "sh",
                "-c",
                'umask 077; cat > "$1"',
                "backup-options",
                private,
            ],
            input=Path(defaults).read_bytes(),
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            shell=False,
        )
        args[1] = f"--defaults-file={private}"
        if self.ca:
            args[-1] = "--ssl-ca=/tls/server.pem"
        return [host_executable("docker"), "exec", "-i", self.client, *args]

    def query(self, sql, directory, phase):
        try:
            return super().query(sql, directory, phase)
        except BackupError:
            # This diagnostic is restricted to these disposable public-fixture
            # credentials. Production deliberately never prints SQL stderr.
            config = self.defaults(directory)
            try:
                # Only owned fixture containers and private defaults files, no host shell.
                # nosemgrep: python.lang.security.audit.dangerous-subprocess-use-audit.dangerous-subprocess-use-audit
                result = subprocess.run(  # nosec B603 # Fixed CLI and fixture-only argv.
                    self.command("mysql", config),
                    input=sql.encode(),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    check=False,
                    shell=False,
                )
                print(result.stderr.decode("utf-8", errors="replace"))
            finally:
                config.unlink()
            raise


def host_executable(tool):
    """Find the two fixture tools without relying on implicit process path lookup."""
    if tool not in ("docker", "openssl"):
        raise BackupError("Unsupported fixture host executable")
    resolved = shutil.which(tool)
    if not resolved and tool == "openssl" and os.name == "nt":
        resolved = "C:/Program Files/Git/usr/bin/openssl.exe"
    if not resolved or not Path(resolved).is_file():
        raise BackupError("Required fixture executable is unavailable")
    return str(Path(resolved).resolve())


def docker(*args, capture=True):
    # Absolute Docker executable; callers supply argv only for owned fixture resources.
    # nosemgrep: python.lang.security.audit.dangerous-subprocess-use-audit.dangerous-subprocess-use-audit
    return subprocess.run(  # nosec B603 # Resolved Docker executable, owned fixture argv.
        [host_executable("docker"), *args],
        check=True,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.PIPE,
        shell=False,
    ).stdout


FIXTURE = r"""
CREATE DATABASE tanah CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE tanah;
CREATE TABLE entries(id INT PRIMARY KEY AUTO_INCREMENT, title TEXT, payload BLOB, optional_text VARCHAR(40) NULL) ENGINE=InnoDB;
CREATE TABLE audit(id INT PRIMARY KEY AUTO_INCREMENT, entry_id INT, CONSTRAINT fk_entry FOREIGN KEY(entry_id) REFERENCES entries(id)) ENGINE=InnoDB;
INSERT INTO entries(title,payload,optional_text) VALUES ('תנ"ך - בדיקת גיבוי',X'0001FF0A',NULL);
CREATE VIEW entry_titles AS SELECT id,title FROM entries;
DELIMITER $$
CREATE PROCEDURE read_entry(IN entry INT) BEGIN SELECT title FROM entries WHERE id=entry; END$$
CREATE TRIGGER record_entry AFTER INSERT ON entries FOR EACH ROW BEGIN INSERT INTO audit(entry_id) VALUES (NEW.id); END$$
CREATE EVENT future_event ON SCHEDULE EVERY 1 DAY DISABLE DO BEGIN SELECT 1; END$$
DELIMITER ;
CREATE USER 'bos_backup'@'%' IDENTIFIED BY 'fixture-only' REQUIRE SSL;
GRANT SELECT,SHOW VIEW,TRIGGER,EVENT ON tanah.* TO 'bos_backup'@'%';
GRANT SHOW_ROUTINE ON *.* TO 'bos_backup'@'%';
"""


def run():
    token = uuid.uuid4().hex[:12]
    network = f"codex-backup-{token}"
    source_name = f"{network}-source"
    scratch_name = f"{network}-scratch"
    client_name = f"{network}-client"
    created = []
    image = "mysql:8.4"
    with tempfile.TemporaryDirectory(prefix="bos-backup-fixture-") as root:
        root = Path(root)
        tls = root / "tls"
        initial = root / "initial"
        probe = root / "probe"
        work = root / "work"
        for directory in [tls, initial, probe, work]:
            directory.mkdir()
        # The scratch fixture gets only a dedicated unprivileged probe account;
        # its readiness check authenticates that account over the socket so it
        # never performs the root login whose cold caching_sha2_password cache
        # is under test (a warmed cache masked MySQL error 2061).
        (probe / "probe.sql").write_text(
            "CREATE USER 'fixture_probe'@'localhost' IDENTIFIED BY 'probe-only';\n",
            encoding="utf-8",
        )
        # Absolute OpenSSL executable and generated fixture paths, no shell.
        # nosemgrep: python.lang.security.audit.dangerous-subprocess-use-audit.dangerous-subprocess-use-audit
        subprocess.run(  # nosec B603 # Fixed certificate operation and fixture-only argv.
            [
                host_executable("openssl"),
                "req",
                "-x509",
                "-newkey",
                "rsa:2048",
                "-nodes",
                "-keyout",
                str(tls / "server.key"),
                "-out",
                str(tls / "server.pem"),
                "-days",
                "1",
                "-subj",
                "/CN=source",
                "-addext",
                "subjectAltName=DNS:source",
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            shell=False,
        )
        # Only disposable test keys are world-readable inside this private fixture.
        (tls / "server.key").chmod(0o644)
        (initial / "fixture.sql").write_text(FIXTURE, encoding="utf-8")
        docker("network", "create", "--internal", network)
        try:
            for name in [source_name, scratch_name]:
                health = "mysqladmin ping -h127.0.0.1 -pfixture-only --silent"
                if name == scratch_name:
                    health = "mysqladmin ping -hlocalhost -ufixture_probe -pprobe-only --silent"
                args = [
                    "run",
                    "--rm",
                    "-d",
                    "--name",
                    name,
                    "--network",
                    network,
                    "--network-alias",
                    "source" if name == source_name else "scratch",
                    "-e",
                    "MYSQL_ROOT_PASSWORD=fixture-only",
                    "-e",
                    "MYSQL_ROOT_HOST=%",
                    "--health-cmd",
                    health,
                    "--health-interval",
                    "2s",
                    "--health-timeout",
                    "2s",
                    "--health-retries",
                    "30",
                ]
                if name == source_name:
                    args += [
                        "-v",
                        f"{initial}:/docker-entrypoint-initdb.d:ro",
                        "-v",
                        f"{tls}:/tls:ro",
                    ]
                else:
                    args += [
                        "-v",
                        f"{probe}:/docker-entrypoint-initdb.d:ro",
                    ]
                args += [image, "--event-scheduler=OFF", "--local-infile=OFF"]
                if name == source_name:
                    args += [
                        "--ssl-ca=/tls/server.pem",
                        "--ssl-cert=/tls/server.pem",
                        "--ssl-key=/tls/server.key",
                    ]
                docker(*args)
                created.append(name)
            deadline = time.monotonic() + 60
            while True:
                states = [
                    docker("inspect", "--format", "{{.State.Health.Status}}", name)
                    .decode()
                    .strip()
                    for name in created
                ]
                if states == ["healthy", "healthy"]:
                    break
                if "unhealthy" in states or time.monotonic() >= deadline:
                    raise RuntimeError(
                        "Disposable MySQL fixture did not become healthy within 60 seconds"
                    )
                # Conditional health poll bounded by the unchanged 60-second deadline.
                # nosemgrep: python.lang.best-practice.sleep.arbitrary-sleep
                time.sleep(1)
            docker(
                "run",
                "--rm",
                "-d",
                "--name",
                client_name,
                "--network",
                f"container:{scratch_name}",
                "--read-only",
                "--cap-drop=ALL",
                "--security-opt=no-new-privileges",
                "--tmpfs",
                "/run/backup-client:rw,nosuid,nodev,noexec,size=16m,mode=0700",
                "-v",
                f"{tls}:/tls:ro",
                "--entrypoint",
                "sleep",
                image,
                "infinity",
            )
            created.append(client_name)
            ContainerDatabase.client = client_name
            source = ContainerDatabase(
                "source",
                3306,
                "bos_backup",
                "fixture-only",
                "tanah",
                str(tls / "server.pem"),
            )
            scratch = ContainerDatabase(
                "127.0.0.1", 3306, "root", "fixture-only", "tanah"
            )
            s3 = MemoryS3()
            manifest = backup(source, scratch, s3, "weekly", work, run="fixture")
            assert manifest["restoration"]["tables"]["entries"]["rows"] == 1
            assert manifest["restoration"]["tables"]["audit"]["rows"] == 0
            assert scratch.query(
                "SELECT HEX(payload),optional_text IS NULL FROM tanah.entries;",
                work,
                "Restored data check",
            ) == ["0001FF0A\t1"]
            # Only this process's disposable scratch instance is cleared to also
            # exercise the independent version-pinned download/restore command.
            scratch.query("DROP DATABASE tanah;", work, "Scratch reset")
            (work / "second").mkdir()
            result = restore(
                s3,
                manifest["key"].replace("application.sql.gz", "manifest.json"),
                "manifest-version",
                scratch,
                work / "second",
            )
            assert result == manifest["restoration"]
            print(
                json.dumps(
                    {
                        "result": "passed",
                        "schemaAndObjects": "matched",
                        "tables": len(result["tables"]),
                        "checks": [
                            "TLS hostname verification",
                            "cold-cache loopback scratch authentication",
                            "pre-export scratch validation",
                            "dedicated dump grants",
                            "Unicode",
                            "binary",
                            "NULL",
                            "foreign key",
                            "view",
                            "routine",
                            "trigger",
                            "event",
                            "version-pinned restore",
                        ],
                    }
                )
            )
        finally:
            for name in reversed(created):
                docker("rm", "-f", "-v", name)
            docker("network", "rm", network)


if __name__ == "__main__":
    run()
