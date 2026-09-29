// Mirrors backend/mp3editor/core.py's Tags and Track.
export interface Tags {
  title: string
  artist: string // the one line Apple Music shows
  artists: string[] // each name on its own
  album: string
  albumArtist: string
  date: string
  explicit: boolean
}

export interface Track {
  path: string
  name: string
  format: string // the extension: "mp3", "m4a", "wav"…
  duration: number
  bitrate: number
  hasCover: boolean
  mtime: number
  tags: Tags
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let r: Response
  try {
    r = await fetch(url, init)
  } catch {
    throw new Error('Can’t reach the mp3editor server. Start it with `uv run mp3editor serve` in backend/.')
  }
  if (!r.ok) {
    const body = await r.json().catch(() => null)
    const detail = body?.detail
    throw new Error(typeof detail === 'string' ? detail : (detail?.[0]?.msg ?? `${r.status} ${r.statusText}`))
  }
  return r.json()
}

/** One Save: tags, the cover ("keep", "remove", or a new image), where to cut the song, and whether an MP3
 *  should come out as an M4A in ~/Downloads instead. Non-MP3/M4A files always come out as an M4A. */
export interface SaveRequest {
  tags: Tags
  cover: 'keep' | 'remove' | Blob
  end: number | null
  m4a: boolean
}

const q = (path: string) => `?path=${encodeURIComponent(path)}`
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

export const api = {
  files: (dir: string) => call<Track[]>(`/api/files?dir=${encodeURIComponent(dir)}`),
  save: async (path: string, r: SaveRequest) => {
    let cover: unknown = r.cover
    if (r.cover instanceof Blob) {
      const img = await asCover(r.cover)
      cover = { mime: img.type, data: await base64(img) }
    }
    return call<Track>(`/api/save${q(path)}`, json('POST', { ...r, cover }))
  },
}

// mtime busts the browser's cache after the file changes.
export const coverUrl = (t: Track) => `/api/cover${q(t.path)}&v=${t.mtime}`
export const audioUrl = (t: Track) => `/api/audio${q(t.path)}&v=${t.mtime}`

/** Apple Music shows JPEG and PNG covers; anything else (WebP, GIF, HEIC…) is redrawn as a PNG. */
async function asCover(blob: Blob): Promise<Blob> {
  if (blob.type === 'image/jpeg' || blob.type === 'image/png') return blob
  const bmp = await createImageBitmap(blob)
  const canvas = new OffscreenCanvas(bmp.width, bmp.height)
  canvas.getContext('2d')!.drawImage(bmp, 0, 0)
  return canvas.convertToBlob({ type: 'image/png' })
}

async function base64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

/** 3:07.42 */
export function fmt(s: number) {
  const m = Math.floor(s / 60)
  return `${m}:${(s - m * 60).toFixed(2).padStart(5, '0')}`
}

/** "3:07.42" or "187.42" → seconds, or NaN. */
export function parseTime(text: string) {
  const m = text.trim().match(/^(?:(\d+):)?(\d+(?:\.\d*)?)$/)
  return m ? Number(m[1] ?? 0) * 60 + Number(m[2]) : NaN
}

/** "Playboi Carti & Travis Scott feat. Future" → each name. */
export function splitArtists(line: string) {
  return line.split(/\s*(?:,|&|;|\/|\+|\bx\b|\bfeat\.?|\bft\.?|\bwith\b)\s*/i).map((a) => a.trim()).filter(Boolean)
}
