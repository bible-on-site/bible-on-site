"""Opt-in real audio/video decoding using small generated media fixtures."""

# Run with TRANSCRIPTION_TEST_MEDIA=1 and PyAV/NumPy installed. No GPU, model,
# external FFmpeg executable, network or production recording is required.

from fractions import Fraction
import os
from pathlib import Path
import struct
from tempfile import TemporaryDirectory
import unittest
import wave

from devops.transcription.audio import decode_media


@unittest.skipUnless(os.environ.get("TRANSCRIPTION_TEST_MEDIA") == "1", "Set TRANSCRIPTION_TEST_MEDIA=1 for real media decoding")
class MediaIntegrationTests(unittest.TestCase):
    """Verify the actual decoder API, video selection and error behavior."""

    def setUp(self):
        import av
        import numpy as np
        self.av = av
        self.np = np
        self.temporary = TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)

    def write_video(self, path: Path, levels=(0.125,)):
        """Mux a video stream followed by independently identifiable AAC tracks."""
        with self.av.open(str(path), mode="w") as container:
            video = container.add_stream("mpeg4", rate=25)
            video.width = 32
            video.height = 32
            video.pix_fmt = "yuv420p"
            audio_tracks = []
            for _ in levels:
                track = container.add_stream("aac", rate=48000)
                track.codec_context.layout = "mono"
                audio_tracks.append(track)
            frame = self.av.VideoFrame.from_ndarray(self.np.zeros((32, 32, 3), dtype=self.np.uint8), format="rgb24")
            frame.pts = 0
            for packet in video.encode(frame):
                container.mux(packet)
            for packet in video.encode(None):
                container.mux(packet)
            for track, level in zip(audio_tracks, levels):
                samples = self.np.full((1, 4800), level, dtype=self.np.float32)
                audio = self.av.AudioFrame.from_ndarray(samples, format="fltp", layout="mono")
                audio.sample_rate = 48000
                audio.pts = 0
                audio.time_base = Fraction(1, 48000)
                for packet in track.encode(audio):
                    container.mux(packet)
                for packet in track.encode(None):
                    container.mux(packet)

    def test_actual_stereo_wav_preserves_sample_count_and_resampler_tail(self):
        path = self.directory / "stereo.wav"
        # A known 250-ms PCM signal at 48 kHz requires exactly 4,000 samples
        # at 16 kHz, including delayed samples released by the resampler flush.
        with wave.open(str(path), "wb") as recording:
            recording.setnchannels(2)
            recording.setsampwidth(2)
            recording.setframerate(48000)
            recording.writeframes(struct.pack("<hh", 8192, 8192) * 12000)
        result = decode_media(path)
        self.assertEqual(result.samples.shape, (4000,))
        self.assertEqual(result.samples.dtype, self.np.dtype("float32"))
        self.assertTrue(self.np.isfinite(result.samples).all())
        self.assertGreater(float(self.np.mean(result.samples[-128:])), 0.1)
        self.assertEqual(result.metadata["source_sample_rate"], 48000)
        self.assertEqual(result.metadata["source_channels"], 2)
        self.assertEqual(result.metadata["duration"], 0.25)
        self.assertEqual(result.metadata["sample_rate"], 16000)

    def test_actual_mp4_decodes_audio_after_the_video_stream(self):
        path = self.directory / "lecture.mp4"
        self.write_video(path)
        result = decode_media(path)
        self.assertEqual(result.metadata["selected_audio_stream"], 0)
        self.assertEqual(result.metadata["container_stream_index"], 1)
        self.assertEqual(result.metadata["audio_stream_count"], 1)
        self.assertEqual(result.metadata["codec"], "aac")
        self.assertGreater(result.samples.size, 0)
        self.assertGreater(float(self.np.mean(result.samples)), 0.05)
        self.assertTrue(self.np.isfinite(result.samples).all())

    def test_actual_multitrack_video_requires_and_honors_audio_selection(self):
        path = self.directory / "multitrack.mp4"
        self.write_video(path, levels=(0.125, -0.25))
        with self.assertRaisesRegex(RuntimeError, "--audio-stream"):
            decode_media(path)
        first = decode_media(path, audio_stream=0)
        second = decode_media(path, audio_stream=1)
        self.assertEqual(first.metadata["container_stream_index"], 1)
        self.assertEqual(second.metadata["container_stream_index"], 2)
        self.assertEqual(second.metadata["audio_stream_count"], 2)
        self.assertGreater(float(self.np.mean(first.samples)), 0.05)
        self.assertLess(float(self.np.mean(second.samples)), -0.1)

    def test_actual_video_without_audio_is_rejected(self):
        path = self.directory / "silent-video.mp4"
        self.write_video(path, levels=())
        with self.assertRaisesRegex(RuntimeError, "no audio stream"):
            decode_media(path)

    def test_actual_invalid_media_raises_a_decoder_error(self):
        path = self.directory / "broken.mp4"
        path.write_bytes(b"not a media container\x00\xff")
        with self.assertRaisesRegex(RuntimeError, "complete selected audio") as raised:
            decode_media(path)
        self.assertIsInstance(raised.exception.__cause__, self.av.FFmpegError)

    def test_actual_corrupt_final_pcm_frame_cannot_return_partial_audio(self):
        path = self.directory / "corrupt-tail.wav"
        with wave.open(str(path), "wb") as recording:
            recording.setnchannels(2)
            recording.setsampwidth(2)
            recording.setframerate(48000)
            # Valid audio precedes a byte that cannot form a complete stereo
            # 16-bit PCM frame. The decoder must reject the recording's tail.
            recording.writeframes(struct.pack("<hh", 8192, 8192) * 4096 + b"x")
        with self.av.open(str(path), options={"err_detect": "explode"}) as container:
            self.assertGreater(next(container.decode(audio=0)).samples, 0)
        with self.assertRaisesRegex(RuntimeError, "complete selected audio") as raised:
            decode_media(path)
        self.assertIsInstance(raised.exception.__cause__, self.av.error.InvalidDataError)

    def test_actual_empty_wav_cannot_produce_a_transcription(self):
        path = self.directory / "empty.wav"
        with wave.open(str(path), "wb") as recording:
            recording.setnchannels(1)
            recording.setsampwidth(2)
            recording.setframerate(16000)
        with self.assertRaises(RuntimeError):
            decode_media(path)


if __name__ == "__main__":
    unittest.main()
