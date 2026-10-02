"""Exercise the real commit hook against an in-progress branch merge."""

import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
GIT_BASH = Path("C:/Program Files/Git/bin/bash.exe")
BASH = str(GIT_BASH) if GIT_BASH.exists() else shutil.which("bash")


@unittest.skipUnless(BASH and shutil.which("git"), "Git and Bash are required")
class PrecommitMergeTests(unittest.TestCase):
    def test_merge_checks_only_changes_to_the_target_branch(self):
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory)

            def git(*args):
                subprocess.run(
                    ["git", *args], cwd=repo, check=True, capture_output=True
                )

            def write(name, content):
                path = repo / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content, encoding="utf-8", newline="\n")

            git("init", "-b", "master")
            git("config", "user.name", "Hook Test")
            git("config", "user.email", "hook-test@example.invalid")
            # Avoid invoking configured hooks while constructing the fixture.
            git("config", "core.hooksPath", ".unused-hooks")
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

            write(".husky/pre-commit", (ROOT / ".husky/pre-commit").read_text(encoding="utf-8"))
            write(".husky/shared-checks.sh", "#!/bin/bash\necho \"$1\" >> checked-modules\n")
            # The old hook incorrectly enters the admin branch; keep its lint harmless.
            write("bin/npm", "#!/bin/bash\nexit 0\n")
            (repo / "bin/npm").chmod(0o755)
            env = os.environ.copy()
            env["PATH"] = str(repo / "bin") + os.pathsep + env["PATH"]
            subprocess.run([BASH, ".husky/pre-commit"], cwd=repo, env=env, check=True)
            self.assertEqual(["app"], (repo / "checked-modules").read_text().splitlines())


if __name__ == "__main__":
    unittest.main()
