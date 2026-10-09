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
    def check(self, display: str, android: int, other: int) -> list[str]:
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory) / "app.csproj"
            project.write_text(
                "<Project><PropertyGroup>"
                f"<ApplicationDisplayVersion>{display}</ApplicationDisplayVersion>"
                "<ApplicationVersion Condition=\"'$(TargetFramework)' == 'android'\">"
                f"{android}</ApplicationVersion>"
                "<ApplicationVersion Condition=\"'$(TargetFramework)' != 'android'\">"
                f"{other}</ApplicationVersion>"
                "</PropertyGroup></Project>",
                encoding="utf-8",
            )
            return MODULE.check_version(project)

    def test_aligned_release(self):
        self.assertEqual([], self.check("5.0.94", 50000094, 94))

    def test_old_one_step_offset_is_rejected(self):
        errors = self.check("5.0.93", 50000092, 92)
        self.assertEqual(2, len(errors))

    def test_minor_version_uses_reserved_digits(self):
        self.assertEqual([], self.check("5.1.2", 50100002, 2))


if __name__ == "__main__":
    unittest.main()
