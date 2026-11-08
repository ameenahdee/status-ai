import { whatsChangedView, stakeholderChanges } from './sections.js'

// The eighth section of a report: "What Changed Since Last Report". It is stakeholder-facing content and sits
// apart from the seven report sections and from the PM's internal health assessment.
//   value     a stored or draft comparison ({status, baseline, notes, items})
//   onRemove  (draft only) lets the PM take out a change they do not agree with; nothing can be added or reworded
export default function WhatsChanged({ value, onRemove }) {
  const view = whatsChangedView(stakeholderChanges(value))
  if (!view) return null
  const evidenceOf = (index) => value.items?.[index]?.evidence
  return (
    <section className="whatschanged" aria-label={view.heading}>
      <h3>{view.heading}</h3>
      {view.baseline && <p className="faint">{view.baseline}</p>}
      {view.message && <p className={view.groups.length ? '' : 'faint'}>{view.message}</p>}
      {view.groups.map((g) => (
        <div key={g.key} className="change-group">
          <h4>{g.label}</h4>
          <ul>
            {g.items.map((i) => {
              const ev = evidenceOf(i.index)
              return (
                <li key={i.index}>
                  {i.stateLabel && <span className={`change-state s-${i.state}`}>{i.stateLabel}</span>} {i.text}
                  {onRemove && !i.fixed && <button type="button" className="linklike" onClick={() => onRemove(i.index)} aria-label={`Remove this change: ${i.text}`}>Remove</button>}
                  {ev && (ev.current || ev.previous) && (
                    <details className="change-evidence">
                      <summary>Evidence (for you; not exported)</summary>
                      {ev.current && <p><span className="faint">Current update:</span> <q>{ev.current}</q></p>}
                      {ev.previous && <p><span className="faint">Previous report:</span> <q>{ev.previous}</q></p>}
                    </details>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      ))}
      {view.notes.map((n, i) => <p key={i} className="faint">Note: {n}</p>)}
    </section>
  )
}
