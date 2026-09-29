import { FolderOpen, Music, RotateCw, Search, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api, coverUrl, fmt, type Track } from './api'
import Editor from './Editor'
import Blaze from './Blaze'
import Embers from './Embers'

export type Toast = (text: string, bad?: boolean) => void

const DIR_KEY = 'mp3editor.dir'
const savedDir = () => {
  try {
    return localStorage.getItem(DIR_KEY) ?? '~/Downloads'
  } catch {
    return '~/Downloads'
  }
}

// One screen: a folder's MP3s on the left, the picked one's editor on the right.
export default function App() {
  const [dir, setDir] = useState(savedDir)
  const [tracks, setTracks] = useState<Track[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [picked, setPicked] = useState<string>()
  const [query, setQuery] = useState('')
  const [toast, setToast] = useState<{ text: string; bad: boolean; id: number }>()
  const dirty = useRef(false)

  const say: Toast = (text, bad = false) => setToast({ text, bad, id: Date.now() })
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(undefined), 3200)
    return () => clearTimeout(t)
  }, [toast])

  const open = async (folder: string) => {
    setLoading(true)
    try {
      const list = await api.files(folder)
      setTracks(list)
      setError('')
      setPicked((p) => (list.some((t) => t.path === p) ? p : undefined))
      try {
        localStorage.setItem(DIR_KEY, folder)
      } catch { /* private window: the folder just isn't remembered */ }
      return list
    } catch (e) {
      setError((e as Error).message)
      setTracks([])
      return []
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => void open(dir), []) // once, with the remembered folder

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => dirty.current && e.preventDefault()
    addEventListener('beforeunload', warn)
    return () => removeEventListener('beforeunload', warn)
  }, [])

  // undefined goes back to the landing page
  const pick = (path?: string) => {
    if (path === picked || (dirty.current && !confirm('Discard your unsaved changes?'))) return
    dirty.current = false
    setPicked(path)
  }

  // A save lands in the same file, or (converted) in a new M4A in ~/Downloads: then reload, and open it if it's here.
  const saved = async (t: Track, from: string) => {
    if (t.path === from) return setTracks((ts) => ts.map((x) => (x.path === t.path ? t : x)))
    dirty.current = false
    if ((await open(dir)).some((x) => x.path === t.path)) setPicked(t.path)
  }
  const track = tracks.find((t) => t.path === picked)
  const needle = query.trim().toLowerCase()
  const shown = needle
    ? tracks.filter((t) => [t.name, t.tags.title, t.tags.artist, t.tags.album].some((s) => s.toLowerCase().includes(needle)))
    : tracks

  return (
    <>
      <Embers className="pointer-events-none fixed inset-0 -z-10 size-full" />
      <div className="mx-auto flex h-full max-w-[1500px] flex-col gap-4 p-4">
        <header className="flex flex-wrap items-center gap-3 px-1">
          <button onClick={() => pick(undefined)} className="flex shrink-0 items-center gap-2.5 rounded-lg pr-2" aria-label="Home" title="Home">
            <Flame />
            <span className="text-[15px] font-semibold tracking-[-0.01em]">
              <span className="glow-text">mp3</span>editor
            </span>
          </button>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void open(dir)
            }}
            className="field flex h-9 min-w-0 flex-1 items-center gap-2 rounded-full pr-1 pl-3.5 sm:max-w-lg"
          >
            <FolderOpen size={15} className="shrink-0 text-muted" aria-hidden />
            <input
              value={dir}
              onChange={(e) => setDir(e.target.value)}
              aria-label="Folder"
              spellCheck={false}
              className="num min-w-0 flex-1 bg-transparent text-[13px] outline-none"
            />
            <button type="submit" className="grid size-7 place-items-center rounded-full text-muted hover:bg-panel-3 hover:text-text" aria-label="Open folder">
              <RotateCw size={14} className={loading ? 'animate-spin' : ''} aria-hidden />
            </button>
          </form>
          <p className="ml-auto hidden text-xs text-faint md:block">
            <Kbd>⌘V</Kbd> pastes a cover · <Kbd>⌘S</Kbd> saves
          </p>
        </header>

        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[320px_1fr]">
          <aside className="panel flex max-h-[40vh] min-h-0 flex-col overflow-hidden lg:max-h-none">
            <div className="flex items-center gap-2 border-b border-border p-3">
              <label className="field flex h-9 flex-1 items-center gap-2 rounded-full px-3">
                <Search size={14} className="text-muted" aria-hidden />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search"
                  className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint"
                />
              </label>
              <span className="num px-1 text-xs text-muted">{tracks.length}</span>
            </div>
            <ul className="min-h-0 flex-1 overflow-auto p-2">
              {error && (
                <li role="alert" className="flex gap-2 p-3 text-[13px] text-warn">
                  <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden />
                  {error}
                </li>
              )}
              {!error && !loading && tracks.length === 0 && <li className="p-3 text-[13px] text-muted">No audio files in this folder.</li>}
              {shown.map((t) => (
                <li key={t.path}>
                  <button
                    onClick={() => pick(t.path)}
                    aria-current={t.path === picked}
                    className="group relative flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors hover:bg-panel-2 aria-[current=true]:bg-panel-3"
                  >
                    {t.path === picked && (
                      <span className="absolute top-2 bottom-2 -left-2 w-[3px] rounded-full bg-accent shadow-[0_0_12px_2px_rgb(155_107_255/0.7)]" aria-hidden />
                    )}
                    <Thumb track={t} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-[13px] font-medium">{t.tags.title || t.name}</span>
                        {t.tags.explicit && <Explicit />}
                        {t.format !== 'mp3' && <span className="num shrink-0 rounded border border-border px-1 text-[9px] leading-4 text-muted uppercase">{t.format}</span>}
                      </span>
                      <span className="block truncate text-xs text-muted">{t.tags.artist || 'Unknown artist'}</span>
                    </span>
                    <span className="num shrink-0 text-[11px] text-faint">{fmt(t.duration).slice(0, -3)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          <main className="min-h-0 min-w-0">
            {track ? (
              <Editor key={track.path} track={track} onSaved={saved} onDirty={(d) => (dirty.current = d)} say={say} />
            ) : (
              <div className="panel grid h-full min-h-96 place-items-center p-10 text-center">
                <div className="flex flex-col items-center">
                  <Blaze className="h-64 w-52" />
                  <h1 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">{tracks.length ? 'Pick a track' : 'Open a folder of songs'}</h1>
                  <p className="mt-2 text-muted">MP3, M4A, WAV, AIFF, FLAC or AAC. Tags, artists, cover art and where the song ends, written into the file or out as an M4A.</p>
                </div>
              </div>
            )}
          </main>
        </div>
      </div>

      {toast && (
        <div
          key={toast.id}
          role="status"
          className={`rise panel fixed right-5 bottom-5 z-50 flex max-w-sm items-center gap-2.5 px-4 py-3 text-[13px] ${toast.bad ? 'border-crit/50' : 'border-accent/40'}`}
        >
          <span className={`size-2 shrink-0 rounded-full ${toast.bad ? 'bg-crit' : 'pulse-dot bg-accent text-accent'}`} aria-hidden />
          {toast.text}
        </div>
      )}
    </>
  )
}

function Thumb({ track }: { track: Track }) {
  const [broken, setBroken] = useState(false)
  return track.hasCover && !broken ? (
    <img src={coverUrl(track)} alt="" onError={() => setBroken(true)} className="size-10 shrink-0 rounded-lg object-cover shadow-[0_4px_14px_-4px_rgb(0_0_0/0.8)]" />
  ) : (
    <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-border bg-panel-2 text-faint">
      <Music size={16} aria-hidden />
    </span>
  )
}

/** Apple Music's boxed E. */
export function Explicit() {
  return (
    <span title="Explicit" className="grid size-4 shrink-0 place-items-center rounded-[3px] bg-muted text-[10px] leading-none font-semibold text-bg">
      E
    </span>
  )
}

function Kbd({ children }: { children: string }) {
  return <kbd className="num rounded border border-border bg-panel-2 px-1 py-px text-[11px] text-muted">{children}</kbd>
}

/** The mark: a flame, light purple into royal, with a white core. */
function Flame() {
  return (
    <svg viewBox="0 0 32 32" className="flicker size-7 drop-shadow-[0_4px_14px_rgb(155_107_255/0.7)]" aria-hidden>
      <defs>
        <linearGradient id="flame-fill" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#4c1d95" />
          <stop offset="0.55" stopColor="#8b5cf6" />
          <stop offset="1" stopColor="#e4d8ff" />
        </linearGradient>
      </defs>
      <path d="M16 2c1 5 7 8 7 16a7 7 0 0 1-14 0c0-4 2-6 3-8 0 3 1 5 3 5-1-5 0-9 1-13Z" fill="url(#flame-fill)" />
      <path d="M16 17c2 2 3 3 3 5a3 3 0 0 1-6 0c0-2 1-3 3-5Z" fill="#f5f0ff" opacity="0.85" />
    </svg>
  )
}
