import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { makeStorage, loadStore, releaseStorage, readPersisted, KEY } from './helpers/storage.mjs'
import { projectInput, reportInput } from './helpers/fixtures.mjs'
import { buildDemo } from '../src/demo.js'
import { activityEvents } from '../src/dashboard.js'
import { DEMO_ACTIVITY_KINDS, validDemoActivity } from '../src/schema.js'

// "Load Demo Workspace" fills Recent Activity with sample entries. They are flagged demo, point at demo projects and
// reports that really exist, are added once, and are removed with the demo workspace. Real activity is never touched.

const TITLES = ['New project created', 'Project details updated', 'Project status updated', 'New report generated', 'Report saved', 'Saved report edited']
const NOW = new Date('2026-11-10T12:00:00.000Z')

describe('the sample activity the demo builds', () => {
  const demo = buildDemo(NOW)

  it('has at least six entries, covering every kind of event', () => {
    assert.ok(demo.activity.length >= 6)
    const kinds = new Set(demo.activity.map((a) => a.kind))
    for (const k of DEMO_ACTIVITY_KINDS) assert.ok(kinds.has(k), k)
  })

  it('flags every entry as demo, with a fixed unique id and a valid shape', () => {
    assert.ok(demo.activity.every((a) => a.demo === true && validDemoActivity(a)))
    assert.equal(new Set(demo.activity.map((a) => a.id)).size, demo.activity.length)
    assert.ok(demo.activity.every((a) => /^demo-a-\d+$/.test(a.id)))
  })

  it('points only at demo projects and reports that the same build creates', () => {
    const projects = new Set(demo.projects.map((p) => p.id))
    const reports = new Map(demo.reports.map((r) => [r.id, r]))
    for (const a of demo.activity) {
      assert.ok(projects.has(a.projectId), a.id)
      if (a.reportId) assert.equal(reports.get(a.reportId)?.projectId, a.projectId, `${a.id}: the report belongs to that project`)
    }
    assert.ok(demo.activity.filter((a) => a.kind.startsWith('report')).every((a) => a.reportId))
  })

  it('uses realistic times: in the past, spread out, never in the future', () => {
    const times = demo.activity.map((a) => Date.parse(a.at))
    assert.ok(times.every((t) => t < NOW.getTime() && t > NOW.getTime() - 4 * 86_400_000))
    assert.ok(new Set(times).size === times.length)
  })

  it('a status entry names the project\'s real current status', () => {
    const e = demo.activity.find((a) => a.kind === 'status-updated')
    assert.equal(e.status, demo.projects.find((p) => p.id === e.projectId).status)
  })

  it('the six newest entries show all six kinds (generated just before saved)', () => {
    const newest = [...demo.activity].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 6)
    assert.deepEqual([...new Set(newest.map((a) => a.kind))].sort(), [...DEMO_ACTIVITY_KINDS].sort())
    const gen = demo.activity.find((a) => a.kind === 'report-generated')
    const saved = demo.activity.find((a) => a.kind === 'report-saved' && a.reportId === gen.reportId)
    assert.ok(Date.parse(gen.at) < Date.parse(saved.at))
  })
})

describe('Load Demo Workspace and Recent Activity', () => {
  let storage, store
  beforeEach(async () => {
    storage = makeStorage()
    store = await loadStore(storage)
  })
  afterEach(() => {
    mock.timers.reset()
    releaseStorage()
  })
  const persisted = () => readPersisted(storage)
  const events = (n = 50) => activityEvents(persisted(), n)

  it('adds the sample entries, stores them, and shows at least six, newest first', () => {
    store.actions.loadDemo()
    assert.ok(persisted().demoActivity.length >= 6)
    const shown = events(6)
    assert.equal(shown.length, 6)
    assert.ok(shown.every((e) => e.demo === true))
    for (const t of TITLES) assert.ok(shown.some((e) => e.title === t), t)
    const times = shown.map((e) => Date.parse(e.at))
    assert.deepEqual([...times].sort((a, b) => b - a), times)
  })

  it('the entries read from the real demo records (names, links)', () => {
    store.actions.loadDemo()
    const s = persisted()
    const names = new Set(s.projects.map((p) => p.name))
    for (const e of events()) {
      assert.ok([...names].some((n) => e.detail.includes(n)), e.detail)
      assert.match(e.href, /^#\/(projects|reports)\/demo-/)
    }
    const saved = events().find((e) => e.title === 'Report saved')
    assert.ok(s.reports.some((r) => saved.detail.startsWith(r.title)))
  })

  it('does NOT add duplicates when the demo is loaded again and again', () => {
    store.actions.loadDemo()
    const first = structuredClone(persisted().demoActivity)
    store.actions.loadDemo()
    store.actions.loadDemo()
    assert.deepEqual(persisted().demoActivity, first)
    assert.equal(new Set(persisted().demoActivity.map((a) => a.id)).size, first.length)
    assert.equal(events().filter((e) => e.demo).length, first.length)
  })

  it('survives a reload', async () => {
    store.actions.loadDemo()
    const before = structuredClone(persisted().demoActivity)
    releaseStorage()
    const reloaded = await loadStore(storage)
    reloaded.actions.deleteReport('__no-such-report__') // re-saves what the reloaded store holds
    assert.deepEqual(persisted().demoActivity, before)
    assert.equal(storage.data.has('statusai.v1.set-aside'), false)
  })

  it('Reset Demo Workspace removes every sample entry', () => {
    store.actions.loadDemo()
    store.actions.resetDemo()
    assert.deepEqual(persisted().demoActivity, [])
    assert.deepEqual(events(), [])
  })

  it('real activity is never touched by building or clearing the demo', () => {
    mock.timers.enable({ apis: ['Date'], now: new Date() })
    const p = store.actions.createProject(projectInput({ name: 'My Real Project' }))
    mock.timers.tick(60_000)
    store.actions.setProjectStatus(p.id, 'At Risk')
    mock.timers.tick(60_000)
    store.actions.addReport(reportInput(p.id, { title: 'My real report', projectStatusAtReport: 'At Risk', generatedAt: new Date(Date.now() - 30_000).toISOString() }))
    const real = events().filter((e) => !e.demo)
    assert.ok(real.length >= 4)

    store.actions.loadDemo()
    assert.deepEqual(events().filter((e) => !e.demo), real) // the same real events, unchanged
    assert.ok(events().some((e) => e.demo))
    // real activity comes first when it is newer than the samples
    assert.equal(events(1)[0].demo, undefined)

    store.actions.resetDemo()
    assert.deepEqual(events(), real) // only the real events remain, exactly as before
    assert.equal(persisted().projects.length, 1)
  })

  it('Recent Activity keeps working for real actions after the demo is cleared', () => {
    store.actions.loadDemo()
    store.actions.resetDemo()
    const p = store.actions.createProject(projectInput({ name: 'After the demo' }))
    store.actions.updateProject(p.id, projectInput({ name: 'After the demo, renamed' }))
    const titles = events().map((e) => e.title)
    assert.ok(titles.includes('New project created'))
    assert.ok(titles.includes('Project details updated'))
    assert.ok(events().every((e) => !e.demo))
  })

  it('a demo project that holds one of the user\'s own reports is kept, but its sample activity still goes', () => {
    store.actions.loadDemo()
    const demoProject = persisted().projects.find((p) => p.demo)
    store.actions.addReport(reportInput(demoProject.id, { title: 'Real report on a demo project', projectStatusAtReport: 'On Track' }))
    store.actions.resetDemo()
    assert.ok(persisted().projects.some((p) => p.id === demoProject.id))
    assert.deepEqual(persisted().demoActivity, [])
    assert.ok(events().every((e) => !e.demo))
  })

  it('an entry whose demo report was deleted disappears, and nothing else breaks', () => {
    store.actions.loadDemo()
    const gen = persisted().demoActivity.find((a) => a.kind === 'report-generated')
    const before = events().filter((e) => e.demo).length
    store.actions.deleteReport(gen.reportId)
    const after = events().filter((e) => e.demo)
    assert.ok(after.length < before)
    assert.ok(after.every((e) => e.href && !e.href.includes(gen.reportId)))
  })

  it('loading the demo into data that already has some of its records adds only what is missing', () => {
    store.actions.loadDemo()
    store.actions.deleteReport(persisted().reports.find((r) => r.demo).id)
    store.actions.loadDemo()
    const ids = persisted().demoActivity.map((a) => a.id)
    assert.equal(new Set(ids).size, ids.length)
  })

  it('invents no integration, Slack or sync activity (only the six real kinds of event appear)', () => {
    store.actions.loadDemo()
    for (const e of events()) {
      assert.ok(TITLES.includes(e.title), e.title)
      assert.doesNotMatch(e.title, /slack|sync|integration|teams/i)
    }
  })
})

describe('stored sample activity is validated when loaded', () => {
  afterEach(() => releaseStorage())
  const good = { id: 'demo-a-01', kind: 'project-created', at: '2026-11-09T09:00:00.000Z', projectId: 'demo-p-01', reportId: null, status: null, demo: true }

  it('keeps valid entries, drops invalid and duplicate ones, and says so', async () => {
    const data = {
      version: 2, projects: [], reports: [], statusHistory: [],
      demoActivity: [good, { ...good }, { ...good, id: 'x', kind: 'slack-sync' }, { ...good, id: 'y', demo: false }, { ...good, id: 'z', at: 'yesterday' }, 'nope', null],
    }
    const storage = makeStorage({ [KEY]: JSON.stringify(data) })
    const store = await loadStore(storage)
    store.actions.deleteReport('__no-such-report__')
    assert.deepEqual(readPersisted(storage).demoActivity, [good])
    assert.ok(storage.data.has('statusai.v1.set-aside'), 'the original was set aside, not deleted')
    assert.equal(store.getPersistence().notice.demoActivity, 6)
  })

  it('data saved before this feature (no demoActivity) loads with its shape unchanged', async () => {
    const data = { version: 2, projects: [], reports: [], statusHistory: [] }
    const storage = makeStorage({ [KEY]: JSON.stringify(data) })
    const store = await loadStore(storage)
    store.actions.deleteReport('__no-such-report__')
    assert.equal('demoActivity' in readPersisted(storage), false)
    assert.equal(storage.data.has('statusai.v1.set-aside'), false)
  })
})

describe('real events added for the dashboard', () => {
  let storage, store
  beforeEach(async () => {
    storage = makeStorage()
    store = await loadStore(storage)
    mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-10T09:00:00.000Z') })
  })
  afterEach(() => {
    mock.timers.reset()
    releaseStorage()
  })
  const events = () => activityEvents(readPersisted(storage), 50)

  it('editing a project\'s details records "Project details updated"; saving it unchanged records nothing', () => {
    const p = store.actions.createProject(projectInput({ name: 'Alpha' }))
    mock.timers.tick(60_000)
    store.actions.updateProject(p.id, projectInput({ name: 'Alpha' })) // identical
    assert.ok(!events().some((e) => e.title === 'Project details updated'))
    assert.equal('updatedAt' in readPersisted(storage).projects[0], false)
    mock.timers.tick(60_000)
    store.actions.updateProject(p.id, projectInput({ name: 'Alpha Two' }))
    const e = events().find((x) => x.title === 'Project details updated')
    assert.equal(e.detail, 'Alpha Two')
    assert.equal(e.at, '2026-11-10T09:02:00.000Z')
    assert.equal(e.href, `#/projects/${p.id}`)
  })

  it('a report whose generation time is known gives two events, generated then saved', () => {
    const p = store.actions.createProject(projectInput({ name: 'Alpha' }))
    mock.timers.tick(5 * 60_000)
    store.actions.addReport(reportInput(p.id, { title: 'Weekly', projectStatusAtReport: 'On Track', generatedAt: '2026-11-10T09:03:00.000Z' }))
    const gen = events().find((e) => e.title === 'New report generated')
    const saved = events().find((e) => e.title === 'Report saved')
    assert.equal(gen.at, '2026-11-10T09:03:00.000Z')
    assert.equal(saved.at, '2026-11-10T09:05:00.000Z')
    assert.equal(saved.detail, 'Weekly · Alpha')
    assert.ok(Date.parse(gen.at) < Date.parse(saved.at))
  })

  it('an older report with no generation time stays a single event, as before', () => {
    const p = store.actions.createProject(projectInput({ name: 'Alpha' }))
    mock.timers.tick(60_000)
    store.actions.addReport(reportInput(p.id, { projectStatusAtReport: 'On Track', generatedAt: null }))
    assert.equal(events().filter((e) => e.title === 'New report generated').length, 1)
    assert.equal(events().filter((e) => e.title === 'Report saved').length, 0)
  })

  it('real events are never labelled demo', () => {
    const p = store.actions.createProject(projectInput())
    store.actions.addReport(reportInput(p.id, { projectStatusAtReport: 'On Track' }))
    assert.ok(events().length >= 2)
    assert.ok(events().every((e) => e.demo === undefined))
  })
})
