import { useSyncExternalStore } from 'react'

// Minimal hash router: #/projects/<id>?x=1
const subscribe = (cb) => {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}
const snapshot = () => window.location.hash.replace(/^#/, '') || '/'

export function useRoute() {
  const raw = useSyncExternalStore(subscribe, snapshot)
  const [path, query = ''] = raw.split('?')
  return { raw, path: path.split('/').filter(Boolean), query: new URLSearchParams(query) }
}

export const navigate = (to) => {
  window.location.hash = to
}

// Smooth scroll unless the user prefers reduced motion
export const scrollToId = (id) =>
  setTimeout(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    document.getElementById(id)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
  }, 50)
