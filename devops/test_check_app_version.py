"""Focused checks for the app version pre-commit hook."""

import importlib.util
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("check-app-version.py")
SPEC = importlib.util.spec_from_file_location("check_app_version", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class CheckAppVersionTests(unittest.TestCase):
    def check(self, display: str, shared: int, windows: int) -> list[str]:
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory) / "app.csproj"
            project.write_text(
                "<Project><PropertyGroup>"
                f"<ApplicationDisplayVersion>{display}</ApplicationDisplayVersion>"
                "<ApplicationVersion Condition=\"'$(TargetFramework)' != 'windows'\">"
                f"{shared}</ApplicationVersion>"
                "<ApplicationVersion Condition=\"'$(TargetFramework)' == 'windows'\">"
                f"{windows}</ApplicationVersion>"
                "</PropertyGroup></Project>",
                encoding="utf-8",
            )
            return MODULE.check_version(project)

    def test_aligned_release(self):
        self.assertEqual([], self.check("5.0.94", 50000094, 0))

    def test_old_one_step_offset_is_rejected(self):
        errors = self.check("5.0.93", 50000092, 1)
        self.assertEqual(2, len(errors))

    def test_minor_bump_resets_patch_but_not_the_shared_build_number(self):
        self.assertEqual([], self.check("5.1.0", 50100000, 0))

    def test_next_patch_after_minor_bump(self):
        self.assertEqual([], self.check("5.1.2", 50100002, 0))

    def test_shared_build_number_must_not_fall_back_to_patch(self):
        errors = self.check("5.1.0", 0, 0)
        self.assertEqual(1, len(errors))
        self.assertIn("50100000", errors[0])

    def test_windows_revision_must_stay_zero(self):
        errors = self.check("5.1.0", 50100000, 224)
        self.assertEqual(1, len(errors))
        self.assertIn("windows", errors[0])

    def test_patch_must_fit_the_shared_encoding(self):
        errors = self.check("5.0.100000", 500100000, 0)
        self.assertEqual(1, len(errors))
        self.assertIn("100000", errors[0])


if __name__ == "__main__":
    unittest.main()
