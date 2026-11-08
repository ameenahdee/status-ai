import { useEffect, useState } from 'react'
import { useRoute } from './router.js'
import { Logo } from './Logo.jsx'
import Overview from './Overview.jsx'
import { ProjectsPage, ProjectWorkspace } from './Projects.jsx'
import { ReportsPage, ReportView } from './Reports.jsx'
import Composer from './Composer.jsx'
import { usePersistence, actions } from './store.js'

// Tells the truth about storage: if changes are not being saved (or saved data could not be read),
// say so plainly instead of letting the app look as if everything worked.
function StorageBanner() {
  const p = usePersistence()
  const [dismissed, setDismissed] = useState(false)

  if (!p.ok) {
    const text = {
      'write-failed':
        'Your latest changes are not being saved. This browser could not write to storage (it may be full, or blocked, for example in a private window). What you see now will be lost if you refresh or close this tab.',
      'read-blocked':
        'Your saved data cannot be read in this browser right now, so changes made now will not be saved. Your existing data has not been touched. Try reloading the page, or check this site’s storage settings.',
      'cannot-preserve':
        'Some saved data could not be read, and a backup copy could not be stored, so changes will not be saved in this session. Nothing has been overwritten.',
      'newer-version':
        'The data saved in this browser was created by a newer version of Status AI, so this version cannot read it safely. To avoid overwriting it, nothing will be saved in this session. Your data has not been changed.',
      'backup-exists':
        'Some saved data could not be read, and an earlier backup is already stored, so this newly unreadable data could not be backed up safely. To avoid overwriting anything, changes will not be saved in this session. Nothing has been deleted or overwritten.',
    }[p.reason]
    return (
      <div className="storage-banner bad" role="alert">
        <p>{text}</p>
        {p.reason === 'write-failed' && (
          <button className="ghost" onClick={() => actions.retrySave()}>Try saving again</button>
        )}
      </div>
    )
  }

  if (p.notice && !dismissed) {
    const { unreadable, projects, reports, statusHistory = 0 } = p.notice
    const n = projects + reports + statusHistory
    return (
      <div className="storage-banner" role="status">
        <p>
          {unreadable
            ? 'The data saved in this browser could not be read, so you are starting with an empty workspace. The unreadable data was set aside, not deleted.'
            : `${n} saved ${n === 1 ? 'record' : 'records'} could not be read and ${n === 1 ? 'was' : 'were'} set aside (not deleted). Everything else loaded normally.`}
        </p>
        <button className="ghost" onClick={() => setDismissed(true)}>Dismiss</button>
      </div>
    )
  }
  return null
}

const NAV = [
  ['', 'Overview', '/'],
  ['projects', 'Projects', '/projects'],
  ['reports', 'Reports', '/reports'],
]

function Page({ route }) {
  const [a, b, c] = route.path
  if (!a) return <Overview />
  if (a === 'projects') {
    if (!b) return <ProjectsPage />
    if (c === 'new-report') return <Composer key={route.raw} projectId={b} />
    return <ProjectWorkspace key={b} id={b} />
  }
  if (a === 'reports') {
    if (!b) return <ReportsPage />
    if (b === 'new') return <Composer key={route.raw} sample={route.query.has('sample')} />
    return <ReportView key={b + route.query.get('edit')} id={b} startEditing={route.query.has('edit')} saved={route.query.has('saved')} copied={route.query.has('copied')} />
  }
  return <Overview />
}

export default function App() {
  const route = useRoute()
  const section = route.path[0] || ''
  // The drawer is "open for" one route: any navigation closes it automatically.
  const [openFor, setOpenFor] = useState(null)
  const open = openFor === route.raw
  const setOpen = (v) => setOpenFor(v ? route.raw : null)

  const pathKey = route.path.join('/')
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathKey])

  useEffect(() => {
    if (!open) return undefined
    const k = (e) => e.key === 'Escape' && setOpenFor(null)
    document.addEventListener('keydown', k)
    document.body.classList.add('nav-open')
    return () => {
      document.removeEventListener('keydown', k)
      document.body.classList.remove('nav-open')
    }
  }, [open])

  return (
    <div className="shell">
      <header className="topbar">
        <button className="burger" aria-label="Open menu" aria-expanded={open} aria-controls="sidebar" onClick={() => setOpen(true)}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        <a href="#/" className="brand" aria-label="Status AI home"><Logo /></a>
      </header>
      <div className={`scrim ${open ? 'open' : ''}`} onClick={() => setOpen(false)} aria-hidden="true" />
      <aside id="sidebar" className={`side ${open ? 'open' : ''}`}>
        <div className="side-head">
          <a href="#/" className="brand" aria-label="Status AI home"><Logo /></a>
          <button className="side-close" aria-label="Close menu" onClick={() => setOpen(false)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <nav aria-label="Primary">
          {NAV.map(([key, label, href]) => (
            <a key={key} href={`#${href}`} className={section === key ? 'on' : ''} aria-current={section === key ? 'page' : undefined}>
              {label}
            </a>
          ))}
        </nav>
        <p className="side-note">Data is saved in this browser only.</p>
      </aside>
      <main className="main">
        <StorageBanner />
        <div className="page" key={pathKey}>
          <Page route={route} />
        </div>
        <footer className="foot">AI-generated content can contain mistakes. Review before sharing.</footer>
      </main>
    </div>
  )
}
