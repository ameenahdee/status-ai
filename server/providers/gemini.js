import { GoogleGenAI, Type } from '@google/genai'
import { SYSTEM_PROMPT, SECTIONS } from '../prompt.js'

const list = { type: Type.ARRAY, items: { type: Type.STRING } }
const schema = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    executiveSummary: { type: Type.STRING },
    completedActivities: list,
    workInProgress: list,
    blockers: list,
    risks: list,
    nextSteps: list,
    executiveActionRequired: list,
    assessment: {
      type: Type.OBJECT,
      properties: {
        outcome: { type: Type.STRING, enum: ['On Track', 'At Risk', 'Blocked', 'Off Track', 'Insufficient Information'] },
        explanation: { type: Type.STRING },
        evidence: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: { source: { type: Type.STRING, enum: ['update', 'description', 'confirmedStatus'] }, quote: { type: Type.STRING } },
            required: ['source', 'quote'],
          },
        },
        missingInformation: list,
      },
      required: ['outcome', 'explanation', 'evidence', 'missingInformation'],
    },
  },
  required: ['title', ...SECTIONS.map((s) => s.key), 'assessment'],
}

// The project description is background context only, kept separate from the submitted update.
export function buildPrompt({ updates, projectName, projectDescription, projectStatus, audience, periodStart, periodEnd }) {
  const period = periodStart && periodEnd ? `${periodStart} to ${periodEnd}` : 'Not specified'
  return `Project: ${projectName || 'Not specified'}
Project description (background context only): ${projectDescription || 'Not specified'}
Current confirmed project status (background context only): ${projectStatus || 'Not set'}
Audience: ${audience || 'Executive stakeholders'}
Reporting period: ${period}

Rough updates:
"""
${updates}
"""`
}

export function createGeminiProvider({ apiKey, model, timeoutMs = 45_000 }) {
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set')
  const ai = new GoogleGenAI({ apiKey })
  return {
    name: 'gemini',
    model, // recorded with each generated report
    async generateReport(input) {
      const contents = buildPrompt(input)
      let res
      try {
        res = await ai.models.generateContent({
          model,
          contents,
          config: {
            systemInstruction: SYSTEM_PROMPT,
            responseMimeType: 'application/json',
            responseSchema: schema,
            temperature: 0.3,
            // Never let a stalled provider hold the request open indefinitely
            abortSignal: AbortSignal.timeout(timeoutMs),
          },
        })
      } catch (e) {
        if (e?.name === 'TimeoutError' || e?.name === 'AbortError' || /abort/i.test(e?.message || '')) {
          const err = new Error(`Gemini (${model}) did not respond within ${timeoutMs / 1000}s`)
          err.code = 'TIMEOUT'
          throw err
        }
        throw e
      }
      if (!res.text) throw new Error(`Gemini (${model}) returned an empty response`)
      return JSON.parse(res.text)
    },
  }
}
