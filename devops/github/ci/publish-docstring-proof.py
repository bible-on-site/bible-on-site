"""Prove only the audited annotation publisher's leading docstring changed."""

import ast
import base64
import hashlib
import json
import sys

# publish.py reads __doc__ only as ArgumentParser help. Pin the audited remaining
# bytes so future code/consumers conservatively retain delivery until re-audited.
AUDITED_BODY_SHA256 = "e07b4815c5a65803b40f3ac59aed8de90faef497a38a33bd10663dc49efd0750"


def non_doc_bytes(source):
    """Return the exact prefix/suffix outside the first module docstring."""
    # AST columns are UTF-8 byte offsets. Support LF/CRLF without treating other
    # Unicode line separators inside strings as physical source line breaks.
    if b"\r" in source.replace(b"\r\n", b""):
        raise ValueError("Unsupported standalone carriage return")
    module = ast.parse(source.decode("utf-8"))
    if not module.body:
        raise ValueError("Missing module docstring")
    first = module.body[0]
    if not (
        isinstance(first, ast.Expr)
        and isinstance(first.value, ast.Constant)
        and isinstance(first.value.value, str)
        and first.end_lineno is not None
        and first.end_col_offset is not None
    ):
        raise ValueError("First statement is not a module docstring")
    starts = [0] + [index + 1 for index, value in enumerate(source) if value == 10]
    start = starts[first.lineno - 1] + first.col_offset
    end = starts[first.end_lineno - 1] + first.end_col_offset
    return source[:start], source[end:]


def prove(request):
    """Fail closed unless both valid sources retain the audited exact body."""
    if not isinstance(request, dict) or set(request) != {"base", "head"}:
        return False
    if not all(isinstance(request[key], str) for key in ("base", "head")):
        return False
    before = non_doc_bytes(base64.b64decode(request["base"], validate=True))
    after = non_doc_bytes(base64.b64decode(request["head"], validate=True))
    return (
        before == after
        and hashlib.sha256(before[0] + b"\0" + before[1]).hexdigest()
        == AUDITED_BODY_SHA256
    )


def main():
    """Read blobs from stdin without importing or executing their Python code."""
    try:
        result = prove(json.load(sys.stdin))
    except (ValueError, SyntaxError, TypeError):
        result = False
    print(json.dumps(result))


if __name__ == "__main__":
    main()