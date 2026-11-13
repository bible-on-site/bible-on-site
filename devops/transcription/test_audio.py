"""Exercise strict full-stream decoding without installing media or ML libraries."""

from dataclasses import FrozenInstanceError
import math
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, Mock, patch

from devops.transcription.audio import DecodedAudio, decode_media


class FakeDecodeError(Exception):
    """Stand in for an FFmpeg decoder error."""


class Samples:
    """Provide the small NumPy surface used by decoding and its assertions."""

    def __init__(self, values):
        """Retain sample values and the array attributes used by the decoder."""
        self.values = list(values)
        self.size = len(self.values)
        self.dtype = None

    def reshape(self, shape):
        if shape != -1:
            raise AssertionError("Expected mono samples to be flattened.")
        return self

    def astype(self, dtype, *, copy):
        if copy:
            raise AssertionError("An unnecessary second waveform copy was requested.")
        self.dtype = dtype
        return self


def audio_frame(values=(), *, corrupt=False):
    return SimpleNamespace(
        is_corrupt=corrupt,
        to_ndarray=Mock(return_value=Samples(values)),
    )


def audio_stream(index=0, *, layout=SimpleNamespace(channels=("L", "R"))):
    return SimpleNamespace(
        index=index,
        id=100 + index,
        codec_context=SimpleNamespace(name="aac", sample_rate=48000, layout=layout),
    )


class AudioTests(unittest.TestCase):
    """The decoder retains tails and rejects ambiguity or corrupted media."""

    def setUp(self):
        self.container = MagicMock()
        self.container.__enter__.return_value = self.container
        self.container.streams.audio = (audio_stream(1),)
        self.frames = [audio_frame([0.25, -0.5]), audio_frame([0.75])]
        self.container.decode.return_value = iter(self.frames)
        self.resampler = Mock()
        self.tail = audio_frame([0.125])
        self.resampler.resample.side_effect = lambda frame: [self.tail if frame is None else frame]
        self.av = SimpleNamespace(
            open=Mock(return_value=self.container),
            AudioResampler=Mock(return_value=self.resampler),
            FFmpegError=FakeDecodeError,
            __version__="fixture",
        )
        self.np = SimpleNamespace(
            float32="float32",
            concatenate=lambda chunks: Samples(value for chunk in chunks for value in chunk.values),
            isfinite=lambda samples: SimpleNamespace(all=lambda: all(math.isfinite(value) for value in samples.values)),
        )
        self.dependencies = patch.dict("sys.modules", {"av": self.av, "numpy": self.np})
        self.dependencies.start()
        self.addCleanup(self.dependencies.stop)

    def test_complete_audio_includes_every_frame_and_resampler_tail(self):
        result = decode_media(Path("lecture.mp4"))
        self.assertIsInstance(result, DecodedAudio)
        self.assertEqual(result.samples.values, [0.25, -0.5, 0.75, 0.125])
        self.assertEqual(result.samples.dtype, "float32")
        self.container.decode.assert_called_once_with(self.container.streams.audio[0])
        self.av.open.assert_called_once_with("lecture.mp4", mode="r", options={"err_detect": "explode"})
        self.av.AudioResampler.assert_called_once_with(format="fltp", layout="mono", rate=16000)
        self.assertEqual(self.resampler.resample.call_args_list[-1].args, (None,))
        self.assertEqual(result.metadata, {
            "audio_stream_count": 1, "selected_audio_stream": 0,
            "container_stream_index": 1, "container_stream_id": 101,
            "codec": "aac", "source_sample_rate": 48000, "source_channels": 2,
            "sample_rate": 16000, "channels": 1, "sample_format": "float32",
            "decoder": "pyav", "decoder_version": "fixture", "error_detection": "explode",
            "duration": 4 / 16000,
        })
        self.container.__exit__.assert_called_once()
        with self.assertRaises(FrozenInstanceError):
            result.samples = None

    def test_multiple_audio_tracks_require_explicit_selection(self):
        self.container.streams.audio = (audio_stream(1), audio_stream(3))
        with self.assertRaisesRegex(RuntimeError, "--audio-stream"):
            decode_media(Path("video.mkv"))
        self.container.decode.assert_not_called()

    def test_selector_uses_audio_index_rather_than_container_index(self):
        self.container.streams.audio = (audio_stream(1), audio_stream(3))
        result = decode_media(Path("video.mkv"), audio_stream=1)
        self.container.decode.assert_called_once_with(self.container.streams.audio[1])
        self.assertEqual(result.metadata["selected_audio_stream"], 1)
        self.assertEqual(result.metadata["container_stream_index"], 3)
        self.assertEqual(result.metadata["audio_stream_count"], 2)

    def test_explicit_zero_selects_single_audio_stream(self):
        self.assertEqual(decode_media(Path("lecture.wav"), 0).metadata["selected_audio_stream"], 0)

    def test_no_audio_and_unavailable_index_are_rejected(self):
        self.container.streams.audio = ()
        with self.assertRaisesRegex(RuntimeError, "no audio"):
            decode_media(Path("silent-video.mp4"))
        self.container.streams.audio = (audio_stream(),)
        with self.assertRaisesRegex(ValueError, "unavailable"):
            decode_media(Path("lecture.mp3"), 1)

    def test_invalid_selector_is_rejected_before_loading_dependencies(self):
        for selector in (-1, True, 0.5, "0"):
            with self.subTest(selector=selector), self.assertRaisesRegex(ValueError, "nonnegative integer"):
                decode_media(Path("lecture.mp3"), selector)
        self.av.open.assert_not_called()

    def test_unknown_source_channel_layout_remains_unknown(self):
        self.container.streams.audio = (audio_stream(layout=None),)
        self.assertIsNone(decode_media(Path("lecture.mp3")).metadata["source_channels"])

    def test_invalid_frame_error_after_valid_audio_aborts_instead_of_skipping(self):
        def frames():
            yield self.frames[0]
            raise FakeDecodeError("corrupt input")
        self.container.decode.return_value = frames()
        with self.assertRaisesRegex(RuntimeError, "complete selected audio") as raised:
            decode_media(Path("broken.mp3"))
        self.assertIsInstance(raised.exception.__cause__, FakeDecodeError)
        self.container.__exit__.assert_called_once()
        self.assertNotIn(None, [call.args[0] for call in self.resampler.resample.call_args_list])

    def test_frame_marked_corrupt_is_rejected(self):
        self.container.decode.return_value = iter([audio_frame([1.0], corrupt=True)])
        with self.assertRaisesRegex(RuntimeError, "corrupt frame"):
            decode_media(Path("broken.mp3"))
        self.resampler.resample.assert_not_called()

    def test_open_and_resample_errors_fail_without_partial_audio(self):
        self.av.open.side_effect = OSError("cannot open")
        with self.assertRaisesRegex(RuntimeError, "complete selected audio"):
            decode_media(Path("missing.mp3"))
        self.av.open.side_effect = None
        self.resampler.resample.side_effect = FakeDecodeError("bad audio")
        with self.assertRaisesRegex(RuntimeError, "complete selected audio"):
            decode_media(Path("broken.mp3"))

    def test_missing_decoder_and_numpy_have_actionable_errors(self):
        for missing in ("av", "numpy"):
            with self.subTest(missing=missing), patch.dict("sys.modules", {missing: None}):
                with self.assertRaisesRegex(RuntimeError, "Install the transcription runtime"):
                    decode_media(Path("lecture.mp3"))

    def test_empty_decoded_stream_is_rejected(self):
        self.container.decode.return_value = iter(())
        self.resampler.resample.return_value = []
        self.resampler.resample.side_effect = None
        with self.assertRaisesRegex(RuntimeError, "no samples"):
            decode_media(Path("empty.wav"))

    def test_zero_samples_and_nonfinite_samples_are_rejected(self):
        for values in ([], [math.nan], [math.inf], [-math.inf]):
            with self.subTest(values=values):
                self.container.decode.return_value = iter([audio_frame(values)])
                self.resampler.resample.side_effect = lambda frame: [] if frame is None else [frame]
                with self.assertRaisesRegex(RuntimeError, "empty or nonfinite"):
                    decode_media(Path("invalid.wav"))


if __name__ == "__main__":
    unittest.main()
