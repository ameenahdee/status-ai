// Everything the Overview dashboard shows is worked out here from saved data (projects, reports and status history).
// Pure functions only (no React, no storage), so each figure can be tested. Nothing is invented: if the data does not
// record something, it is not shown.

import { STATUSES, isFinalStatus } from './schema.js'
import { fmtStamp } from './sections.js'

export const NOT_SET = 'Not set'

// ---- project counts and the Project Health donut ----

// Uses each project's current confirmed status (the existing project-status rules). A project with no status is
// counted as "Not set", never as On Track.
export function statusCounts(projects) {
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]))
  let notSet = 0
  for (const p of projects) {
    if (isFinalStatus(p.status)) counts[p.status]++
    else notSet++
  }
  return { total: projects.length, ...counts, [NOT_SET]: notSet }
}

const DONUT_ALWAYS = ['On Track', 'At Risk', 'Blocked'] // shown even at zero, as in the design
const DONUT_WHEN_PRESENT = ['Off Track', NOT_SET] // shown only when there are such projects, so the chart always adds up

/** Segments for the donut and its legend. `percent` is rounded; `fraction` is exact and is what the ring is drawn from. */
export function healthSegments(projects) {
  const c = statusCounts(projects)
  const keys = [...DONUT_ALWAYS, ...DONUT_WHEN_PRESENT.filter((k) => c[k] > 0)]
  return {
    total: c.total,
    segments: keys.map((key) => ({
      key,
      count: c[key],
      fraction: c.total ? c[key] / c.total : 0,
      percent: c.total ? Math.round((c[key] / c.total) * 100) : 0,
    })),
  }
}

// ---- recent reports ----

/** The latest saved reports, newest first. The status shown is the one the PM finalised, never an AI recommendation. */
export function recentReports(reports, projects, limit = 5) {
  const byId = new Map(projects.map((p) => [p.id, p]))
  return [...reports]
    .sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)) || String(a.id).localeCompare(String(b.id)))
    .slice(0, limit)
    .map((report) => ({
      report,
      projectName: byId.get(report.projectId)?.name ?? 'Unknown project',
      status: isFinalStatus(report.projectStatusAtReport) ? report.projectStatusAtReport : null,
    }))
}

// ---- recent activity ----

const time = (iso) => (typeof iso === 'string' ? Date.parse(iso) : NaN)
const SAME_MOMENT_MS = 2000 // a status edit and the report edit it caused are one event

// How a demo workspace activity entry reads (its kind, refs and time are stored; its words are worked out here)
const DEMO_KIND = { 'project-created': 'project', 'project-updated': 'details', 'status-updated': 'status', 'report-generated': 'report', 'report-saved': 'saved', 'report-edited': 'edit' }

/**
 * Recent activity, newest first. REAL events are worked out from real data:
 *   New project created        (a project's createdAt)
 *   Project details updated    (a project's updatedAt, set when its details really changed)
 *   New report generated       (a live AI report's generatedAt; if that is unknown, its savedAt)
 *   Report saved               (a live AI report's savedAt, when its generation time is known)
 *   Sample copy saved          (a saved copy of a sample report)
 *   Project status updated     (a status-history entry that is not a report edit)
 *   Saved report edited        (a report's updatedAt, or a status-history entry for a report edit)
 * Demo workspace records are fictional and never produce real events. Instead, the demo workspace carries its own
 * flagged sample entries (state.demoActivity), which are merged in with demo: true so the dashboard labels them.
 * Nothing else is shown: there is no record of deletions or integrations, so none appear.
 */
export function activityEvents(state, limit = 6) {
  const projects = state.projects ?? []
  const reports = state.reports ?? []
  const history = state.statusHistory ?? []
  const projectById = new Map(projects.map((p) => [p.id, p]))
  const reportById = new Map(reports.map((r) => [r.id, r]))
  const events = []
  const add = (e) => {
    if (!Number.isNaN(time(e.at))) events.push(e)
  }

  for (const p of projects) {
    if (p.demo) continue
    add({ id: `project:${p.id}`, kind: 'project', title: 'New project created', detail: p.name, at: p.createdAt, href: `#/projects/${p.id}` })
    if (p.updatedAt) {
      add({ id: `details:${p.id}`, kind: 'details', title: 'Project details updated', detail: p.name, at: p.updatedAt, href: `#/projects/${p.id}` })
    }
  }

  const statusEditTimes = new Map() // reportId -> times of status edits
  for (const h of history) {
    if (h.demo || !projectById.has(h.projectId)) continue
    if (h.reportEdit) {
      const r = reportById.get(h.reportId)
      const was = h.previousStatus ?? 'not recorded'
      add({
        id: `status:${h.id}`,
        kind: 'edit',
        title: 'Saved report edited',
        detail: `${r?.title ?? 'A deleted report'} · Project Health ${was} → ${h.newStatus ?? 'not set'}`,
        at: h.at,
        href: r ? `#/reports/${r.id}` : null,
      })
      if (!statusEditTimes.has(h.reportId)) statusEditTimes.set(h.reportId, [])
      statusEditTimes.get(h.reportId).push(time(h.at))
    } else {
      const p = projectById.get(h.projectId)
      add({
        id: `status:${h.id}`,
        kind: 'status',
        title: 'Project status updated',
        detail: `${p.name} → ${h.newStatus ?? 'status cleared'}`,
        at: h.at,
        href: `#/projects/${p.id}`,
      })
    }
  }

  for (const r of reports) {
    const projectName = projectById.get(r.projectId)?.name ?? 'Unknown project'
    if (r.sampleCopy) {
      add({ id: `report:${r.id}`, kind: 'sample', title: 'Sample copy saved', detail: projectName, at: r.savedAt, href: `#/reports/${r.id}` })
    } else if (r.source === 'ai' && !r.demo) {
      const generated = time(r.generatedAt)
      const saved = time(r.savedAt)
      if (!Number.isNaN(generated) && !Number.isNaN(saved) && generated < saved) {
        // the AI wrote it, and the PM saved it afterwards: two real events
        add({ id: `report:${r.id}`, kind: 'report', title: 'New report generated', detail: projectName, at: r.generatedAt, href: `#/reports/${r.id}` })
        add({ id: `saved:${r.id}`, kind: 'saved', title: 'Report saved', detail: `${r.title} · ${projectName}`, at: r.savedAt, href: `#/reports/${r.id}` })
      } else {
        // generation time not recorded (older reports): one event, at the time it was saved
        add({ id: `report:${r.id}`, kind: 'report', title: 'New report generated', detail: projectName, at: r.savedAt, href: `#/reports/${r.id}` })
      }
    }
    // edited later (not for the first save, which has updatedAt null)
    if (r.updatedAt) {
      const edited = time(r.updatedAt)
      const coveredByStatusEvent = (statusEditTimes.get(r.id) ?? []).some((t) => Math.abs(t - edited) <= SAME_MOMENT_MS)
      if (!coveredByStatusEvent) add({ id: `edit:${r.id}`, kind: 'edit', title: 'Saved report edited', detail: `${r.title} · ${projectName}`, at: r.updatedAt, href: `#/reports/${r.id}` })
    }
  }

  // sample entries from the demo workspace: shown only while the demo project (and report) they point at exist
  for (const a of state.demoActivity ?? []) {
    const p = projectById.get(a.projectId)
    const r = a.reportId ? reportById.get(a.reportId) : null
    if (!p || (a.reportId && !r)) continue
    const kind = DEMO_KIND[a.kind]
    const common = { id: `demo:${a.id}`, kind, at: a.at, demo: true }
    if (a.kind === 'project-created') add({ ...common, title: 'New project created', detail: p.name, href: `#/projects/${p.id}` })
    else if (a.kind === 'project-updated') add({ ...common, title: 'Project details updated', detail: p.name, href: `#/projects/${p.id}` })
    else if (a.kind === 'status-updated') add({ ...common, title: 'Project status updated', detail: `${p.name} → ${a.status ?? p.status ?? 'status cleared'}`, href: `#/projects/${p.id}` })
    else if (a.kind === 'report-generated') add({ ...common, title: 'New report generated', detail: p.name, href: `#/reports/${r.id}` })
    else if (a.kind === 'report-saved') add({ ...common, title: 'Report saved', detail: `${r.title} · ${p.name}`, href: `#/reports/${r.id}` })
    else if (a.kind === 'report-edited') add({ ...common, title: 'Saved report edited', detail: `${r.title} · ${p.name}`, href: `#/reports/${r.id}` })
  }

  return events
    .sort((a, b) => time(b.at) - time(a.at) || a.id.localeCompare(b.id))
    .slice(0, limit)
}

// ---- time ----

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

/** "Just now", "12 min ago", "2 hours ago", "Yesterday", "3 days ago", then a date. */
export function relativeTime(iso, now = new Date()) {
  const t = time(iso)
  if (Number.isNaN(t)) return ''
  const diff = now.getTime() - t
  if (diff < 60_000) return 'Just now'
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(diff / 3_600_000)
  if (hours < 24 && startOfDay(now) <= t) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`
  const days = Math.round((startOfDay(now) - startOfDay(new Date(t))) / 86_400_000)
  if (days === 1) return 'Yesterday'
  if (days > 1 && days < 7) return `${days} days ago`
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`
  return fmtStamp(iso)
}
