"""Verify private checkpoints preserve native generation and honest status."""

from contextlib import redirect_stderr, redirect_stdout
from dataclasses import dataclass
from io import StringIO
import json
import os
from pathlib import Path
import runpy
import sys
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from devops.transcription import checkpoint as cp


@dataclass
class NativeSegment:
    """Represent native data, including unmodified diagnostic fields."""

    start: float = 0.0
    end: float = 1.0
    text: str = ' תנ״ך & שלום '
    temperature: float = 0.0
    avg_logprob: float = -0.2


class CheckpointTests(unittest.TestCase):
    """Exercise actual file IO with a native-model stand-in."""

    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.path = Path(self.temporary.name) / "private" / "תמלול.jsonl"
        self.native = NativeSegment()
        self.info = object()
        self.seen = []
        owner = self

        class Engine:
            """Stand in for the public native transcribe method."""

            def transcribe(self, *args, **kwargs):
                owner.seen.append((args, kwargs))
                return iter([owner.native]), owner.info

        self.engine = Engine
        self.original = Engine.transcribe
        self.fake_module = SimpleNamespace(WhisperModel=Engine)

    def invoke(self, ordinary=None, *, import_error=None, arguments=None):
        if ordinary is None:
            def ordinary(argv):
                segments, info = self.engine().transcribe("samples", beam_size=5)
                self.assertIs(info, self.info)
                self.assertIs(next(segments), self.native)
                self.assertEqual(list(segments), [])
                return 0

        stdout, stderr = StringIO(), StringIO()
        with (patch.dict(os.environ, {"TRANSCRIPTION_SEGMENT_CHECKPOINT": str(self.path)}),
              patch.object(cp.importlib, "import_module", return_value=self.fake_module, side_effect=import_error),
              patch.object(cp, "ordinary_main", side_effect=ordinary) as cli,
              redirect_stdout(stdout), redirect_stderr(stderr)):
            status = cp.main(arguments if arguments is not None else ["lecture.webm", "--offline"])
        return status, stderr.getvalue(), cli

    def rows(self):
        return [json.loads(line) for line in self.path.read_text(encoding="utf-8").splitlines()]

    def test_success_preserves_native_data_arguments_and_restores_method(self):
        status, _, cli = self.invoke()
        self.assertEqual(status, 0)
        cli.assert_called_once_with(["lecture.webm", "--offline"])
        self.assertEqual(self.seen, [(("samples",), {"beam_size": 5})])
        self.assertIs(self.engine.transcribe, self.original)
        rows = self.rows()
        self.assertEqual([row["event"] for row in rows], ["started", "recognition_started", "segment", "finished"])
        self.assertEqual(rows[2]["segment"]["text"], self.native.text)
        self.assertEqual(rows[2]["segment"]["avg_logprob"], -0.2)
        self.assertTrue(rows[-1]["complete"])
        self.assertEqual(rows[-1]["exit_code"], 0)
        self.assertNotIn("aws_profile", rows[0]["request"])
        self.assertEqual(rows[0]["request"]["random_seed"], 0)
        self.assertEqual(rows[0]["request"]["decoding_mode"], "fallback")
        if os.name == "posix":
            self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)

    def test_incomplete_checkpoint_records_requested_seed_and_decoding_mode(self):
        arguments = ["lecture.webm", "--random-seed", "73", "--decoding-mode", "beam"]
        status, _, cli = self.invoke(lambda argv: 1, arguments=arguments)
        self.assertEqual(status, 1)
        cli.assert_called_once_with(arguments)
        request = self.rows()[0]["request"]
        self.assertEqual(request["random_seed"], 73)
        self.assertEqual(request["decoding_mode"], "beam")
        self.assertFalse(self.rows()[-1]["complete"])

    def test_recording_is_lazy_and_clocks_include_different_overhead(self):
        target = StringIO()
        consumed = []
        now = [110.0]

        def native(*args, **kwargs):
            def generate():
                consumed.append(True)
                yield self.native
            return generate(), self.info

        with patch.object(cp.time, "monotonic", side_effect=lambda: now[0]):
            wrapped = cp.checkpoint_transcribe(native, cp.Checkpoint(target, 100.0))
            segments, info = wrapped(object(), "samples", language="he")
            self.assertIs(info, self.info)
            self.assertEqual(consumed, [])
            now[0] = 116.0
            self.assertIs(next(segments), self.native)
        row = json.loads(target.getvalue().splitlines()[-1])
        self.assertEqual(row["pipeline_elapsed_seconds"], 16.0)
        self.assertEqual(row["recognition_elapsed_seconds"], 6.0)

    def test_native_failure_retains_ready_segments_and_incomplete_status(self):
        failure = RuntimeError("native failure")
        original = self.original

        def fails(engine, *args, **kwargs):
            segments, info = original(engine, *args, **kwargs)

            def generate():
                yield from segments
                raise failure
            return generate(), info

        self.engine.transcribe = fails

        def ordinary(argv):
            segments, _ = self.engine().transcribe("samples")
            list(segments)
            return 0

        status, stderr, _ = self.invoke(ordinary)
        self.assertEqual(status, 1)
        self.assertIn("native failure", stderr)
        self.assertIs(self.engine.transcribe, fails)
        self.assertEqual(len([row for row in self.rows() if row["event"] == "segment"]), 1)
        self.assertFalse(self.rows()[-1]["complete"])
        self.assertEqual(self.rows()[-1]["error_type"], "RuntimeError")

    def test_nonzero_cli_and_interrupt_are_not_complete(self):
        status, _, _ = self.invoke(lambda argv: 1)
        self.assertEqual(status, 1)
        self.assertFalse(self.rows()[-1]["complete"])
        self.path.unlink()

        def interrupt(argv):
            raise KeyboardInterrupt

        status, _, _ = self.invoke(interrupt)
        self.assertEqual(status, 130)
        self.assertFalse(self.rows()[-1]["complete"])
        self.assertIs(self.engine.transcribe, self.original)

    def test_existing_checkpoint_is_never_overwritten(self):
        self.path.parent.mkdir()
        self.path.write_bytes(b"prior checkpoint")
        status, _, cli = self.invoke()
        self.assertEqual(status, 1)
        self.assertEqual(self.path.read_bytes(), b"prior checkpoint")
        cli.assert_not_called()

    def test_missing_runtime_still_records_incomplete_status(self):
        status, _, _ = self.invoke(import_error=ImportError("missing runtime"))
        self.assertEqual(status, 1)
        self.assertFalse(self.rows()[-1]["complete"])
        self.assertEqual(self.rows()[-1]["error_type"], "ImportError")

    def test_missing_destination_and_help_need_no_runtime(self):
        with patch.dict(os.environ, {}, clear=True), redirect_stderr(StringIO()) as stderr:
            self.assertEqual(cp.main(["lecture.opus"]), 1)
        self.assertIn("TRANSCRIPTION_SEGMENT_CHECKPOINT", stderr.getvalue())
        with (patch.dict(sys.modules), patch("sys.argv", ["checkpoint", "--help"]),
              redirect_stdout(StringIO()), self.assertRaises(SystemExit) as exited):
            sys.modules.pop(cp.__name__, None)
            runpy.run_module("devops.transcription.checkpoint", run_name="__main__")
        self.assertEqual(exited.exception.code, 0)


if __name__ == "__main__":
    unittest.main()
