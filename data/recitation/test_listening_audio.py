"""Windowless review probes retain the original source-format and duration gates."""

import json
from pathlib import Path
import unittest
import tempfile
from unittest.mock import patch

from listening_audio import duration
from listening_review import session_token


class ListeningAudioTests(unittest.TestCase):
    def test_windowless_probe_preserves_the_original_mp3_contract(self):
        source = Path("original.mp3").resolve()
        probe = {"streams": [{"codec_type": "audio", "codec_name": "mp3"}], "format": {"duration": "1.2345"}}
        with patch("listening_audio.executable", return_value="ffprobe"), patch(
                "listening_audio.subprocess.CREATE_NO_WINDOW", 0x08000000, create=True), patch(
                "listening_audio.subprocess.check_output", return_value=json.dumps(probe)) as command:
            self.assertEqual(duration(source), 1234)
            self.assertEqual(command.call_args.kwargs["creationflags"], 0x08000000)
            self.assertEqual(command.call_args.args[0][-1], str(source))
            for malformed in (
                    {**probe, "streams": []},
                    {**probe, "streams": probe["streams"] * 2},
                    {**probe, "streams": [{"codec_type": "audio", "codec_name": "opus"}]},
                    {**probe, "format": {"duration": "0"}}):
                command.return_value = json.dumps(malformed)
                with self.subTest(probe=malformed), self.assertRaises(ValueError):
                    duration(source)


    def test_same_queue_restart_preserves_session_but_new_queue_rotates_it(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "session.json"
            first = session_token(path, "queue-one")
            self.assertEqual(session_token(path, "queue-one"), first)
            self.assertNotEqual(session_token(path, "queue-two"), first)
            path.write_text(json.dumps({"queueSha256": "queue-two", "token": "invalid"}))  # nosec B105: deliberately invalid fixture.
            self.assertNotEqual(session_token(path, "queue-two"), "invalid")


if __name__ == "__main__":
    unittest.main()
