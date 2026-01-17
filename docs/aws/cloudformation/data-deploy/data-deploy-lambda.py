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

            # Download SQL from S3
            response = s3.get_object(Bucket=bucket, Key=s3_key)
            sql_content = response["Body"].read().decode("utf-8")

            # Preprocess SQL to handle existing tables/views
            sql_content = preprocess_sql(sql_content)

            # Execute SQL statements
            with connection.cursor() as cursor:
                statements = parse_statements(sql_content)
                for stmt in statements:
                    try:
                        cursor.execute(stmt)
                    except Exception as e:
                        print(f"Error executing: {stmt[:100]}...")
                        raise
                results.append(
                    {"file": sql_file, "statements": len(statements), "status": "success"}
                )
            print(f"Executed {len(statements)} statements from {sql_file}")

        return {
            "statusCode": 200,
            "body": json.dumps({"message": "Database population completed", "results": results}),
        }
    finally:
        connection.close()


def parse_statements(sql_content):
    """
    Parse SQL into statements, filtering out problematic ones.

    Filters:
    - Empty statements
    - SQL comments (--)
    - USE database statements
    - MySQL dump artifacts (/*!40101 ... */)
    - SET statements that restore @OLD_ variables (often NULL)
    """
    statements = []
    for s in sql_content.split(";"):
        s = s.strip()
        if not s:
            continue
        # Skip comments
        if s.startswith("--"):
            continue
        # Skip USE statements
        if s.upper().startswith("USE "):
            continue
        # Skip MySQL dump artifacts (/*!40101 ... */)
        if s.startswith("/*!") or s.startswith("/*M!"):
            continue
        # Skip SET statements that restore old values (often NULL)
        if re.match(r"SET\s+.*=\s*@OLD_", s, re.IGNORECASE):
            continue
        if re.match(r"SET\s+@OLD_", s, re.IGNORECASE):
            continue
        statements.append(s)
    return statements


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
