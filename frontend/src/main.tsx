import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// CareerPilot is a dark-first Vision-UI-inspired dashboard. Locking the
// `dark` mode class keeps every surface on the deep-navy theme regardless of
// the OS preference, so the app reads as one coherent design system.
document.documentElement.classList.add('dark')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
