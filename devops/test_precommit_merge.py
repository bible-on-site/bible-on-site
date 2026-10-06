"""Exercise the module hook runner against an in-progress branch merge."""

import shutil
import subprocess  # nosec B404: fixed test fixture commands, argument vectors, no shell.
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
GIT = shutil.which("git")
NODE = shutil.which("node")
RUNNER = ROOT / "devops" / "precommit-run.mjs"


@unittest.skipUnless(NODE and GIT, "Node and Git are required")
class PrecommitMergeTests(unittest.TestCase):
    def test_merge_checks_only_changes_to_the_target_branch(self):
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory)

            def git(*args):
                # All arguments below are fixed fixture commands; resolve the executable.
                subprocess.run(  # nosec B603: fixed fixture argv, no shell.  # nosemgrep
                    [GIT, *args], cwd=repo, check=True, capture_output=True
                )

            def write(name, content):
                path = repo / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content, encoding="utf-8", newline="\n")

            git("init", "-b", "master")
            git("config", "user.name", "Hook Test")
            git("config", "user.email", "hook-test@example.invalid")
            write("app/example.txt", "base")
            write("web/admin/example.txt", "base")
            git("add", ".")
            git("commit", "-m", "base")
            git("checkout", "-b", "feature")
            write("app/example.txt", "feature")
            git("add", ".")
            git("commit", "-m", "app fix")
            git("checkout", "master")
            write("web/admin/example.txt", "already on master")
            git("add", ".")
            git("commit", "-m", "admin release")
            git("checkout", "feature")
            git("merge", "--no-commit", "master")

            # Execute the real runner with no user-supplied command. The probe
            # prints a fixed marker to stdout only when the runner decides the
            # module has changes relative to the merge target.
            def run_hook(module):
                return subprocess.run(  # nosec B603: fixed fixture argv, no shell.  # nosemgrep
                    [
                        NODE,
                        str(RUNNER),
                        module,
                        "git",
                        "rev-parse",
                        "--is-inside-work-tree",
                    ],
                    cwd=repo,
                    capture_output=True,
                    text=True,
                    check=True,
                )

            # web/admin changes arrive via the merge (already published on the
            # target) — the module hook must not run for them.
            self.assertNotIn("true", run_hook("web/admin").stdout)
            # app changes are ours — the module hook runs.
            self.assertIn("true", run_hook("app").stdout)


if __name__ == "__main__":
    unittest.main()
