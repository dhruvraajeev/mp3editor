"""mp3editor from the terminal.

  mp3editor app                   open the editor in its own window (what mp3editor.app runs)
  mp3editor serve [--port 8020]   open the editor at http://localhost:8020
  mp3editor show FILE...          print each file's tags
  mp3editor rm-cover FILE...      strip the cover art
"""

import argparse
import socket
import threading
import time
from pathlib import Path

from . import core


def main() -> None:
    parser = argparse.ArgumentParser(prog="mp3editor", description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    serve = sub.add_parser("serve", help="run the editor")
    serve.add_argument("--port", type=int, default=8020)
    sub.add_parser("app", help="run the editor in a desktop window")
    for name, help in (("show", "print tags"), ("rm-cover", "strip cover art")):
        sub.add_parser(name, help=help).add_argument("files", nargs="+", type=Path)
    args = parser.parse_args()

    if args.cmd == "serve":
        import uvicorn

        uvicorn.run("mp3editor.api:app", host="127.0.0.1", port=args.port)
        return
    if args.cmd == "app":
        window()
        return
    for f in args.files:
        if args.cmd == "show":
            t = core.read(f)
            print(f"{f.name}  ({t.duration:.1f}s, {t.bitrate // 1000} kbps, cover: {'yes' if t.has_cover else 'no'})")
            for k, v in t.tags.model_dump().items():
                print(f"  {k:<13}{', '.join(v) if isinstance(v, list) else v}")
        else:
            print(f"{f.name}: {'cover removed' if core.remove_cover(f) else 'had no cover'}")


def window() -> None:
    """The API on a free port in a background thread, and a native WebKit window onto it."""
    import uvicorn
    import webview

    with socket.socket() as s:  # a free port, so a second copy or `serve` on 8020 doesn't collide
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config("mp3editor.api:app", host="127.0.0.1", port=port, log_level="warning"))
    threading.Thread(target=server.run, daemon=True).start()
    while not server.started:
        time.sleep(0.02)
    webview.create_window(
        "mp3editor", f"http://127.0.0.1:{port}", width=1320, height=860, min_size=(880, 600), background_color="#07060a"
    )
    # not private, so the last folder (kept in localStorage) is remembered between launches
    webview.start(private_mode=False, storage_path=str(Path.home() / ".mp3editor" / "webview"))


if __name__ == "__main__":
    main()
