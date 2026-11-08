import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { makeStorage, loadStore, releaseStorage, readPersisted } from './helpers/storage.mjs'
import { projectInput, reportInput } from './helpers/fixtures.mjs'
import { previousReportFor, reportRefState, statusHistoryFor } from '../src/history.js'

// Deleting a report must never rewrite what happened: status-history entries that point at it are kept and
// marked, the project's current status is left alone, and everything that reads history copes with the gap.
describe('deleting a report: status history stays safe', () => {
  let storage, store, project
  const t0 = '2026-11-10T09:00:00.000Z'
  beforeEach(async () => {
    storage = makeStorage()
    store = await loadStore(storage)
    project = store.actions.createProject(projectInput())
    mock.timers.enable({ apis: ['Date'], now: new Date(t0) })
  })
  afterEach(() => {
    mock.timers.reset()
    releaseStorage()
  })
  const persisted = () => readPersisted(storage)
  const proj = () => persisted().projects.find((p) => p.id === project.id)

  // saves a report and, like the app does, sets the status from it
  const reportWithStatus = (status, over = {}) => {
    const r = store.actions.addReport(reportInput(project.id, { projectStatusAtReport: status, ...over }))
    store.actions.setProjectStatus(project.id, status, { type: 'report', reportId: r.id })
    return r
  }

  it('keeps the history entry, keeps its reportId, and marks it as deleted', () => {
    const r = reportWithStatus('At Risk')
    mock.timers.tick(60_000)
    store.actions.deleteReport(r.id)
    const [entry] = persisted().statusHistory
    assert.equal(entry.reportId, r.id)
    assert.equal(entry.reportDeleted, true)
    assert.equal(entry.reportDeletedAt, '2026-11-10T09:01:00.000Z')
    assert.equal(entry.newStatus, 'At Risk')
    assert.equal(persisted().reports.length, 0)
  })

  it('leaves the other fields of the entry exactly as recorded', () => {
    const r = reportWithStatus('At Risk')
    const { reportDeleted, reportDeletedAt, ...before } = { ...persisted().statusHistory[0] }
    store.actions.deleteReport(r.id)
    const { reportDeleted: d, reportDeletedAt: a, ...after } = persisted().statusHistory[0]
    assert.deepEqual(after, before)
    assert.equal(reportDeleted, undefined)
    assert.equal(reportDeletedAt, undefined)
    assert.equal(d, true)
    assert.ok(a)
  })

  it('leaves the project\'s current status and its source untouched', () => {
    const r = reportWithStatus('Blocked')
    const before = structuredClone(proj())
    store.actions.deleteReport(r.id)
    assert.deepEqual(proj(), before)
    assert.equal(proj().status, 'Blocked')
    assert.equal(proj().statusSource.reportId, r.id)
  })

  it('only marks entries for the deleted report; other entries and reports are untouched', () => {
    const a = reportWithStatus('At Risk')
    mock.timers.tick(1000)
    const b = reportWithStatus('Blocked')
    mock.timers.tick(1000)
    store.actions.setProjectStatus(project.id, 'On Track') // manual, no report
    store.actions.deleteReport(a.id)
    const h = persisted().statusHistory
    assert.equal(h.length, 3)
    assert.equal(h.filter((e) => e.reportDeleted).length, 1)
    assert.equal(h.find((e) => e.reportId === a.id).reportDeleted, true)
    assert.equal(h.find((e) => e.reportId === b.id).reportDeleted, undefined)
    assert.equal(h.find((e) => e.source === 'manual').reportDeleted, undefined)
    assert.deepEqual(persisted().reports.map((r) => r.id), [b.id])
  })

  it('marks every entry that pointed at the report, not just the first', () => {
    const r = reportWithStatus('At Risk')
    // a later change that also names the same report
    store.actions.setProjectStatus(project.id, 'Blocked', { type: 'report', reportId: r.id })
    store.actions.deleteReport(r.id)
    assert.equal(persisted().statusHistory.filter((e) => e.reportDeleted).length, 2)
  })

  it('deleting an unknown id changes nothing', () => {
    reportWithStatus('At Risk')
    const before = JSON.stringify(persisted())
    store.actions.deleteReport('__no-such-report__')
    assert.equal(JSON.stringify(persisted()), before)
  })

  it('deleting the same report twice does not change the first deletion time', () => {
    const r = reportWithStatus('At Risk')
    mock.timers.tick(1000)
    store.actions.deleteReport(r.id)
    const first = persisted().statusHistory[0].reportDeletedAt
    mock.timers.tick(5000)
    store.actions.deleteReport(r.id)
    assert.equal(persisted().statusHistory[0].reportDeletedAt, first)
  })

  it('survives a reload: the marked entry is still valid and still marked', async () => {
    const r = reportWithStatus('At Risk')
    store.actions.deleteReport(r.id)
    releaseStorage()
    const reloaded = await loadStore(storage)
    reloaded.actions.deleteReport('__no-such-report__') // re-saves whatever the reloaded store holds
    const entry = persisted().statusHistory[0]
    assert.equal(persisted().statusHistory.length, 1)
    assert.equal(entry.reportDeleted, true)
    assert.equal(storage.data.has('statusai.v1.set-aside'), false) // the marked entry was not treated as malformed
  })

  describe('reading history afterwards', () => {
    it('reportRefState says which references can still be opened', () => {
      const a = reportWithStatus('At Risk')
      mock.timers.tick(1000)
      const b = reportWithStatus('Blocked')
      mock.timers.tick(1000)
      store.actions.setProjectStatus(project.id, 'On Track')
      store.actions.deleteReport(a.id)
      const s = persisted()
      const by = (id) => s.statusHistory.find((e) => e.reportId === id)
      assert.equal(reportRefState(s, by(a.id)), 'deleted')
      assert.equal(reportRefState(s, by(b.id)), 'available')
      assert.equal(reportRefState(s, s.statusHistory.find((e) => e.source === 'manual')), 'none')
    })

    it('a missing report that was never marked reads as unavailable, not deleted', () => {
      const s = { reports: [], statusHistory: [] }
      assert.equal(reportRefState(s, { reportId: 'gone' }), 'unavailable')
      assert.equal(reportRefState(s, undefined), 'none')
    })

    it('statusHistoryFor still returns the marked entries, in order', () => {
      const a = reportWithStatus('At Risk')
      mock.timers.tick(1000)
      reportWithStatus('Blocked')
      store.actions.deleteReport(a.id)
      const h = statusHistoryFor(persisted(), project.id)
      assert.deepEqual(h.map((e) => e.newStatus), ['At Risk', 'Blocked'])
      assert.equal(h[0].reportDeleted, true)
    })

    it('previousReportFor says "unavailable / report-not-found" for a deleted target, without throwing', () => {
      const r = store.actions.addReport(reportInput(project.id))
      store.actions.deleteReport(r.id)
      const res = previousReportFor(persisted(), { id: r.id })
      assert.equal(res.status, 'unavailable')
      assert.equal(res.reason, 'report-not-found')
      assert.equal(res.report, null)
    })

    it('previousReportFor never returns a deleted report; it falls back to the one before it, or to "none"', () => {
      const w1 = store.actions.addReport(reportInput(project.id, { periodStart: '2026-10-01', periodEnd: '2026-10-07' }))
      const w2 = store.actions.addReport(reportInput(project.id, { periodStart: '2026-10-08', periodEnd: '2026-10-14' }))
      const w3 = store.actions.addReport(reportInput(project.id, { periodStart: '2026-10-15', periodEnd: '2026-10-21' }))
      assert.equal(previousReportFor(persisted(), { id: w3.id }).report.id, w2.id)
      store.actions.deleteReport(w2.id)
      assert.equal(previousReportFor(persisted(), { id: w3.id }).report.id, w1.id)
      store.actions.deleteReport(w1.id)
      const none = previousReportFor(persisted(), { id: w3.id })
      assert.equal(none.status, 'none')
      assert.equal(none.report, null)
    })

    it('an unsaved candidate is still compared correctly after a delete', () => {
      const w1 = store.actions.addReport(reportInput(project.id, { periodStart: '2026-10-01', periodEnd: '2026-10-07' }))
      const w2 = store.actions.addReport(reportInput(project.id, { periodStart: '2026-10-08', periodEnd: '2026-10-14' }))
      store.actions.deleteReport(w2.id)
      const res = previousReportFor(persisted(), { projectId: project.id, periodStart: '2026-10-15', periodEnd: '2026-10-21' })
      assert.equal(res.report.id, w1.id)
    })
  })

  describe('demo workspace', () => {
    it('a demo report that is deleted and then restored by Load Demo is no longer marked deleted', () => {
      store.actions.loadDemo()
      const s0 = persisted()
      const entry = s0.statusHistory.find((e) => e.reportId && s0.reports.some((r) => r.id === e.reportId))
      assert.ok(entry, 'demo data should contain a status change tied to a report')
      store.actions.deleteReport(entry.reportId)
      assert.equal(persisted().statusHistory.find((e) => e.id === entry.id).reportDeleted, true)
      store.actions.loadDemo()
      const again = persisted().statusHistory.find((e) => e.id === entry.id)
      assert.equal(again.reportDeleted, undefined)
      assert.equal(again.reportDeletedAt, undefined)
    })

    it('Reset Demo still removes demo history and does not trip over marked entries', () => {
      store.actions.loadDemo()
      const s0 = persisted()
      const r = s0.reports.find((x) => x.demo)
      store.actions.deleteReport(r.id)
      store.actions.resetDemo()
      assert.equal(persisted().statusHistory.filter((h) => h.demo).length, 0)
    })
  })
})
