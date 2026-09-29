import { ArrowDown, ArrowUp, ClipboardPaste, FileAudio, ImageUp, Music, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { api, coverUrl, fmt, splitArtists, type Tags, type Track } from './api'
import { Explicit, type Toast } from './App'
import Ending from './Ending'

const DATE = /^(\d{4}(-\d{2}(-\d{2})?)?)?$/
const input = 'field h-9 w-full px-3 text-[13px]'

// The picked track. Everything is a draft (tags, cover, where the song cuts off) until Save or ⌘S writes it.
// MP3 and M4A are saved in place; any other format, or an MP3 with "Convert to M4A" on, comes out as a new M4A
// in ~/Downloads and the original is left alone.
export default function Editor({ track, onSaved, onDirty, say }: {
  track: Track; onSaved: (t: Track, from: string) => void; onDirty: (dirty: boolean) => void; say: Toast
}) {
  const editable = track.format === 'mp3' || track.format === 'm4a'
  const [draft, setDraft] = useState<Tags>(track.tags)
  const [cover, setCover] = useState<'keep' | 'remove' | Blob>('keep')
  const [cut, setCut] = useState<number | null>(null) // null: play to the end
  const [toM4a, setToM4a] = useState(!editable)
  const [preview, setPreview] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [dropping, setDropping] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const converting = track.format !== 'm4a' && toM4a
  const dirty = JSON.stringify(draft) !== JSON.stringify(track.tags) || cover !== 'keep' || cut !== null
  const dateOk = DATE.test(draft.date.trim())
  const canSave = (dirty || converting) && dateOk && !busy
  const set = <K extends keyof Tags>(k: K, v: Tags[K]) => setDraft((d) => ({ ...d, [k]: v }))
  const shownCover = preview ?? (cover === 'keep' && track.hasCover ? coverUrl(track) : undefined)

  useEffect(() => {
    onDirty(dirty)
  }, [dirty, onDirty])

  useEffect(() => {
    if (!(cover instanceof Blob)) {
      setPreview(undefined)
      return
    }
    const url = URL.createObjectURL(cover)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [cover])

  const reset = () => {
    setDraft(track.tags)
    setCover('keep')
    setCut(null)
    setToM4a(!editable)
  }

  const save = async () => {
    if (!canSave) return
    if (cut !== null && !converting
      && !confirm(`Cut ${track.name} at ${fmt(cut)}?\n\nEverything after it is removed from the file. The untrimmed original is kept in ~/.mp3editor/backups.`)) return
    setBusy(true)
    try {
      const saved = await api.save(track.path, { tags: { ...draft, date: draft.date.trim() }, cover, end: cut, m4a: converting })
      if (saved.path === track.path) {
        setDraft(saved.tags) // the server trims blanks; take its copy so the draft isn't left "dirty"
        setCover('keep')
        setCut(null)
        say(cut !== null ? `Saved, cut to ${fmt(saved.duration)}` : 'Saved')
      } else {
        say(`Saved as ~/Downloads/${saved.name}`)
      }
      onSaved(saved, track.path)
    } catch (e) {
      say((e as Error).message, true)
    } finally {
      setBusy(false)
    }
  }

  // ⌘S saves; ⌘V with an image on the clipboard sets the cover, wherever focus is.
  const latest = useRef(save)
  latest.current = save
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        void latest.current()
      }
    }
    const paste = (e: ClipboardEvent) => {
      const img = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'))
      if (!img) return
      e.preventDefault()
      setCover(img)
    }
    addEventListener('keydown', key)
    addEventListener('paste', paste)
    return () => {
      removeEventListener('keydown', key)
      removeEventListener('paste', paste)
    }
  }, [])

  const pasteButton = async () => {
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((t) => t.startsWith('image/'))
        if (type) return setCover(await item.getType(type))
      }
      say('No image on the clipboard. Copy one, then paste.', true)
    } catch {
      say('Clipboard access was blocked. Press ⌘V instead.', true)
    }
  }

  return (
    <div className="panel flex h-full min-h-0 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-auto p-5 sm:p-6">
        <div className="flex flex-col gap-6 sm:flex-row">
          <div className="flex shrink-0 flex-col items-center gap-3">
            <div
              onDragOver={(e) => {
                e.preventDefault()
                setDropping(true)
              }}
              onDragLeave={() => setDropping(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDropping(false)
                const img = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'))
                if (img) setCover(img)
                else say('Drop an image file (JPEG, PNG, WebP…)', true)
              }}
              className={`aura size-52 rounded-2xl sm:size-56 ${dropping ? 'scale-[1.02]' : ''} transition-transform`}
            >
              {shownCover ? (
                <img src={shownCover} alt={`Cover of ${draft.title || track.name}`} className="size-full rounded-2xl object-cover" />
              ) : (
                <div className="grid size-full place-items-center rounded-2xl bg-panel-2 p-6 text-center">
                  <span className="flex flex-col items-center gap-2 text-muted">
                    <Music size={28} className="text-accent" aria-hidden />
                    <span className="text-xs">Paste or drop cover art</span>
                  </span>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={pasteButton} disabled={busy} className="btn h-8 px-3 text-xs" title="Paste an image from the clipboard (or press ⌘V)">
                <ClipboardPaste size={14} aria-hidden /> Paste
              </button>
              <button onClick={() => file.current?.click()} disabled={busy} className="btn h-8 px-3 text-xs">
                <ImageUp size={14} aria-hidden /> Choose
              </button>
              <button
                onClick={() => setCover('remove')}
                disabled={busy || !shownCover}
                className="btn btn-danger h-8 px-3 text-xs"
                aria-label="Remove cover"
                title="Remove cover (terminal: mp3editor rm-cover FILE)"
              >
                <Trash2 size={14} aria-hidden />
              </button>
              <input
                ref={file}
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => {
                  const img = e.target.files?.[0]
                  e.target.value = ''
                  if (img) setCover(img)
                }}
              />
            </div>
          </div>

          <div className="flex min-w-0 flex-1 flex-col">
            <p className="num truncate text-xs text-faint" title={track.path}>{track.name}</p>
            <div className="mt-2 flex items-center gap-2">
              <input
                value={draft.title}
                onChange={(e) => set('title', e.target.value)}
                placeholder="Title"
                aria-label="Title"
                className="-mx-2 min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-2xl font-semibold tracking-[-0.02em] outline-none placeholder:text-faint hover:border-border focus:border-accent sm:text-3xl"
              />
              {draft.explicit && <Explicit />}
            </div>
            <p className="mt-1 truncate text-muted">{draft.artist || 'Unknown artist'}</p>
            <p className="truncate text-[13px] text-faint">
              {[draft.album, draft.date.slice(0, 4)].filter(Boolean).join(' · ') || 'No album'}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Chip>{fmt(track.duration)}</Chip>
              <Chip>{Math.round(track.bitrate / 1000)} kbps</Chip>
              <Chip>{track.format.toUpperCase()}</Chip>
            </div>
            <div className="mt-auto flex flex-wrap items-center gap-x-5 gap-y-3 pt-5">
            <label className="flex cursor-pointer items-center gap-3 text-[13px]" title="MP3: TXXX:ITUNESADVISORY = 1 · M4A: Apple’s rtng flag">
              <input type="checkbox" role="switch" checked={draft.explicit} onChange={(e) => set('explicit', e.target.checked)} className="peer sr-only" />
              <span
                aria-hidden
                className="relative h-5 w-9 shrink-0 rounded-full border border-border-strong bg-panel-3 transition-colors peer-checked:border-accent/60 peer-checked:bg-accent/80 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent after:absolute after:top-[2px] after:left-[2px] after:size-3.5 after:rounded-full after:bg-text after:transition-transform peer-checked:after:translate-x-4"
              />
              Explicit
            </label>
            {track.format === 'm4a' ? (
              <span className="text-xs text-faint">M4A: saves over this file</span>
            ) : editable ? (
              <button
                onClick={() => setToM4a((v) => !v)}
                aria-pressed={toM4a}
                className={`btn h-8 px-3 text-xs ${toM4a ? 'border-accent/60 bg-accent/10 text-glow shadow-[0_0_18px_-6px_rgb(155_107_255/0.9)]' : ''}`}
                title="Save writes a 256 kbps AAC .m4a to ~/Downloads; the MP3 is left as it is"
              >
                <FileAudio size={14} aria-hidden /> {toM4a ? 'Converting to M4A' : 'Convert to M4A'}
              </button>
            ) : (
              <span className="flex items-center gap-2 text-xs text-glow" title={`${track.format.toUpperCase()} can’t hold these tags, so Save converts it`}>
                <FileAudio size={14} className="text-accent" aria-hidden /> Saves as M4A
              </span>
            )}
            </div>
          </div>
        </div>

        <section className="mt-8 grid gap-x-5 gap-y-4 md:grid-cols-2">
          <Row label="Artist" hint="The single line Apple Music shows">
            <input value={draft.artist} onChange={(e) => set('artist', e.target.value)} placeholder="e.g. Playboi Carti & Travis Scott" className={input} />
          </Row>
          <Row label="Album artist" hint="What the album is grouped under, so features don’t split it">
            <input value={draft.albumArtist} onChange={(e) => set('albumArtist', e.target.value)} placeholder="e.g. Playboi Carti" className={input} />
          </Row>
          <div className="md:col-span-2">
            <Row group label="Artists" hint="Each name stored on its own (TXXX:ARTISTS). Enter adds one.">
              <Artists value={draft.artists} onChange={(v) => set('artists', v)} />
            </Row>
            <div className="mt-2 flex flex-wrap gap-2">
              <button onClick={() => set('artists', splitArtists(draft.artist))} disabled={!draft.artist.trim()} className="btn h-7 px-3 text-xs">
                <ArrowDown size={13} aria-hidden /> Split artist line into names
              </button>
              <button onClick={() => set('artist', draft.artists.join(' & '))} disabled={!draft.artists.length} className="btn h-7 px-3 text-xs">
                <ArrowUp size={13} aria-hidden /> Join names into artist line
              </button>
            </div>
          </div>
          <Row label="Album">
            <input value={draft.album} onChange={(e) => set('album', e.target.value)} className={input} />
          </Row>
          <Row label="Released" hint="A year, or a full date" error={dateOk ? undefined : 'Use 2020, 2020-12 or 2020-12-25'}>
            <input value={draft.date} onChange={(e) => set('date', e.target.value)} placeholder="e.g. 2020-12-25" aria-invalid={!dateOk} className={`num ${input}`} />
          </Row>
        </section>

        <Ending key={track.duration} track={track} cut={cut} setCut={setCut} />
      </div>

      <footer className="flex items-center gap-3 border-t border-border bg-panel/80 px-5 py-3 backdrop-blur">
        {converting ? (
          <span className="min-w-0 truncate text-[13px] text-glow">
            Writes <span className="num">~/Downloads/{track.name.replace(/\.[^.]+$/, '')}.m4a</span>, leaves the {track.format.toUpperCase()} alone
          </span>
        ) : dirty ? (
          <span className="flex items-center gap-2 text-[13px] text-accent-2">
            <span className="pulse-dot size-1.5 bg-accent text-accent" aria-hidden /> Unsaved changes
          </span>
        ) : (
          <span className="text-[13px] text-faint">All changes written to the file</span>
        )}
        <button onClick={reset} disabled={!(dirty || (editable && toM4a)) || busy} className="btn ml-auto h-9 shrink-0 px-4 text-[13px]">
          Revert
        </button>
        <button onClick={save} disabled={!canSave} className="btn-royal h-9 shrink-0 px-5 text-[13px]">
          {busy ? (converting || (cut !== null && track.format === 'm4a') ? 'Converting…' : 'Saving…') : converting ? 'Save as M4A' : 'Save'}
        </button>
      </footer>
    </div>
  )
}

// A <label> around one control; `group` makes it a plain div, for rows holding several buttons.
function Row({ label, hint, error, group, children }: { label: string; hint?: string; error?: string; group?: boolean; children: ReactNode }) {
  const Tag = group ? 'div' : 'label'
  return (
    <Tag className="block">
      <span className="mb-1.5 flex items-baseline gap-2 text-xs">
        <span className="shrink-0 text-muted">{label}</span>
        {hint && <span className="truncate text-faint">{hint}</span>}
      </span>
      {children}
      {error && <span role="alert" className="mt-1.5 block text-xs text-warn">{error}</span>}
    </Tag>
  )
}

function Chip({ children }: { children: ReactNode }) {
  return <span className="num rounded-full border border-border bg-panel-2 px-2.5 py-1 text-[11px] text-muted">{children}</span>
}

/** Names as removable chips; typing a name and pressing Enter (or comma) adds it. */
function Artists({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState('')
  const add = () => {
    const name = text.trim().replace(/,$/, '')
    if (name && !value.includes(name)) onChange([...value, name])
    setText('')
  }
  return (
    <span className="field flex min-h-9 flex-wrap items-center gap-1.5 px-1.5 py-1">
      {value.map((a) => (
        <span key={a} className="flex items-center gap-1 rounded-md border border-accent/30 bg-accent/10 py-0.5 pr-1 pl-2 text-xs text-glow">
          {a}
          <button type="button" onClick={() => onChange(value.filter((x) => x !== a))} className="rounded text-accent-2 hover:text-text" aria-label={`Remove ${a}`}>
            <X size={12} aria-hidden />
          </button>
        </span>
      ))}
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            add()
          } else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1))
        }}
        onBlur={add}
        placeholder={value.length ? '' : 'Type a name, press Enter'}
        className="h-7 min-w-32 flex-1 bg-transparent px-1.5 text-[13px] outline-none placeholder:text-faint"
      />
    </span>
  )
}
