"""Read-only NTFS identity/allocation audit for the exact cleanup manifest.

Uses the already installed runtime, never installs packages or traverses links.
Allocation is primary data only; measured drive free space remains authoritative.
"""
import ctypes
from ctypes import wintypes
import json
import os
import sys


class Standard(ctypes.Structure):
    _fields_ = [("allocation", ctypes.c_longlong), ("eof", ctypes.c_longlong),
                ("links", wintypes.DWORD), ("pending", ctypes.c_ubyte), ("directory", ctypes.c_ubyte)]


class Compression(ctypes.Structure):
    _fields_ = [("size", ctypes.c_longlong), ("format", wintypes.WORD),
                ("unit", ctypes.c_ubyte), ("chunk", ctypes.c_ubyte),
                ("cluster", ctypes.c_ubyte), ("reserved", ctypes.c_ubyte * 3)]


def audit(manifest):
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                                  ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
    kernel.CreateFileW.restype = wintypes.HANDLE
    kernel.GetFileInformationByHandleEx.argtypes = [wintypes.HANDLE, ctypes.c_int,
                                                   ctypes.c_void_p, wintypes.DWORD]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    groups = {}
    for entry in manifest["entries"]:
        path = os.path.join(entry["root"], entry["path"])
        stat = os.lstat(path)
        if stat.st_file_attributes & 0x400:
            raise RuntimeError("Reparse point must be preserved: " + path)
        handle = kernel.CreateFileW(path, 0x80, 7, None, 3, 0x00200000 | 0x00100000, None)
        if handle == wintypes.HANDLE(-1).value:
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            standard = Standard()
            if not kernel.GetFileInformationByHandleEx(handle, 1, ctypes.byref(standard), ctypes.sizeof(standard)):
                raise ctypes.WinError(ctypes.get_last_error())
            allocated = standard.allocation
            if stat.st_file_attributes & (0x800 | 0x200):
                compression = Compression()
                if not kernel.GetFileInformationByHandleEx(handle, 8, ctypes.byref(compression), ctypes.sizeof(compression)):
                    raise ctypes.WinError(ctypes.get_last_error())
                allocated = compression.size
            key = str(stat.st_dev) + ":" + str(stat.st_ino)
            item = groups.setdefault(key, {"allocated": allocated, "links": standard.links,
                                           "selected": 0, "delete": 0, "relocate": 0})
            item["selected"] += 1
            item[entry["action"]] += 1
        finally:
            kernel.CloseHandle(handle)
    return {"files": len(manifest["entries"]), "uniqueFileIds": len(groups),
            "selectedUniqueAllocation": sum(g["allocated"] for g in groups.values()),
            "reclaimableAllocation": sum(g["allocated"] for g in groups.values() if g["selected"] >= g["links"]),
            "deleteOnlyReclaimableAllocation": sum(g["allocated"] for g in groups.values() if g["delete"] >= g["links"]),
            "sharedWithUnselectedAllocation": sum(g["allocated"] for g in groups.values() if g["selected"] < g["links"]),
            "note": "NTFS primary streams, file-ID deduplicated; excludes metadata and alternate streams"}


if __name__ == "__main__":
    with open(sys.argv[1], encoding="utf-8") as source:
        print(json.dumps(audit(json.load(source))))
