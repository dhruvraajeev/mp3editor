import type { CSSProperties } from 'react'

// The landing page's flame: the logo's shape, burning. A turbulence filter keeps its edges wavering, the body
// flickers, and small tongues break off the tips and rise away as wisps. SVG + CSS, no library.
const FLAME = 'M16 2c1 5 7 8 7 16a7 7 0 0 1-14 0c0-4 2-6 3-8 0 3 1 5 3 5-1-5 0-9 1-13Z'
const CORE = 'M16 17c2 2 3 3 3 5a3 3 0 0 1-6 0c0-2 1-3 3-5Z'
const TONGUE = 'M0-3c1 1.6 1.7 2.7 1.7 3.7a1.7 1.7 0 0 1-3.4 0C-1.7-.3-1-1.4 0-3Z'

// Where each tongue breaks off (x, y), which way it drifts (dx), and its timing.
const TONGUES = [
  { x: 16, y: 5, dx: 2.5, d: 0, t: 2.2 },
  { x: 15.5, y: 7, dx: -3, d: 0.7, t: 2.6 },
  { x: 12, y: 11, dx: -2, d: 1.3, t: 2.3 },
  { x: 17, y: 6, dx: 1, d: 1.8, t: 2.9 },
  { x: 12.5, y: 12, dx: -3.5, d: 2.4, t: 2.4 },
  { x: 16.5, y: 4, dx: -1, d: 3.1, t: 2.7 },
]

export default function Blaze({ className = '' }: { className?: string }) {
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches
  return (
    <div className={`relative ${className}`} aria-hidden>
      <div className="blaze-halo absolute inset-[-30%] rounded-full" />
      <svg viewBox="6.5 -9 19 35" overflow="visible" className="relative size-full">
        <defs>
          <linearGradient id="blaze-fill" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="#4c1d95" />
            <stop offset="0.5" stopColor="#8b5cf6" />
            <stop offset="1" stopColor="#e4d8ff" />
          </linearGradient>
          <filter id="blaze-waver" x="-60%" y="-60%" width="220%" height="220%">
            <feTurbulence type="fractalNoise" baseFrequency="0.14 0.3" numOctaves="2" seed="7" result="noise">
              {!still && <animate attributeName="baseFrequency" dur="6s" values="0.14 0.3;0.18 0.36;0.12 0.26;0.14 0.3" repeatCount="indefinite" />}
            </feTurbulence>
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="1.6" xChannelSelector="R" yChannelSelector="G" />
          </filter>
          <filter id="blaze-blur" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="2.2" />
          </filter>
        </defs>
        <path d={FLAME} fill="#7c3aed" filter="url(#blaze-blur)" className="blaze-glow" />
        <g filter="url(#blaze-waver)">
          {TONGUES.map((w, i) => (
            <g key={i} transform={`translate(${w.x} ${w.y})`}>
              <path d={TONGUE} fill="url(#blaze-fill)" className="blaze-tongue" style={{ '--dx': `${w.dx}px`, animationDelay: `${w.d}s`, animationDuration: `${w.t}s` } as CSSProperties} />
            </g>
          ))}
          <path d={FLAME} fill="url(#blaze-fill)" className="blaze-body" />
          <path d={CORE} fill="#f5f0ff" opacity="0.9" className="blaze-core" />
        </g>
      </svg>
    </div>
  )
}
