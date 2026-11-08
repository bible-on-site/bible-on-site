"""Validate deployed SQL files with the production Lambda's parser, in manifest order.

Use --parse-only for the database-free compatibility check used in Data CI.
Without --parse-only, execute the statements against a disposable local MySQL
database (the parser injects DROP TABLE/VIEW statements).

Usage:
    python devops/deploy/data-deploy/validate_lambda_parser.py [--db DB_URL] [--parse-only]

Paths are resolved from the script location, independent of the working directory.
SQL files live in the repository's data/mysql/ directory. perushim_data.sql is
loaded from the system temporary directory's perushim-sql/ subdirectory, with a
local SQL fallback.
"""

import argparse
import json
import os
import re
import sys
from pathlib import Path
from tempfile import gettempdir


# ---------------------------------------------------------------------------
# Exact copy of Lambda helper functions
# (must stay in sync with docs/aws/cloudformation/data-deploy/data-deploy-lambda.py)
# ---------------------------------------------------------------------------

def find_statement_end(buf):
    in_string = False
    i = 0
    length = len(buf)
    while i < length:
        ch = buf[i]
        if in_string:
            if ch == "\\":
                i += 2
                continue
            if ch == "'":
                if i + 1 < length and buf[i + 1] == "'":
                    i += 2
                    continue
                in_string = False
        else:
            if ch == "'":
                in_string = True
            elif ch == ";":
                return i
        i += 1
    return -1


def _should_execute(stmt):
    if not stmt:
        return False
    while stmt.startswith("--"):
        newline = stmt.find("\n")
        if newline == -1:
            return False
        stmt = stmt[newline + 1:].strip()
        if not stmt:
            return False
    if stmt.upper().startswith("USE "):
        return False
    if stmt.startswith("/*!") or stmt.startswith("/*M!"):
        return False
    if re.match(r"SET\s+.*=\s*@OLD_", stmt, re.IGNORECASE):
        return False
    if re.match(r"SET\s+@OLD_", stmt, re.IGNORECASE):
        return False
    return True


def preprocess_sql(sql_content):
    result = "SET FOREIGN_KEY_CHECKS = 0;\n"
    table_pattern = r'CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS\b)[`"]?(\w+)[`"]?'
    for match in re.finditer(table_pattern, sql_content, re.IGNORECASE):
        table_name = match.group(1)
        sql_content = sql_content.replace(
            match.group(0), f"DROP TABLE IF EXISTS `{table_name}`;\n{match.group(0)}"
        )
    view_pattern = r'CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+[`"]?(\w+)[`"]?'
    for match in re.finditer(view_pattern, sql_content, re.IGNORECASE):
        view_name = match.group(1)
        sql_content = sql_content.replace(
            match.group(0), f"DROP VIEW IF EXISTS `{view_name}`;\n{match.group(0)}"
        )
    result += sql_content
    result += "\nSET FOREIGN_KEY_CHECKS = 1;"
    return result


def parse_statements(sql_content):
    statements = []
    buf = sql_content
    while True:
        idx = find_statement_end(buf)
        if idx == -1:
            remaining = buf.strip()
            if remaining and _should_execute(remaining):
                statements.append(remaining)
            break
        stmt = buf[:idx].strip()
        buf = buf[idx + 1:]
        if stmt and _should_execute(stmt):
            statements.append(stmt)
    return statements


def simulate_streaming_parse(filepath):
    CHUNK = 1 * 1024 * 1024
    buf = ""
    statements = []
    with open(filepath, "r", encoding="utf-8") as f:
        while True:
            chunk = f.read(CHUNK)
            if not chunk:
                break
            buf += chunk
            while True:
                idx = find_statement_end(buf)
                if idx == -1:
                    break
                stmt = buf[:idx].strip()
                buf = buf[idx + 1:]
                if not _should_execute(stmt):
                    continue
                statements.append(stmt)
    remaining = buf.strip()
    if remaining and _should_execute(remaining):
        statements.append(remaining)
    return statements


def parse_file(filepath):
    """Parse a SQL file using the same logic path the Lambda uses."""
    size = os.path.getsize(filepath)
    if size > 10 * 1024 * 1024:
        return simulate_streaming_parse(filepath)
    else:
        with open(filepath, "r", encoding="utf-8") as f:
            content = f.read()
        content = preprocess_sql(content)
        return parse_statements(content)


_CREATE_KEYWORDS_RE = re.compile(
    r"\bCREATE\s+(?:TABLE|(?:OR\s+REPLACE\s+)?VIEW)\b", re.IGNORECASE
)


# The Lambda's find_statement_end ignores comments entirely: a `;` inside
# any comment still terminates a statement, an apostrophe toggles string
# state, and preprocess_sql's CREATE TABLE/VIEW rewrite matches inside
# comments. `/*!`/`/*M!` are MySQL conditional comments whose contents are
# executable SQL, so balanced apostrophes are allowed there.
def _check_comment(filepath, line_number, comment, executable):
    """Reject comment text the production splitter can misparse as SQL."""
    if ";" in comment or (not executable and "'" in comment):
        raise ValueError(
            f"{filepath}:{line_number}: Lambda-unsafe SQL comment "
            "contains a semicolon or apostrophe"
        )
    if _CREATE_KEYWORDS_RE.search(comment):
        raise ValueError(
            f"{filepath}:{line_number}: Lambda-unsafe SQL comment "
            "contains table/view creation keywords"
        )


def validate_lambda_safe_comments(filepath):
    """Scan every MySQL comment form for content that breaks the Lambda parser."""
    with open(filepath, "r", encoding="utf-8") as sql_file:
        buf = sql_file.read()
    i = 0
    n = len(buf)
    in_string = False
    while i < n:
        ch = buf[i]
        if in_string:
            if ch == "\\":
                i += 2
                continue
            if ch == "'":
                if i + 1 < n and buf[i + 1] == "'":
                    i += 2
                    continue
                in_string = False
            i += 1
            continue
        if ch == "'":
            in_string = True
            i += 1
            continue
        end = None
        executable = False
        if buf.startswith("--", i) and (i + 2 >= n or buf[i + 2] in " \t\r\n"):
            newline = buf.find("\n", i + 2)
            end = n if newline == -1 else newline
        elif ch == "#":
            newline = buf.find("\n", i + 1)
            end = n if newline == -1 else newline
        elif buf.startswith("/*!", i) or buf.startswith("/*M!", i):
            close = buf.find("*/", i + 2)
            end = n if close == -1 else close + 2
            executable = True
        elif buf.startswith("/*", i):
            close = buf.find("*/", i + 2)
            end = n if close == -1 else close + 2
        if end is None:
            i += 1
            continue
        _check_comment(
            filepath, buf.count("\n", 0, i) + 1, buf[i:end], executable
        )
        i = end


# Statement-start keywords the deployed files may legitimately begin with once
# leading comments are stripped. Anything else means comment prose or dump
# noise leaked into an "executable" statement.
_VALID_STATEMENT_STARTS = {
    "ALTER", "ANALYZE", "BEGIN", "CALL", "COMMIT", "CREATE", "DEALLOCATE",
    "DELETE", "DROP", "EXECUTE", "GRANT", "INSERT", "LOAD", "LOCK",
    "OPTIMIZE", "PREPARE", "RENAME", "REPLACE", "REVOKE", "SELECT", "SET",
    "TRUNCATE", "UNLOCK", "UPDATE", "WITH",
}


def _strip_leading_comments(stmt):
    while True:
        s = stmt.lstrip()
        if s.startswith("--") or s.startswith("#"):
            newline = s.find("\n")
            if newline == -1:
                return ""
            stmt = s[newline + 1:]
            continue
        if s.startswith("/*"):
            close = s.find("*/", 2)
            if close == -1:
                return s
            stmt = s[close + 2:]
            continue
        return s


# A `;` inside a comment splits the stream mid-comment; the prose fragment
# after it survives _should_execute and would run (and fail) on prod.
def validate_parsed_statements(name, stmts):
    """Reject parsed statements that don't start with a real SQL keyword."""
    for i, stmt in enumerate(stmts):
        head = _strip_leading_comments(stmt)
        word = re.match(r"[A-Za-z]+", head)
        if not word or word.group(0).upper() not in _VALID_STATEMENT_STARTS:
            preview = head[:120].encode("ascii", errors="replace").decode("ascii")
            raise ValueError(
                f"{name}: parsed statement #{i} does not start with a SQL "
                "keyword (likely comment prose leaked by a stray ';'): "
                f"{preview!r}"
            )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", dest="db_url")
    parser.add_argument("--parse-only", action="store_true")
    args = parser.parse_args()

    script_dir = Path(__file__).resolve().parent
    repo_root = script_dir.parents[2]
    data_dir = repo_root / "data" / "mysql"

    manifest_path = script_dir / "sql-files.json"
    with open(manifest_path, "r", encoding="utf-8") as manifest_file:
        deploy_files = json.load(manifest_file)

    # perushim_data.sql comes from the artifact.
    artifact_path = Path(gettempdir()) / "perushim-sql" / "perushim_data.sql"
    local_perushim_path = data_dir / "perushim_data.sql"

    sql_files = []
    for name in deploy_files:
        if name == "perushim_data.sql":
            if artifact_path.is_file():
                sql_files.append((name, artifact_path))
            elif local_perushim_path.is_file():
                sql_files.append((name, local_perushim_path))
            else:
                print(
                    "WARNING: perushim_data.sql not found at "
                    f"{artifact_path} or {local_perushim_path}"
                )
            continue
        sql_files.append((name, data_dir / name))

    all_stmts = []
    for name, fpath in sql_files:
        if not fpath.is_file():
            print(f"SKIP: {name} not found at {fpath}")
            continue
        validate_lambda_safe_comments(fpath)
        size_mb = os.path.getsize(fpath) / (1024 * 1024)
        path_type = "streaming" if size_mb > 10 else "preprocess"
        stmts = parse_file(fpath)
        validate_parsed_statements(name, stmts)
        print(f"  {name}: {len(stmts)} stmts ({size_mb:.1f} MB, {path_type})")
        all_stmts.extend(stmts)

    print(f"\nTotal: {len(all_stmts)} executable statements across {len(sql_files)} files")

    if args.parse_only:
        print("LAMBDA PARSER VALIDATION PASSED.")
        return

    # Try executing against local MySQL
    try:
        import pymysql
    except ImportError:
        print("\npymysql not installed — skipping live DB validation.")
        sys.exit(0)

    db_url = args.db_url or os.environ.get(
        "DB_URL",
        "mysql://root:test_123@localhost:3306/tanah-dev?ssl-mode=DISABLED",
    )
    from urllib.parse import urlparse
    parsed = urlparse(db_url)
    db_name = parsed.path.lstrip("/").split("?")[0]

    conn = pymysql.connect(
        host=parsed.hostname,
        port=parsed.port or 3306,
        user=parsed.username,
        password=parsed.password,
        database=db_name,
        autocommit=True,
    )

    print(f"\nExecuting {len(all_stmts)} statements against {parsed.hostname}/{db_name} ...")
    try:
        with conn.cursor() as cursor:
            cursor.execute("SET FOREIGN_KEY_CHECKS = 0")
            for i, stmt in enumerate(all_stmts):
                try:
                    cursor.execute(stmt)
                except pymysql.Error as e:
                    preview = stmt[:300].encode("ascii", errors="replace").decode("ascii")
                    print(f"\n*** FAILED at statement {i}: {e}")
                    print(f"    {preview}...")
                    sys.exit(1)
                if (i + 1) % 1000 == 0:
                    print(f"  ... {i + 1}/{len(all_stmts)}")
            cursor.execute("SET FOREIGN_KEY_CHECKS = 1")
    finally:
        conn.close()

    # Quick data check
    conn2 = pymysql.connect(
        host=parsed.hostname, port=parsed.port or 3306,
        user=parsed.username, password=parsed.password,
        database=db_name, autocommit=True,
    )
    try:
        with conn2.cursor() as cur:
            for table in ["tanah_helek", "tanah_sefer", "tanah_perek", "parshan", "perush", "note"]:
                try:
                    cur.execute(f"SELECT COUNT(*) FROM {table}")
                    count = cur.fetchone()[0]
                    print(f"  {table}: {count} rows")
                except pymysql.err.ProgrammingError:
                    print(f"  {table}: (not found)")
    finally:
        conn2.close()

    print(f"\nAll {len(all_stmts)} statements executed successfully!")
    print("VALIDATION PASSED.")


if __name__ == "__main__":
    main()
