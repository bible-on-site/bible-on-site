"""Exercise the module hook runner: merge-aware gating and --related narrowing."""

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


@unittest.skipUnless(NODE and GIT, "Node and Git are required")
class PrecommitRelatedTests(unittest.TestCase):
    def setUp(self):
        """Build a repo whose probes echo argv in place of real test runners."""
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.repo = Path(self._tmp.name)
        self.git("init", "-b", "master")
        self.git("config", "user.name", "Hook Test")
        self.git("config", "user.email", "hook-test@example.invalid")
        # probe.mjs echoes its argv so tests can assert which command ran and
        # which staged files were appended; probe-no-tests.mjs emits the "no
        # tests" marker a runner prints when the related set maps to nothing.
        self.write(
            "probe.mjs",
            'console.log("PROBE ARGS:", process.argv.slice(2).join(" "))\n',
        )
        self.write(
            "probe-no-tests.mjs",
            'console.log("No tests found, exiting with code 1"); process.exit(1)\n',
        )
        self.write("other/file.txt", "outside the module")
        self.write("web/mod/src/example.ts", "export {}")
        self.write("web/mod/src/util/helper.ts", "export {}")
        # A JS module with installed dependencies — without node_modules the
        # runner's skip gate fires before any related/fallback decision.
        self.write("web/mod/package.json", '{"name": "mod"}')
        self.write("web/mod/node_modules/.keep", "")
        self.git("add", ".")
        self.git("commit", "-m", "base")

    def git(self, *args):
        # All arguments below are fixed fixture commands; resolve the executable.
        subprocess.run(  # nosec B603: fixed fixture argv, no shell.  # nosemgrep
            [GIT, *args], cwd=self.repo, check=True, capture_output=True
        )

    def write(self, name, content):
        path = self.repo / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8", newline="\n")

    def run_hook(self, *args, check=False):
        return subprocess.run(  # nosec B603: fixed fixture argv, no shell.  # nosemgrep
            [NODE, str(RUNNER), *args],
            cwd=self.repo,
            capture_output=True,
            text=True,
            check=check,
        )

    def related_hook(self, related="probe.mjs"):
        return self.run_hook(
            "--related",
            "web/mod",
            "node",
            "../../probe.mjs",
            "full",
            "::",
            "node",
            f"../../{related}",
            "related",
        )

    def test_related_appends_module_relative_staged_files(self):
        self.write("web/mod/src/example.ts", "changed")
        self.write("web/mod/src/util/helper.ts", "changed")
        self.write("other/file.txt", "outside the module")
        self.git("add", ".")
        result = self.related_hook()
        self.assertEqual(result.returncode, 0, result.stderr)
        # Files are module-relative (the command runs inside web/mod) and
        # exclude paths outside the module.
        self.assertIn(
            "PROBE ARGS: related src/example.ts src/util/helper.ts",
            result.stdout,
        )
        self.assertNotIn("PROBE ARGS: full", result.stdout)

    def test_related_falls_back_for_suite_wide_paths(self):
        # One representative per denylist bucket: module-root file, dotfile,
        # nested *.config.*, setup file, public/ and scripts/ — each must take
        # the full-suite path regardless of other staged sources.
        for staged in (
            "package.json",
            ".env",
            "src/nested/tool.config.ts",
            "tests/setup.ts",
            "public/logo.png",
            "scripts/build.mjs",
        ):
            with self.subTest(staged=staged):
                self.write(f"web/mod/{staged}", '{"name": "mod2"}')
                self.write("web/mod/src/example.ts", "changed")
                self.git("add", f"web/mod/{staged}", "web/mod/src/example.ts")
                result = self.related_hook()
                self.assertIn("PROBE ARGS: full", result.stdout)
                self.assertNotIn("PROBE ARGS: related", result.stdout)
                self.git("reset", "-q")

    def test_related_falls_back_when_no_tests_match(self):
        self.write("web/mod/src/example.ts", "changed")
        self.git("add", ".")
        result = self.related_hook(related="probe-no-tests.mjs")
        # Zero matched tests is inconclusive — the full suite must still run.
        self.assertIn("No tests found", result.stdout)
        self.assertIn("PROBE ARGS: full", result.stdout)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_related_failure_without_marker_propagates(self):
        self.write("probe-fail.mjs", 'console.log("PROBE FAIL"); process.exit(3)\n')
        self.write("web/mod/src/example.ts", "changed")
        self.git("add", ".")
        result = self.related_hook(related="probe-fail.mjs")
        # A real failure is not the no-tests case — no full-suite rerun.
        self.assertEqual(result.returncode, 3, result.stderr)
        self.assertNotIn("PROBE ARGS: full", result.stdout)

    def test_related_skips_when_module_not_staged(self):
        self.write("other/file.txt", "changed")
        self.git("add", ".")
        result = self.related_hook()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("PROBE", result.stdout)

    def test_related_skips_without_node_modules(self):
        # A JS module (package.json) with no installed dependencies skips —
        # even a suite-wide file like package.json never reaches the fallback.
        self.write("web/nm/package.json", "{}")
        self.write("web/nm/src/example.ts", "export {}")
        self.git("add", ".")
        result = self.run_hook(
            "--related",
            "web/nm",
            "node",
            "../../probe.mjs",
            "full",
            "::",
            "node",
            "../../probe.mjs",
            "related",
        )
        self.assertIn("Skipping web/nm", result.stdout)
        self.assertNotIn("PROBE", result.stdout)

    def test_related_requires_separator(self):
        self.write("web/mod/src/example.ts", "changed")
        self.git("add", ".")
        # --related without `::` and `::` without --related are both invalid.
        self.assertEqual(
            self.run_hook("--related", "web/mod", "node", "x.mjs").returncode, 2
        )
        self.assertEqual(
            self.run_hook(
                "web/mod", "node", "x.mjs", "::", "node", "y.mjs"
            ).returncode,
            2,
        )


if __name__ == "__main__":
    unittest.main()
