import { z } from 'zod'

export const chatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string().trim().min(1).max(20_000),
}).strict()

export const chatRequestSchema = z.object({
  model: z.string().uuid(),
  messages: z.array(chatMessageSchema).min(1).max(50),
  max_tokens: z.number().int().positive().max(8_192).default(1_024),
}).strict()

export type ChatMessage = z.infer<typeof chatMessageSchema>
export type ChatRequest = z.infer<typeof chatRequestSchema>

export type UsageCounts = {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

export function extractUsage(value: Record<string, unknown>): UsageCounts {
  const usage = value.usage
  if (typeof usage !== 'object' || usage === null || Array.isArray(usage)) {
    return { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
  }

  const record = usage as Record<string, unknown>
  const promptTokens = nonNegativeInteger(record.prompt_tokens) ?? 0
  const completionTokens = nonNegativeInteger(record.completion_tokens) ?? 0
  const totalTokens = nonNegativeInteger(record.total_tokens) ?? promptTokens + completionTokens

  return { promptTokens, completionTokens, totalTokens }
}
