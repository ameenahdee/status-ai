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
  },
  required: ['title', ...SECTIONS.map((s) => s.key)],
}

// The project description is background context only, kept separate from the submitted update.
export function buildPrompt({ updates, projectName, projectDescription, audience, periodStart, periodEnd }) {
  const period = periodStart && periodEnd ? `${periodStart} to ${periodEnd}` : 'Not specified'
  return `Project: ${projectName || 'Not specified'}
Project description (background context only): ${projectDescription || 'Not specified'}
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
