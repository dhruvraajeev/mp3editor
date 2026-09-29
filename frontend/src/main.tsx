import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './theme.css'

// Cursor light for `.spotlight` cards (theme.css draws it): one listener for the whole page.
document.addEventListener('pointermove', (e) => {
  const el = (e.target as Element | null)?.closest?.<HTMLElement>('.spotlight')
  if (!el) return
  const r = el.getBoundingClientRect()
  el.style.setProperty('--mx', `${e.clientX - r.left}px`)
  el.style.setProperty('--my', `${e.clientY - r.top}px`)
}, { passive: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
