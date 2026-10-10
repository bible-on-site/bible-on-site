import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from playback import PROFILE, convert, digest, load_playback, pcm_frames


class PlaybackTests(unittest.TestCase):
    def test_inventory_rejects_stale_source_and_unexpected_object_keys(self):
        with tempfile.TemporaryDirectory() as temporary:
            manifest = Path(temporary) / "inventory.json"
            asset = {"profile": PROFILE, "sourceSha256": "a" * 64, "sha256": "b" * 64,
                     "sizeBytes": 100, "sampleRate": 48000, "frames": 96000, "channels": 1,
                     "bitrate": 24000, "key": "recordings/opus-24k/" + "b" * 64 + ".ogg"}
            for change in ({}, {"key": "../other.ogg"}, {"sha256": "../../escape"}, {"bitrate": 12000},
                           {"frames": 0}, {"sourceSha256": "c" * 64}):
                manifest.write_text(json.dumps({"version": 1, "profile": PROFILE, "tracks": {"1": {**asset, **change}}}))
                if change:
                    with self.assertRaises(ValueError): load_playback(1, "a" * 64, manifest)
                else:
                    self.assertEqual(load_playback(1, "a" * 64, manifest), asset)

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "FFmpeg required")
    def test_real_encoding_preserves_original_hash_and_all_decoded_frames(self):
        source = Path(__file__).with_name("fixtures") / "seek.mp3"
        before = digest(source)
        encoder = subprocess.check_output(["ffmpeg", "-version"], text=True).splitlines()[0]
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            metadata = convert(source, output, encoder)
            audio = output / (metadata["sha256"] + ".ogg")
            self.assertEqual(digest(source), before)
            self.assertEqual(metadata["sourceSha256"], before)
            self.assertEqual(pcm_frames(audio, 1), pcm_frames(source, 1))
            self.assertEqual(metadata["frames"], 96000)
            self.assertEqual(convert(source, output, encoder), metadata)
            audio.write_bytes(b"corrupted cache")
            replaced = convert(source, output, encoder)
            self.assertEqual(digest(output / (replaced["sha256"] + ".ogg")), replaced["sha256"])
            self.assertEqual(digest(source), before)


if __name__ == "__main__":
    unittest.main()
