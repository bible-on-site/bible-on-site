"""Probe review audio without opening a console in the windowless server."""

import json
import subprocess  # nosec B404: resolved FFmpeg executables and fixed argv, no shell.

from recite import executable


def hidden_audio_options():
    """A pythonw parent must not give console tools a new visible window."""
    return {"creationflags": getattr(subprocess, "CREATE_NO_WINDOW", 0)}


def duration(path):
    """Keep the original MP3 probe and duration gates, with hidden transport only."""
    probe = json.loads(subprocess.check_output([  # nosec B603: resolved executable, absolute source, argv only.  # nosemgrep
        executable("ffprobe"), "-v", "error", "-show_entries",
        "format=duration:stream=codec_type,codec_name,sample_rate,channels",
        "-of", "json", str(path.resolve()),
    ], text=True, stdin=subprocess.DEVNULL, **hidden_audio_options()))
    streams = [s for s in probe["streams"] if s["codec_type"] == "audio"]
    if len(streams) != 1 or streams[0]["codec_name"] != "mp3":
        raise ValueError(f"{path.name}: expected one browser-compatible MP3 audio stream")
    result = round(float(probe["format"]["duration"]) * 1000)
    if result <= 0:
        raise ValueError(f"{path.name}: invalid audio duration")
    return result
