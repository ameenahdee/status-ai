import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { makeStorage, loadStore, releaseStorage, readPersisted, KEY, SET_ASIDE_KEY } from './helpers/storage.mjs'
import { projectInput, reportInput, content } from './helpers/fixtures.mjs'
import { itemsOf, reportToText, SECTIONS } from '../src/sections.js'

// store.js exposes its data only through a React hook, so these tests read what the app would see
// after a refresh: whatever was persisted. A no-op action re-saves the loaded state, which lets us
// observe what a fresh load actually produced.
const NOOP = '__no-such-report__'
const loadedState = async (storage) => {
  const store = await loadStore(storage)
  store.actions.deleteReport(NOOP)
  return { store, state: readPersisted(storage) }
}

const EMPTY = { version: 2, projects: [], reports: [], statusHistory: [] }

// Records in the CURRENT (version 2) shape. Migration from version 1 is covered in migration.test.mjs.
const goodProject = (over = {}) => ({
  id: 'p-good', name: 'Good project', startDate: '2026-10-01', description: 'd', owner: '', audience: '',
  status: 'On Track', statusSource: { type: 'manual', at: '2026-10-02T00:00:00.000Z' }, createdAt: '2026-10-01T00:00:00.000Z', ...over,
})
const goodReport = (over = {}) => ({
  id: 'r-good', projectId: 'p-good', title: 'Good report', originalUpdate: 'raw', periodStart: '2026-10-01', periodEnd: '2026-10-07',
  generatedAt: '2026-10-07T23:50:00.000Z', savedAt: '2026-10-08T00:00:00.000Z', updatedAt: null, source: 'ai', projectStatusAtReport: null,
  generatedContent: content(), content: content(), provenance: { generatedAt: 'recorded', generatedContent: 'recorded' }, ...over,
})
const seed = (projects, reports, extra = {}) => JSON.stringify({ version: 2, projects, reports, statusHistory: [], ...extra })

describe('persistence', () => {
  afterEach(releaseStorage)

  describe('a healthy store', () => {
    it('reports that everything is being saved, with nothing to warn about', async () => {
      const store = await loadStore(makeStorage())
      store.actions.createProject(projectInput())
      assert.deepEqual(store.getPersistence(), { ok: true, reason: null, notice: null })
    })
  })

  describe('surviving a refresh', () => {
    it('brings back projects and reports saved in an earlier session, exactly as saved', async () => {
      const storage = makeStorage()
      const first = await loadStore(storage)
      const p = first.actions.createProject(projectInput())
      const r = first.actions.addReport(reportInput(p.id))
      first.actions.updateReportContent(r.id, content({ executiveSummary: 'Edited before the refresh.' }))
      const before = readPersisted(storage)

      const { state } = await loadedState(storage) // a brand-new load of the app over the same storage
      assert.deepEqual(state, before)
      assert.equal(state.reports[0].content.executiveSummary, 'Edited before the refresh.')
      assert.equal(state.reports[0].originalUpdate, r.originalUpdate)
    })

    it('keeps working on top of loaded data without losing it', async () => {
      const storage = makeStorage()
      const first = await loadStore(storage)
      const p = first.actions.createProject(projectInput({ name: 'Existing' }))
      first.actions.addReport(reportInput(p.id))

      const second = await loadStore(storage)
      second.actions.createProject(projectInput({ name: 'Added after refresh' }))
      const s = readPersisted(storage)
      assert.deepEqual(s.projects.map((x) => x.name).sort(), ['Added after refresh', 'Existing'])
      assert.equal(s.reports.length, 1)
    })

    it('restores sample copies and demo records after a refresh', async () => {
      const storage = makeStorage()
      const first = await loadStore(storage)
      first.actions.loadDemo()
      first.actions.saveSampleCopy({ projectId: 'demo-p-01', content: content(), originalUpdate: 'x', periodStart: '2026-11-01', periodEnd: '2026-11-07', copiedFrom: 'sample:customer-portal' })
      const { state } = await loadedState(storage)
      assert.equal(state.projects.filter((p) => p.demo).length, 10)
      assert.equal(state.reports.filter((r) => r.sampleCopy).length, 1)
    })
  })

  describe('loading existing data', () => {
    it('loads valid stored data unchanged, including fields it does not know about', async () => {
      const seeded = {
        version: 2,
        futureTopLevel: { a: 1 },
        projects: [goodProject({ futureField: { a: 1 } })],
        reports: [goodReport({ futureField: 'kept' })],
        statusHistory: [],
      }
      const { state } = await loadedState(makeStorage({ [KEY]: JSON.stringify(seeded) }))
      assert.deepEqual(state, seeded)
    })

    it('loads older records that lack newer optional fields (no demo flag, empty description)', async () => {
      const legacy = { version: 2, projects: [goodProject({ id: 'legacy', description: '', owner: 'Old Owner' })], reports: [], statusHistory: [] }
      const { state } = await loadedState(makeStorage({ [KEY]: JSON.stringify(legacy) }))
      assert.deepEqual(state, legacy)
    })

    it('starts empty (current version) when nothing has been stored, with no warning and no backup', async () => {
      const storage = makeStorage()
      const store = await loadStore(storage)
      store.actions.deleteReport(NOOP)
      assert.deepEqual(readPersisted(storage), EMPTY)
      assert.equal(store.getPersistence().notice, null)
      assert.equal(storage.data.has(SET_ASIDE_KEY), false)
    })

    it('treats an empty stored string as "nothing stored", not as corruption', async () => {
      const storage = makeStorage({ [KEY]: '' })
      const store = await loadStore(storage)
      assert.equal(store.getPersistence().notice, null)
      assert.equal(storage.data.has(SET_ASIDE_KEY), false)
    })

    it('does not warn, set anything aside or rewrite anything when all data is valid', async () => {
      const storage = makeStorage({ [KEY]: seed([goodProject()], [goodReport()]) })
      const store = await loadStore(storage)
      assert.deepEqual(store.getPersistence(), { ok: true, reason: null, notice: null })
      assert.deepEqual(storage.writes, [])
    })
  })

  describe('stored data that cannot be read at all (invalid JSON or the wrong shape)', () => {
    it('does not crash, starts from an empty workspace, and says that data was set aside', async () => {
      const storage = makeStorage({ [KEY]: '{this is not json' })
      const { state, store } = await loadedState(storage)
      assert.deepEqual(state, EMPTY)
      assert.deepEqual(store.getPersistence().notice, { unreadable: true, projects: 0, reports: 0 })
    })

    it('keeps the unreadable text, byte for byte, instead of destroying it', async () => {
      const raw = '{"projects":[{"id":"precious"'
      const storage = makeStorage({ [KEY]: raw })
      await loadedState(storage)
      assert.equal(storage.data.get(SET_ASIDE_KEY), raw)
    })

    for (const [name, raw] of [
      ['null', 'null'],
      ['a string', '"hello"'],
      ['a number', '42'],
      ['an array', '[]'],
      ['an empty object', '{}'],
      ['projects that are not a list', '{"projects":{},"reports":[]}'],
      ['reports that are not a list', '{"projects":[],"reports":"x"}'],
    ]) {
      it(`falls back to an empty workspace, and sets the data aside, when the stored value is ${name}`, async () => {
        const storage = makeStorage({ [KEY]: raw })
        const { state } = await loadedState(storage)
        assert.deepEqual(state, EMPTY)
        assert.equal(storage.data.get(SET_ASIDE_KEY), raw)
      })
    }

    it('lets the app carry on normally afterwards, writing valid data while the old text stays set aside', async () => {
      const storage = makeStorage({ [KEY]: '{corrupt' })
      const store = await loadStore(storage)
      store.actions.createProject(projectInput({ name: 'Fresh start' }))
      assert.equal(readPersisted(storage).projects[0].name, 'Fresh start')
      assert.equal(storage.data.get(SET_ASIDE_KEY), '{corrupt')
      assert.equal(store.getPersistence().ok, true)
    })

    it('stops writing, and leaves the stored data untouched, if it cannot be backed up first', async () => {
      const storage = makeStorage({ [KEY]: '{corrupt' }, { failSet: [SET_ASIDE_KEY] })
      const store = await loadStore(storage)
      assert.deepEqual(store.getPersistence(), { ok: false, reason: 'cannot-preserve', notice: { unreadable: true, projects: 0, reports: 0 } })
      assert.doesNotThrow(() => store.actions.createProject(projectInput()))
      assert.equal(storage.data.get(KEY), '{corrupt', 'the original must not be overwritten')
      assert.deepEqual(storage.writes, [])
    })
  })

  describe('an existing backup is never overwritten', () => {
    const OLD_BACKUP = '{"projects":[{"id":"from-the-first-incident"'
    const NEW_CORRUPT = '{"projects":[{"id":"from-the-second-incident"'
    const warnedNotice = { unreadable: true, projects: 0, reports: 0 }

    it('keeps the earlier backup untouched when a new corruption incident occurs', async () => {
      const storage = makeStorage({ [KEY]: NEW_CORRUPT, [SET_ASIDE_KEY]: OLD_BACKUP })
      await loadStore(storage)
      assert.equal(storage.data.get(SET_ASIDE_KEY), OLD_BACKUP)
    })

    it('stops writing, and leaves the newly unreadable data exactly where it is', async () => {
      const storage = makeStorage({ [KEY]: NEW_CORRUPT, [SET_ASIDE_KEY]: OLD_BACKUP })
      const store = await loadStore(storage)
      store.actions.createProject(projectInput())
      store.actions.loadDemo()
      store.actions.resetDemo()
      assert.equal(storage.data.get(KEY), NEW_CORRUPT, 'the new unreadable data must not be replaced')
      assert.equal(storage.data.get(SET_ASIDE_KEY), OLD_BACKUP)
      assert.deepEqual(storage.writes, [], 'nothing at all should have been written')
    })

    it('tells the user the new data could not be backed up safely (its own reason, not a generic one)', async () => {
      const storage = makeStorage({ [KEY]: NEW_CORRUPT, [SET_ASIDE_KEY]: OLD_BACKUP })
      const store = await loadStore(storage)
      assert.deepEqual(store.getPersistence(), { ok: false, reason: 'backup-exists', notice: warnedNotice })
    })

    it('keeps the app usable for the session, without pretending anything is saved', async () => {
      const storage = makeStorage({ [KEY]: NEW_CORRUPT, [SET_ASIDE_KEY]: OLD_BACKUP })
      const store = await loadStore(storage)
      assert.doesNotThrow(() => store.actions.createProject(projectInput()))
      assert.equal(store.getPersistence().ok, false)
    })

    it('does not write when asked to retry', async () => {
      const storage = makeStorage({ [KEY]: NEW_CORRUPT, [SET_ASIDE_KEY]: OLD_BACKUP })
      const store = await loadStore(storage)
      store.actions.createProject(projectInput())
      assert.equal(store.actions.retrySave().ok, false)
      assert.deepEqual(storage.writes, [])
    })

    it('protects the backup in the "invalid records dropped" case too, not only for unreadable text', async () => {
      const mixed = seed([null, goodProject()], [{ id: 'broken' }, goodReport()])
      const storage = makeStorage({ [KEY]: mixed, [SET_ASIDE_KEY]: OLD_BACKUP })
      const store = await loadStore(storage)
      assert.deepEqual(store.getPersistence(), { ok: false, reason: 'backup-exists', notice: { unreadable: false, projects: 1, reports: 1 } })
      store.actions.createProject(projectInput())
      assert.equal(storage.data.get(KEY), mixed, 'the original, with its invalid records, must not be rewritten')
      assert.equal(storage.data.get(SET_ASIDE_KEY), OLD_BACKUP)
      assert.deepEqual(storage.writes, [])
    })

    it('protects the backup when the stored value has the wrong overall shape', async () => {
      const storage = makeStorage({ [KEY]: '{"projects":{},"reports":[]}', [SET_ASIDE_KEY]: OLD_BACKUP })
      const store = await loadStore(storage)
      store.actions.createProject(projectInput())
      assert.equal(store.getPersistence().reason, 'backup-exists')
      assert.equal(storage.data.get(SET_ASIDE_KEY), OLD_BACKUP)
      assert.equal(storage.data.get(KEY), '{"projects":{},"reports":[]}')
    })

    it('end to end: two separate incidents keep BOTH the first backup and the second incident\'s data', async () => {
      const storage = makeStorage({ [KEY]: OLD_BACKUP })
      const first = await loadStore(storage) // incident 1: backed up, then the app starts afresh
      assert.equal(storage.data.get(SET_ASIDE_KEY), OLD_BACKUP)
      first.actions.createProject(projectInput({ name: 'Work done after incident 1' }))
      assert.equal(first.getPersistence().ok, true)

      storage.data.set(KEY, NEW_CORRUPT) // incident 2: the stored data is damaged again
      const second = await loadStore(storage)
      assert.equal(second.getPersistence().reason, 'backup-exists')
      second.actions.createProject(projectInput({ name: 'Must not be saved' }))
      assert.equal(storage.data.get(SET_ASIDE_KEY), OLD_BACKUP, 'the first backup survived incident 2')
      assert.equal(storage.data.get(KEY), NEW_CORRUPT, 'the second incident\'s data survived too')
    })

    it('stays safe across repeated reloads: still blocked, still nothing written', async () => {
      const storage = makeStorage({ [KEY]: NEW_CORRUPT, [SET_ASIDE_KEY]: OLD_BACKUP })
      for (let i = 0; i < 3; i++) {
        const store = await loadStore(storage)
        store.actions.createProject(projectInput())
        assert.equal(store.getPersistence().reason, 'backup-exists')
      }
      assert.deepEqual(storage.writes, [])
      assert.equal(storage.data.get(KEY), NEW_CORRUPT)
      assert.equal(storage.data.get(SET_ASIDE_KEY), OLD_BACKUP)
    })

    it('assumes a backup exists if it cannot be checked, and writes nothing', async () => {
      const storage = makeStorage({ [KEY]: NEW_CORRUPT, [SET_ASIDE_KEY]: OLD_BACKUP }, { failGet: [SET_ASIDE_KEY] })
      const store = await loadStore(storage)
      store.actions.createProject(projectInput())
      assert.equal(store.getPersistence().reason, 'cannot-preserve')
      assert.deepEqual(storage.writes, [])
      assert.equal(storage.data.get(KEY), NEW_CORRUPT)
      assert.equal(storage.data.get(SET_ASIDE_KEY), OLD_BACKUP)
    })

    it('carries on normally when the same data is already backed up (nothing to protect)', async () => {
      const storage = makeStorage({ [KEY]: OLD_BACKUP, [SET_ASIDE_KEY]: OLD_BACKUP })
      const store = await loadStore(storage)
      assert.equal(store.getPersistence().ok, true)
      store.actions.createProject(projectInput({ name: 'Saved normally' }))
      assert.equal(readPersisted(storage).projects[0].name, 'Saved normally')
      assert.equal(storage.data.get(SET_ASIDE_KEY), OLD_BACKUP, 'the identical backup is left exactly as it was')
      assert.ok(!storage.writes.includes(SET_ASIDE_KEY), 'no pointless rewrite of the backup')
    })

    it('treats an empty backup slot as no backup', async () => {
      const storage = makeStorage({ [KEY]: NEW_CORRUPT, [SET_ASIDE_KEY]: '' })
      const store = await loadStore(storage)
      assert.equal(store.getPersistence().ok, true)
      assert.equal(storage.data.get(SET_ASIDE_KEY), NEW_CORRUPT)
    })

    it('never touches an existing backup during normal use of healthy data', async () => {
      const storage = makeStorage({ [KEY]: seed([goodProject()], [goodReport()]), [SET_ASIDE_KEY]: OLD_BACKUP })
      const store = await loadStore(storage)
      assert.equal(store.getPersistence().ok, true)
      store.actions.createProject(projectInput())
      store.actions.addReport(reportInput('p-good'))
      store.actions.loadDemo()
      store.actions.resetDemo()
      assert.equal(storage.data.get(SET_ASIDE_KEY), OLD_BACKUP)
      assert.ok(!storage.writes.includes(SET_ASIDE_KEY))
    })

    it('still backs up a first incident normally when no backup exists yet', async () => {
      const storage = makeStorage({ [KEY]: NEW_CORRUPT })
      const store = await loadStore(storage)
      assert.deepEqual(store.getPersistence(), { ok: true, reason: null, notice: warnedNotice })
      assert.equal(storage.data.get(SET_ASIDE_KEY), NEW_CORRUPT)
    })
  })

  describe('malformed records inside an otherwise valid list', () => {
    const badProjects = [
      ['null', null],
      ['a number', 7],
      ['a string', 'oops'],
      ['a list', [1, 2]],
      ['an empty object', {}],
      ['a project with no id', { name: 'No id', startDate: '2026-01-01' }],
      ['a project with an empty id', { id: '', name: 'Empty id', startDate: '2026-01-01' }],
      ['a project whose name is not text', { id: 'x1', name: 42, startDate: '2026-01-01' }],
      ['a project with no start date', { id: 'x2', name: 'No start' }],
      ['a project whose description is not text', { id: 'x3', name: 'Bad desc', startDate: '2026-01-01', description: { a: 1 } }],
    ]
    const badReports = [
      ['null', null],
      ['a number', 7],
      ['a report with no id', goodReport({ id: undefined })],
      ['a report with no project', goodReport({ id: 'x1', projectId: undefined })],
      ['a report with no save date', goodReport({ id: 'x2', savedAt: undefined })],
      ['a report whose original AI output is not valid content', goodReport({ id: 'x2b', generatedContent: { risks: 'one big string' } })],
      ['a report with no content', goodReport({ id: 'x3', content: null })],
      ['a report whose content is a list', goodReport({ id: 'x4', content: [] })],
      ['a report whose summary is not text', goodReport({ id: 'x5', content: content({ executiveSummary: 12 }) })],
      ['a report with a section that is not a list', goodReport({ id: 'x6', content: content({ risks: 'one big string' }) })],
      ['a report with non-text items in a section', goodReport({ id: 'x7', content: content({ blockers: [{ oops: true }] }) })],
      ['a report whose period is not text', goodReport({ id: 'x8', periodStart: 20261001 })],
    ]

    for (const [name, bad] of badProjects) {
      it(`skips ${name} in the projects list and keeps the valid project exactly as it was`, async () => {
        const storage = makeStorage({ [KEY]: seed([bad, goodProject()], []) })
        const { state } = await loadedState(storage)
        assert.deepEqual(state.projects, [goodProject()])
      })
    }
    for (const [name, bad] of badReports) {
      it(`skips ${name} in the reports list and keeps the valid report exactly as it was`, async () => {
        const storage = makeStorage({ [KEY]: seed([goodProject()], [bad, goodReport()]) })
        const { state } = await loadedState(storage)
        assert.deepEqual(state.reports, [goodReport()])
      })
    }

    it('leaves every valid record byte-for-byte intact while dropping the invalid ones', async () => {
      const p2 = goodProject({ id: 'p2', name: 'Second' })
      const r2 = goodReport({ id: 'r2', projectId: 'p2', originalUpdate: 'second raw notes' })
      const storage = makeStorage({ [KEY]: seed([null, goodProject(), { id: 'bad' }, p2], [goodReport(), 5, r2]) })
      const { state } = await loadedState(storage)
      assert.deepEqual(state.projects, [goodProject(), p2])
      assert.deepEqual(state.reports, [goodReport(), r2])
    })

    it('keeps the first record when an id appears twice, so lists never have clashing ids', async () => {
      const storage = makeStorage({ [KEY]: seed([goodProject({ name: 'First' }), goodProject({ name: 'Second' })], [goodReport({ title: 'First' }), goodReport({ title: 'Second' })]) })
      const { state } = await loadedState(storage)
      assert.deepEqual(state.projects.map((p) => p.name), ['First'])
      assert.deepEqual(state.reports.map((r) => r.title), ['First'])
    })

    it('keeps a report whose project is missing: that is not malformed, the UI shows "Unknown project"', async () => {
      const storage = makeStorage({ [KEY]: seed([], [goodReport({ projectId: 'gone' })]) })
      const { state } = await loadedState(storage)
      assert.equal(state.reports.length, 1)
    })

    it('tells the user how many records were set aside, and keeps the full original text', async () => {
      const raw = seed([null, goodProject(), 3], [goodReport(), { id: 'broken' }])
      const storage = makeStorage({ [KEY]: raw })
      const store = await loadStore(storage)
      assert.deepEqual(store.getPersistence().notice, { unreadable: false, projects: 2, reports: 1 })
      assert.equal(storage.data.get(SET_ASIDE_KEY), raw, 'nothing was destroyed: the invalid records are still in the set-aside copy')
    })

    it('preserves unknown top-level fields alongside the salvaged lists', async () => {
      const storage = makeStorage({ [KEY]: seed([null, goodProject()], [], { settings: { theme: 'x' } }) })
      const { state } = await loadedState(storage)
      assert.deepEqual(state.settings, { theme: 'x' })
    })

    it('never leaves anything that would crash the screens: every kept record renders safely', async () => {
      const storage = makeStorage({ [KEY]: seed([...badProjects.map(([, b]) => b), goodProject()], [...badReports.map(([, b]) => b), goodReport()]) })
      const { state } = await loadedState(storage)
      for (const p of state.projects) assert.equal(typeof p.name, 'string')
      for (const r of state.reports) {
        for (const s of SECTIONS) assert.doesNotThrow(() => itemsOf(r.content, s), `${r.id}.${s.key}`)
        assert.doesNotThrow(() => reportToText(r.content, { periodStart: r.periodStart, periodEnd: r.periodEnd }))
      }
    })

    it('keeps every action working on the salvaged data', async () => {
      const storage = makeStorage({ [KEY]: seed([null, goodProject()], [{ id: 'x' }, goodReport()]) })
      const store = await loadStore(storage)
      assert.doesNotThrow(() => {
        store.actions.createProject(projectInput({ name: 'New' }))
        store.actions.addReport(reportInput('p-good'))
        store.actions.updateReportContent('r-good', content({ title: 'Edited' }))
        store.actions.setProjectStatus('p-good', 'Blocked')
        store.actions.loadDemo()
        store.actions.resetDemo()
      })
      const s = readPersisted(storage)
      assert.ok(s.projects.some((p) => p.id === 'p-good' && p.status === 'Blocked'))
      assert.equal(s.reports.find((r) => r.id === 'r-good').title, 'Edited')
    })
  })

  describe('storage that cannot be read', () => {
    const raw = seed([goodProject({ name: 'Precious existing data' })], [goodReport()])
    let storage, store
    beforeEach(async () => {
      storage = makeStorage({ [KEY]: raw }, { failGet: true })
      store = await loadStore(storage)
    })

    it('says so, and does not pretend things are saved', () => {
      assert.deepEqual(store.getPersistence(), { ok: false, reason: 'read-blocked', notice: null })
    })

    it('never overwrites the existing stored data, however many changes are made', () => {
      store.actions.createProject(projectInput({ name: 'New' }))
      store.actions.addReport(reportInput('p-good'))
      store.actions.loadDemo()
      store.actions.resetDemo()
      assert.equal(storage.data.get(KEY), raw, 'the unreadable data must be exactly as it was')
      assert.deepEqual(storage.writes, [], 'nothing at all should have been written')
    })

    it('keeps the app usable for the session instead of throwing', () => {
      assert.doesNotThrow(() => store.actions.createProject(projectInput()))
      assert.equal(store.getPersistence().ok, false)
    })

    it('does not write when asked to retry either', () => {
      store.actions.createProject(projectInput())
      store.actions.retrySave()
      assert.deepEqual(storage.writes, [])
      assert.equal(storage.data.get(KEY), raw)
    })

    it('does not set anything aside either (there is nothing it could read)', () => {
      assert.equal(storage.data.has(SET_ASIDE_KEY), false)
    })
  })

  describe('failed saves are reported accurately', () => {
    let storage, store, warn
    beforeEach(async () => {
      storage = makeStorage()
      store = await loadStore(storage)
      warn = mock.method(console, 'warn', () => {})
    })
    afterEach(() => warn.mock.restore())

    it('flags the failure immediately instead of looking successful', () => {
      assert.equal(store.getPersistence().ok, true)
      storage.failSet = true
      store.actions.createProject(projectInput({ name: 'Might be lost' }))
      assert.deepEqual(store.getPersistence(), { ok: false, reason: 'write-failed', notice: null })
    })

    it('does not crash the app, and still logs the failure for developers', () => {
      storage.failSet = true
      assert.doesNotThrow(() => store.actions.createProject(projectInput()))
      assert.equal(warn.mock.callCount(), 1)
      assert.match(String(warn.mock.calls[0].arguments[0]), /persist/i)
    })

    it('really stored nothing while it was failing', () => {
      storage.failSet = true
      store.actions.createProject(projectInput())
      assert.equal(storage.data.has(KEY), false)
    })

    const everyAction = [
      ['createProject', (s) => s.actions.createProject(projectInput())],
      ['updateProject', (s, ids) => s.actions.updateProject(ids.p, projectInput({ name: 'Renamed' }))],
      ['setProjectStatus', (s, ids) => s.actions.setProjectStatus(ids.p, 'Blocked')],
      ['addReport', (s, ids) => s.actions.addReport(reportInput(ids.p))],
      ['updateReportContent', (s, ids) => s.actions.updateReportContent(ids.r, content({ title: 'Edited' }))],
      ['deleteReport', (s, ids) => s.actions.deleteReport(ids.r)],
      ['loadDemo', (s) => s.actions.loadDemo()],
      ['saveSampleCopy', (s, ids) => s.actions.saveSampleCopy({ projectId: ids.p, content: content(), originalUpdate: 'x', periodStart: '2026-11-01', periodEnd: '2026-11-07', copiedFrom: 'sample' })],
      ['resetDemo', (s) => s.actions.resetDemo()],
    ]
    for (const [name, run] of everyAction) {
      it(`${name} is reported as not saved when the write fails`, () => {
        const p = store.actions.createProject(projectInput())
        const r = store.actions.addReport(reportInput(p.id))
        assert.equal(store.getPersistence().ok, true)
        storage.failSet = true
        run(store, { p: p.id, r: r.id })
        assert.equal(store.getPersistence().ok, false, `${name} looked successful although nothing was saved`)
      })
    }

    it('recovers: a later successful write saves everything that was made while saving was failing', () => {
      storage.failSet = true
      const a = store.actions.createProject(projectInput({ name: 'Made while failing' }))
      store.actions.addReport(reportInput(a.id, { originalUpdate: 'notes written while failing' }))
      assert.equal(store.getPersistence().ok, false)

      storage.failSet = false // the browser has space again
      store.actions.createProject(projectInput({ name: 'Made after recovery' }))
      assert.deepEqual(store.getPersistence(), { ok: true, reason: null, notice: null })
      const s = readPersisted(storage)
      assert.deepEqual(s.projects.map((p) => p.name).sort(), ['Made after recovery', 'Made while failing'])
      assert.equal(s.reports[0].originalUpdate, 'notes written while failing')
    })

    it('"Try saving again" persists what is on screen once storage works, and is honest while it does not', () => {
      storage.failSet = true
      store.actions.createProject(projectInput({ name: 'Keep me' }))
      assert.equal(store.actions.retrySave().ok, false)
      assert.equal(storage.data.has(KEY), false)

      storage.failSet = false
      assert.equal(store.actions.retrySave().ok, true)
      assert.equal(readPersisted(storage).projects[0].name, 'Keep me')
    })
  })

  describe('isolation', () => {
    it('never uses the real browser storage: each test gets its own, and other keys are untouched', async () => {
      const storage = makeStorage({ unrelated: 'value' })
      const store = await loadStore(storage)
      store.actions.createProject(projectInput())
      assert.equal(storage.getItem('unrelated'), 'value')
      assert.deepEqual([...storage.data.keys()].sort(), [KEY, 'unrelated'].sort())
    })

    it('two separate storages do not leak into each other', async () => {
      const a = makeStorage()
      const b = makeStorage()
      const storeA = await loadStore(a)
      storeA.actions.createProject(projectInput({ name: 'only in A' }))
      await loadStore(b)
      assert.equal(b.getItem(KEY), null)
    })
  })
})
