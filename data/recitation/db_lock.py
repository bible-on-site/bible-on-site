"""Inter-process serialization for recitation.sqlite copy-mutate-replace writers."""

from contextlib import contextmanager
from pathlib import Path
import time

try:
    import fcntl
    msvcrt = None
except ImportError:  # Windows
    fcntl = None
    import msvcrt


@contextmanager
def database_lock(database):
    """Serialize copy-mutate-replace writers across processes via a lockfile."""
    # Held from before the database snapshot until after the atomic replace so a
    # concurrent exporter or review overlay cannot overwrite committed rows.
    # recite.py itself cannot host this helper: it is one of the hashed baseline
    # files, and editing it invalidates the preserved GPU evidence.
    database = Path(database)
    database.parent.mkdir(parents=True, exist_ok=True)
    lock = database.parent / (database.name + ".lock")
    with lock.open("a+b") as handle:
        if fcntl is not None:
            fcntl.flock(handle, fcntl.LOCK_EX)
        else:
            # LK_LOCK gives up after ~10s; retry non-blocking so a held lock waits.
            while True:
                try:
                    msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
                    break
                except OSError:
                    time.sleep(0.05)
        try:
            yield
        finally:
            if fcntl is not None:
                fcntl.flock(handle, fcntl.LOCK_UN)
            else:
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
