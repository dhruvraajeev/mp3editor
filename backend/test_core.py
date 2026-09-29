import shutil

import pytest
from mutagen.mp3 import MP3

from mp3editor import core

HEADER = b"\xff\xfb\x90\x00"  # MPEG-1 Layer III, 128 kbps, 44.1 kHz, stereo: 417-byte frames of 1152 samples
FRAME_S = 1152 / 44100


def song(tmp_path, frames=400):
    """A silent MP3 led by an "Info" header frame, like LAME writes, counting `frames` audio frames."""
    info = bytearray(HEADER + bytes(413))
    info[36:48] = b"Info" + (3).to_bytes(4) + frames.to_bytes(4)
    info[48:52] = (417 * (frames + 1)).to_bytes(4)
    p = tmp_path / "song.mp3"
    p.write_bytes(bytes(info) + (HEADER + bytes(413)) * frames)
    return p


TAGS = core.Tags(
    title="Sky", artist="Playboi Carti & Travis Scott", artists=["Playboi Carti", "Travis Scott"],
    album="Whole Lotta Red", album_artist="Playboi Carti", date="2020-12-25", explicit=True,
)
PNG = core.Cover(mime="image/png", data=b"iVBORw0KGgo=")  # base64, as the UI sends it


def test_mp3_tags_and_cover(tmp_path):
    p = song(tmp_path)
    assert core.save(p, core.Save(tags=TAGS, cover=PNG)) == p
    assert core.read(p).tags == TAGS and core.cover(p) == (b"\x89PNG\r\n\x1a\n", "image/png")
    core.save(p, core.Save(tags=core.Tags()))  # clearing a field removes its frame; "keep" keeps the cover
    assert core.read(p).tags == core.Tags() and core.read(p).has_cover
    assert core.remove_cover(p) and not core.remove_cover(p)


@pytest.mark.skipif(not shutil.which("afconvert"), reason="M4A needs macOS's afconvert")
def test_convert_to_m4a_then_edit_in_place(tmp_path, monkeypatch):
    monkeypatch.setattr(core, "DOWNLOADS", tmp_path / "out")
    monkeypatch.setattr(core, "BACKUPS", tmp_path / "backups")
    (tmp_path / "out").mkdir()
    p = song(tmp_path)
    m4a = core.save(p, core.Save(tags=TAGS, cover=PNG, end=5.0, m4a=True))
    assert m4a == tmp_path / "out" / "song.m4a" and p.exists()  # the MP3 is left alone
    t = core.read(m4a)
    assert t.tags == TAGS and t.has_cover and abs(t.duration - 5.0) < 0.1
    assert core.save(p, core.Save(tags=TAGS, m4a=True)).name == "song 2.m4a"  # never overwrites
    # an M4A is overwritten in place, cut included
    assert core.save(m4a, core.Save(tags=core.Tags(title="Cut"), end=3.0)) == m4a
    assert core.read(m4a).tags.title == "Cut" and abs(core.read(m4a).duration - 3.0) < 0.1


def test_trim(tmp_path, monkeypatch):
    monkeypatch.setattr(core, "BACKUPS", tmp_path / "backups")
    p = song(tmp_path)
    core.save(p, core.Save(tags=core.Tags(title="Sky")))
    before = p.read_bytes()
    core.trim(p, 5.0)
    frames = -(-5.0 // FRAME_S)  # rounded up to a whole frame
    assert abs(MP3(p).info.length - frames * FRAME_S) < 0.001  # the Info header was updated
    assert core.read(p).tags.title == "Sky"
    assert list((tmp_path / "backups").iterdir())[0].read_bytes() == before
    try:
        core.trim(p, 60)
        raise AssertionError("trimming past the end should fail")
    except ValueError:
        pass
