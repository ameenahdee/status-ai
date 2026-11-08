import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { makeStorage, loadStore, releaseStorage, readPersisted } from './helpers/storage.mjs'
import { projectInput, reportInput, content, SECTION_KEYS } from './helpers/fixtures.mjs'

describe('reports', () => {
  let storage, store, project
  beforeEach(async () => {
    storage = makeStorage()
    store = await loadStore(storage)
    project = store.actions.createProject(projectInput())
    mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-10T09:00:00.000Z') })
  })
  afterEach(() => {
    mock.timers.reset()
    releaseStorage()
  })

  const persisted = () => readPersisted(storage)
  const tick = (ms) => mock.timers.tick(ms)

  describe('saving', () => {
    it('stores the report with its project, original update, period and content', () => {
      const r = store.actions.addReport(reportInput(project.id))
      const saved = persisted().reports[0]
      assert.deepEqual(saved, r)
      assert.equal(saved.projectId, project.id)
      assert.equal(saved.originalUpdate, 'raw notes: finished login, dashboard 60%, payments blocked')
      assert.equal(saved.periodStart, '2026-11-01')
      assert.equal(saved.periodEnd, '2026-11-07')
      assert.deepEqual(Object.keys(saved.content).filter((k) => k !== 'title').sort(), [...SECTION_KEYS].sort())
    })

    it('gives each report a unique id', () => {
      const a = store.actions.addReport(reportInput(project.id))
      const b = store.actions.addReport(reportInput(project.id))
      assert.notEqual(a.id, b.id)
    })

    it('keeps the reporting period, the AI generation time and the save time as three separate facts', () => {
      const r = store.actions.addReport(reportInput(project.id, { periodStart: '2026-10-01', periodEnd: '2026-10-07' }))
      assert.equal(r.periodStart, '2026-10-01')
      assert.equal(r.periodEnd, '2026-10-07')
      assert.equal(r.generatedAt, '2026-11-08T08:30:00.000Z') // when the AI generated it
      assert.equal(r.savedAt, '2026-11-10T09:00:00.000Z') // when the PM saved it
      assert.notEqual(r.generatedAt, r.savedAt)
    })

    it('is marked as a live AI report, never as a demo or sample', () => {
      const r = store.actions.addReport(reportInput(project.id))
      assert.equal(r.source, 'ai')
      assert.ok(!r.demo)
      assert.ok(!r.sampleCopy)
    })

    it('snapshots the project status chosen at save time', () => {
      const r = store.actions.addReport(reportInput(project.id, { projectStatusAtReport: 'Blocked' }))
      assert.equal(r.projectStatusAtReport, 'Blocked')
    })

    it('is refused when no status was chosen (see final-status.test.mjs for the full guard)', () => {
      assert.throws(() => store.actions.addReport(reportInput(project.id, { projectStatusAtReport: '' })), /finalised/)
    })

    it('has not been edited when first saved', () => {
      assert.equal(store.actions.addReport(reportInput(project.id)).updatedAt, null)
    })

    it('does not change the project by itself', () => {
      const before = persisted().projects[0]
      store.actions.addReport(reportInput(project.id, { projectStatusAtReport: 'Off Track' }))
      assert.deepEqual(persisted().projects[0], before)
    })

    it('associates reports with the right project when several projects exist', () => {
      const other = store.actions.createProject(projectInput({ name: 'Beta' }))
      const a = store.actions.addReport(reportInput(project.id))
      const b = store.actions.addReport(reportInput(other.id))
      const s = persisted()
      assert.deepEqual(store.reportsFor(s, project.id).map((r) => r.id), [a.id])
      assert.deepEqual(store.reportsFor(s, other.id).map((r) => r.id), [b.id])
    })
  })

  describe('editing', () => {
    it('updates the content and records when it was edited', () => {
      const r = store.actions.addReport(reportInput(project.id))
      tick(60_000)
      store.actions.updateReportContent(r.id, content({ title: 'Edited title', executiveSummary: 'Edited summary.' }))
      const saved = persisted().reports[0]
      assert.equal(saved.content.executiveSummary, 'Edited summary.')
      assert.equal(saved.title, 'Edited title')
      assert.equal(saved.updatedAt, '2026-11-10T09:01:00.000Z')
    })

    it('never alters the original submitted update', () => {
      const r = store.actions.addReport(reportInput(project.id))
      store.actions.updateReportContent(r.id, content({ executiveSummary: 'Completely rewritten.' }))
      store.actions.updateReportContent(r.id, content({ executiveSummary: 'Rewritten again.' }))
      assert.equal(persisted().reports[0].originalUpdate, r.originalUpdate)
    })

    it('never alters the reporting period, generation date, id or project', () => {
      const r = store.actions.addReport(reportInput(project.id))
      tick(3_600_000)
      store.actions.updateReportContent(r.id, content({ title: 'New' }))
      const saved = persisted().reports[0]
      for (const k of ['id', 'projectId', 'periodStart', 'periodEnd', 'generatedAt', 'savedAt', 'source', 'projectStatusAtReport', 'originalUpdate']) {
        assert.equal(saved[k], r[k], k)
      }
    })

    it('only changes the targeted report', () => {
      const a = store.actions.addReport(reportInput(project.id, { originalUpdate: 'A notes' }))
      const b = store.actions.addReport(reportInput(project.id, { originalUpdate: 'B notes' }))
      store.actions.updateReportContent(a.id, content({ executiveSummary: 'Only A changed' }))
      const byId = Object.fromEntries(persisted().reports.map((r) => [r.id, r]))
      assert.equal(byId[a.id].content.executiveSummary, 'Only A changed')
      assert.equal(byId[b.id].content.executiveSummary, 'Summary text.')
      assert.equal(byId[b.id].updatedAt, null)
    })

    it('ignores an unknown report id', () => {
      const r = store.actions.addReport(reportInput(project.id))
      store.actions.updateReportContent('nope', content({ executiveSummary: 'x' }))
      assert.deepEqual(persisted().reports[0], r)
    })
  })

  describe('deleting', () => {
    it('removes only the chosen report', () => {
      const a = store.actions.addReport(reportInput(project.id))
      const b = store.actions.addReport(reportInput(project.id))
      store.actions.deleteReport(a.id)
      assert.deepEqual(persisted().reports.map((r) => r.id), [b.id])
    })

    it('leaves the project and its other data in place', () => {
      const r = store.actions.addReport(reportInput(project.id))
      store.actions.deleteReport(r.id)
      assert.equal(persisted().projects.length, 1)
      assert.equal(persisted().projects[0].id, project.id)
    })

    it('ignores an unknown report id', () => {
      const r = store.actions.addReport(reportInput(project.id))
      store.actions.deleteReport('nope')
      assert.equal(persisted().reports.length, 1)
      assert.equal(persisted().reports[0].id, r.id)
    })

    // Characterisation: the UI shows "(since deleted)" when a project's status came from a report
    // that no longer exists, so the reference is intentionally left in place.
    it('leaves a status source pointing at a deleted report (the UI handles this)', () => {
      const r = store.actions.addReport(reportInput(project.id))
      store.actions.setProjectStatus(project.id, 'At Risk', { type: 'report', reportId: r.id })
      store.actions.deleteReport(r.id)
      const p = persisted().projects[0]
      assert.equal(p.status, 'At Risk')
      assert.equal(p.statusSource.reportId, r.id)
    })
  })

  describe('history ordering', () => {
    // Characterisation of CURRENT behaviour: history is ordered by when each report was saved
    // (savedAt), newest first. It is not ordered by reporting period (history.js does that).
    it('lists a project\'s reports newest-saved first', () => {
      const first = store.actions.addReport(reportInput(project.id, { title: 'first' }))
      tick(86_400_000)
      const second = store.actions.addReport(reportInput(project.id, { title: 'second' }))
      tick(86_400_000)
      const third = store.actions.addReport(reportInput(project.id, { title: 'third' }))
      const ids = store.reportsFor(persisted(), project.id).map((r) => r.id)
      assert.deepEqual(ids, [third.id, second.id, first.id])
    })

    it('orders by save time even when the reporting periods are out of order (documents current behaviour)', () => {
      const newerPeriod = store.actions.addReport(reportInput(project.id, { periodStart: '2026-11-01', periodEnd: '2026-11-07' }))
      tick(1000)
      const olderPeriodSavedLater = store.actions.addReport(reportInput(project.id, { periodStart: '2026-10-01', periodEnd: '2026-10-07' }))
      const ids = store.reportsFor(persisted(), project.id).map((r) => r.id)
      assert.deepEqual(ids, [olderPeriodSavedLater.id, newerPeriod.id])
    })

    it('does not mutate stored order when reading history', () => {
      store.actions.addReport(reportInput(project.id, { title: 'a' }))
      tick(1000)
      store.actions.addReport(reportInput(project.id, { title: 'b' }))
      const s = persisted()
      const before = s.reports.map((r) => r.id)
      store.reportsFor(s, project.id)
      assert.deepEqual(s.reports.map((r) => r.id), before)
    })

    it('returns nothing for a project with no reports', () => {
      assert.deepEqual(store.reportsFor(persisted(), project.id), [])
    })
  })
})
