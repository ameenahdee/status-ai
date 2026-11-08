import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  CURRENT_VERSION, STATUS_CHANGE_SOURCES, PROVENANCE, emptyState, storedVersion, isIsoDay, isIsoTimestamp,
  validContent, validReportV1, validReportV2, validHistoryEntry, migrateReport, migrationHistoryFor, migrateV1toV2,
} from '../src/schema.js'
import { content, v1Project, v1Report } from './helpers/fixtures.mjs'

describe('schema constants', () => {
  it('is version 2, and starts with an empty status history', () => {
    assert.equal(CURRENT_VERSION, 2)
    assert.deepEqual(emptyState(), { version: 2, projects: [], reports: [], statusHistory: [] })
  })

  it('only accepts confirmed status-change sources: an AI recommendation is not one', () => {
    assert.deepEqual(STATUS_CHANGE_SOURCES, ['manual', 'report', 'ai-confirmed'])
    for (const notASource of ['ai-recommended', 'ai', 'recommendation', 'system']) assert.ok(!STATUS_CHANGE_SOURCES.includes(notASource))
  })

  it('distinguishes how a historical value is known, so "unknown" is never confused with "none"', () => {
    assert.deepEqual(PROVENANCE, ['recorded', 'recovered', 'unknown', 'not-applicable'])
  })
})

describe('storedVersion', () => {
  it('reads a valid version, and treats anything missing or malformed as the original version 1', () => {
    assert.equal(storedVersion({ version: 2 }), 2)
    assert.equal(storedVersion({ version: 1 }), 1)
    assert.equal(storedVersion({ version: 7 }), 7)
    for (const bad of [undefined, null, '2', 0, -3, 1.5, NaN, {}, []]) assert.equal(storedVersion({ version: bad }), 1, String(bad))
    assert.equal(storedVersion({}), 1)
    assert.equal(storedVersion(null), 1)
  })
})

describe('date checks', () => {
  it('accepts real ISO days and timestamps only', () => {
    assert.ok(isIsoDay('2026-11-07'))
    for (const bad of ['', '2026-1-1', '2026-13-01', 'yesterday', 20261107, null, undefined]) assert.equal(isIsoDay(bad), false, String(bad))
    assert.ok(isIsoTimestamp('2026-11-07T10:00:00.000Z'))
    for (const bad of ['', 'soon', 5, null]) assert.equal(isIsoTimestamp(bad), false, String(bad))
  })
})

describe('structural validators', () => {
  const v2 = (over = {}) => ({
    id: 'r', projectId: 'p', savedAt: '2026-01-02T00:00:00.000Z', generatedAt: null, generatedContent: null, content: content(), ...over,
  })

  it('version 1 reports need a generatedAt; version 2 reports need a savedAt instead', () => {
    assert.equal(validReportV1(v1Report()), true)
    assert.equal(validReportV1(v1Report({ generatedAt: undefined })), false)
    assert.equal(validReportV2(v2()), true)
    assert.equal(validReportV2(v2({ savedAt: undefined })), false)
  })

  it('version 2 allows a null generation time and a null original AI output, but not a malformed one', () => {
    assert.equal(validReportV2(v2({ generatedAt: null, generatedContent: null })), true)
    assert.equal(validReportV2(v2({ generatedAt: 5 })), false)
    assert.equal(validReportV2(v2({ generatedContent: { risks: 'not a list' } })), false)
    assert.equal(validReportV2(v2({ generatedContent: content() })), true)
    assert.equal(validReportV2(v2({ provenance: 'nope' })), false)
  })

  it('validates content shape: only text lists in the six list sections', () => {
    assert.equal(validContent(content()), true)
    assert.equal(validContent(content({ risks: [{ a: 1 }] })), false)
    assert.equal(validContent(null), false)
  })

  it('validates status history entries, rejecting unsupported sources', () => {
    const ok = { id: 'h', projectId: 'p', at: '2026-01-01T00:00:00.000Z', source: 'manual', previousStatus: null, newStatus: 'At Risk', reportId: null }
    assert.equal(validHistoryEntry(ok), true)
    assert.equal(validHistoryEntry({ ...ok, source: 'ai-recommended' }), false)
    assert.equal(validHistoryEntry({ ...ok, at: undefined }), false)
    assert.equal(validHistoryEntry({ ...ok, id: '' }), false)
    assert.equal(validHistoryEntry({ ...ok, source: 'ai-confirmed', reportId: 'r1' }), true)
  })
})

describe('migrateReport (version 1 -> 2)', () => {
  it('turns the old "generatedAt" into savedAt, because that is what it always was', () => {
    const m = migrateReport(v1Report({ generatedAt: '2026-01-08T09:00:00.000Z' }))
    assert.equal(m.savedAt, '2026-01-08T09:00:00.000Z')
  })

  it('does NOT invent an AI generation time: it is null and marked unknown', () => {
    const m = migrateReport(v1Report())
    assert.equal(m.generatedAt, null)
    assert.equal(m.provenance.generatedAt, 'unknown')
  })

  it('recovers the original AI output with certainty when the report was never edited', () => {
    const r = v1Report({ updatedAt: null, content: content({ executiveSummary: 'AI wrote this.' }) })
    const m = migrateReport(r)
    assert.deepEqual(m.generatedContent, r.content)
    assert.notEqual(m.generatedContent, r.content, 'a separate copy, not the same object')
    assert.equal(m.provenance.generatedContent, 'recovered')
  })

  it('does NOT fabricate AI output for a report that was edited: it was overwritten, so it is unknown', () => {
    const m = migrateReport(v1Report({ updatedAt: '2026-01-09T00:00:00.000Z', content: content({ executiveSummary: 'PM rewrote this.' }) }))
    assert.equal(m.generatedContent, null)
    assert.equal(m.provenance.generatedContent, 'unknown')
  })

  it('treats a missing updatedAt as "never edited"', () => {
    const r = v1Report()
    delete r.updatedAt
    assert.equal(migrateReport(r).provenance.generatedContent, 'recovered')
  })

  it('treats demo reports and sample copies as having no AI output or generation time at all', () => {
    for (const r of [v1Report({ demo: true, source: 'demo' }), v1Report({ demo: true, sampleCopy: true, source: 'sample-copy' })]) {
      const m = migrateReport(r)
      assert.equal(m.generatedAt, null)
      assert.equal(m.generatedContent, null)
      assert.deepEqual(m.provenance, { generatedAt: 'not-applicable', generatedContent: 'not-applicable', generation: 'not-applicable' })
      assert.equal(m.savedAt, r.generatedAt, 'the old stamp still becomes the date it is dated/saved')
    }
  })

  it('treats a live report with no recorded source as live', () => {
    const r = v1Report()
    delete r.source
    assert.equal(migrateReport(r).provenance.generatedAt, 'unknown')
  })

  it('keeps every existing field exactly as it was, including unknown extra fields', () => {
    const r = v1Report({ extra: { nested: [1, 2] }, projectStatusAtReport: 'Blocked', updatedAt: '2026-01-09T00:00:00.000Z' })
    const m = migrateReport(r)
    for (const k of Object.keys(r).filter((k) => k !== 'generatedAt')) assert.deepEqual(m[k], r[k], k)
    assert.equal(m.originalUpdate, 'old raw notes')
    assert.equal(m.id, 'r-old')
    assert.equal(m.projectId, 'p-old')
  })

  it('does not modify its input', () => {
    const r = v1Report()
    const before = JSON.stringify(r)
    migrateReport(r)
    assert.equal(JSON.stringify(r), before)
  })

  it('leaves an already-migrated report alone (idempotent)', () => {
    const m = migrateReport(v1Report())
    assert.equal(migrateReport(m), m)
  })
})

describe('migrationHistoryFor (one honest anchor per project that already has a status)', () => {
  const at = '2026-02-01T10:00:00.000Z'

  it('records when the current status was set and how, and says the earlier status is unknown', () => {
    const e = migrationHistoryFor(v1Project({ status: 'At Risk', statusSource: { type: 'manual', at } }))
    assert.deepEqual(e, {
      id: 'status-migrated-p-old', projectId: 'p-old', previousStatus: null, previousStatusKnown: false,
      newStatus: 'At Risk', at, source: 'manual', reportId: null, migrated: true,
    })
  })

  it('keeps the report a status came from', () => {
    const e = migrationHistoryFor(v1Project({ status: 'Blocked', statusSource: { type: 'report', reportId: 'r-9', at } }))
    assert.equal(e.source, 'report')
    assert.equal(e.reportId, 'r-9')
  })

  it('creates nothing when there is nothing reliable to record', () => {
    assert.equal(migrationHistoryFor(v1Project({ status: null })), null, 'no status')
    assert.equal(migrationHistoryFor(v1Project({ status: 'On Track', statusSource: null })), null, 'no record of how it was set')
    assert.equal(migrationHistoryFor(v1Project({ status: 'On Track', statusSource: { type: 'manual' } })), null, 'no time')
    assert.equal(migrationHistoryFor(v1Project({ status: 'On Track', statusSource: { type: 'manual', at: 'whenever' } })), null, 'unusable time')
    assert.equal(migrationHistoryFor(v1Project({ status: 'On Track', statusSource: { type: 'mystery', at } })), null, 'unknown source type')
    assert.equal(migrationHistoryFor(v1Project({ demo: true, status: 'On Track', statusSource: { type: 'manual', at } })), null, 'demo projects get theirs from the demo data')
  })

  it('uses a deterministic id, so migrating twice can never create a second entry', () => {
    const p = v1Project({ status: 'On Track', statusSource: { type: 'manual', at } })
    assert.equal(migrationHistoryFor(p).id, migrationHistoryFor(p).id)
  })
})

describe('migrateV1toV2 (whole state)', () => {
  const at = '2026-02-01T10:00:00.000Z'
  const v1 = () => ({
    version: 1,
    topLevelExtra: { keep: true },
    projects: [
      v1Project({ id: 'a', status: 'At Risk', statusSource: { type: 'report', reportId: 'ra', at } }),
      v1Project({ id: 'b', status: null }),
    ],
    reports: [v1Report({ id: 'ra', projectId: 'a' }), v1Report({ id: 'rb', projectId: 'b', updatedAt: '2026-01-10T00:00:00.000Z' })],
  })

  it('upgrades the version and adds a status history, dropping nothing', () => {
    const m = migrateV1toV2(v1())
    assert.equal(m.version, 2)
    assert.equal(m.projects.length, 2)
    assert.equal(m.reports.length, 2)
    assert.equal(m.statusHistory.length, 1)
  })

  it('keeps ids and every project/report association', () => {
    const m = migrateV1toV2(v1())
    assert.deepEqual(m.projects.map((p) => p.id), ['a', 'b'])
    assert.deepEqual(m.reports.map((r) => [r.id, r.projectId]), [['ra', 'a'], ['rb', 'b']])
  })

  it('links the project to its migrated history entry by id', () => {
    const m = migrateV1toV2(v1())
    const a = m.projects.find((p) => p.id === 'a')
    assert.equal(a.statusSource.historyId, m.statusHistory[0].id)
    assert.equal(m.statusHistory[0].projectId, 'a')
    assert.equal(m.projects.find((p) => p.id === 'b').statusSource, null)
  })

  it('preserves unknown top-level fields', () => {
    assert.deepEqual(migrateV1toV2(v1()).topLevelExtra, { keep: true })
  })

  it('is idempotent: migrating the result again changes nothing', () => {
    const once = migrateV1toV2(v1())
    assert.deepEqual(migrateV1toV2(once), once)
  })

  it('keeps an existing status history and never duplicates an entry by id', () => {
    const start = v1()
    start.statusHistory = [{ id: 'status-migrated-a', projectId: 'a', at, source: 'manual', previousStatus: null, newStatus: 'At Risk', reportId: null }]
    const m = migrateV1toV2(start)
    assert.equal(m.statusHistory.length, 1)
  })

  it('does not modify its input', () => {
    const s = v1()
    const before = JSON.stringify(s)
    migrateV1toV2(s)
    assert.equal(JSON.stringify(s), before)
  })
})
