"""
Local validation: simulate the Lambda's SQL parsing on all 4 SQL files
(same order as the deployer) and verify every extracted statement is
syntactically valid by executing it against a local MySQL instance.

Usage:
    python validate_lambda_parser.py [--db DB_URL]

The script locates the SQL files at data/mysql/ relative to itself.
perushim_data.sql is expected in /tmp/perushim-sql/ (downloaded artifact).
"""

import sys
import os
import re


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
    table_pattern = r'CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?(\w+)[`"]?'
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


def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    data_dir = os.path.join(script_dir, "data", "mysql")

    sql_files = [
        ("tanah_static_structure.sql", os.path.join(data_dir, "tanah_static_structure.sql")),
        ("tanah_sefarim_and_perakim_data.sql", os.path.join(data_dir, "tanah_sefarim_and_perakim_data.sql")),
        ("perushim_structure.sql", os.path.join(data_dir, "perushim_structure.sql")),
    ]

    # perushim_data.sql comes from the artifact
    artifact_path = os.path.join(os.environ.get("TEMP", "/tmp"), "perushim-sql", "perushim_data.sql")
    if os.path.isfile(artifact_path):
        sql_files.append(("perushim_data.sql", artifact_path))
    else:
        local_path = os.path.join(data_dir, "perushim_data.sql")
        if os.path.isfile(local_path):
            sql_files.append(("perushim_data.sql", local_path))
        else:
            print(f"WARNING: perushim_data.sql not found at {artifact_path} or {local_path}")

    all_stmts = []
    for name, fpath in sql_files:
        if not os.path.isfile(fpath):
            print(f"SKIP: {name} not found at {fpath}")
            continue
        size_mb = os.path.getsize(fpath) / (1024 * 1024)
        path_type = "streaming" if size_mb > 10 else "preprocess"
        stmts = parse_file(fpath)
        print(f"  {name}: {len(stmts)} stmts ({size_mb:.1f} MB, {path_type})")
        all_stmts.extend(stmts)

    print(f"\nTotal: {len(all_stmts)} executable statements across {len(sql_files)} files")

    # Try executing against local MySQL
    try:
        import pymysql
    except ImportError:
        print("\npymysql not installed — skipping live DB validation.")
        sys.exit(0)

    db_url = os.environ.get("DB_URL", "mysql://root:test_123@localhost:3306/tanah-dev?ssl-mode=DISABLED")
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
                except Exception as e:
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
                except Exception:
                    print(f"  {table}: (not found)")
    finally:
        conn2.close()

    print(f"\nAll {len(all_stmts)} statements executed successfully!")
    print("VALIDATION PASSED.")


if __name__ == "__main__":
    main()
