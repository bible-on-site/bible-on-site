"""Turn a recording into a reviewable, admin-compatible article candidate."""

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import hashlib
from html import escape
import json
import math
from pathlib import Path
import re
from tempfile import TemporaryDirectory
from typing import Protocol
from uuid import uuid4

from .model import LocalTranscriber, ModelConfig, Transcript
from .sources import SourceFile, materialize_source


class Transcriber(Protocol):
    """The inference boundary, independent of storage and future draft delivery."""

    def transcribe(self, path: Path) -> Transcript:
        """Recognize the recording without publishing any article."""
        ...


@dataclass(frozen=True)
class ExportOptions:
    """Editorial formatting, separate from the unchanged ASR transcript."""

    title: str | None = None
    paragraph_pause: float = 1.5
    max_paragraph_characters: int = 900

    def __post_init__(self):
        """Reject invalid formatting before running expensive inference."""
        if not math.isfinite(self.paragraph_pause) or self.paragraph_pause <= 0:
            raise ValueError("paragraph_pause must be finite and greater than zero")
        if self.max_paragraph_characters < 1:
            raise ValueError("max_paragraph_characters must be greater than zero")
        if self.title is not None and not self.title.strip():
            raise ValueError("title must contain text")


@dataclass(frozen=True)
class ArticleCandidate:
    """The explicit handoff for a future draft writer; contains no database IDs."""

    title: str
    content: str


@dataclass(frozen=True)
class ExportResult:
    """A completed directory and the candidate a future draft sink can consume."""

    directory: Path
    article: ArticleCandidate


def normalize_display(text: str) -> str:
    """Apply authored-Hebrew punctuation policy without changing raw ASR data."""
    return " ".join(text.translate(str.maketrans({
        "\u05f4": '"', "\u201c": '"', "\u201d": '"',
        "\u05f3": "'", "\u2018": "'", "\u2019": "'",
        "\u05be": "-", "\u2010": "-", "\u2011": "-", "\u2013": "-", "\u2014": "-",
    })).split())


def validate_transcript(transcript: Transcript) -> None:
    """Refuse incomplete, unordered or non-finite inference output."""
    if not math.isfinite(transcript.duration) or transcript.duration <= 0:
        raise ValueError("Recording duration must be finite and greater than zero")
    if (not math.isfinite(transcript.language_probability)
            or not 0 <= transcript.language_probability <= 1):
        raise ValueError("Invalid detected-language probability")
    if not re.fullmatch(r"[a-z]{2,3}", transcript.language):
        raise ValueError("Invalid transcript language")
    previous_end = 0.0
    for segment in transcript.segments:
        if (not math.isfinite(segment.start) or not math.isfinite(segment.end)
                or segment.start < previous_end or segment.end <= segment.start
                or segment.end > transcript.duration + 0.001):
            raise ValueError("Transcript segments must have ordered timestamps within the recording")
        if not isinstance(segment.text, str):
            raise ValueError("Transcript text must be a string")
        previous_end = segment.end
    if not any(segment.text.strip() for segment in transcript.segments):
        raise ValueError("No speech recognized; no article was exported")


def build_article(transcript: Transcript, title: str, options: ExportOptions) -> ArticleCandidate:
    """Group escaped speech into paragraphs accepted by admin's HTML source mode."""
    validate_transcript(transcript)
    paragraphs: list[str] = []
    current = ""
    previous_end = 0.0
    for segment in transcript.segments:
        text = normalize_display(segment.text)
        if not text:
            continue
        if current and (segment.start - previous_end >= options.paragraph_pause
                        or len(current) + len(text) + 1 > options.max_paragraph_characters):
            paragraphs.append(current)
            current = ""
        current = f"{current} {text}" if current else text
        previous_end = segment.end
    if current:
        paragraphs.append(current)
    content = "\n".join(f"<p>{escape(paragraph)}</p>" for paragraph in paragraphs) + "\n"
    return ArticleCandidate(title=normalize_display(title), content=content)


def preview_document(article: ArticleCandidate, language: str) -> str:
    """Wrap the importable fragment in a script-free local review document."""
    direction = "rtl" if language in {"he", "ar", "fa", "ur", "yi"} else "ltr"
    return (f'<!doctype html>\n<html lang="{escape(language, quote=True)}" dir="{direction}">\n'
            '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width">\n'
            '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; '
            'style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'">\n'
            '<meta name="robots" content="noindex,nofollow,noarchive">\n'
            f'<title>{escape(article.title)}</title>\n'
            '<style>body{font:20px/1.8 system-ui,sans-serif;max-width:46rem;margin:3rem auto;'
            'padding:0 1.5rem;color:#202625;background:#faf9f5}aside{font-size:1rem;'
            'border-inline-start:3px solid #96743d;padding-inline-start:1rem}h1{line-height:1.3}</style>'
            '</head>\n<body>\n'
            '<aside>Automatic transcription - requires editorial review before publication.</aside>\n'
            f'<h1>{escape(article.title)}</h1>\n{article.content}</body>\n</html>\n')


def export_transcript(source: SourceFile, transcript: Transcript, output_dir: Path,
                      options: ExportOptions) -> ExportResult:
    """Atomically deliver all artifacts; never replace an existing completed run."""
    article = build_article(transcript, options.title or Path(source.filename).stem, options)
    with source.path.open("rb") as recording:
        if hashlib.file_digest(recording, "sha256").hexdigest() != source.sha256:
            raise ValueError("Recording changed during transcription; no article was exported")
    output_dir = output_dir.expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    # A fixed prefix, content hash and UUID work for Hebrew, reserved Windows names
    # and untrusted S3 filenames, without using any input path as an output path.
    run_id = f"transcription-{source.sha256[:12]}-{uuid4().hex}"
    destination = output_dir / run_id
    manifest = {
        "schema_version": 1,
        "run_id": run_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "review_status": "needs-review",
        "source": {"uri": source.uri, "filename": source.filename,
                   "sha256": source.sha256, "metadata": source.metadata},
        "transcription": {"language": transcript.language,
                          "language_probability": transcript.language_probability,
                          "duration_seconds": transcript.duration, "model": transcript.model,
                          "segments": [asdict(segment) for segment in transcript.segments]},
        "article": {"title": article.title, "content_file": "article.html",
                    "content_sha256": hashlib.sha256(article.content.encode("utf-8")).hexdigest()},
        "formatting": asdict(options),
        "artifacts": {"preview": "preview.html", "transcript": "transcript.json"},
    }
    # Serialize first, so malformed model/source metadata cannot leave a partial
    # successful result. Raw recognized text is retained only in transcript.json.
    metadata = json.dumps(manifest, ensure_ascii=False, allow_nan=False, indent=2) + "\n"
    with TemporaryDirectory(prefix=".transcription-", dir=output_dir) as temporary:
        staged = Path(temporary) / "complete"
        staged.mkdir(mode=0o700)
        (staged / "article.html").write_text(article.content, encoding="utf-8", newline="\n")
        (staged / "transcript.json").write_text(metadata, encoding="utf-8", newline="\n")
        (staged / "preview.html").write_text(
            preview_document(article, transcript.language), encoding="utf-8", newline="\n")
        staged.rename(destination)
    return ExportResult(directory=destination, article=article)


def run(source: str, output_dir: Path, *, config: ModelConfig | None = None,
        options: ExportOptions | None = None, aws_profile: str | None = None,
        transcriber: Transcriber | None = None) -> ExportResult:
    """Materialize, recognize and export without writing to S3 or the database."""
    options = options or ExportOptions()
    backend = transcriber if transcriber is not None else LocalTranscriber(config or ModelConfig())
    with materialize_source(source, aws_profile=aws_profile) as recording:
        transcript = backend.transcribe(recording.path)
        return export_transcript(recording, transcript, output_dir, options)
