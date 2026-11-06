import { createGeminiProvider } from './gemini.js'

// Provider contract: { name, generateReport({ updates, projectName, audience }) -> report object }
// Add new providers (e.g. a RAG-backed one) here and select with AI_PROVIDER.
export function getProvider(env = process.env) {
  switch (env.AI_PROVIDER || 'gemini') {
    case 'gemini':
      return createGeminiProvider({
        apiKey: env.GEMINI_API_KEY,
        // Verified responsive against the Gemini API on 2026-11-06 (2.5-flash is 404 for new users)
        model: env.GEMINI_MODEL || 'gemini-3.5-flash',
        timeoutMs: Number(env.GEMINI_TIMEOUT_MS) || undefined,
      })
    default:
      throw new Error(`Unknown AI_PROVIDER: ${env.AI_PROVIDER}`)
  }
}
