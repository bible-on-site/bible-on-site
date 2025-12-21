#!/usr/bin/env python3
"""
Wrapper script for md-dead-link-check that uses a CI-specific config
when running in CI environments (no external network access).
"""

import os
import subprocess
import sys
from pathlib import Path

# Resolve the script's directory, following symlinks
DEVOPS_DIR = Path(__file__).resolve().parent
CI_CONFIG = DEVOPS_DIR / "pyproject.ci.toml"
LOCAL_CONFIG = DEVOPS_DIR / "pyproject.toml"


def is_ci() -> bool:
    """Detect if running in a CI environment."""
    ci_env_vars = ["CI", "GITHUB_ACTIONS", "PRE_COMMIT_CI"]
    result = any(os.environ.get(var) for var in ci_env_vars)
    if result:
        print(f"[md-dead-link-check-wrapper] CI detected, using config: {CI_CONFIG}", file=sys.stderr)
    else:
        print(f"[md-dead-link-check-wrapper] Local run, using config: {LOCAL_CONFIG}", file=sys.stderr)
    return result


def main() -> int:
    config_file = CI_CONFIG if is_ci() else LOCAL_CONFIG

    if not config_file.exists():
        print(f"[md-dead-link-check-wrapper] ERROR: Config file not found: {config_file}", file=sys.stderr)
        print(f"[md-dead-link-check-wrapper] Script location: {Path(__file__).resolve()}", file=sys.stderr)
        print(f"[md-dead-link-check-wrapper] CWD: {Path.cwd()}", file=sys.stderr)
        return 1

    cmd = [sys.executable, "-m", "md_dead_link_check",
           "--config", str(config_file), *sys.argv[1:]]

    result = subprocess.run(cmd)
    return result.returncode


if __name__ == "__main__":
    sys.exit(main())
