"""Inter-process serialization for recitation.sqlite copy-mutate-replace writers."""

from contextlib import contextmanager
import errno
from pathlib import Path

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
            # LK_LOCK blocks ~10s then raises; retry it so a held lock waits
            # like flock while permanent errors still surface.
            while True:
                try:
                    msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
                    break
                except OSError as error:
                    # EDEADLK is LK_LOCK's exhausted-retry signal, not a deadlock.
                    if error.errno not in (errno.EACCES, errno.EAGAIN, errno.EDEADLK):
                        raise
        try:
            yield
        finally:
            if fcntl is not None:
                fcntl.flock(handle, fcntl.LOCK_UN)
            else:
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
