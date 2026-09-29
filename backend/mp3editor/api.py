"""The editor's HTTP API. Local only: it reads and writes any audio path it's handed."""

import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from mutagen import MutagenError

from . import core

app = FastAPI(title="mp3editor")
MEDIA_TYPES = {".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".wav": "audio/wav", ".aif": "audio/aiff",
               ".aiff": "audio/aiff", ".flac": "audio/flac", ".aac": "audio/aac"}


def audio_file(path: str) -> Path:
    p = Path(path).expanduser()
    if p.suffix.lower() not in core.AUDIO or not p.is_file():
        raise HTTPException(404, f"No audio file at {path}")
    return p


@app.get("/api/files")
def files(dir: str) -> list[core.Track]:
    d = Path(dir).expanduser()
    if not d.is_dir():
        raise HTTPException(404, f"No folder at {dir}")
    tracks = []
    for p in sorted(d.iterdir(), key=lambda p: p.name.lower()):
        if p.suffix.lower() in core.AUDIO and not p.name.startswith("."):
            try:
                tracks.append(core.read(p))
            except MutagenError:  # not really audio; leave it out of the list
                pass
    return tracks


@app.post("/api/save")
def save(path: str, req: core.Save) -> core.Track:
    """Tags, cover and cut in one go. The answer is the file written: the same one, or a new M4A."""
    try:
        return core.read(core.save(audio_file(path), req))
    except ValueError as e:
        raise HTTPException(422, str(e)) from e


@app.get("/api/cover")
def get_cover(path: str) -> Response:
    if not (found := core.cover(audio_file(path))):
        raise HTTPException(404, "No cover")
    return Response(found[0], media_type=found[1])


@app.get("/api/audio")
def audio(path: str) -> FileResponse:
    p = audio_file(path)
    return FileResponse(p, media_type=MEDIA_TYPES[p.suffix.lower()])


# The built UI: mp3editor.app's copy, else the checkout's (`npm run build` in frontend/). In dev, Vite serves it
# and proxies /api here.
DIST = Path(os.environ.get("MP3EDITOR_UI") or Path(__file__).resolve().parents[2] / "frontend" / "dist")
if DIST.is_dir():
    app.mount("/", StaticFiles(directory=DIST, html=True), name="ui")
