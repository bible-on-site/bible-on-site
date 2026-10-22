"""Read replaceable local JSON state without denying Windows atomic replacement."""

from contextlib import contextmanager
import json
import os
from pathlib import Path


def _open_windows_state_text(path):
    import ctypes
    import ctypes.wintypes as wintypes
    import msvcrt

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    create_file = kernel32.CreateFileW
    create_file.argtypes = (wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                            wintypes.LPVOID, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE)
    create_file.restype = wintypes.HANDLE
    close_handle = kernel32.CloseHandle
    close_handle.argtypes = (wintypes.HANDLE,)
    close_handle.restype = wintypes.BOOL
    # Every reader grants replacement as well as concurrent reads/writes. The
    # stream still refers to its opened generation after an atomic replacement.
    handle = create_file(str(path.resolve()), 0x80000000, 0x1 | 0x2 | 0x4,
                         None, 3, 0x80, None)
    if handle == wintypes.HANDLE(-1).value:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        descriptor = msvcrt.open_osfhandle(handle, os.O_RDONLY | os.O_BINARY)
    except BaseException:
        close_handle(handle)
        raise
    # open_osfhandle transfers ownership to the descriptor. Closing the Python
    # text stream closes that descriptor and the native handle exactly once.
    try:
        return os.fdopen(descriptor, "r", encoding="utf-8-sig")
    except BaseException:
        os.close(descriptor)
        raise


@contextmanager
def open_state_text(path):
    """Yield one UTF-8 state generation while permitting concurrent replacement."""
    path = Path(path)
    stream = (_open_windows_state_text(path) if os.name == "nt"
              else path.open("r", encoding="utf-8-sig"))
    with stream:
        yield stream


def read_state_json(path):
    """Parse one state generation, preserving normal missing/malformed errors."""
    with open_state_text(path) as stream:
        return json.load(stream)


def _replace_windows_state_file(source, target):
    import ctypes
    import ctypes.wintypes as wintypes

    class RenameInfo(ctypes.Structure):
        _fields_ = [("Flags", wintypes.DWORD), ("RootDirectory", wintypes.HANDLE),
                    ("FileNameLength", wintypes.DWORD), ("FileName", wintypes.WCHAR * 1)]

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    create_file = kernel32.CreateFileW
    create_file.argtypes = (wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                            wintypes.LPVOID, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE)
    create_file.restype = wintypes.HANDLE
    set_information = kernel32.SetFileInformationByHandle
    set_information.argtypes = (wintypes.HANDLE, ctypes.c_int, wintypes.LPVOID, wintypes.DWORD)
    set_information.restype = wintypes.BOOL
    close_handle = kernel32.CloseHandle
    close_handle.argtypes = (wintypes.HANDLE,)
    close_handle.restype = wintypes.BOOL
    # DELETE access on the task-owned temporary source is sufficient to rename
    # it. Never grant broader access or ignore the destination's permissions.
    handle = create_file(str(source.resolve()), 0x10000, 0x1 | 0x2 | 0x4,
                         None, 3, 0x80, None)
    if handle == wintypes.HANDLE(-1).value:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        name = str(target.resolve()).encode("utf-16-le")
        buffer = ctypes.create_string_buffer(max(ctypes.sizeof(RenameInfo),
            RenameInfo.FileName.offset + len(name) + 2))
        info = RenameInfo.from_buffer(buffer)
        # FILE_RENAME_REPLACE_IF_EXISTS | FILE_RENAME_POSIX_SEMANTICS. Old
        # delete-sharing readers retain their generation; new opens see the new
        # one. FileRenameInfoEx is the Windows FILE_INFO_BY_HANDLE_CLASS 22.
        info.Flags = 0x1 | 0x2
        info.RootDirectory = None
        info.FileNameLength = len(name)
        ctypes.memmove(ctypes.addressof(buffer) + RenameInfo.FileName.offset, name, len(name))
        if not set_information(handle, 22, buffer, len(buffer)):
            error = ctypes.WinError(ctypes.get_last_error())
            raise OSError(error.errno,
                "Atomic task-state replacement requires Windows FileRenameInfoEx POSIX semantics "
                "and delete-sharing readers: " + error.strerror, str(target), error.winerror) from error
    finally:
        close_handle(handle)


def replace_state_file(source, target):
    """Atomically replace task state while preserving open, shareable generations."""
    source, target = Path(source), Path(target)
    if os.name == "nt":
        _replace_windows_state_file(source, target)
    else:
        source.replace(target)


def write_state_json(path, value):
    """Flush and atomically replace task state without changing publication writers."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    with temporary.open("w", encoding="utf-8") as stream:
        stream.write(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
        stream.flush()
        os.fsync(stream.fileno())
    replace_state_file(temporary, path)
