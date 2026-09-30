import { ClipboardPaste, FileAudio, ImageUp, Music, RotateCcw, Split, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api, coverUrl, fmt, splitArtists, type Tags, type Track } from './api'
import type { Toast } from './App'
import { Artists, Chip, DATE, input, Row } from './Editor'

type Key = Exclude<keyof Tags, 'title'> // one title across many songs is never what you want

// Several songs at once. Only the fields you touch are written; the rest keep each song's own value.
// A field the songs disagree on shows as "Mixed". Save runs the same per-file save as the single editor.
export default function Batch({ tracks, onSaved, onDirty, say }: {
  tracks: Track[]; onSaved: (saved: Track[]) => void; onDirty: (dirty: boolean) => void; say: Toast
}) {
  const [edits, setEdits] = useState<Partial<Pick<Tags, Key>>>({})
  const [splitEach, setSplitEach] = useState(false)
  const [cover, setCover] = useState<'keep' | 'remove' | Blob>('keep')
  const [toM4a, setToM4a] = useState(false)
  const [preview, setPreview] = useState<string>()
  const [progress, setProgress] = useState<number | null>(null)
  const file = useRef<HTMLInputElement>(null)

  const common = <K extends Key>(k: K): Tags[K] | undefined => {
    const first = JSON.stringify(tracks[0].tags[k])
    return tracks.every((t) => JSON.stringify(t.tags[k]) === first) ? tracks[0].tags[k] : undefined
  }
  const touched = (k: Key) => k in edits
  const value = <K extends Key>(k: K): Tags[K] | undefined => (touched(k) ? (edits[k] as Tags[K]) : common(k))
  const set = <K extends Key>(k: K, v: Tags[K]) => setEdits((e) => ({ ...e, [k]: v }))
  const unset = (k: Key) => setEdits(({ [k]: _, ...rest }) => rest)

  const converts = (t: Track) => t.format !== 'm4a' && (toM4a || t.format !== 'mp3')
  const mp3s = tracks.filter((t) => t.format === 'mp3').length
  const converting = tracks.filter(converts).length
  const dirty = Object.keys(edits).length > 0 || splitEach || cover !== 'keep'
  const dateOk = edits.date === undefined || DATE.test(edits.date.trim())
  const busy = progress !== null
  const canSave = (dirty || converting > 0) && dateOk && !busy
  const formats = [...new Set(tracks.map((t) => t.format))].map((f) => `${tracks.filter((t) => t.format === f).length} ${f.toUpperCase()}`)

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
    setEdits({})
    setSplitEach(false)
    setCover('keep')
    setToM4a(false)
  }

  const save = async () => {
    if (!canSave) return
    const done: Track[] = []
    const failed: string[] = []
    for (const [i, t] of tracks.entries()) {
      setProgress(i)
      const tags = { ...t.tags, ...edits }
      tags.date = tags.date.trim()
      if (splitEach) tags.artists = splitArtists(tags.artist)
      try {
        done.push(await api.save(t.path, { tags, cover, end: null, m4a: converts(t) }))
      } catch (e) {
        failed.push(`${t.name}: ${(e as Error).message}`)
      }
    }
    setProgress(null)
    if (failed.length) say(`${done.length} saved, ${failed.length} failed. ${failed[0]}`, true)
    else {
      say(`Saved ${done.length} songs`)
      reset() // on a failure the edits stay, so Save can be tried again
    }
    onSaved(done)
  }

  // ⌘S saves; ⌘V with an image on the clipboard sets every cover.
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

  // A text field that shows the shared value, or "Mixed" until you type into it.
  const text = (k: Exclude<Key, 'artists' | 'explicit'>, label: string, hint?: string, error?: string) => (
    <Row label={label} hint={hint} error={error}>
      <span className="relative block">
        <input
          value={(value(k) as string | undefined) ?? ''}
          onChange={(e) => set(k, e.target.value)}
          placeholder={common(k) === undefined ? 'Mixed' : ''}
          aria-invalid={!!error}
          className={`${input} pr-9 ${k === 'date' ? 'num' : ''} ${touched(k) ? 'border-accent/60' : ''}`}
        />
        {touched(k) && <Undo onClick={() => unset(k)} />}
      </span>
    </Row>
  )

  const covers = tracks.filter((t) => t.hasCover).slice(0, 4)
  const artists = value('artists')
  const explicit = value('explicit')

  return (
    <div className="panel flex h-full min-h-0 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-auto p-5 sm:p-6">
        <div className="flex flex-col gap-6 sm:flex-row">
          <div className="flex shrink-0 flex-col items-center gap-3">
            <div className="aura relative size-52 rounded-2xl sm:size-56">
              {preview ? (
                <img src={preview} alt="New cover for every selected song" className="size-full rounded-2xl object-cover" />
              ) : cover === 'remove' || covers.length === 0 ? (
                <div className="grid size-full place-items-center rounded-2xl bg-panel-2 p-6 text-center">
                  <span className="flex flex-col items-center gap-2 text-muted">
                    <Music size={28} className="text-accent" aria-hidden />
                    <span className="text-xs">{cover === 'remove' ? 'Covers will be removed' : 'Paste or drop cover art for all'}</span>
                  </span>
                </div>
              ) : (
                <div className={`grid size-full overflow-hidden rounded-2xl ${covers.length > 1 ? 'grid-cols-2' : ''}`}>
                  {covers.map((t) => (
                    <img key={t.path} src={coverUrl(t)} alt="" className="size-full object-cover" />
                  ))}
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={pasteButton} disabled={busy} className="btn h-8 px-3 text-xs" title="Paste an image for every selected song (or press ⌘V)">
                <ClipboardPaste size={14} aria-hidden /> Paste
              </button>
              <button onClick={() => file.current?.click()} disabled={busy} className="btn h-8 px-3 text-xs">
                <ImageUp size={14} aria-hidden /> Choose
              </button>
              <button onClick={() => setCover('remove')} disabled={busy || cover === 'remove'} className="btn btn-danger h-8 px-3 text-xs" aria-label="Remove every cover">
                <Trash2 size={14} aria-hidden />
              </button>
              {cover !== 'keep' && (
                <button onClick={() => setCover('keep')} className="btn h-8 px-3 text-xs" aria-label="Keep each song’s own cover">
                  <RotateCcw size={14} aria-hidden />
                </button>
              )}
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
            <p className="num text-xs text-faint">Editing together</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">
              <span className="glow-text">{tracks.length}</span> songs
            </h2>
            <p className="mt-1 text-muted">Only the fields you change are written. The rest keep each song’s own value.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Chip>{fmt(tracks.reduce((s, t) => s + t.duration, 0)).slice(0, -3)} total</Chip>
              {formats.map((f) => <Chip key={f}>{f}</Chip>)}
            </div>
            <ul className="num mt-4 max-h-24 overflow-auto text-xs text-faint">
              {tracks.map((t) => <li key={t.path} className="truncate">{t.tags.title || t.name}</li>)}
            </ul>
            <div className="mt-auto flex flex-wrap items-center gap-x-5 gap-y-3 pt-5">
              <div className="flex items-center gap-2 text-[13px]" role="group" aria-label="Explicit">
                Explicit
                <span className="segmented text-xs">
                  {([['keep', 'Keep'], [true, 'Yes'], [false, 'No']] as const).map(([v, label]) => {
                    const on = v === 'keep' ? !touched('explicit') : touched('explicit') && explicit === v
                    return (
                      <button key={label} aria-pressed={on} onClick={() => (v === 'keep' ? unset('explicit') : set('explicit', v))} className="rounded-full px-3 py-1 text-muted">
                        {label}
                      </button>
                    )
                  })}
                </span>
                {!touched('explicit') && <span className="text-xs text-faint">{explicit === undefined ? 'mixed' : explicit ? 'all explicit' : 'none explicit'}</span>}
              </div>
              {mp3s > 0 && (
                <button
                  onClick={() => setToM4a((v) => !v)}
                  aria-pressed={toM4a}
                  className={`btn h-8 px-3 text-xs ${toM4a ? 'border-accent/60 bg-accent/10 text-glow shadow-[0_0_18px_-6px_rgb(155_107_255/0.9)]' : ''}`}
                  title="Save writes each MP3 as a 256 kbps AAC .m4a in ~/Downloads; the MP3s are left as they are"
                >
                  <FileAudio size={14} aria-hidden /> {toM4a ? `Converting ${mp3s} MP3s to M4A` : 'Convert MP3s to M4A'}
                </button>
              )}
            </div>
          </div>
        </div>

        <section className="mt-8 grid gap-x-5 gap-y-4 md:grid-cols-2">
          {text('artist', 'Artist', 'The single line Apple Music shows')}
          {text('albumArtist', 'Album artist', 'Set this once for a whole album')}
          <div className="md:col-span-2">
            <Row group label="Artists" hint={splitEach ? 'Taken from each song’s own artist line' : artists === undefined && !touched('artists') ? 'Mixed' : 'Each name stored on its own'}>
              <span className={`relative block ${splitEach ? 'pointer-events-none opacity-40' : ''}`}>
                <Artists value={artists ?? []} onChange={(v) => set('artists', v)} />
                {touched('artists') && <Undo onClick={() => unset('artists')} />}
              </span>
            </Row>
            <button
              onClick={() => {
                setSplitEach((v) => !v)
                unset('artists')
              }}
              aria-pressed={splitEach}
              className={`btn mt-2 h-7 px-3 text-xs ${splitEach ? 'border-accent/60 bg-accent/10 text-glow' : ''}`}
            >
              <Split size={13} aria-hidden /> Split each song’s artist line into its own names
            </button>
          </div>
          {text('album', 'Album')}
          {text('date', 'Released', 'A year, or a full date', dateOk ? undefined : 'Use 2020, 2020-12 or 2020-12-25')}
        </section>
      </div>

      <footer className="flex items-center gap-3 border-t border-border bg-panel/80 px-5 py-3 backdrop-blur">
        <span className="min-w-0 truncate text-[13px] text-muted">
          {[tracks.length - converting && `${tracks.length - converting} saved in place`, converting && `${converting} written as M4A to ~/Downloads`].filter(Boolean).join(' · ')}
        </span>
        <button onClick={reset} disabled={!(dirty || toM4a) || busy} className="btn ml-auto h-9 shrink-0 px-4 text-[13px]">
          Revert
        </button>
        <button onClick={save} disabled={!canSave} className="btn-royal h-9 shrink-0 px-5 text-[13px]">
          {busy ? `Saving ${progress! + 1}/${tracks.length}…` : `Save ${tracks.length}`}
        </button>
      </footer>
    </div>
  )
}

function Undo({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded-full text-accent-2 hover:bg-panel-3 hover:text-text" aria-label="Keep each song’s own value" title="Keep each song’s own value">
      <RotateCcw size={13} aria-hidden />
    </button>
  )
}
