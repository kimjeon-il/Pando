"""Resume a large HTTP source by verified byte ranges (standard library only).

The destination may contain a prefix from an interrupted curl download. Every
remaining chunk must return HTTP 206 and the requested Content-Range; a server
that ignores Range never creates a misleading complete source file.
"""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
import threading
import urllib.request


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--chunk-mib", type=int, default=64)
    args = parser.parse_args()
    with urllib.request.urlopen(urllib.request.Request(args.url, method="HEAD"), timeout=30) as response:
        size = int(response.headers["Content-Length"])
        if response.headers.get("Accept-Ranges", "").lower() != "bytes":
            raise RuntimeError("Server does not advertise byte ranges")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    prefix = args.output.stat().st_size if args.output.exists() else 0
    if prefix > size:
        raise ValueError("Existing file is larger than the source")
    print(f"source={size} prefix={prefix} remaining={size-prefix}", flush=True)
    if prefix == size:
        return
    chunk_size = max(1, args.chunk_mib) * 1024 * 1024
    ranges = [(start, min(size-1, start+chunk_size-1)) for start in range(prefix, size, chunk_size)]
    lock = threading.Lock()
    with args.output.open("r+b" if args.output.exists() else "w+b") as target:
        target.truncate(size)
        def fetch_range(start, end):
            request = urllib.request.Request(args.url, headers={"Range": f"bytes={start}-{end}"})
            for attempt in range(4):
                try:
                    with urllib.request.urlopen(request, timeout=90) as response:
                        expected_range = f"bytes {start}-{end}/{size}"
                        if response.status != 206 or response.headers.get("Content-Range") != expected_range:
                            raise RuntimeError(f"Bad range response: {response.status} {response.headers.get('Content-Range')}")
                        chunks = []
                        total = 0
                        while True:
                            block = response.read(1024 * 1024)
                            if not block:
                                break
                            chunks.append(block)
                            total += len(block)
                        if total != end-start+1:
                            raise IOError(f"Short range {start}-{end}: {total}")
                    with lock:
                        target.seek(start)
                        for block in chunks:
                            target.write(block)
                    return total
                except Exception:
                    if attempt == 3:
                        raise
        completed = 0
        with ThreadPoolExecutor(max_workers=max(1, args.workers)) as executor:
            futures = [executor.submit(fetch_range, start, end) for start, end in ranges]
            for future in as_completed(futures):
                completed += future.result()
                print(f"received={completed} of {size-prefix}", flush=True)
        target.flush()
    print(f"completed={args.output.stat().st_size}", flush=True)


if __name__ == "__main__":
    main()
