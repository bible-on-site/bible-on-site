#!/usr/bin/env python3
"""
Wrapper script for md-dead-link-check that uses a CI-specific config
when running in CI environments (no external network access).
"""

import os
import subprocess
import sys
from pathlib import Path

DEVOPS_DIR = Path(__file__).parent
CI_CONFIG = DEVOPS_DIR / "pyproject.ci.toml"
LOCAL_CONFIG = DEVOPS_DIR / "pyproject.toml"


def is_ci() -> bool:
    """Detect if running in a CI environment."""
    ci_env_vars = ["CI", "GITHUB_ACTIONS", "PRE_COMMIT_CI"]
    return any(os.environ.get(var) for var in ci_env_vars)


def main() -> int:
    config_file = CI_CONFIG if is_ci() else LOCAL_CONFIG

    cmd = [sys.executable, "-m", "md_dead_link_check",
           "--config", str(config_file), *sys.argv[1:]]

    result = subprocess.run(cmd)
    return result.returncode


if __name__ == "__main__":
    sys.exit(main())
