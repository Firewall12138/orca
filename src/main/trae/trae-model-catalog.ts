import { lazyZodSchema } from '../../shared/schema/lazy-zod-schema'
import { z } from 'zod'
import type { AgentSessionModelOption } from '../../shared/agent-session/options/model-catalog/agent-session-model-option'

const modelEntry = lazyZodSchema(() =>
  z.object({
    config_name: z.string().min(1).nullish(),
    name: z.string().min(1),
    description: z.string().optional()
  })
)

export function parseTraeModelListing(stdout: string): AgentSessionModelOption[] {
  return z
    .array(z.unknown())
    .parse(JSON.parse(stdout))
    .flatMap((row) => {
      const parsed = modelEntry.safeParse(row)
      if (!parsed.success) {
        return []
      }
      const model = parsed.data
      return [
        {
          id: model.config_name ?? model.name,
          label: model.name,
          ...(model.description ? { description: model.description } : {}),
          isDefault: false,
          efforts: [],
          effortsKnown: false as const
        }
      ]
    })
}
