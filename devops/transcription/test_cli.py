"""Check CLI configuration, honest failure statuses and offline help."""

from contextlib import redirect_stderr, redirect_stdout
from io import BytesIO, StringIO, TextIOWrapper
from pathlib import Path
import runpy
import sys
import unittest
from unittest.mock import Mock, patch

from devops.transcription import __main__ as cli
from devops.transcription.model import DEFAULT_REVISION


class CliTests(unittest.TestCase):
    """Exercise public commands without downloading weights or requiring CUDA."""

    def invoke(self, arguments, error=None):
        stdout, stderr = StringIO(), StringIO()
        with patch.object(cli, "run", return_value=Mock(directory=Path("complete")), side_effect=error) as execute:
            with redirect_stdout(stdout), redirect_stderr(stderr):
                status = cli.main(arguments)
        return status, stdout.getvalue(), stderr.getvalue(), execute

    def test_default_command_exports_to_local_output(self):
        status, stdout, stderr, execute = self.invoke(["recording.mp3"])
        self.assertEqual((status, stdout, stderr), (0, "complete\n", ""))
        config = execute.call_args.kwargs["config"]
        self.assertEqual(config.language, "he")
        self.assertEqual(config.revision, DEFAULT_REVISION)
        self.assertFalse(config.local_files_only)
        self.assertEqual(config.random_seed, 0)
        self.assertEqual(config.decoding_mode, "fallback")
        self.assertEqual(execute.call_args.args, ("recording.mp3", Path(".outputs/transcription")))

    def test_explicit_s3_configuration_and_offline_model(self):
        arguments = ["s3://archive/authors/author/lecture.mp4", "--output-dir", "out",
                     "--aws-profile", "reader", "--title", "תנ״ך", "--model", "owner/model",
                     "--model-revision", "a" * 40, "--language", "auto", "--device-index", "1",
                     "--compute-type", "int8_float16", "--beam-size", "3", "--model-cache", "cache",
                     "--audio-stream", "1",
                     "--random-seed", "23", "--decoding-mode", "beam",
                     "--offline", "--paragraph-pause", "2.0", "--max-paragraph-characters", "500"]
        status, _, _, execute = self.invoke(arguments)
        self.assertEqual(status, 0)
        config = execute.call_args.kwargs["config"]
        self.assertEqual(config.model, "owner/model")
        self.assertEqual(config.device_index, 1)
        self.assertEqual(config.model_cache, "cache")
        self.assertEqual(config.audio_stream, 1)
        self.assertTrue(config.local_files_only)
        self.assertEqual(config.random_seed, 23)
        self.assertEqual(config.decoding_mode, "beam")
        self.assertEqual(execute.call_args.kwargs["aws_profile"], "reader")
        options = execute.call_args.kwargs["options"]
        self.assertEqual((options.title, options.paragraph_pause, options.max_paragraph_characters),
                         ("תנ״ך", 2.0, 500))

    def test_custom_model_requires_revision_before_pipeline_runs(self):
        status, stdout, stderr, execute = self.invoke(["a.mp3", "--model", "owner/model"])
        self.assertEqual(status, 1)
        self.assertEqual(stdout, "")
        self.assertIn("require --model-revision", stderr)
        execute.assert_not_called()

    def test_invalid_options_fail_before_pipeline(self):
        for arguments in [["--paragraph-pause", "nan"], ["--beam-size", "0"],
                          ["--title", " "], ["--model-revision", "main"],
                          ["--random-seed", "-1"], ["--random-seed", "4294967295"]]:
            with self.subTest(arguments=arguments):
                status, _, stderr, execute = self.invoke(["a.mp3", *arguments])
                self.assertEqual(status, 1)
                self.assertIn("Transcription failed", stderr)
                execute.assert_not_called()

    def test_expected_failures_never_print_success_path(self):
        for error in [ValueError("invalid audio"), OSError("cannot write"), RuntimeError("no GPU")]:
            with self.subTest(error=error):
                status, stdout, stderr, _ = self.invoke(["a.mp3"], error)
                self.assertEqual((status, stdout), (1, ""))
                self.assertIn(str(error), stderr)

    def test_interrupt_has_standard_nonzero_status(self):
        status, stdout, stderr, _ = self.invoke(["a.mp3"], KeyboardInterrupt())
        self.assertEqual((status, stdout), (130, ""))
        self.assertIn("interrupted", stderr)

    def test_hebrew_output_paths_and_errors_work_with_legacy_windows_pipes(self):
        for error in (None, OSError("תיקייה לא זמינה")):
            with self.subTest(error=error):
                stdout_bytes, stderr_bytes = BytesIO(), BytesIO()
                stdout = TextIOWrapper(stdout_bytes, encoding="ascii")
                stderr = TextIOWrapper(stderr_bytes, encoding="ascii")
                with patch.object(cli, "run", return_value=Mock(directory=Path("תמלול")), side_effect=error):
                    with redirect_stdout(stdout), redirect_stderr(stderr):
                        status = cli.main(["lecture.mp4"])
                        stdout.flush()
                        stderr.flush()
                self.assertEqual(status, 1 if error else 0)
                self.assertEqual(stdout_bytes.getvalue().decode("utf-8").splitlines(), [] if error else ["תמלול"])
                if error:
                    self.assertIn("תיקייה לא זמינה", stderr_bytes.getvalue().decode("utf-8"))

    def test_module_help_needs_no_gpu_runtime(self):
        with patch.dict(sys.modules), patch("sys.argv", ["transcription", "--help"]):
            sys.modules.pop(cli.__name__, None)
            with redirect_stdout(StringIO()) as stdout, self.assertRaises(SystemExit) as exited:
                runpy.run_module("devops.transcription", run_name="__main__")
        self.assertEqual(exited.exception.code, 0)
        self.assertIn("local NVIDIA GPU", stdout.getvalue())


if __name__ == "__main__":
    unittest.main()
