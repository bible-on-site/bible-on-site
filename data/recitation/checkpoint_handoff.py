"""Observe completed manifests through stdout; recover SQLite only after exit."""

from contextlib import closing
import json
from pathlib import Path
import re
import sqlite3

from recite import export_database


def completed_manifest_logged(text, perek):
    """recite.py flushes this line after saving the complete chapter manifest.

    Never open a worker-owned checkpoint or manifest while Windows may replace
    it. Stop the bound worker after this stdout signal; then recover and verify
    its checkpoint from saved manifests before another inference starts.
    """
    pattern = rf"^{perek}: ([1-9][0-9]*)/([1-9][0-9]*) word identities; (ready|needs_review); [0-9.]+s$"
    return any(match[1] == match[2] for match in re.finditer(pattern, text, re.MULTILINE))


def recover_checkpoint(output, database, perek):
    """Caller must first stop the actual worker and exclude concurrent writers."""
    output, database = Path(output), Path(database)
    manifest = json.loads((output / f"{perek}.json").read_text(encoding="utf-8"))
    if manifest["perekId"] != perek or manifest["alignmentStatus"] == "pending":
        raise ValueError("The requested chapter has no completed manifest")
    export_database(output, database)
    core = {"version", "perekId", "audioUrl", "audioSha256", "textSha256",
            "durationMs", "alignmentStatus", "words"}
    provenance = {key: value for key, value in manifest.items() if key not in core}
    with closing(sqlite3.connect(database.as_uri() + "?mode=ro", uri=True)) as db:
        if db.execute("PRAGMA integrity_check").fetchone() != ("ok",):
            raise ValueError("Recovered checkpoint integrity failed")
        row = db.execute("select audio_sha256,text_sha256,alignment_status,provenance_json "
                         "from recitation_track where perek_id=?", (perek,)).fetchone()
        if (row[:3] != (manifest["audioSha256"], manifest["textSha256"], manifest["alignmentStatus"])
                or json.loads(row[3]) != provenance):
            raise ValueError("Recovered checkpoint provenance differs from its saved manifest")
        actual = db.execute("select pasuk,segment,start_ms,end_ms from recitation_word "
                            "where perek_id=? order by pasuk,segment", (perek,)).fetchall()
        expected = sorted((word["pasuk"], word["segment"], word["startMs"], word["endMs"])
                          for word in manifest["words"] if word["startMs"] is not None
                          and word["endMs"] is not None and word["endMs"] > word["startMs"])
        if manifest["alignmentStatus"] != "ready":
            # The original exporter deliberately keeps unpublished candidates
            # in manifests, never in the checkpoint's approved word table.
            expected = []
        if actual != expected:
            raise ValueError("Recovered checkpoint intervals differ from the saved manifest")
    return {"perekId": perek, "canonicalWords": len(manifest["words"]),
            "storedIntervals": len(expected), "status": manifest["alignmentStatus"],
            "checkpointIntegrity": "ok"}
