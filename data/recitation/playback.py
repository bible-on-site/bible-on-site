"""Derive 24 kbps Ogg Opus playback assets. Never modify alignment MP3s or timings."""

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "web/bible-on-site/src/data/recitation/opus-playback.json"
PROFILE = "ogg-opus-24k-v1"


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def pcm_frames(path, channels):
    # Count decoded samples rather than container duration (which includes pre-skip).
    command = ["ffmpeg", "-v", "error", "-threads", "1", "-i", str(path),
               "-map", "0:a:0", "-ar", "48000", "-f", "s16le", "-"]
    # A malformed source may report many recoverable packets; never block its
    # decoder on an undrained stderr pipe while counting stdout.
    with tempfile.TemporaryFile() as errors, subprocess.Popen(
            command, stdout=subprocess.PIPE, stderr=errors) as process:
        size = 0
        while block := process.stdout.read(1024 * 1024):
            size += len(block)
        if process.wait() != 0:
            errors.seek(0)
            raise ValueError(errors.read().decode())
    if size % (channels * 2):
        raise ValueError("Incomplete PCM frame")
    return size // (channels * 2)


def convert(source, output, encoder):
    source_sha = digest(source)
    cached = output / (source_sha + ".json")
    if cached.exists():
        metadata = json.loads(cached.read_text())
        audio = output / (metadata["sha256"] + ".ogg")
        if (metadata["profile"] == PROFILE and metadata["encoder"] == encoder
                and metadata["sourceSha256"] == source_sha and audio.exists()
                and digest(audio) == metadata["sha256"]):
            return metadata
    probe = json.loads(subprocess.check_output([
        "ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries",
        "stream=channels", "-of", "json", str(source)]))
    channels = probe["streams"][0]["channels"]
    temporary = output / (source_sha + ".download.ogg")
    try:
        subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-threads", "1",
                        "-i", str(source), "-map", "0:a:0", "-map_metadata", "-1", "-vn",
                        "-c:a", "libopus", "-b:a", "24000", "-vbr", "on",
                        "-application", "audio", "-compression_level", "10",
                        "-frame_duration", "20", "-ar", "48000", "-threads", "1",
                        "-f", "ogg", str(temporary)], check=True)
        frames = pcm_frames(source, channels)
        if pcm_frames(temporary, channels) != frames:
            raise ValueError(f"{source.name}: playback sample count changed")
        if digest(source) != source_sha:
            raise ValueError("Original MP3 changed during conversion")
        sha = digest(temporary)
        metadata = {"profile": PROFILE, "encoder": encoder, "sourceSha256": source_sha,
                    "sha256": sha, "sizeBytes": temporary.stat().st_size,
                    "sampleRate": 48000, "frames": frames, "channels": channels,
                    "bitrate": 24000, "key": f"recordings/opus-24k/{sha}.ogg"}
        temporary.replace(output / (sha + ".ogg"))
        cached.write_text(json.dumps(metadata, indent=2) + "\n")
        return metadata
    finally:
        temporary.unlink(missing_ok=True)


def build(recordings, output, manifest=MANIFEST):
    output.mkdir(parents=True, exist_ok=True)
    encoder = subprocess.check_output(["ffmpeg", "-version"], text=True).splitlines()[0]
    sources = sorted(recordings.glob("*_record.mp3"), key=lambda p: int(p.stem.split("_")[0]))
    if not sources:
        raise ValueError("No original recordings")
    identities = {source: digest(source) for source in sources}
    unique = {sha: source for source, sha in identities.items()}
    # Two CPU-only encoders, each with one thread, leave the alignment GPU alone.
    # Equal source bytes must not race the same immutable cache destination.
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = dict(zip(unique, pool.map(lambda p: convert(p, output, encoder), unique.values())))
    if any(digest(source) != sha for source, sha in identities.items()):
        raise ValueError("Original MP3 changed during inventory construction")
    tracks = {str(int(p.stem.split("_")[0])): results[sha] for p, sha in identities.items()}
    manifest.parent.mkdir(parents=True, exist_ok=True)
    manifest.write_text(json.dumps({"version": 1, "profile": PROFILE, "tracks": tracks}, indent=2) + "\n")
    print(f"Verified {len(tracks)} playback copies, {sum(t['sizeBytes'] for t in tracks.values())} bytes", flush=True)


def load_playback(perek_id, source_sha, manifest=MANIFEST):
    data = json.loads(manifest.read_text())
    track = data["tracks"].get(str(perek_id))
    if (data.get("version") != 1 or data.get("profile") != PROFILE or not track
            or track.get("sourceSha256") != source_sha or track.get("profile") != PROFILE
            or track.get("bitrate") != 24000 or track.get("sampleRate") != 48000
            or not isinstance(track.get("frames"), int) or track["frames"] <= 0
            or track.get("channels") not in (1, 2) or track.get("sizeBytes", 0) <= 0
            or len(track.get("sha256", "")) != 64
            or any(c not in "0123456789abcdef" for c in track["sha256"])
            or track.get("key") != f'recordings/opus-24k/{track["sha256"]}.ogg'):
        raise ValueError(f"{perek_id}: invalid or stale Opus playback metadata")
    return track


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("recordings", type=Path)
    parser.add_argument("--output", type=Path, default=ROOT / ".cache/recitation-opus")
    parser.add_argument("--manifest", type=Path, default=MANIFEST)
    args = parser.parse_args()
    build(args.recordings, args.output, args.manifest)
