"""Run the manual article fingerprint migration on a disposable MySQL 8.4 server."""

import argparse
import hashlib
from pathlib import Path
import shutil
import subprocess  # nosec B404 # Runs the isolated Docker fixture with shell=False.
import time


DATABASE = "article_fingerprint_test"
MIGRATION = Path(__file__).parent / "manual" / "mysql-97-article-fingerprint.sql"

SEED = """
CREATE TABLE tanah_article (
    id MEDIUMINT NOT NULL PRIMARY KEY,
    perek_id SMALLINT NOT NULL,
    author_id SMALLINT NOT NULL,
    abstract VARCHAR(10000),
    name VARCHAR(700) NOT NULL,
    content MEDIUMTEXT,
    content_hash BINARY(16) GENERATED ALWAYS AS (
        UNHEX(MD5(CONCAT_WS(X'01', IFNULL(name, ''), IFNULL(abstract, ''),
            IFNULL(content, ''), perek_id, author_id)))
    ) STORED
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;

CREATE TABLE article_search_doc (
    article_id MEDIUMINT NOT NULL PRIMARY KEY,
    model_epoch INT NOT NULL,
    content_hash BINARY(16) NOT NULL,
    plain_len INT NOT NULL,
    vector BLOB NOT NULL,
    terms MEDIUMBLOB NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO tanah_article (id, perek_id, author_id, abstract, name, content)
VALUES
    (1, 11, 7, NULL, 'שָׁלוֹם', 'תוכן'),
    (2, 12, 8, 'Abstract', 'Edited article', 'Original content'),
    (3, 13, 9, '', 'Article without a document', NULL);

INSERT INTO article_search_doc
    (article_id, model_epoch, content_hash, plain_len, vector, terms, updated_at)
SELECT id, id + 4, content_hash, id + 100, X'00c1ff', X'12ee00', '2025-01-02 03:04:05'
FROM tanah_article WHERE id IN (1, 2);

INSERT INTO article_search_doc VALUES
    (4, 9, X'0123456789abcdef0123456789abcdef', 121, X'00a1ff', X'13ff00',
        '2025-01-03 03:04:05');

UPDATE tanah_article SET content = 'Current content' WHERE id = 2;
"""

ARTICLE_FIELDS = """
SELECT id, perek_id, author_id, HEX(abstract), HEX(name), HEX(content)
FROM tanah_article ORDER BY id;
"""
ARTICLE_HASHES = "SELECT id, HEX(content_hash) FROM tanah_article ORDER BY id;"
SEARCH_DOCUMENTS = """
SELECT article_id, HEX(content_hash), model_epoch, plain_len, HEX(vector),
    HEX(terms), updated_at
FROM article_search_doc ORDER BY article_id;
"""


def docker(*arguments, input_data=None, check=True, capture=True):
    executable = shutil.which("docker")
    if executable is None:
        raise RuntimeError("Docker is required for the fingerprint migration fixture")

    # nosemgrep: python.lang.security.audit.dangerous-subprocess-use-audit.dangerous-subprocess-use-audit
    return subprocess.run(  # nosec B603 # Resolved Docker executable and owned fixture argv.
        [str(Path(executable).resolve(strict=True)), *arguments],
        input=input_data,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.PIPE if not check and capture else None,
        check=check,
        shell=False,
    )


def wait_for_mysql(container):
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        # The initialization server only listens on its Unix socket.
        probe = docker(
            "exec",
            container,
            "mysqladmin",
            "--protocol=tcp",
            "ping",
            check=False,
        )
        if probe.returncode == 0:
            return
        time.sleep(0.25)
    docker("logs", container, check=False, capture=False)
    raise RuntimeError("The disposable MySQL server did not finish starting")


def mysql(container, sql):
    result = docker(
        "exec",
        "-i",
        container,
        "mysql",
        "--protocol=socket",
        "--batch",
        "--raw",
        "--skip-column-names",
        "--default-character-set=utf8mb4",
        f"--database={DATABASE}",
        input_data=sql,
    )
    return result.stdout.decode("utf-8").strip()


def rows(container, query):
    return [line.split("\t") for line in mysql(container, query.encode()).splitlines()]


def expected_digest(*fields):
    return hashlib.sha256("\x01".join(fields).encode("utf-8")).hexdigest()[:32].upper()


def assert_equal(label, actual, expected):
    if actual != expected:
        raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")


def exercise_migration(container, mysql_tag):
    assert_equal("MySQL version", mysql(container, b"SELECT VERSION();"), mysql_tag)
    mysql(container, SEED.encode())
    original_articles = rows(container, ARTICLE_FIELDS)
    legacy_hashes = dict(rows(container, ARTICLE_HASHES))
    fresh, stale, orphan = rows(container, SEARCH_DOCUMENTS)
    assert_equal("fixture fresh document", fresh[:2], ["1", legacy_hashes["1"]])
    if stale[0] != "2" or stale[1] == legacy_hashes["2"]:
        raise AssertionError("The fixture must start with article 2's stale document")

    expected_hashes = [
        ["1", expected_digest("שָׁלוֹם", "", "תוכן", "11", "7")],
        [
            "2",
            expected_digest("Edited article", "Abstract", "Current content", "12", "8"),
        ],
        ["3", expected_digest("Article without a document", "", "", "13", "9")],
    ]
    expected_docs = [["1", expected_hashes[0][1], *fresh[2:]], stale, orphan]
    migration = MIGRATION.read_bytes()
    for run in (1, 2):
        mysql(container, migration)
        assert_equal(
            f"run {run} source article fields",
            rows(container, ARTICLE_FIELDS),
            original_articles,
        )
        assert_equal(
            f"run {run} source fingerprints",
            rows(container, ARTICLE_HASHES),
            expected_hashes,
        )
        assert_equal(
            f"run {run} search documents",
            rows(container, SEARCH_DOCUMENTS),
            expected_docs,
        )

    mysql(container, b"UPDATE tanah_article SET abstract = 'Revised' WHERE id = 1;")
    expected_hashes[0][1] = expected_digest("שָׁלוֹם", "Revised", "תוכן", "11", "7")
    assert_equal(
        "generated fingerprints track edits",
        rows(container, ARTICLE_HASHES),
        expected_hashes,
    )
    assert_equal(
        "search document stays stale after edit",
        rows(container, SEARCH_DOCUMENTS),
        expected_docs,
    )
    print(f"MySQL {mysql_tag} fingerprint migration and retry passed")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mysql-tag", choices=("8.4.9", "8.4.13"), default="8.4.9")
    args = parser.parse_args()

    started = docker(
        "run",
        "--detach",
        "--rm",
        "--network",
        "none",
        "--env",
        "MYSQL_ALLOW_EMPTY_PASSWORD=yes",
        "--env",
        f"MYSQL_DATABASE={DATABASE}",
        f"mysql:{args.mysql_tag}",
    )
    container = started.stdout.decode("utf-8").strip()
    try:
        wait_for_mysql(container)
        exercise_migration(container, args.mysql_tag)
    finally:
        docker("stop", container)


if __name__ == "__main__":
    main()
