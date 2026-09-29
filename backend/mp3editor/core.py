"""Read and write the tags mp3editor edits, cut songs short, and convert them to M4A.

MP3 and M4A are edited in place. Anything else (WAV, AIFF, FLAC, AAC) can't hold these tags well, so saving
it converts to an M4A in ~/Downloads; an MP3 can opt into the same.
"""

import hashlib
import os
import re
import shutil
import subprocess
import tempfile
import wave
from pathlib import Path
from typing import Literal

import mutagen
from mutagen.flac import FLAC
from mutagen.id3 import APIC, ID3, TALB, TDRC, TIT2, TPE1, TPE2, TXXX, ID3NoHeaderError
from mutagen.mp4 import MP4, MP4Cover, MP4FreeForm, MP4Tags
from pydantic import Base64Bytes, BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

AUDIO = {".mp3", ".m4a", ".wav", ".aif", ".aiff", ".flac", ".aac"}
BACKUPS = Path.home() / ".mp3editor" / "backups"
DOWNLOADS = Path.home() / "Downloads"


class Model(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class Tags(Model):
    title: str = ""
    # Two artist tags, the way MusicBrainz Picard writes them: `artist` is the one line players show,
    # e.g. "Playboi Carti & Travis Scott"; `artists` holds each name on its own.
    artist: str = ""
    artists: list[str] = []
    album: str = ""
    album_artist: str = ""  # what Apple Music groups an album by, so features don't split it
    date: str = Field("", pattern=r"^(\d{4}(-\d{2}(-\d{2})?)?)?$")  # "2020", "2020-12" or "2020-12-25"
    explicit: bool = False


class Track(Model):
    path: str
    name: str
    format: str  # the extension: "mp3", "m4a", "wav"…
    duration: float
    bitrate: int
    has_cover: bool
    mtime: float
    tags: Tags


class Cover(Model):
    mime: Literal["image/jpeg", "image/png"]  # the two Apple Music shows
    data: Base64Bytes


class Save(Model):
    tags: Tags
    cover: Cover | Literal["keep", "remove"] = "keep"
    end: float | None = Field(None, gt=0)  # cut the song off here, in seconds
    m4a: bool = False  # MP3 only: write an M4A to ~/Downloads instead of editing the MP3


def _date(raw: object) -> str:
    """The leading "2020-12-25" of a stored date like "2020-12-25T08:00:00Z"."""
    m = re.match(r"\d{4}(-\d{2}(-\d{2})?)?", str(raw))
    return m.group(0) if m else ""


# ── Reading ─────────────────────────────────────────────────────────────────


def read(path: Path) -> Track:
    f = mutagen.File(path)
    if f is None:
        raise mutagen.MutagenError(f"{path.name} isn't audio mp3editor can read")
    if isinstance(f.tags, ID3):  # MP3, and WAV/AIFF with an ID3 chunk
        tags = _read_id3(f.tags)
    elif isinstance(f.tags, MP4Tags):
        tags = _read_mp4(f.tags)
    elif isinstance(f, FLAC) and f.tags:
        tags = _read_vorbis(f.tags)
    else:
        tags = Tags()
    return Track(
        path=str(path),
        name=path.name,
        format=path.suffix[1:].lower(),
        duration=f.info.length,
        bitrate=getattr(f.info, "bitrate", 0) or 0,
        has_cover=_cover(f) is not None,
        mtime=path.stat().st_mtime,
        tags=tags,
    )


def _read_id3(id3: ID3) -> Tags:
    text = {k: str(id3[frame].text[0]) for k, frame in ID3_FRAMES.items() if frame in id3}
    if "TXXX:ARTISTS" in id3:
        artists = [str(a) for a in id3["TXXX:ARTISTS"].text]
    elif "TPE1" in id3 and len(id3["TPE1"].text) > 1:  # another tagger stored the names as a multi-value TPE1
        artists = [str(a) for a in id3["TPE1"].text]
        text["artist"] = " & ".join(artists)
    else:
        artists = []
    advisory = id3.get("TXXX:ITUNESADVISORY")
    text["date"] = _date(text.get("date", ""))
    return Tags(**text, artists=artists, explicit=bool(advisory and str(advisory.text[0]) == "1"))


def _read_mp4(t: MP4Tags) -> Tags:
    text = {k: str(t[atom][0]) for k, atom in MP4_ATOMS.items() if t.get(atom)}
    text["date"] = _date(text.get("date", ""))
    artists = [bytes(a).decode() for a in t.get(MP4_ARTISTS, [])]
    return Tags(**text, artists=artists, explicit=t.get("rtng", [0])[0] in (1, 4))


def _read_vorbis(t) -> Tags:
    first = lambda k: t.get(k, [""])[0]  # noqa: E731
    return Tags(
        title=first("title"), artist=first("artist"), artists=t.get("artists", []), album=first("album"),
        album_artist=first("albumartist"), date=_date(first("date")), explicit=first("itunesadvisory") == "1",
    )


def _cover(f) -> tuple[bytes, str] | None:
    t = f.tags
    if isinstance(t, ID3):
        pics = t.getall("APIC")
        front = next((p for p in pics if p.type == 3), pics[0] if pics else None)
        return (front.data, front.mime) if front else None
    if isinstance(t, MP4Tags) and t.get("covr"):
        c = t["covr"][0]
        return bytes(c), "image/png" if c.imageformat == MP4Cover.FORMAT_PNG else "image/jpeg"
    if isinstance(f, FLAC) and f.pictures:
        return f.pictures[0].data, f.pictures[0].mime
    return None


def cover(path: Path) -> tuple[bytes, str] | None:
    return _cover(mutagen.File(path))


def remove_cover(path: Path) -> bool:
    """Drop every picture. False if there was none."""
    f = mutagen.File(path)
    if not _cover(f):
        return False
    if isinstance(f.tags, ID3):
        f.tags.delall("APIC")
    elif isinstance(f.tags, MP4Tags):
        del f.tags["covr"]
    else:
        f.clear_pictures()
    f.save()
    return True


# ── Writing ─────────────────────────────────────────────────────────────────

ID3_FRAMES = {"title": "TIT2", "artist": "TPE1", "album": "TALB", "album_artist": "TPE2", "date": "TDRC"}
ID3_CLASSES = {"TIT2": TIT2, "TPE1": TPE1, "TALB": TALB, "TPE2": TPE2, "TDRC": TDRC}
MP4_ATOMS = {"title": "©nam", "artist": "©ART", "album": "©alb", "album_artist": "aART", "date": "©day"}
MP4_ARTISTS = "----:com.apple.iTunes:ARTISTS"


def save(path: Path, req: Save) -> Path:
    """Apply `req` and return where the result lives: `path` itself, or a new M4A in ~/Downloads."""
    art = cover(path) if req.cover == "keep" else None if req.cover == "remove" else (req.cover.data, req.cover.mime)
    end = req.end if req.end is not None and req.end < read(path).duration - 0.01 else None
    ext = path.suffix.lower()
    if ext == ".mp3" and not req.m4a:
        _write_id3(path, req.tags, art)
        if end:
            trim(path, end)
        return path
    if ext == ".m4a":
        if end:  # AAC has no frame-exact cut here, so re-encode the kept part
            backup(path)
            to_m4a(path, path, end)
        _write_mp4(path, req.tags, art)
        return path
    dst = DOWNLOADS / f"{path.stem}.m4a"
    n = 2
    while dst.exists():  # never overwrite a file that's already there
        dst, n = DOWNLOADS / f"{path.stem} {n}.m4a", n + 1
    to_m4a(path, dst, end)
    _write_mp4(dst, req.tags, art)
    return dst


def _write_id3(path: Path, tags: Tags, art: tuple[bytes, str] | None) -> None:
    try:
        id3 = ID3(path)
    except ID3NoHeaderError:
        id3 = ID3()
    for key, frame in ID3_FRAMES.items():
        id3.delall(frame)
        if value := getattr(tags, key).strip():
            id3.add(ID3_CLASSES[frame](encoding=3, text=value))
    id3.delall("TXXX:ARTISTS")
    if names := [a.strip() for a in tags.artists if a.strip()]:
        id3.add(TXXX(encoding=3, desc="ARTISTS", text=names))
    id3.delall("TXXX:ITUNESADVISORY")
    if tags.explicit:
        id3.add(TXXX(encoding=3, desc="ITUNESADVISORY", text="1"))
    id3.delall("APIC")
    if art:
        id3.add(APIC(encoding=3, mime=art[1], type=3, desc="Cover", data=art[0]))
    id3.save(path)


def _write_mp4(path: Path, tags: Tags, art: tuple[bytes, str] | None) -> None:
    f = MP4(path)
    if f.tags is None:
        f.add_tags()
    t = f.tags
    for key, atom in MP4_ATOMS.items():
        t.pop(atom, None)
        if value := getattr(tags, key).strip():
            t[atom] = [value]
    t.pop(MP4_ARTISTS, None)
    if names := [a.strip() for a in tags.artists if a.strip()]:
        t[MP4_ARTISTS] = [MP4FreeForm(a.encode()) for a in names]
    t.pop("rtng", None)
    if tags.explicit:
        t["rtng"] = [1]  # Apple's explicit flag; M4A is where Apple Music actually shows the E
    t.pop("covr", None)
    if art:
        t["covr"] = [MP4Cover(art[0], MP4Cover.FORMAT_PNG if art[1] == "image/png" else MP4Cover.FORMAT_JPEG)]
    f.save()


def backup(path: Path) -> None:
    """Copy `path` to ~/.mp3editor/backups before its audio changes. The first copy (the true original) is kept."""
    BACKUPS.mkdir(parents=True, exist_ok=True)
    dst = BACKUPS / f"{path.stem}-{hashlib.sha1(str(path.resolve()).encode()).hexdigest()[:8]}{path.suffix}"
    if not dst.exists():
        shutil.copy2(path, dst)


def _replace(src: Path, dst: Path) -> None:
    """Move `src` onto `dst` atomically, so a crash never leaves half a song."""
    tmp = dst.with_name(f".{dst.name}.mp3editor-tmp")
    shutil.copyfile(src, tmp)
    os.replace(tmp, dst)


# ── Converting ──────────────────────────────────────────────────────────────


def _afconvert(*args: str | Path) -> None:
    if not shutil.which("afconvert"):
        raise ValueError("Converting to M4A uses macOS's afconvert, which isn't on this machine")
    done = subprocess.run(["afconvert", *map(str, args)], capture_output=True, text=True)
    if done.returncode:
        raise ValueError(f"afconvert failed: {done.stderr.strip() or done.stdout.strip()}")


def to_m4a(src: Path, dst: Path, end: float | None = None) -> None:
    """Encode `src` as 256 kbps AAC (iTunes Plus quality) at `dst`, cut at `end` seconds if given. Tags aren't carried."""
    with tempfile.TemporaryDirectory() as tmp:
        if end is not None:  # decode to PCM, keep the first `end` seconds, encode that
            pcm, cut = Path(tmp) / "full.wav", Path(tmp) / "cut.wav"
            _afconvert(src, pcm, "-f", "WAVE", "-d", "LEI16")
            with wave.open(str(pcm)) as r, wave.open(str(cut), "wb") as w:
                w.setparams(r.getparams())
                w.writeframes(r.readframes(int(end * r.getframerate())))
            src = cut
        out = Path(tmp) / "out.m4a"
        _afconvert(src, out, "-f", "m4af", "-d", "aac", "-b", "256000", "-s", "2", "-q", "127")
        _replace(out, dst)


# ── Trimming MP3s ───────────────────────────────────────────────────────────
# An MP3 is a run of independent frames, so cutting between two of them ends the song cleanly with no
# re-encode. Layer III only: that's every .mp3 anyone has.

BITRATES = {  # kbps by header index, MPEG-1 vs MPEG-2/2.5
    True: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
    False: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
}
RATES = {3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000]}


def frame(h: bytes) -> tuple[int, float] | None:
    """(bytes, seconds) of the Layer III frame starting with header `h`, or None if `h` isn't one."""
    if len(h) < 4 or h[0] != 0xFF or h[1] & 0xE0 != 0xE0:
        return None
    version, layer = (h[1] >> 3) & 3, (h[1] >> 1) & 3
    b, r, pad = h[2] >> 4, (h[2] >> 2) & 3, (h[2] >> 1) & 1
    if version == 1 or layer != 1 or b in (0, 15) or r == 3:
        return None
    samples = 1152 if version == 3 else 576
    rate = RATES[version][r]
    return samples // 8 * BITRATES[version == 3][b] * 1000 // rate + pad, samples / rate


def trim(path: Path, end: float) -> None:
    """Cut an MP3's audio at the first frame boundary at or after `end` seconds. Tags are kept.

    The untrimmed file is copied to ~/.mp3editor/backups the first time, so a cut can be undone by hand.
    """
    data = path.read_bytes()
    pos = 0
    if data[:3] == b"ID3":  # skip the ID3v2 tag; its size is "synchsafe", 7 bits per byte
        pos = 10 + sum((b & 0x7F) << (7 * (3 - i)) for i, b in enumerate(data[6:10]))
    if pos and data[5] & 0x10:  # ID3 footer
        pos += 10
    stop = len(data) - 128 if data[-128:-125] == b"TAG" else len(data)  # an ID3v1 tag trails the audio

    while pos + 4 <= stop and not frame(data[pos : pos + 4]):  # skip junk before the first frame
        pos += 1
    first, xing, frames, t = pos, -1, 0, 0.0
    while pos + 4 <= stop and t < end:
        f = frame(data[pos : pos + 4])
        if not f:  # junk between frames: step past it, it stays in the output
            pos += 1
            continue
        size, seconds = f
        if pos == first:  # a "Xing"/"Info" header frame is silent and counts the frames after it
            # it sits right after the side info, whose size depends on MPEG version and mono/stereo
            xing = next((pos + o for o in (13, 21, 36) if data[pos + o : pos + o + 4] in (b"Xing", b"Info")), -1)
        if pos != first or xing < 0:
            t += seconds
            frames += 1
        pos += size
    if pos >= stop:
        raise ValueError(f"{path.name} is only {t:.2f}s long; nothing after {end:.2f}s to cut")

    audio = bytearray(data[first:pos])
    if xing >= 0:  # keep the header's frame and byte counts true, or players show the old length
        at, flags = xing - first + 8, int.from_bytes(audio[xing - first + 4 : xing - first + 8])
        if flags & 1:
            audio[at : at + 4] = frames.to_bytes(4)
            at += 4
        if flags & 2:
            audio[at : at + 4] = len(audio).to_bytes(4)

    backup(path)
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / path.name
        out.write_bytes(data[:first] + audio + data[stop:])
        _replace(out, path)
