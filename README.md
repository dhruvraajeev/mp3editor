# mp3editor

Edit a song's tags, cover art and ending, as a Mac app or in the browser. FastAPI + mutagen backend,
React + TypeScript + Tailwind UI.

## Mac app

```bash
./install-app.sh   # builds the UI, installs /Applications/mp3editor.app; rerun after pulling changes
```

The app runs from its own environment in `~/.mp3editor/venv` with a copy of the UI inside the bundle, so this
checkout can move. The first time it opens ~/Downloads, macOS asks to allow access.

## Browser / dev

```bash
cd frontend && npm install && npm run build
cd ../backend && uv run mp3editor serve        # http://localhost:8020
```

Hot reload: `uv run mp3editor serve` in `backend/` plus `npm run dev` in `frontend/` (Vite proxies `/api` to 8020).

## What Save does

Every edit (tags, cover, where the song cuts off) is a draft until Save or ⌘S.

| File | Save |
| --- | --- |
| MP3 | edits it in place; a cut is frame-exact with no re-encode |
| MP3 with **Convert to M4A** on | writes a new `~/Downloads/<name>.m4a`, MP3 untouched |
| M4A | overwrites it in place (a cut re-encodes) |
| WAV, AIFF, FLAC, AAC | always writes a new `~/Downloads/<name>.m4a` |

**Several at once:** ⌘-click, ⇧-click, or tick the row checkboxes (the header box selects all). The batch editor
writes only the fields you change; a field the songs disagree on shows "Mixed" and is left alone unless you type
into it. It can also set or remove every cover, split each song's own artist line into names, and convert all
the MP3s. Title and the cut stay per-song.

M4A is 256 kbps AAC via macOS's built-in `afconvert`. A new M4A never overwrites an existing file (`name 2.m4a`).
Before a cut changes a file's audio, the original is copied to `~/.mp3editor/backups/`.

Tags: title, artist line, each artist separately, album, album artist, release date, explicit, cover (JPEG/PNG).
MP3 uses ID3 (TIT2, TPE1, TXXX:ARTISTS, TALB, TPE2, TDRC, TXXX:ITUNESADVISORY, APIC); M4A uses Apple's atoms
(©nam, ©ART, ----:com.apple.iTunes:ARTISTS, ©alb, aART, ©day, rtng, covr).

## Terminal

```bash
uv run mp3editor show FILE...      # print tags
uv run mp3editor rm-cover FILE...  # strip cover art
```

Tests: `cd backend && uv run pytest`.
