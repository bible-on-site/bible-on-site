"""
Lambda function for deploying SQL data to RDS MySQL.

This Lambda is deployed as: bible-on-site-db-populator
Runtime: Python 3.11
Handler: index.handler

Deployment:
    mkdir lambda-package && cd lambda-package
    pip install pymysql -t .
    cp data-deploy-lambda.py index.py
    zip -r ../lambda.zip .
    aws lambda update-function-code \
        --function-name bible-on-site-db-populator \
        --zip-file fileb://lambda.zip \
        --region il-central-1
"""

import json
import os
import re
import boto3
import pymysql


def handler(event, context):
    """
    Lambda handler for database population.

    Expected event format:
    {
        "sql_files": ["file1.sql", "file2.sql"],
        "s3_prefix": "sql/2024-01-01-120000/"
    }

    The handler:
    1. Retrieves DB credentials from SSM Parameter Store
    2. Downloads SQL files from S3
    3. Preprocesses SQL to add DROP TABLE/VIEW IF EXISTS
    4. Filters out MySQL dump artifacts
    5. Executes statements against RDS MySQL
    """
    ssm = boto3.client("ssm")
    s3 = boto3.client("s3")

    bucket = os.environ.get("S3_BUCKET", "bible-on-site-data-deploy")
    ssm_prefix = os.environ.get("SSM_PREFIX", "bible-on-site-tanah-db")

    # Get database credentials from SSM
    params = ssm.get_parameters(
        Names=[
            f"{ssm_prefix}-host",
            f"{ssm_prefix}-port",
            f"{ssm_prefix}-name",
            f"{ssm_prefix}-username",
            f"{ssm_prefix}-url",
        ],
        WithDecryption=True,
    )

    param_dict = {p["Name"].split("-")[-1]: p["Value"] for p in params["Parameters"]}

    # Extract password from URL (format: mysql://user:pass@host:port/db)
    db_url = param_dict.get("url", "")
    password = db_url.split(":")[2].split("@")[0] if "://" in db_url else ""

    # Connect to database
    connection = pymysql.connect(
        host=param_dict["host"],
        port=int(param_dict.get("port", 3306)),
        user=param_dict["username"],
        password=password,
        database=param_dict["name"],
        connect_timeout=30,
        autocommit=True,
    )

    try:
        sql_files = event.get("sql_files", [])
        s3_prefix = event.get("s3_prefix", "")
        results = []

        for sql_file in sql_files:
            s3_key = f"{s3_prefix}{sql_file}"
            print(f"Processing: s3://{bucket}/{s3_key}")

            response = s3.get_object(Bucket=bucket, Key=s3_key)
            content_length = response.get("ContentLength", 0)

            # For large files (>10 MB), stream-process in chunks to reduce memory
            if content_length > 10 * 1024 * 1024:
                count = execute_sql_streaming(response["Body"], connection)
            else:
                # Small files: load into memory for preprocessing
                sql_content = response["Body"].read().decode("utf-8")
                sql_content = preprocess_sql(sql_content)
                with connection.cursor() as cursor:
                    stmts = parse_statements(sql_content)
                    for stmt in stmts:
                        try:
                            cursor.execute(stmt)
                        except Exception as e:
                            print(f"Error executing: {stmt[:100]}...")
                            raise
                count = len(stmts)

            results.append(
                {"file": sql_file, "statements": count, "status": "success"}
            )
            print(f"Executed {count} statements from {sql_file}")

        return {
            "statusCode": 200,
            "body": json.dumps({"message": "Database population completed", "results": results}),
        }
    finally:
        connection.close()


def find_statement_end(buf):
    """
    Find the index of the first ';' that is NOT inside a SQL string literal.

    Tracks single-quoted strings and skips semicolons that appear within
    them.  Inside a string the following escape sequences are recognised
    (MySQL default behaviour):

    * ``''``  – SQL-standard doubled quote  (literal ``'``)
    * ``\\'`` – backslash-escaped quote     (literal ``'``)
    * ``\\\\`` – escaped backslash           (literal ``\\``)
    * Any other ``\\X`` – skip the backslash and the next char

    Returns the index of the terminating ';', or -1 if no unquoted ';'
    exists in *buf*.
    """
    in_string = False
    i = 0
    length = len(buf)
    while i < length:
        ch = buf[i]
        if in_string:
            if ch == "\\":
                # Backslash escape: skip the next character whatever it is
                i += 2
                continue
            if ch == "'":
                # Lookahead: '' is an escaped quote, stay in string
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


def execute_sql_streaming(body, connection):
    """
    Stream-process a large SQL file from S3 to avoid loading it entirely
    into memory.  Reads the S3 body in 1 MB chunks, accumulates a buffer,
    and executes each semicolon-terminated statement as it is found.

    Uses quote-aware splitting so that semicolons inside SQL string
    literals (e.g. in perush names or note HTML) are not mistaken for
    statement terminators.

    An incremental UTF-8 decoder is used so that multi-byte characters
    split across chunk boundaries are handled correctly.

    Only INSERT/CREATE/DROP/SET/TRUNCATE statements are executed;
    comments, USE, and MySQL dump artifacts are skipped.
    """
    import codecs

    CHUNK = 1 * 1024 * 1024  # 1 MB
    decoder = codecs.getincrementaldecoder("utf-8")("replace")
    buf = ""
    count = 0

    with connection.cursor() as cursor:
        cursor.execute("SET FOREIGN_KEY_CHECKS = 0")

        for chunk in body.iter_chunks(chunk_size=CHUNK):
            buf += decoder.decode(chunk, final=False)

            while True:
                idx = find_statement_end(buf)
                if idx == -1:
                    break
                stmt = buf[:idx].strip()
                buf = buf[idx + 1 :]

                if not _should_execute(stmt):
                    continue

                # Handle CREATE TABLE → add DROP TABLE IF EXISTS
                table_match = re.match(
                    r'CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?(\w+)[`"]?',
                    stmt,
                    re.IGNORECASE,
                )
                if table_match:
                    cursor.execute(
                        f"DROP TABLE IF EXISTS `{table_match.group(1)}`"
                    )

                cursor.execute(stmt)
                count += 1

        # Flush the decoder for any remaining partial bytes
        buf += decoder.decode(b"", final=True)

        # Process remaining buffer
        stmt = buf.strip()
        if stmt and _should_execute(stmt):
            cursor.execute(stmt)
            count += 1

        cursor.execute("SET FOREIGN_KEY_CHECKS = 1")

    return count


def parse_statements(sql_content):
    """
    Parse SQL into executable statements using quote-aware splitting.

    Handles semicolons inside string literals correctly, and filters
    out comments, USE statements, and MySQL dump artifacts.
    """
    statements = []
    buf = sql_content
    while True:
        idx = find_statement_end(buf)
        if idx == -1:
            # Handle trailing statement without semicolon
            remaining = buf.strip()
            if remaining and _should_execute(remaining):
                statements.append(remaining)
            break
        stmt = buf[:idx].strip()
        buf = buf[idx + 1 :]
        if stmt and _should_execute(stmt):
            statements.append(stmt)
    return statements


def _should_execute(stmt):
    """Return True if *stmt* is a SQL statement that should be executed."""
    if not stmt:
        return False
    # Strip leading SQL line-comments so the real statement is exposed.
    # Comments in our generated SQL are standalone lines (e.g. "-- parshan")
    # that may be glued to the next INSERT when splitting by ";".
    while stmt.startswith("--"):
        newline = stmt.find("\n")
        if newline == -1:
            return False  # entire content is a comment
        stmt = stmt[newline + 1 :].strip()
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
    """
    Add DROP statements before CREATE TABLE/VIEW.

    This ensures idempotent deployments - the same SQL can be
    run multiple times without "already exists" errors.
    """
    result = "SET FOREIGN_KEY_CHECKS = 0;\n"

    # Handle CREATE TABLE - add DROP TABLE IF EXISTS before each
    table_pattern = r'CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?(\w+)[`"]?'
    for match in re.finditer(table_pattern, sql_content, re.IGNORECASE):
        table_name = match.group(1)
        sql_content = sql_content.replace(
            match.group(0), f"DROP TABLE IF EXISTS `{table_name}`;\n{match.group(0)}"
        )

    # Handle CREATE VIEW - add DROP VIEW IF EXISTS before each
    view_pattern = r'CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+[`"]?(\w+)[`"]?'
    for match in re.finditer(view_pattern, sql_content, re.IGNORECASE):
        view_name = match.group(1)
        sql_content = sql_content.replace(
            match.group(0), f"DROP VIEW IF EXISTS `{view_name}`;\n{match.group(0)}"
        )

    result += sql_content
    result += "\nSET FOREIGN_KEY_CHECKS = 1;"

    return result
