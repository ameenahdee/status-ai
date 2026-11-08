export const SECTION_KEYS = [
  'executiveSummary',
  'completedActivities',
  'workInProgress',
  'blockers',
  'risks',
  'nextSteps',
  'executiveActionRequired',
]

export const content = (over = {}) => ({
  title: 'Weekly Status Report',
  executiveSummary: 'Summary text.',
  completedActivities: ['Did a thing'],
  workInProgress: ['Doing a thing'],
  blockers: ['Waiting on a thing'],
  risks: ['A thing may slip'],
  nextSteps: ['Do the next thing'],
  executiveActionRequired: ['Approve the thing'],
  ...over,
})

export const projectInput = (over = {}) => ({
  name: 'Alpha Project',
  startDate: '2026-10-01',
  description: 'Replaces the legacy invoicing tool so finance can close month-end faster.',
  owner: 'Ann Owner',
  audience: 'Steering committee',
  ...over,
})

// What the app passes when saving a live AI report: the AI output as generated, the (possibly edited) content,
// and the time the AI generated it (which is NOT the time of saving).
export const GENERATED_AT = '2026-11-08T08:30:00.000Z'
export const reportInput = (projectId, over = {}) => ({
  projectId,
  title: 'Weekly Status Report',
  originalUpdate: 'raw notes: finished login, dashboard 60%, payments blocked',
  periodStart: '2026-11-01',
  periodEnd: '2026-11-07',
  content: content(),
  generatedContent: content(),
  generatedAt: GENERATED_AT,
  projectStatusAtReport: 'At Risk',
  ...over,
})

// Records exactly as version 1 of the app stored them (before this data-model change), for migration tests.
export const v1Project = (over = {}) => ({
  id: 'p-old', name: 'Old project', startDate: '2026-01-01', description: 'd', owner: '', audience: '',
  status: null, statusSource: null, createdAt: '2026-01-01T00:00:00.000Z', ...over,
})
export const v1Report = (over = {}) => ({
  id: 'r-old', projectId: 'p-old', title: 'Old report', originalUpdate: 'old raw notes',
  periodStart: '2026-01-01', periodEnd: '2026-01-07',
  generatedAt: '2026-01-08T09:00:00.000Z', // in version 1 this was really the time the report was SAVED
  updatedAt: null, source: 'ai', projectStatusAtReport: 'On Track', content: content(), ...over,
})
