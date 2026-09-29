import { Crosshair, Pause, Play, Scissors, SkipForward } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { audioUrl, fmt, parseTime, type Track } from './api'

const BARS = 240

// Where the song cuts off: its waveform, and playback that stops at the cut so you hear the new ending before
// saving. `cut` is null for "play to the end"; Editor applies it on Save and remounts this (keyed by duration)
// on the shorter file.
export default function Ending({ track, cut: picked, setCut: pick }: { track: Track; cut: number | null; setCut: (s: number | null) => void }) {
  const [src] = useState(() => audioUrl(track)) // fixed per mount: a cover change mustn't restart playback
  const audio = useRef<HTMLAudioElement>(null)
  const [peaks, setPeaks] = useState<number[]>()
  const [now, setNow] = useState(0)
  const [playing, setPlaying] = useState(false)
  const len = track.duration
  const cut = picked ?? len
  const [cutText, setCutText] = useState(fmt(cut))
  const cutRef = useRef(cut)
  cutRef.current = cut
  useEffect(() => {
    setCutText(fmt(cut))
  }, [cut])
  const setCut = (s: number) => {
    const v = Math.min(Math.max(s, 0.1), len)
    pick(v >= len - 0.03 ? null : v)
  }

  // Decode the audio once and keep the loudest sample in each of BARS slices.
  useEffect(() => {
    let live = true
    const ctx = new AudioContext()
    fetch(src)
      .then((r) => r.arrayBuffer())
      .then((b) => ctx.decodeAudioData(b))
      .then((buf) => {
        const ch = buf.getChannelData(0)
        const step = Math.floor(ch.length / BARS)
        const out = Array.from({ length: BARS }, (_, i) => {
          let m = 0
          for (let j = i * step; j < (i + 1) * step; j += 32) m = Math.max(m, Math.abs(ch[j]))
          return m
        })
        const top = Math.max(...out, 0.001)
        if (live) setPeaks(out.map((p) => p / top))
      })
      .catch(() => live && setPeaks([]))
      .finally(() => void ctx.close())
    return () => {
      live = false
    }
  }, [src])

  // While playing: move the playhead every frame, and stop at the cut so you hear the new ending.
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = () => {
      const a = audio.current!
      if (a.currentTime >= cutRef.current) {
        a.pause()
        a.currentTime = cutRef.current
      }
      setNow(a.currentTime)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  const play = (from?: number) => {
    const a = audio.current!
    if (from !== undefined) a.currentTime = from
    else if (a.currentTime >= cutRef.current - 0.05) a.currentTime = 0
    void a.play()
  }
  const seek = (s: number) => {
    audio.current!.currentTime = s
    setNow(s)
  }

  const pct = (s: number) => `${(s / len) * 100}%`

  return (
    <section className="mt-8 rounded-2xl border border-border bg-panel-2/40 p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-[13px] font-semibold">Ending</h2>
        <p className="text-xs text-faint">Where the song cuts off. Playback stops at the cut so you can hear it; Save applies it.</p>
      </div>

      <audio ref={audio} src={src} preload="auto" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />

      <div
        className="relative mt-4 h-28 cursor-pointer select-none"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          seek(((e.clientX - r.left) / r.width) * len)
        }}
        title="Click to move the playhead"
      >
        {peaks === undefined ? (
          <div className="grid h-full place-items-center text-xs text-faint">Reading the audio…</div>
        ) : (
          <svg viewBox={`0 0 ${BARS} 100`} preserveAspectRatio="none" className="size-full" aria-hidden>
            <defs>
              <linearGradient id="wave" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#f1e9ff" />
                <stop offset="0.35" stopColor="#b794ff" />
                <stop offset="0.65" stopColor="#8b5cf6" />
                <stop offset="1" stopColor="#5b21b6" />
              </linearGradient>
              <clipPath id="kept">
                <rect width={(cut / len) * BARS} height="100" />
              </clipPath>
            </defs>
            <g fill="var(--border-strong)">{bars(peaks)}</g>
            <g fill="url(#wave)" clipPath="url(#kept)">{bars(peaks)}</g>
          </svg>
        )}
        <span className="pointer-events-none absolute inset-y-0 w-px bg-text/80" style={{ left: pct(now) }} aria-hidden />
        <span
          className="pointer-events-none absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-accent shadow-[0_0_14px_3px_rgb(155_107_255/0.8)]"
          style={{ left: pct(cut) }}
          aria-hidden
        >
          <Scissors size={12} className="absolute -top-4 left-1/2 -translate-x-1/2 text-accent-2" />
        </span>
      </div>

      <input
        type="range"
        min={0}
        max={len}
        step={0.01}
        value={cut}
        onChange={(e) => setCut(e.target.valueAsNumber)}
        style={{ '--fill': pct(cut) } as CSSProperties}
        aria-label="Cut point"
        className="mt-2 w-full"
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => (playing ? audio.current!.pause() : play())}
          className="grid size-9 place-items-center rounded-full bg-text text-bg shadow-[0_0_20px_-4px_rgb(155_107_255/0.9)] transition-transform active:scale-95"
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" className="translate-x-px" />}
        </button>
        <span className="num w-40 text-xs text-muted">
          {fmt(now)} <span className="text-faint">/ {fmt(len)}</span>
        </span>
        <button onClick={() => play(Math.max(0, cut - 5))} className="btn h-8 px-3 text-xs" title="Play the last 5 seconds before the cut">
          <SkipForward size={13} aria-hidden /> Hear the ending
        </button>
        <button onClick={() => setCut(now)} disabled={now <= 0} className="btn h-8 px-3 text-xs">
          <Crosshair size={13} aria-hidden /> Cut at playhead
        </button>

        <label className="ml-auto flex items-center gap-2 text-xs text-muted">
          Cut at
          <input
            value={cutText}
            onChange={(e) => setCutText(e.target.value)}
            onBlur={() => {
              const s = parseTime(cutText)
              if (Number.isFinite(s)) setCut(s)
              else setCutText(fmt(cut))
            }}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            aria-label="Cut time"
            className="field num h-8 w-24 px-2 text-center text-xs"
          />
        </label>
        {picked !== null && (
          <button onClick={() => pick(null)} className="btn h-8 px-3 text-xs" title="Play to the end again">
            <Scissors size={13} aria-hidden /> Save cuts {fmt(len - cut)} off · undo
          </button>
        )}
      </div>
    </section>
  )
}

function bars(peaks: number[]) {
  return peaks.map((p, i) => {
    const h = Math.max(2, p * 96)
    return <rect key={i} x={i + 0.15} y={(100 - h) / 2} width={0.7} height={h} rx={0.3} />
  })
}
