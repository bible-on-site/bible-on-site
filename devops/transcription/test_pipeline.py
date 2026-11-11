"""Exercise the article handoff, input integrity and transactional export boundary."""

from dataclasses import replace
import hashlib
from html.parser import HTMLParser
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock, patch

from devops.transcription.model import ModelConfig, Segment, Transcript
from devops.transcription.pipeline import (
    ArticleCandidate, ExportOptions, build_article, export_transcript,
    normalize_display, preview_document, run, validate_transcript,
)
from devops.transcription.sources import SourceFile


class ElementCollector(HTMLParser):
    """Inspect actual parsed markup rather than checking escape implementation."""

    def __init__(self):
        """Collect parsed elements and text without executing markup."""
        super().__init__()
        self.elements = []
        self.text = []

    def handle_starttag(self, tag, attrs):
        self.elements.append((tag, attrs))

    def handle_data(self, data):
        self.text.append(data)


def recognized(*segments):
    """Return representative recognition with its original model provenance."""
    return Transcript(segments=tuple(segments or [Segment(0, 2, " בראשית ברא ")]),
                      language="he", language_probability=1.0, duration=12.0,
                      model={"model_id": "fixture/model", "revision": "a" * 40})


class ArticleTests(unittest.TestCase):
    """Check readable admin markup and preserve raw recognition for review."""

    def test_escapes_untrusted_speech_and_title(self):
        text = '<script>alert("x")</script> & שלום <img src=x onerror=alert(1)>'
        article = build_article(recognized(Segment(0, 1, text)), '<bad "title">', ExportOptions())
        parsed = ElementCollector()
        parsed.feed(article.content)
        self.assertEqual(parsed.elements, [("p", [])])
        self.assertEqual("".join(parsed.text).strip(), text)
        preview = ElementCollector()
        preview.feed(preview_document(article, "he"))
        self.assertNotIn("script", [tag for tag, _ in preview.elements])
        self.assertNotIn("img", [tag for tag, _ in preview.elements])
        self.assertIn('<bad "title">', preview.text)

    def test_groups_on_pauses_and_size_at_segment_boundaries(self):
        transcript = recognized(Segment(0, 1, "אחד"), Segment(1, 2, "שתיים"),
                                Segment(4, 5, "שלוש"), Segment(5, 6, "ארבע"))
        article = build_article(transcript, "כותרת", ExportOptions(max_paragraph_characters=9))
        self.assertEqual(article.content, "<p>אחד שתיים</p>\n<p>שלוש ארבע</p>\n")
        article = build_article(transcript, "כותרת", ExportOptions(max_paragraph_characters=4))
        self.assertEqual(article.content.count("<p>"), 4)

    def test_skips_blank_segments_without_losing_pause_boundary(self):
        transcript = recognized(Segment(0, 1, "א"), Segment(1, 2, " "), Segment(3, 4, "ב"))
        self.assertEqual(build_article(transcript, "t", ExportOptions()).content, "<p>א</p>\n<p>ב</p>\n")

    def test_normalizes_only_editorial_display(self):
        raw = "  תנ״ך\n א׳ — ב־ג ‘ד’ “ה” ‐ ‑ – "
        transcript = recognized(Segment(0, 1, raw))
        article = build_article(transcript, "תנ״ך", ExportOptions())
        self.assertEqual(normalize_display(raw), 'תנ"ך א\' - ב-ג \'ד\' "ה" - - -')
        self.assertEqual(article.title, 'תנ"ך')
        self.assertEqual(transcript.segments[0].text, raw)

    def test_preview_direction_language_and_inert_policy(self):
        for language, direction in [("he", "rtl"), ("en", "ltr")]:
            with self.subTest(language=language):
                preview = preview_document(ArticleCandidate("t", "<p>x</p>"), language)
                self.assertIn(f'lang="{language}" dir="{direction}"', preview)
                self.assertIn("default-src 'none'", preview)
                self.assertIn("יש לערוך ולאשר" if language == "he" else "requires editorial review", preview)

    def test_rejects_invalid_format_options_before_inference(self):
        for values in [{"paragraph_pause": 0}, {"paragraph_pause": float("nan")},
                       {"paragraph_pause": float("inf")}, {"max_paragraph_characters": 0},
                       {"title": " \n "}]:
            with self.subTest(values=values), self.assertRaises(ValueError):
                ExportOptions(**values)

    def test_rejects_invalid_recording_metadata(self):
        for values in [{"duration": 0}, {"duration": float("inf")},
                       {"language_probability": -1}, {"language_probability": 1.1},
                       {"language_probability": float("nan")}, {"language": '<img src=x>'}]:
            with self.subTest(values=values), self.assertRaises(ValueError):
                validate_transcript(replace(recognized(), **values))

    def test_rejects_invalid_segments_and_silence(self):
        invalid = [(), (Segment(0, 1, " "),), (Segment(-1, 1, "x"),),
                   (Segment(0, 0, "x"),),
                   (Segment(float("nan"), 1, "x"),), (Segment(0, float("inf"), "x"),),
                   (Segment(2, 3, "x"), Segment(1, 3, "y")), (Segment(0, 1, None),)]
        for segments in invalid:
            with self.subTest(segments=segments), self.assertRaises(ValueError):
                validate_transcript(replace(recognized(), segments=segments))


class ExportTests(unittest.TestCase):
    """Check real file IO and preservation of completed runs on failure."""

    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.media = self.root / "הרצאה.mp3"
        self.media.write_bytes(b"recording fixture")
        self.source = SourceFile(self.media, self.media.as_uri(),
                                 hashlib.sha256(self.media.read_bytes()).hexdigest(),
                                 self.media.name, {"contentLength": self.media.stat().st_size})
        self.output = self.root / "output"

    def test_export_has_importable_fragment_preview_and_raw_provenance(self):
        transcript = recognized(Segment(0, 1, ' תנ״ך & שלום '))
        result = export_transcript(self.source, transcript, self.output, ExportOptions())
        self.assertEqual(set(path.name for path in result.directory.iterdir()),
                         {"article.html", "transcript.json", "preview.html"})
        content = (result.directory / "article.html").read_text(encoding="utf-8")
        manifest = json.loads((result.directory / "transcript.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["review_status"], "needs-review")
        self.assertEqual(manifest["schema_version"], 1)
        self.assertEqual(manifest["source"]["sha256"], self.source.sha256)
        self.assertEqual(manifest["transcription"]["segments"][0]["text"], ' תנ״ך & שלום ')
        self.assertEqual(manifest["transcription"]["model"], transcript.model)
        self.assertEqual(manifest["article"]["title"], "הרצאה")
        self.assertEqual(manifest["article"]["content_sha256"], hashlib.sha256(content.encode()).hexdigest())
        self.assertEqual(result.article.content, content)
        self.assertNotIn("<html", content)
        self.assertEqual(list(self.output.iterdir()), [result.directory])
        if os.name == "posix":
            self.assertEqual(result.directory.stat().st_mode & 0o777, 0o700)

    def test_repeated_runs_never_overwrite_and_input_names_cannot_escape(self):
        source = replace(self.source, filename="../../CON.mp3")
        first = export_transcript(source, recognized(), self.output, ExportOptions(title="ראשון"))
        before = {path.name: path.read_bytes() for path in first.directory.iterdir()}
        second = export_transcript(source, recognized(), self.output, ExportOptions(title="שני"))
        self.assertNotEqual(first.directory, second.directory)
        self.assertEqual(second.directory.parent, self.output)
        self.assertEqual(before, {path.name: path.read_bytes() for path in first.directory.iterdir()})

    def test_uncertain_timestamp_estimates_preserve_text_and_raw_review_evidence(self):
        transcript = recognized(Segment(0, 2, "אחד"), Segment(1.98, 3, "שתיים"),
                                Segment(3, 12.02, "שלוש"))
        result = export_transcript(self.source, transcript, self.output, ExportOptions())
        manifest = json.loads((result.directory / "transcript.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["transcription"]["warnings"], [
            {"code": "timestamp-overlap", "segment_index": 1},
            {"code": "timestamp-beyond-recording", "segment_index": 2},
        ])
        self.assertEqual(manifest["transcription"]["segments"][1]["start"], 1.98)
        self.assertEqual(manifest["transcription"]["segments"][2]["end"], 12.02)
        self.assertEqual(result.article.content, "<p>אחד שתיים שלוש</p>\n")

    def test_nested_estimates_do_not_hide_overlaps_or_invent_paragraph_pauses(self):
        transcript = recognized(Segment(0, 10, "אחד"), Segment(1, 2, "שתיים"),
                                Segment(4, 5, "שלוש"))
        result = export_transcript(self.source, transcript, self.output, ExportOptions())
        manifest = json.loads((result.directory / "transcript.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["transcription"]["warnings"], [
            {"code": "timestamp-overlap", "segment_index": 1},
            {"code": "timestamp-overlap", "segment_index": 2},
        ])
        self.assertEqual(result.article.content, "<p>אחד שתיים שלוש</p>\n")

    def test_native_timestamp_roundoff_is_not_reported_as_overlap_or_overrun(self):
        transcript = replace(recognized(
            Segment(444, 445.50000000000006, "אחד"),
            Segment(445.5, 448.5, "שתיים"),
            Segment(448.48, 448.50000000000006, "שלוש"),
        ), duration=448.5)
        result = export_transcript(self.source, transcript, self.output, ExportOptions())
        manifest = json.loads((result.directory / "transcript.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["transcription"]["warnings"], [
            {"code": "timestamp-overlap", "segment_index": 2},
        ])
        self.assertEqual(manifest["transcription"]["segments"][0]["end"], 445.50000000000006)
        self.assertEqual(manifest["transcription"]["segments"][2]["end"], 448.50000000000006)
        self.assertEqual(result.article.content, "<p>אחד שתיים שלוש</p>\n")

    def test_modified_snapshot_cannot_claim_original_provenance(self):
        self.media.write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "changed during transcription"):
            export_transcript(self.source, recognized(), self.output, ExportOptions())
        self.assertFalse(self.output.exists())

    def test_metadata_serialization_failure_does_not_leave_partial_export(self):
        transcript = replace(recognized(), model={"bad": object()})
        with self.assertRaises(TypeError):
            export_transcript(self.source, transcript, self.output, ExportOptions())
        self.assertEqual(list(self.output.iterdir()), [])

    def test_disk_failure_removes_staging_and_preserves_previous_run(self):
        result = export_transcript(self.source, recognized(), self.output, ExportOptions())
        with patch.object(Path, "write_text", side_effect=OSError("disk full")):
            with self.assertRaisesRegex(OSError, "disk full"):
                export_transcript(self.source, recognized(), self.output, ExportOptions())
        self.assertEqual(list(self.output.iterdir()), [result.directory])
        self.assertTrue((result.directory / "transcript.json").is_file())

    def test_complete_pipeline_snapshots_input_and_cleans_up(self):
        backend = Mock()
        used_paths = []

        def transcribe(path):
            used_paths.append(path)
            self.assertEqual(path.read_bytes(), self.media.read_bytes())
            self.assertNotEqual(path, self.media)
            return recognized()

        backend.transcribe.side_effect = transcribe
        result = run(str(self.media), self.output, transcriber=backend)
        self.assertTrue(result.directory.is_dir())
        self.assertFalse(used_paths[0].exists())

    def test_default_backend_receives_config_and_source_context(self):
        config = ModelConfig(language="en")
        with patch("devops.transcription.pipeline.LocalTranscriber") as backend:
            backend.return_value.transcribe.return_value = recognized()
            run(str(self.media), self.output, config=config)
            backend.assert_called_once_with(config)

    def test_default_config_and_failing_inference_do_not_export(self):
        with patch("devops.transcription.pipeline.LocalTranscriber") as backend:
            backend.return_value.transcribe.side_effect = RuntimeError("GPU exhausted")
            with self.assertRaisesRegex(RuntimeError, "GPU exhausted"):
                run(str(self.media), self.output)
            backend.assert_called_once_with(ModelConfig())
        self.assertFalse(self.output.exists())


if __name__ == "__main__":
    unittest.main()
