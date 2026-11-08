import { describe, it, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { makeStorage, loadStore, releaseStorage, readPersisted, KEY, SET_ASIDE_KEY, PRE_MIGRATION_KEY } from './helpers/storage.mjs'
import { projectInput, reportInput, content, v1Project, v1Report } from './helpers/fixtures.mjs'
import { previousReportFor, statusHistoryFor } from '../src/history.js'

// Browsers already hold version-1 data (written before the report data model changed). Loading it must
// upgrade it safely: nothing lost, nothing invented, and every existing safeguard still applies.

const at = '2026-02-01T10:00:00.000Z'
const v1Data = (extra = {}) => ({
  version: 1,
  projects: [
    v1Project({ id: 'p1', name: 'Portal', status: 'At Risk', statusSource: { type: 'report', reportId: 'r2', at } }),
    v1Project({ id: 'p2', name: 'Payments', status: null }),
    v1Project({ id: 'p3', name: 'Billing', status: 'On Track', statusSource: { type: 'manual', at: '2026-01-20T08:00:00.000Z' } }),
  ],
  reports: [
    v1Report({ id: 'r1', projectId: 'p1', originalUpdate: 'first raw update', periodStart: '2026-01-01', periodEnd: '2026-01-07', generatedAt: '2026-01-08T09:00:00.000Z', projectStatusAtReport: 'On Track' }),
    v1Report({ id: 'r2', projectId: 'p1', originalUpdate: 'second raw update', periodStart: '2026-01-08', periodEnd: '2026-01-14', generatedAt: '2026-01-15T09:00:00.000Z', updatedAt: '2026-01-16T10:00:00.000Z', projectStatusAtReport: 'At Risk', content: content({ executiveSummary: 'PM rewrote this' }) }),
    v1Report({ id: 'r3', projectId: 'p2', originalUpdate: 'payments update', projectStatusAtReport: null }),
  ],
  ...extra,
})
const raw = (d = v1Data()) => JSON.stringify(d)

// What a fresh load produced: re-saves the loaded state and reads it back (a harmless no-op action).
const loaded = async (storage) => {
  const store = await loadStore(storage)
  store.actions.deleteReport('__no-such-report__')
  return { store, state: readPersisted(storage) }
}

describe('migrating existing browser data (version 1 -> 2)', () => {
  afterEach(releaseStorage)

  describe('nothing is lost', () => {
    it('keeps every project and report, with the same ids and the same project associations', async () => {
      const { state } = await loaded(makeStorage({ [KEY]: raw() }))
      assert.deepEqual(state.projects.map((p) => p.id), ['p1', 'p2', 'p3'])
      assert.deepEqual(state.reports.map((r) => [r.id, r.projectId]), [['r1', 'p1'], ['r2', 'p1'], ['r3', 'p2']])
      assert.equal(state.version, 2)
    })

    it('keeps every original submitted update exactly', async () => {
      const { state } = await loaded(makeStorage({ [KEY]: raw() }))
      assert.deepEqual(state.reports.map((r) => r.originalUpdate), ['first raw update', 'second raw update', 'payments update'])
    })

    it('keeps reporting periods, report content, status snapshots, titles, edit times and extra fields untouched', async () => {
      const src = v1Data()
      src.reports[0].mystery = { keep: 'me' }
      const { state } = await loaded(makeStorage({ [KEY]: raw(src) }))
      for (const [i, before] of src.reports.entries()) {
        const after = state.reports[i]
        for (const k of Object.keys(before).filter((k) => k !== 'generatedAt')) assert.deepEqual(after[k], before[k], `${before.id}.${k}`)
      }
    })

    it('keeps projects exactly as they were (apart from linking a status to its history entry)', async () => {
      const src = v1Data()
      const { state } = await loaded(makeStorage({ [KEY]: raw(src) }))
      for (const [i, before] of src.projects.entries()) {
        const { statusSource: sBefore, ...restBefore } = before
        const { statusSource: sAfter, ...restAfter } = state.projects[i]
        assert.deepEqual(restAfter, restBefore, before.id)
        if (sBefore) {
          const { historyId, ...sRest } = sAfter
          assert.deepEqual(sRest, sBefore)
          assert.ok(historyId)
        } else assert.equal(sAfter, null)
      }
    })

    it('keeps unknown top-level fields', async () => {
      const { state } = await loaded(makeStorage({ [KEY]: raw(v1Data({ futureThing: { a: 1 } })) }))
      assert.deepEqual(state.futureThing, { a: 1 })
    })

    it('reads data with a missing or malformed version as version 1 and migrates it', async () => {
      for (const version of [undefined, null, '1', 0, -1, 1.5]) {
        const d = v1Data()
        if (version === undefined) delete d.version
        else d.version = version
        const { state } = await loaded(makeStorage({ [KEY]: raw(d) }))
        assert.equal(state.version, 2, String(version))
        assert.equal(state.reports.length, 3)
        assert.ok(state.reports.every((r) => 'savedAt' in r))
      }
    })
  })

  describe('nothing is invented', () => {
    it('turns the old (save-time) "generatedAt" into savedAt and leaves the AI generation time null and "unknown"', async () => {
      const { state } = await loaded(makeStorage({ [KEY]: raw() }))
      const r1 = state.reports.find((r) => r.id === 'r1')
      assert.equal(r1.savedAt, '2026-01-08T09:00:00.000Z')
      assert.equal(r1.generatedAt, null)
      assert.equal(r1.provenance.generatedAt, 'unknown')
    })

    it('recovers the original AI output only for a report that was never edited', async () => {
      const { state } = await loaded(makeStorage({ [KEY]: raw() }))
      const r1 = state.reports.find((r) => r.id === 'r1')
      const r2 = state.reports.find((r) => r.id === 'r2')
      assert.deepEqual(r1.generatedContent, r1.content)
      assert.equal(r1.provenance.generatedContent, 'recovered')
      assert.equal(r2.generatedContent, null, 'edited: the AI original was overwritten and is unknown')
      assert.equal(r2.provenance.generatedContent, 'unknown')
      assert.equal(r2.content.executiveSummary, 'PM rewrote this')
    })

    it('does not give demo reports or sample copies any AI output or generation time', async () => {
      const d = v1Data()
      d.projects.push(v1Project({ id: 'demo-p-01', name: 'Demo', demo: true }))
      d.reports.push(v1Report({ id: 'demo-r-01-1', projectId: 'demo-p-01', source: 'demo', demo: true }))
      d.reports.push(v1Report({ id: 'copy1', projectId: 'demo-p-01', source: 'sample-copy', demo: true, sampleCopy: true, copiedFrom: 'demo-r-01-1' }))
      const { state } = await loaded(makeStorage({ [KEY]: raw(d) }))
      for (const id of ['demo-r-01-1', 'copy1']) {
        const r = state.reports.find((x) => x.id === id)
        assert.deepEqual([r.generatedAt, r.generatedContent], [null, null])
        assert.deepEqual(r.provenance, { generatedAt: 'not-applicable', generatedContent: 'not-applicable', generation: 'not-applicable' })
      }
    })

    it('creates one honest status anchor per project that has a status, with the earlier status marked unknown', async () => {
      const { state } = await loaded(makeStorage({ [KEY]: raw() }))
      assert.equal(state.statusHistory.length, 2) // p1 and p3 have a status; p2 has none
      const p1 = state.statusHistory.find((h) => h.projectId === 'p1')
      assert.deepEqual(p1, {
        id: 'status-migrated-p1', projectId: 'p1', previousStatus: null, previousStatusKnown: false,
        newStatus: 'At Risk', at, source: 'report', reportId: 'r2', migrated: true,
      })
      assert.equal(state.statusHistory.find((h) => h.projectId === 'p3').source, 'manual')
      assert.equal(state.statusHistory.some((h) => h.projectId === 'p2'), false, 'no status, so nothing to record')
    })

    it('links each project to its anchor by id', async () => {
      const { state } = await loaded(makeStorage({ [KEY]: raw() }))
      const p1 = state.projects.find((p) => p.id === 'p1')
      assert.equal(p1.statusSource.historyId, 'status-migrated-p1')
    })

    it('skips the anchor when there is no reliable record of how the status was set', async () => {
      const d = v1Data()
      d.projects[2].statusSource = null
      const { state } = await loaded(makeStorage({ [KEY]: raw(d) }))
      assert.equal(state.statusHistory.some((h) => h.projectId === 'p3'), false)
      assert.equal(state.projects.find((p) => p.id === 'p3').status, 'On Track', 'the status itself is kept')
    })
  })

  describe('timing and idempotence', () => {
    it('writes nothing to the main data until the app actually changes something', async () => {
      const storage = makeStorage({ [KEY]: raw() })
      await loadStore(storage)
      assert.equal(storage.data.get(KEY), raw(), 'still exactly the version-1 data')
      assert.ok(!storage.writes.includes(KEY))
    })

    it('migrates identically every time it is loaded, until it is saved', async () => {
      const storage = makeStorage({ [KEY]: raw() })
      const a = (await loaded(makeStorage({ [KEY]: raw() }))).state
      const b = (await loaded(makeStorage({ [KEY]: raw() }))).state
      assert.deepEqual(a, b)
      assert.equal(storage.data.get(KEY), raw())
    })

    it('after the first save, reloads as version 2 with no further migration or backup', async () => {
      const storage = makeStorage({ [KEY]: raw() })
      const first = await loaded(storage)
      const writesAfterFirst = storage.writes.length
      const second = await loaded(storage)
      assert.deepEqual(second.state, first.state)
      assert.equal(readPersisted(storage).version, 2)
      assert.equal(storage.writes.filter((k) => k === PRE_MIGRATION_KEY).length, 1, 'the backup was made once')
      assert.equal(storage.writes.length, writesAfterFirst + 1, 'only the no-op save itself')
    })

    it('never adds a second status anchor when it migrates again', async () => {
      const storage = makeStorage({ [KEY]: raw() })
      await loaded(storage)
      await loaded(storage)
      assert.equal(readPersisted(storage).statusHistory.filter((h) => h.projectId === 'p1').length, 1)
    })
  })

  describe('a safety copy of the original data', () => {
    it('stores the exact version-1 data once, before anything is rewritten', async () => {
      const storage = makeStorage({ [KEY]: raw() })
      await loadStore(storage)
      assert.equal(storage.data.get(PRE_MIGRATION_KEY), raw())
    })

    it('never overwrites an existing safety copy', async () => {
      const storage = makeStorage({ [KEY]: raw(), [PRE_MIGRATION_KEY]: 'an earlier copy' })
      await loadStore(storage)
      assert.equal(storage.data.get(PRE_MIGRATION_KEY), 'an earlier copy')
    })

    it('carries on migrating if the safety copy cannot be stored (the migration only adds fields)', async () => {
      const storage = makeStorage({ [KEY]: raw() }, { failSet: [PRE_MIGRATION_KEY] })
      const { state, store } = await loaded(storage)
      assert.equal(state.reports.length, 3)
      assert.deepEqual(store.getPersistence(), { ok: true, reason: null, notice: null })
    })
  })

  describe('data written by a newer version of the app', () => {
    const newer = () => JSON.stringify({ version: 3, projects: [{ id: 'p', name: 'x', startDate: '2026-01-01', futureOnly: true }], reports: [], newThing: { a: 1 } })

    it('is left exactly as it is: nothing is written, and the user is told why', async () => {
      const storage = makeStorage({ [KEY]: newer() })
      const store = await loadStore(storage)
      assert.deepEqual(store.getPersistence(), { ok: false, reason: 'newer-version', notice: null })
      assert.doesNotThrow(() => store.actions.createProject(projectInput()))
      store.actions.loadDemo()
      store.actions.resetDemo()
      assert.equal(storage.data.get(KEY), newer(), 'the newer data is untouched')
      assert.deepEqual(storage.writes, [])
    })

    it('does not set it aside as if it were corrupt, and does not make a migration copy', async () => {
      const storage = makeStorage({ [KEY]: newer() })
      await loadStore(storage)
      assert.equal(storage.data.has(SET_ASIDE_KEY), false)
      assert.equal(storage.data.has(PRE_MIGRATION_KEY), false)
    })

    it('does not write when asked to retry', async () => {
      const storage = makeStorage({ [KEY]: newer() })
      const store = await loadStore(storage)
      store.actions.retrySave()
      assert.deepEqual(storage.writes, [])
    })
  })

  describe('existing safeguards still apply', () => {
    it('sets aside version-1 records that cannot be loaded, migrates the rest, and keeps the original text', async () => {
      const d = v1Data()
      d.projects.push(null, { id: 'bad' })
      d.reports.push({ id: 'broken' })
      const storage = makeStorage({ [KEY]: raw(d) })
      const store = await loadStore(storage)
      assert.deepEqual(store.getPersistence().notice, { unreadable: false, projects: 2, reports: 1 })
      assert.equal(storage.data.get(SET_ASIDE_KEY), raw(d), 'nothing destroyed')
      store.actions.deleteReport('__no-such-report__')
      assert.equal(readPersisted(storage).reports.length, 3)
      assert.equal(readPersisted(storage).version, 2)
      assert.equal(storage.data.has(PRE_MIGRATION_KEY), false, 'the set-aside copy already preserves the original')
    })

    it('does not overwrite an existing set-aside backup, and suspends all writes (version-1 data stays as it was)', async () => {
      const d = v1Data()
      d.reports.push({ id: 'broken' })
      const storage = makeStorage({ [KEY]: raw(d), [SET_ASIDE_KEY]: 'older incident' })
      const store = await loadStore(storage)
      assert.equal(store.getPersistence().reason, 'backup-exists')
      store.actions.createProject(projectInput())
      assert.equal(storage.data.get(SET_ASIDE_KEY), 'older incident')
      assert.equal(storage.data.get(KEY), raw(d))
      assert.deepEqual(storage.writes, [])
    })

    it('reports a failed save of migrated data accurately, and recovers when saving works again', async () => {
      const storage = makeStorage({ [KEY]: raw() })
      const store = await loadStore(storage)
      storage.failSet = true
      store.actions.createProject(projectInput({ name: 'New' }))
      assert.equal(store.getPersistence().reason, 'write-failed')
      assert.equal(storage.data.get(KEY), raw(), 'the old data is still intact')
      storage.failSet = false
      assert.equal(store.actions.retrySave().ok, true)
      const s = readPersisted(storage)
      assert.equal(s.version, 2)
      assert.ok(s.projects.some((p) => p.name === 'New'))
      assert.equal(s.reports.length, 3)
    })

    it('does not write when the existing data cannot be read', async () => {
      const storage = makeStorage({ [KEY]: raw() }, { failGet: true })
      const store = await loadStore(storage)
      store.actions.createProject(projectInput())
      assert.equal(storage.data.get(KEY), raw())
      assert.deepEqual(storage.writes, [])
    })
  })

  describe('compatibility with the demo workspace and sample reports', () => {
    const demoV1 = () => {
      const d = v1Data()
      d.projects.push(v1Project({ id: 'demo-p-04', name: 'Mobile Application Release', demo: true, status: 'On Track', statusSource: { type: 'report', reportId: 'demo-r-04-1', at } }))
      d.reports.push(v1Report({ id: 'demo-r-04-1', projectId: 'demo-p-04', source: 'demo', demo: true, projectStatusAtReport: 'On Track' }))
      d.reports.push(v1Report({ id: 'copy-a', projectId: 'demo-p-04', source: 'sample-copy', demo: true, sampleCopy: true, copiedFrom: 'demo-r-04-1' }))
      return d
    }

    it('gives existing demo projects no invented history of their own', async () => {
      const { state } = await loaded(makeStorage({ [KEY]: raw(demoV1()) }))
      assert.equal(state.statusHistory.some((h) => h.projectId === 'demo-p-04'), false)
    })

    it('Load Demo fills in the demo status history without duplicating anything or touching the user\'s data', async () => {
      const storage = makeStorage({ [KEY]: raw(demoV1()) })
      const { store, state: before } = await loaded(storage)
      assert.deepEqual(store.actions.loadDemo(), { addedProjects: 9, addedReports: 12 }) // the 9 demo projects not already present
      const s = readPersisted(storage)
      assert.equal(new Set(s.statusHistory.map((h) => h.id)).size, s.statusHistory.length)
      assert.ok(statusHistoryFor(s, 'demo-p-04').every((h) => h.demo === true))
      for (const id of ['p1', 'p2', 'p3']) assert.deepEqual(s.projects.find((p) => p.id === id), before.projects.find((p) => p.id === id))
      for (const id of ['r1', 'r2', 'r3']) assert.deepEqual(s.reports.find((r) => r.id === id), before.reports.find((r) => r.id === id))
    })

    it('Reset Demo still removes demo records, sample copies and demo history, and keeps the user\'s migrated data', async () => {
      const storage = makeStorage({ [KEY]: raw(demoV1()) })
      const { store } = await loaded(storage)
      store.actions.loadDemo()
      const r = store.actions.resetDemo()
      const s = readPersisted(storage)
      assert.equal(r.keptProjects, 0)
      assert.deepEqual(s.projects.map((p) => p.id), ['p1', 'p2', 'p3'])
      assert.deepEqual(s.reports.map((x) => x.id), ['r1', 'r2', 'r3'])
      assert.deepEqual(s.statusHistory.map((h) => h.id).sort(), ['status-migrated-p1', 'status-migrated-p3'])
    })

    it('Save a Copy works on migrated data and the copy has the new fields', async () => {
      const storage = makeStorage({ [KEY]: raw(demoV1()) })
      const { store } = await loaded(storage)
      const copy = store.actions.saveSampleCopy({ projectId: 'demo-p-04', content: content(), originalUpdate: 'x', periodStart: '2026-11-01', periodEnd: '2026-11-07', copiedFrom: 'demo-r-04-1' })
      assert.deepEqual([copy.generatedAt, copy.generatedContent], [null, null])
      assert.ok(copy.savedAt)
    })
  })

  describe('migrated data works with the new features', () => {
    it('can be saved to and edited like any other data, keeping the new immutability guarantees', async () => {
      const storage = makeStorage({ [KEY]: raw() })
      const { store } = await loaded(storage)
      store.actions.updateReportContent('r1', content({ executiveSummary: 'edited after migration' }))
      const r1 = readPersisted(storage).reports.find((r) => r.id === 'r1')
      assert.equal(r1.originalUpdate, 'first raw update')
      assert.equal(r1.content.executiveSummary, 'edited after migration')
      assert.equal(r1.generatedContent.executiveSummary, 'Summary text.', 'the recovered AI original is unchanged by the edit')
    })

    it('a new live report saved next to migrated ones keeps its own recorded timestamps and can find its predecessor', async () => {
      const storage = makeStorage({ [KEY]: raw() })
      const { store } = await loaded(storage)
      mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-10T09:00:00.000Z') })
      try {
        const fresh = store.actions.addReport(reportInput('p1', { periodStart: '2026-01-15', periodEnd: '2026-01-21', generatedAt: '2026-11-09T12:00:00.000Z' }))
        assert.equal(fresh.generatedAt, '2026-11-09T12:00:00.000Z')
        assert.equal(fresh.savedAt, '2026-11-10T09:00:00.000Z')
        const s = readPersisted(storage)
        assert.equal(previousReportFor(s, { id: fresh.id }).report.id, 'r2', 'chosen by period end among migrated reports')
      } finally {
        mock.timers.reset()
      }
    })

    it('records later status changes after the migrated anchor, with the previous status now known', async () => {
      const storage = makeStorage({ [KEY]: raw() })
      const { store } = await loaded(storage)
      store.actions.setProjectStatus('p1', 'Blocked')
      const h = statusHistoryFor(readPersisted(storage), 'p1')
      assert.deepEqual(h.map((e) => [e.previousStatus, e.previousStatusKnown, e.newStatus]), [[null, false, 'At Risk'], ['At Risk', true, 'Blocked']])
    })

    it('keeps each migrated report\'s status snapshot when the project status later changes', async () => {
      const storage = makeStorage({ [KEY]: raw() })
      const { store } = await loaded(storage)
      store.actions.setProjectStatus('p1', 'Off Track')
      const s = readPersisted(storage)
      assert.deepEqual(['r1', 'r2'].map((id) => s.reports.find((r) => r.id === id).projectStatusAtReport), ['On Track', 'At Risk'])
    })
  })
})
