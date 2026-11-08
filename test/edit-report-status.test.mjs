import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { makeStorage, loadStore, releaseStorage, readPersisted } from './helpers/storage.mjs'
import { projectInput, reportInput, content } from './helpers/fixtures.mjs'
import { metaOf } from '../src/exporters.js'
import { reportToText } from '../src/sections.js'
import { validHistoryEntry, validReportV2, computeHealthMovement, STATUSES, INSUFFICIENT } from '../src/schema.js'
import { comparisonBaselineFor, statusHistoryFor } from '../src/history.js'

// A saved report's Project Health (its PM-finalised status) can be edited in "Edit report". The PM owns the change;
// an AI recommendation is never used. The change is recorded in status history, the project follows only when its
// status really comes from that report, and no saved comparison is left showing an outdated health movement.

const ASSESSMENT = (outcome) => ({ outcome, explanation: 'Because.', evidence: [{ source: 'update', quote: 'some quote here' }], missingInformation: [] })
const compared = (baselineId, over = {}) => ({
  status: 'compared',
  baseline: { reportId: baselineId, periodStart: '2026-10-01', periodEnd: '2026-10-07' },
  notes: [],
  items: [{ category: 'newDevelopments', state: 'new', text: 'Legal has requested a review.', evidence: { current: 'Legal has requested a review.', previous: null } }],
  ...over,
})
const t0 = '2026-11-10T09:00:00.000Z'

describe('editing a saved report\'s status', () => {
  let storage, store, project
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
  const saved = (id) => persisted().reports.find((r) => r.id === id)
  const proj = () => persisted().projects.find((p) => p.id === project.id)
  const tick = (ms = 60_000) => mock.timers.tick(ms)
  // saves a report the way the app does: report first, then the project status from it
  const report = (status, over = {}) => {
    const r = store.actions.addReport(reportInput(project.id, { projectStatusAtReport: status, ...over }))
    if (status !== proj().status) store.actions.setProjectStatus(project.id, status, { type: 'report', reportId: r.id })
    return r
  }
  const textOf = (r) => reportToText(content(), metaOf(r, { name: 'Alpha Project' }))

  describe('the report', () => {
    it('takes the new final status, which is stored and survives a reload', async () => {
      const r = report('On Track')
      tick()
      const entry = store.actions.updateReportStatus(r.id, 'Blocked')
      assert.ok(entry)
      assert.equal(saved(r.id).projectStatusAtReport, 'Blocked')
      releaseStorage()
      const reloaded = await loadStore(storage)
      reloaded.actions.deleteReport('__no-such-report__') // re-saves what the reloaded store holds
      assert.equal(storage.data.has('statusai.v1.set-aside'), false)
      assert.equal(saved(r.id).projectStatusAtReport, 'Blocked')
      assert.ok(validReportV2(saved(r.id)))
    })

    it('works for every pair of the four statuses', () => {
      for (const from of STATUSES) for (const to of STATUSES) {
        if (from === to) continue
        const r = report(from)
        store.actions.updateReportStatus(r.id, to)
        assert.equal(saved(r.id).projectStatusAtReport, to, `${from} -> ${to}`)
      }
    })

    it('shows the edited status in stakeholder-facing text (copy, email and PDF share this header)', () => {
      const r = report('On Track')
      assert.match(textOf(saved(r.id)), /Project Health: On Track/)
      store.actions.updateReportStatus(r.id, 'Off Track')
      const text = textOf(saved(r.id))
      assert.match(text, /Project Health: Off Track/)
      assert.doesNotMatch(text, /Project Health: On Track/)
    })

    it('records when it was edited, and leaves everything else about the report alone', () => {
      const r = report('On Track', { assessment: ASSESSMENT('Blocked') })
      const before = structuredClone(saved(r.id))
      tick()
      store.actions.updateReportStatus(r.id, 'At Risk')
      const after = saved(r.id)
      assert.equal(after.updatedAt, '2026-11-10T09:01:00.000Z')
      for (const k of ['originalUpdate', 'content', 'generatedContent', 'periodStart', 'periodEnd', 'savedAt', 'generatedAt', 'title', 'generation', 'whatsChanged', 'generatedWhatsChanged']) {
        assert.deepEqual(after[k], before[k], k)
      }
    })

    it('is a no-op when the status is the same, the report is unknown, or nothing is recorded as changed', () => {
      const r = report('On Track')
      const snapshot = JSON.stringify(persisted())
      const writes = storage.writes.length
      assert.equal(store.actions.updateReportStatus(r.id, 'On Track'), null)
      assert.equal(store.actions.updateReportStatus('__no-such-report__', 'Blocked'), null)
      assert.equal(JSON.stringify(persisted()), snapshot)
      assert.equal(storage.writes.length, writes)
    })

    it('only accepts the four statuses (never "Insufficient Information", an empty value, or an AI-style outcome)', () => {
      const r = report('On Track')
      const snapshot = JSON.stringify(persisted())
      for (const bad of ['', null, undefined, 'Not set', INSUFFICIENT, 'Insufficient information', 'on track', 'Green', 7, {}, ['At Risk']]) {
        assert.throws(() => store.actions.updateReportStatus(r.id, bad), /must be On Track, At Risk, Blocked or Off Track/)
      }
      assert.equal(JSON.stringify(persisted()), snapshot)
    })

    it('can set a status on an older report that never had one', async () => {
      const r = report('On Track')
      const data = persisted()
      data.reports = data.reports.map((x) => ({ ...x, projectStatusAtReport: null }))
      data.projects = data.projects.map((p) => ({ ...p, status: null, statusSource: null })) // an older project with no status either
      data.statusHistory = []
      const s2 = makeStorage({ 'statusai.v1': JSON.stringify(data) })
      releaseStorage()
      const reloaded = await loadStore(s2)
      const entry = reloaded.actions.updateReportStatus(r.id, 'At Risk')
      assert.equal(entry.previousStatus, null)
      assert.equal(entry.previousStatusKnown, false)
      assert.equal(readPersisted(s2).reports.find((x) => x.id === r.id).projectStatusAtReport, 'At Risk')
    })
  })

  describe('the AI recommendation is not touched or used', () => {
    it('stays exactly as it was; only the PM\'s decision record follows the new status', () => {
      const r = report('Blocked', { assessment: ASSESSMENT('Blocked') })
      assert.equal(saved(r.id).statusDecision.action, 'confirmed')
      const original = structuredClone(saved(r.id).assessment)
      tick()
      store.actions.updateReportStatus(r.id, 'At Risk')
      assert.deepEqual(saved(r.id).assessment, original)
      assert.deepEqual(saved(r.id).statusDecision, { status: 'At Risk', action: 'overridden', decidedAt: '2026-11-10T09:01:00.000Z' })
      store.actions.updateReportStatus(r.id, 'Blocked')
      assert.equal(saved(r.id).statusDecision.action, 'confirmed')
      assert.deepEqual(saved(r.id).assessment, original)
    })

    it('a report with no assessment gets none and no decision invented', () => {
      const r = report('On Track')
      store.actions.updateReportStatus(r.id, 'At Risk')
      assert.equal(saved(r.id).assessment, null)
      assert.equal(saved(r.id).statusDecision, null)
    })

    it('the recommendation never becomes the status: the new status is whatever the PM chose', () => {
      const r = report('On Track', { assessment: ASSESSMENT('Off Track') })
      store.actions.updateReportStatus(r.id, 'At Risk')
      assert.equal(saved(r.id).projectStatusAtReport, 'At Risk')
      assert.equal(proj().status, 'At Risk')
    })
  })

  describe('status history', () => {
    it('records previous status, new status, time and the report', () => {
      const r = report('On Track')
      tick()
      const entry = store.actions.updateReportStatus(r.id, 'Blocked')
      const stored = persisted().statusHistory.at(-1)
      assert.deepEqual(stored, entry)
      assert.deepEqual(
        [stored.projectId, stored.previousStatus, stored.newStatus, stored.at, stored.source, stored.reportId, stored.reportEdit],
        [project.id, 'On Track', 'Blocked', '2026-11-10T09:01:00.000Z', 'report', r.id, true],
      )
      assert.equal(stored.previousStatusKnown, true)
      assert.ok(validHistoryEntry(stored))
      assert.equal(typeof stored.id, 'string')
    })

    it('adds an entry for every edit, in order, and never rewrites earlier entries', () => {
      const r = report('On Track')
      const before = structuredClone(persisted().statusHistory)
      tick(); store.actions.updateReportStatus(r.id, 'At Risk')
      tick(); store.actions.updateReportStatus(r.id, 'Blocked')
      const h = persisted().statusHistory
      assert.deepEqual(h.slice(0, before.length), before)
      const edits = h.filter((e) => e.reportEdit)
      assert.deepEqual(edits.map((e) => [e.previousStatus, e.newStatus]), [['On Track', 'At Risk'], ['At Risk', 'Blocked']])
      assert.deepEqual(statusHistoryFor(persisted(), project.id).map((e) => e.newStatus).slice(-2), ['At Risk', 'Blocked'])
    })

    it('a deleted report keeps its history entries, marked deleted, as for every other entry', () => {
      const r = report('On Track')
      store.actions.updateReportStatus(r.id, 'Blocked')
      store.actions.deleteReport(r.id)
      assert.ok(persisted().statusHistory.filter((e) => e.reportId === r.id).every((e) => e.reportDeleted === true))
    })
  })

  describe('the project\'s own status', () => {
    it('follows the edit when the project\'s status comes from this report, and says so in its source', () => {
      const r = report('On Track')
      assert.equal(proj().statusSource.reportId, r.id)
      tick()
      const entry = store.actions.updateReportStatus(r.id, 'Blocked')
      assert.equal(proj().status, 'Blocked')
      assert.deepEqual(proj().statusSource, { type: 'report', reportId: r.id, at: '2026-11-10T09:01:00.000Z', historyId: entry.id })
      assert.equal(entry.projectStatusChanged, true)
      assert.equal(entry.previousStatus, 'On Track') // the project's status before
    })

    it('follows the edit when the status had been confirmed from the AI recommendation, and then belongs to the PM\'s report edit', () => {
      const r = store.actions.addReport(reportInput(project.id, { assessment: ASSESSMENT('Blocked'), projectStatusAtReport: 'Blocked' }))
      store.actions.setProjectStatus(project.id, 'Blocked', { type: 'ai-confirmed', reportId: r.id })
      store.actions.updateReportStatus(r.id, 'At Risk')
      assert.equal(proj().status, 'At Risk')
      assert.equal(proj().statusSource.type, 'report')
    })

    it('does NOT change when a later manual decision, or a newer report, set the project\'s status', () => {
      const older = report('On Track', { periodStart: '2026-10-01', periodEnd: '2026-10-07' })
      const newer = report('Blocked', { periodStart: '2026-10-08', periodEnd: '2026-10-14' })
      assert.equal(proj().statusSource.reportId, newer.id)
      const entry = store.actions.updateReportStatus(older.id, 'At Risk')
      assert.equal(proj().status, 'Blocked')
      assert.equal(proj().statusSource.reportId, newer.id)
      assert.equal(entry.projectStatusChanged, false)
      assert.equal(entry.previousStatus, 'On Track') // the report's own previous status
      assert.equal(saved(older.id).projectStatusAtReport, 'At Risk')
      // and a manual change after a report is not overwritten either
      store.actions.setProjectStatus(project.id, 'Off Track', { type: 'manual' })
      store.actions.updateReportStatus(newer.id, 'At Risk')
      assert.equal(proj().status, 'Off Track')
      assert.equal(proj().statusSource.type, 'manual')
    })

    it('leaves the project untouched when it already shows the new status, but still records the report edit', () => {
      const r = report('On Track')
      store.actions.setProjectStatus(project.id, 'Blocked', { type: 'report', reportId: r.id }) // the project was moved on from this report
      const before = structuredClone(proj())
      const entry = store.actions.updateReportStatus(r.id, 'Blocked')
      assert.ok(entry)
      assert.equal(entry.projectStatusChanged, false)
      assert.deepEqual(proj(), before)
      assert.equal(saved(r.id).projectStatusAtReport, 'Blocked')
    })
  })

  describe('demo reports and sample copies', () => {
    it('are never changed, and never write real status history or change a real project', () => {
      store.actions.loadDemo()
      const demoReport = persisted().reports.find((r) => r.demo && !r.sampleCopy)
      const demoProject = persisted().projects.find((p) => p.demo)
      const copy = store.actions.saveSampleCopy({ projectId: demoProject.id, content: content(), originalUpdate: 'u', periodStart: '2026-11-01', periodEnd: '2026-11-07', copiedFrom: 'sample', projectStatusAtReport: 'On Track' })
      report('On Track')
      const snapshot = JSON.stringify(persisted())
      const writes = storage.writes.length
      assert.equal(store.actions.updateReportStatus(demoReport.id, 'Off Track'), null)
      assert.equal(store.actions.updateReportStatus(copy.id, 'Off Track'), null)
      assert.equal(JSON.stringify(persisted()), snapshot)
      assert.equal(storage.writes.length, writes)
      assert.equal(proj().status, 'On Track')
    })
  })

  describe('comparisons and health movement', () => {
    it('a report generated AFTER the edit is compared with the updated status', () => {
      const a = report('On Track', { periodStart: '2026-10-01', periodEnd: '2026-10-07' })
      store.actions.updateReportStatus(a.id, 'Blocked')
      const baseline = comparisonBaselineFor(persisted(), { projectId: project.id, periodStart: '2026-10-08', periodEnd: '2026-10-14' })
      assert.equal(baseline.report.id, a.id)
      assert.equal(baseline.report.projectStatusAtReport, 'Blocked') // what the app sends as the previous status
      const b = store.actions.addReport(reportInput(project.id, { periodStart: '2026-10-08', periodEnd: '2026-10-14', projectStatusAtReport: 'At Risk', whatsChanged: compared(a.id) }))
      assert.deepEqual(saved(b.id).whatsChanged.healthMovement, { previous: 'Blocked', current: 'At Risk', change: 'moved' })
    })

    it('an already saved comparison against the edited report is recalculated, not left outdated', () => {
      const a = report('On Track', { periodStart: '2026-10-01', periodEnd: '2026-10-07' })
      const b = store.actions.addReport(reportInput(project.id, { periodStart: '2026-10-08', periodEnd: '2026-10-14', projectStatusAtReport: 'Blocked', whatsChanged: compared(a.id), generatedWhatsChanged: compared(a.id) }))
      assert.deepEqual(saved(b.id).whatsChanged.healthMovement, { previous: 'On Track', current: 'Blocked', change: 'moved' })
      assert.match(textOf(saved(b.id)), /Project Health moved from On Track to Blocked\./)
      store.actions.updateReportStatus(a.id, 'Blocked')
      assert.deepEqual(saved(b.id).whatsChanged.healthMovement, { previous: 'Blocked', current: 'Blocked', change: 'unchanged' })
      const text = textOf(saved(b.id))
      assert.match(text, /Project Health is unchanged: Blocked\./)
      assert.doesNotMatch(text, /moved from On Track/)
    })

    it('editing the compared report\'s own status recalculates its movement too', () => {
      const a = report('On Track', { periodStart: '2026-10-01', periodEnd: '2026-10-07' })
      const b = store.actions.addReport(reportInput(project.id, { periodStart: '2026-10-08', periodEnd: '2026-10-14', projectStatusAtReport: 'At Risk', whatsChanged: compared(a.id) }))
      store.actions.updateReportStatus(b.id, 'Off Track')
      assert.deepEqual(saved(b.id).whatsChanged.healthMovement, { previous: 'On Track', current: 'Off Track', change: 'moved' })
      store.actions.updateReportStatus(b.id, 'On Track')
      assert.equal(saved(b.id).whatsChanged.healthMovement.change, 'unchanged')
    })

    it('changes only the movement: the compared items, notes, baseline and the AI original stay as saved', () => {
      const a = report('On Track', { periodStart: '2026-10-01', periodEnd: '2026-10-07' })
      const b = store.actions.addReport(reportInput(project.id, { periodStart: '2026-10-08', periodEnd: '2026-10-14', projectStatusAtReport: 'Blocked', whatsChanged: compared(a.id), generatedWhatsChanged: compared(a.id) }))
      const before = structuredClone(saved(b.id))
      store.actions.updateReportStatus(a.id, 'At Risk')
      const { healthMovement: _m, ...rest } = saved(b.id).whatsChanged
      const { healthMovement: _o, ...restBefore } = before.whatsChanged
      assert.deepEqual(rest, restBefore)
      assert.deepEqual(saved(b.id).generatedWhatsChanged, before.generatedWhatsChanged)
      assert.equal(saved(b.id).projectStatusAtReport, 'Blocked') // the later report's own status is not touched
    })

    it('leaves unrelated reports, and "none" / "unavailable" comparisons, alone', () => {
      const a = report('On Track', { periodStart: '2026-10-01', periodEnd: '2026-10-07' })
      const other = store.actions.addReport(reportInput(project.id, { periodStart: '2026-09-01', periodEnd: '2026-09-07', projectStatusAtReport: 'At Risk',
        whatsChanged: { status: 'none', baseline: null, notes: [], items: [] } }))
      const unrelated = store.actions.addReport(reportInput(project.id, { periodStart: '2026-12-01', periodEnd: '2026-12-07', projectStatusAtReport: 'At Risk', whatsChanged: compared(other.id) }))
      const before = structuredClone({ other: saved(other.id), unrelated: saved(unrelated.id) })
      store.actions.updateReportStatus(a.id, 'Blocked')
      assert.deepEqual(saved(other.id), before.other)
      assert.deepEqual(saved(unrelated.id), before.unrelated)
    })

    it('uses only PM-finalised statuses: an AI recommendation on either report changes nothing', () => {
      const a = report('On Track', { periodStart: '2026-10-01', periodEnd: '2026-10-07', assessment: ASSESSMENT('Off Track') })
      const b = store.actions.addReport(reportInput(project.id, { periodStart: '2026-10-08', periodEnd: '2026-10-14', projectStatusAtReport: 'On Track', assessment: ASSESSMENT('Blocked'), whatsChanged: compared(a.id) }))
      store.actions.updateReportStatus(a.id, 'At Risk')
      assert.deepEqual(saved(b.id).whatsChanged.healthMovement, computeHealthMovement('At Risk', 'On Track'))
      assert.doesNotMatch(textOf(saved(b.id)), /Off Track|Blocked/)
    })
  })

  describe('generating and finalising new reports is unchanged', () => {
    it('a new report still cannot be saved without a finalised status', () => {
      assert.throws(() => store.actions.addReport(reportInput(project.id, { projectStatusAtReport: '' })), /finalised/)
      assert.throws(() => store.actions.addReport(reportInput(project.id, { projectStatusAtReport: undefined })), /finalised/)
    })

    it('editing the report text does not change its status or write history', () => {
      const r = report('On Track')
      const historyBefore = persisted().statusHistory.length
      store.actions.updateReportContent(r.id, content({ title: 'Edited' }))
      assert.equal(saved(r.id).projectStatusAtReport, 'On Track')
      assert.equal(persisted().statusHistory.length, historyBefore)
    })
  })
})
