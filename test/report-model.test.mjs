import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { makeStorage, loadStore, releaseStorage, readPersisted } from './helpers/storage.mjs'
import { projectInput, reportInput, content, GENERATED_AT } from './helpers/fixtures.mjs'

// The report data model keeps ORIGINAL information separate from HUMAN-EDITED output:
//   originalUpdate (what the PM submitted)  generatedContent (what the AI produced)  content (what the PM has since edited)
// and keeps three moments apart: generatedAt (AI), savedAt (first saved), updatedAt (last edited).
describe('report data model', () => {
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
  const saved = (id) => persisted().reports.find((r) => r.id === id)
  const tick = (ms) => mock.timers.tick(ms)
  // Forces a re-save of whatever the store currently holds in memory. If the store were holding on to an object
  // the caller still has, any later change to that object would show up here.
  const resave = () => store.actions.deleteReport('__no-such-report__')

  const AI = () => content({ title: 'AI title', executiveSummary: 'Written by the AI.', risks: ['AI risk'] })
  const EDITED = () => content({ title: 'PM title', executiveSummary: 'Rewritten by the PM.', risks: ['PM risk'] })

  describe('A. the original submitted update', () => {
    it('is stored exactly as submitted, whitespace and unicode included', () => {
      const raw = '  Finished login 🎉\n\n  café – payments blocked  \t'
      const r = store.actions.addReport(reportInput(project.id, { originalUpdate: raw }))
      assert.equal(saved(r.id).originalUpdate, raw)
    })

    it('is never changed by editing the report, however many times', () => {
      const r = store.actions.addReport(reportInput(project.id, { originalUpdate: 'my raw notes' }))
      for (let i = 0; i < 5; i++) {
        tick(1000)
        store.actions.updateReportContent(r.id, content({ executiveSummary: `edit ${i}` }))
      }
      assert.equal(saved(r.id).originalUpdate, 'my raw notes')
    })

    it('is not changed by an edit that tries to include an update field', () => {
      const r = store.actions.addReport(reportInput(project.id, { originalUpdate: 'my raw notes' }))
      store.actions.updateReportContent(r.id, { ...content(), originalUpdate: 'SNEAKED IN' })
      assert.equal(saved(r.id).originalUpdate, 'my raw notes')
    })
  })

  describe('B. the original AI-generated report', () => {
    it('is stored exactly as the AI produced it', () => {
      const r = store.actions.addReport(reportInput(project.id, { generatedContent: AI(), content: AI() }))
      assert.deepEqual(saved(r.id).generatedContent, AI())
    })

    it('stays available, unchanged, after the PM edits the report', () => {
      const r = store.actions.addReport(reportInput(project.id, { generatedContent: AI(), content: AI() }))
      store.actions.updateReportContent(r.id, EDITED())
      store.actions.updateReportContent(r.id, content({ executiveSummary: 'a second edit' }))
      assert.deepEqual(saved(r.id).generatedContent, AI())
    })

    it('is kept apart from the editable content: they are separate objects, not one shared reference', () => {
      const r = store.actions.addReport(reportInput(project.id, { generatedContent: AI(), content: AI() }))
      assert.notEqual(r.generatedContent, r.content)
    })

    it('is protected from later changes to the object that was passed in when saving', () => {
      const generated = AI()
      const r = store.actions.addReport(reportInput(project.id, { generatedContent: generated, content: AI() }))
      generated.executiveSummary = 'MUTATED AFTER SAVING'
      generated.risks.push('SNEAKED IN')
      resave()
      assert.deepEqual(saved(r.id).generatedContent, AI())
    })

    it('is not changed by an edit, even if the edit object shares data with it', () => {
      const r = store.actions.addReport(reportInput(project.id, { generatedContent: AI(), content: AI() }))
      const edit = structuredClone(saved(r.id).generatedContent)
      edit.executiveSummary = 'edited'
      store.actions.updateReportContent(r.id, edit)
      assert.deepEqual(saved(r.id).generatedContent, AI())
    })

    it('is marked "recorded" when it was captured at the time', () => {
      const r = store.actions.addReport(reportInput(project.id))
      assert.equal(r.provenance.generatedContent, 'recorded')
    })

    it('is stored as unknown (not guessed) when the AI output was not supplied or is not valid content', () => {
      for (const bad of [undefined, null, { risks: 'one string' }, 'text']) {
        const r = store.actions.addReport(reportInput(project.id, { generatedContent: bad }))
        assert.equal(r.generatedContent, null, String(bad))
        assert.equal(r.provenance.generatedContent, 'unknown')
      }
    })
  })

  describe('C. the PM-edited report', () => {
    it('holds the current, human-reviewed version, separate from the AI original', () => {
      const r = store.actions.addReport(reportInput(project.id, { generatedContent: AI(), content: AI() }))
      store.actions.updateReportContent(r.id, EDITED())
      assert.deepEqual(saved(r.id).content, EDITED())
      assert.deepEqual(saved(r.id).generatedContent, AI())
    })

    it('keeps edits made BEFORE the first save in content, while the AI output is still preserved', () => {
      const r = store.actions.addReport(reportInput(project.id, { generatedContent: AI(), content: EDITED() }))
      assert.deepEqual(saved(r.id).content, EDITED())
      assert.deepEqual(saved(r.id).generatedContent, AI())
      assert.equal(saved(r.id).updatedAt, null, 'nothing was changed after saving')
    })

    it('keeps the report title in step with the edited title', () => {
      const r = store.actions.addReport(reportInput(project.id, { title: 'AI title', generatedContent: AI(), content: AI() }))
      store.actions.updateReportContent(r.id, content({ title: 'PM title' }))
      assert.equal(saved(r.id).title, 'PM title')
      assert.equal(saved(r.id).generatedContent.title, 'AI title')
    })

    it('is not aliased to the object the editor passed in', () => {
      const r = store.actions.addReport(reportInput(project.id))
      const edit = EDITED()
      store.actions.updateReportContent(r.id, edit)
      edit.executiveSummary = 'MUTATED AFTER SAVING'
      resave()
      assert.equal(saved(r.id).content.executiveSummary, 'Rewritten by the PM.')
    })
  })

  describe('D. the reporting period', () => {
    it('stores the start and end dates and never changes them when the report is edited', () => {
      const r = store.actions.addReport(reportInput(project.id, { periodStart: '2026-10-01', periodEnd: '2026-10-07' }))
      store.actions.updateReportContent(r.id, EDITED())
      assert.equal(saved(r.id).periodStart, '2026-10-01')
      assert.equal(saved(r.id).periodEnd, '2026-10-07')
    })
  })

  describe('E. timestamps', () => {
    it('records when the AI generated it (as supplied), when it was saved, and that it has not been edited', () => {
      const r = store.actions.addReport(reportInput(project.id))
      assert.equal(r.generatedAt, GENERATED_AT)
      assert.equal(r.savedAt, t0)
      assert.equal(r.updatedAt, null)
    })

    it('never uses the save time as the generation time, even when no generation time is given', () => {
      const r = store.actions.addReport(reportInput(project.id, { generatedAt: undefined }))
      assert.equal(r.generatedAt, null)
      assert.notEqual(r.generatedAt, r.savedAt)
      assert.equal(r.provenance.generatedAt, 'unknown')
      assert.equal(r.savedAt, t0)
    })

    it('ignores a generation time that is not a real timestamp rather than storing junk', () => {
      for (const bad of ['yesterday', '', 12345, {}]) {
        const r = store.actions.addReport(reportInput(project.id, { generatedAt: bad }))
        assert.equal(r.generatedAt, null, String(bad))
      }
    })

    it('marks a supplied generation time as recorded', () => {
      assert.equal(store.actions.addReport(reportInput(project.id)).provenance.generatedAt, 'recorded')
    })

    it('records the time of an edit in updatedAt, and moves it forward on each later edit', () => {
      const r = store.actions.addReport(reportInput(project.id))
      tick(60_000)
      store.actions.updateReportContent(r.id, EDITED())
      assert.equal(saved(r.id).updatedAt, '2026-11-10T09:01:00.000Z')
      tick(60_000)
      store.actions.updateReportContent(r.id, content({ executiveSummary: 'again' }))
      assert.equal(saved(r.id).updatedAt, '2026-11-10T09:02:00.000Z')
    })

    it('never changes generatedAt or savedAt when the report is edited', () => {
      const r = store.actions.addReport(reportInput(project.id))
      tick(3_600_000)
      store.actions.updateReportContent(r.id, EDITED())
      assert.equal(saved(r.id).generatedAt, GENERATED_AT)
      assert.equal(saved(r.id).savedAt, t0)
    })

    it('keeps the three timestamps distinct from each other', () => {
      const r = store.actions.addReport(reportInput(project.id, { periodEnd: '2026-11-07' }))
      tick(1000)
      store.actions.updateReportContent(r.id, EDITED())
      const s = saved(r.id)
      assert.equal(new Set([s.generatedAt, s.savedAt, s.updatedAt]).size, 3)
      assert.equal(s.periodEnd, '2026-11-07', 'and the reporting period is a different thing again')
    })

    it('a sample copy has no AI generation time or output, only a save time', () => {
      const copy = store.actions.saveSampleCopy({ projectId: project.id, content: content(), originalUpdate: 'x', periodStart: '2026-11-01', periodEnd: '2026-11-07', copiedFrom: 'sample' })
      assert.equal(copy.generatedAt, null)
      assert.equal(copy.generatedContent, null)
      assert.equal(copy.savedAt, t0)
      assert.deepEqual(copy.provenance, { generatedAt: 'not-applicable', generatedContent: 'not-applicable', generation: 'not-applicable' })
    })
  })

  describe('F. the project status when the report was made', () => {
    it('keeps the status the PM confirmed for the report, whatever the project status does later', () => {
      store.actions.setProjectStatus(project.id, 'At Risk')
      const r = store.actions.addReport(reportInput(project.id, { projectStatusAtReport: 'At Risk' }))
      for (const next of ['Blocked', 'Off Track', 'On Track', '']) {
        store.actions.setProjectStatus(project.id, next)
        assert.equal(saved(r.id).projectStatusAtReport, 'At Risk', `after the project moved to ${next || 'not set'}`)
      }
    })

    it('is not rewritten by editing the project or the report', () => {
      const r = store.actions.addReport(reportInput(project.id, { projectStatusAtReport: 'Blocked' }))
      store.actions.updateProject(project.id, projectInput({ name: 'Renamed' }))
      store.actions.updateReportContent(r.id, EDITED())
      assert.equal(saved(r.id).projectStatusAtReport, 'Blocked')
    })

    it('keeps each report\'s own snapshot, so a project\'s history of statuses stays readable across reports', () => {
      const a = store.actions.addReport(reportInput(project.id, { projectStatusAtReport: 'On Track', periodEnd: '2026-10-07' }))
      store.actions.setProjectStatus(project.id, 'Blocked')
      const b = store.actions.addReport(reportInput(project.id, { projectStatusAtReport: 'Blocked', periodEnd: '2026-10-14' }))
      assert.deepEqual([saved(a.id).projectStatusAtReport, saved(b.id).projectStatusAtReport], ['On Track', 'Blocked'])
    })

    it('stores "none" when the PM did not confirm a status, never an invented one', () => {
      assert.equal(store.actions.addReport(reportInput(project.id, { projectStatusAtReport: '' })).projectStatusAtReport, null)
      assert.equal(store.actions.addReport(reportInput(project.id, { projectStatusAtReport: undefined })).projectStatusAtReport, null)
    })
  })

  describe('H. stable associations (by id, never by position)', () => {
    it('ties a report to its project by id, and that survives edits, status changes and other projects', () => {
      const other = store.actions.createProject(projectInput({ name: 'Other' }))
      const r = store.actions.addReport(reportInput(project.id))
      store.actions.addReport(reportInput(other.id))
      store.actions.updateReportContent(r.id, EDITED())
      store.actions.setProjectStatus(project.id, 'Blocked')
      store.actions.updateProject(project.id, projectInput({ name: 'Renamed' }))
      assert.equal(saved(r.id).projectId, project.id)
    })

    it('still finds every report by id when the stored order is shuffled', async () => {
      const ids = [1, 2, 3].map((n) => store.actions.addReport(reportInput(project.id, { title: `r${n}` })).id)
      const s = persisted()
      s.reports.reverse()
      storage.data.set('statusai.v1', JSON.stringify(s))
      const reloaded = await loadStore(storage)
      reloaded.actions.deleteReport('__no-such-report__')
      const after = readPersisted(storage)
      for (const id of ids) assert.ok(after.reports.find((r) => r.id === id), id)
      assert.deepEqual(after.reports.map((r) => r.projectId), [project.id, project.id, project.id])
    })

    it('uses unique ids for projects, reports and (see status-history tests) status changes', () => {
      const r1 = store.actions.addReport(reportInput(project.id))
      const r2 = store.actions.addReport(reportInput(project.id))
      assert.notEqual(r1.id, r2.id)
      assert.notEqual(r1.id, project.id)
    })

    it('deleting one report leaves every other report\'s links untouched', () => {
      const a = store.actions.addReport(reportInput(project.id))
      const b = store.actions.addReport(reportInput(project.id))
      store.actions.deleteReport(a.id)
      assert.equal(saved(b.id).projectId, project.id)
    })
  })
})
