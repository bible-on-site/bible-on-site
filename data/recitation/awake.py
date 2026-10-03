"""Temporarily prevent Windows system sleep while recitation is processing."""

import argparse
from contextlib import contextmanager
import ctypes
import sys

CONTINUOUS = 0x80000000
SYSTEM_REQUIRED = 0x00000001


def windows_api():
    from ctypes import wintypes
    api = ctypes.WinDLL("kernel32", use_last_error=True)
    api.SetThreadExecutionState.argtypes = [wintypes.DWORD]
    api.SetThreadExecutionState.restype = wintypes.DWORD
    api.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    api.OpenProcess.restype = wintypes.HANDLE
    api.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    api.WaitForSingleObject.restype = wintypes.DWORD
    api.CloseHandle.argtypes = [wintypes.HANDLE]
    api.CloseHandle.restype = wintypes.BOOL
    return api


@contextmanager
def keep_awake(api=None):
    if api is None and sys.platform != "win32":
        yield
        return
    api = api if api is not None else windows_api()
    if not api.SetThreadExecutionState(CONTINUOUS | SYSTEM_REQUIRED):
        raise OSError("Could not prevent system sleep during recitation")
    try:
        yield
    finally:
        api.SetThreadExecutionState(CONTINUOUS)


def monitor(pid):
    api = windows_api()
    # The handle refers to this process instance, even if Windows reuses its PID.
    handle = api.OpenProcess(0x00100000, False, pid)  # SYNCHRONIZE, no mutation rights.
    if not handle:
        raise OSError(f"Cannot monitor recitation process {pid}")
    try:
        with keep_awake(api):
            print(f"Preventing system sleep until process {pid} exits", flush=True)
            while True:
                result = api.WaitForSingleObject(handle, 30000)
                if result == 0:
                    break
                if result != 258:  # WAIT_TIMEOUT
                    raise OSError("Could not wait for recitation process")
    finally:
        api.CloseHandle(handle)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pid", type=int, required=True)
    args = parser.parse_args()
    if sys.platform != "win32" or args.pid <= 0:
        parser.error("A running Windows process ID is required")
    monitor(args.pid)
