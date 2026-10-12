"""Keep immutable completed rounds while importing current per-candidate evidence."""

from copy import deepcopy
from pathlib import Path
import shutil

from listening_review import digest_file, load_queue


def archive_round(queue_path, reviews_path, destination):
    """Copy a completed round; never reset or rewrite the live answer history."""
    queue = load_queue(queue_path)
    destination.mkdir(parents=True, exist_ok=False)
    for source, name in ((queue_path, "queue.json"), (reviews_path, "reviews.json")):
        shutil.copy2(source, destination / name)
        if digest_file(source) != digest_file(destination / name):
            raise ValueError("Review archive differs from its source")
    return {"path": str((destination / "queue.json").resolve()),
            "sha256": digest_file(destination / "queue.json"),
            "caseCount": len(queue["cases"])}


def load_review_evidence(queue_path):
    """New candidates supersede old cuts; unchanged cases retain their real answers."""
    seen, visiting, cases, bindings = set(), set(), {}, {}

    def visit(path):
        path = path.resolve()
        if path in visiting:
            raise ValueError("Cyclic review archive")
        if path in seen:
            return
        visiting.add(path)
        queue = load_queue(path)
        for archive in queue.get("archivedQueues", []):
            archived_path = Path(archive["path"])
            if digest_file(archived_path) != archive["sha256"]:
                raise ValueError("Completed review archive changed")
            visit(archived_path)
        for case in queue["cases"]:
            old = cases.get(case["id"])
            if old is None or (old["candidateSha256"], old["clipSha256"]) != (
                    case["candidateSha256"], case["clipSha256"]):
                bindings[case["id"]] = set()
            cases[case["id"]] = deepcopy(case)
            bindings[case["id"]].add(queue["queueSha256"])
        visiting.remove(path)
        seen.add(path)
        return queue

    active = visit(queue_path)
    combined = {**active, "cases": list(cases.values())}
    return combined, {key: sorted(value) for key, value in bindings.items()}