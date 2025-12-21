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


def is_remote_pre_commit() -> bool:
    """Detect if running in pre-commit.ci or similar remote CI environment.

    pre-commit.ci doesn't set standard CI env vars (CI, GITHUB_ACTIONS, PRE_COMMIT_CI),
    but runs from /code/ directory. We detect this by checking the path.
    """
    # Check standard CI env vars first
    ci_env_vars = ["CI", "GITHUB_ACTIONS", "PRE_COMMIT_CI"]
    if any(os.environ.get(var) for var in ci_env_vars):
        return True

    # pre-commit.ci runs from /code/ directory
    cwd = str(Path.cwd())
    script_path = str(Path(__file__).resolve())
    if cwd.startswith("/code") or script_path.startswith("/code"):
        return True

    return False


def main() -> int:
    config_file = CI_CONFIG if is_remote_pre_commit() else LOCAL_CONFIG

    cmd = [sys.executable, "-m", "md_dead_link_check",
           "--config", str(config_file), *sys.argv[1:]]

    result = subprocess.run(cmd)
    return result.returncode


if __name__ == "__main__":
    sys.exit(main())
