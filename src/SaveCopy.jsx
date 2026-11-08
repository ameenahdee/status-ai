import { useRef, useState } from 'react'
import { useStore, actions } from './store.js'
import { navigate } from './router.js'
import { fmtStamp } from './sections.js'
import { Modal } from './ui.jsx'

// "Save a Copy" for sample and demo reports: saves a separate, labelled copy into a demo project.
// `payload` = { content, originalUpdate, periodStart, periodEnd, projectStatusAtReport }.
// `sourceKey` identifies the sample being copied, so repeat saves can be flagged.
export default function SaveCopyDialog({ sourceKey, defaultProjectId, payload, onClose }) {
  const store = useStore()
  const demoProjects = store.projects.filter((p) => p.demo)
  const [pick, setPick] = useState(defaultProjectId || '')
  const [saving, setSaving] = useState(false)
  const saved = useRef(false) // synchronous guard: two rapid clicks must never save two copies

  // Fall back to the first demo project if the preferred one isn't available
  const projectId = demoProjects.some((p) => p.id === pick) ? pick : demoProjects[0]?.id || ''
  const existing = store.reports.find((r) => r.sampleCopy && r.copiedFrom === sourceKey && r.projectId === projectId)

  function save() {
    if (saved.current || !projectId) return
    saved.current = true
    setSaving(true) // also disables the button visually
    const copy = actions.saveSampleCopy({ ...payload, projectId, copiedFrom: sourceKey })
    navigate(`/reports/${copy.id}?copied=1`)
  }

  return (
    <Modal title="Save a copy" onClose={onClose}>
      {(close) => (
        <>
          <p className="muted">
            Saves a separate copy of this sample report, including any edits you’ve made, to your demo workspace. The original sample is not changed, and the copy is labelled as a sample copy, not a live AI report.
          </p>
          {demoProjects.length === 0 ? (
            <div className="preview-note">
              <p>Sample copies are saved to a demo project, and you haven’t loaded the demo workspace yet.</p>
              <button className="ghost" onClick={() => actions.loadDemo()}>Load Demo Workspace</button>
            </div>
          ) : (
            <>
              <label>Save to demo project
                <select value={projectId} onChange={(e) => setPick(e.target.value)}>
                  {demoProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              {existing && (
                <p className="flash" role="status">
                  You already saved a copy of this sample to this project on {fmtStamp(existing.generatedAt)}.{' '}
                  <a href={`#/reports/${existing.id}`}>View it</a>, or save another one below.
                </p>
              )}
            </>
          )}
          <div className="actions end modal-actions">
            <button className="ghost" onClick={close}>Cancel</button>
            <button className="primary" onClick={save} disabled={!projectId || saving}>
              {existing ? 'Save another copy' : 'Save copy'}
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}
