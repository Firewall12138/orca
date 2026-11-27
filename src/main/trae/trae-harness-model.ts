import { lazyZodSchema } from '../../shared/schema/lazy-zod-schema'
import { z } from 'zod'

export const traeHarnessMetadataSchema = lazyZodSchema(() =>
  z.object({ family: z.string(), variant: z.string() })
)
export type TraeHarnessMetadata = z.infer<typeof traeHarnessMetadataSchema>

const modelSchema = lazyZodSchema(() =>
  z.object({
    slug: z.string().min(1),
    config_name: z.string().nullish(),
    model_provider_id: z.string().optional(),
    harness_mode: z.enum(['codex', 'claudecode', 'seed', 'auto']),
    harness_metadata: traeHarnessMetadataSchema,
    base_instructions: z.string().min(1),
    tool_mode: z.unknown(),
    business_metadata: z
      .object({
        variants: z.object({ standard_key: z.string().nullish(), max_key: z.string().nullish() })
      })
      .optional(),
    supported_reasoning_levels: z.array(z.object({ effort: z.string() })).optional()
  })
)

export type TraeHarnessModel = z.infer<typeof modelSchema>

export function readTraeHarnessModels(stdout: string): TraeHarnessModel[] {
  return z
    .object({ models: z.array(z.unknown()).min(1) })
    .parse(JSON.parse(stdout))
    .models.flatMap((row) => modelSchema.safeParse(row).data ?? [])
}

export function selectedTraeHarnessModel(models: TraeHarnessModel[], selection: string) {
  const ranked = models.flatMap((model) =>
    [
      model.slug,
      model.config_name,
      model.business_metadata?.variants.standard_key,
      model.business_metadata?.variants.max_key
    ].flatMap((alias) => {
      if (!alias) {
        return []
      }
      const selected = selection.toLowerCase()
      const id = alias.toLowerCase()
      return selected === id || selected.startsWith(`${id}/`) || selected === `${id}__max`
        ? [{ model, alias, rank: alias.length }]
        : []
    })
  )
  ranked.sort((a, b) => b.rank - a.rank)
  const matched = ranked[0]
  if (!matched) {
    throw new Error(`TRAE did not provide Harness metadata for ${selection}`)
  }
  const suffix = selection.slice(matched.alias.length)
  const variants = matched.model.business_metadata?.variants
  const max =
    selection.toLowerCase() === variants?.max_key?.toLowerCase() ||
    suffix === '__max' ||
    suffix.split('/').includes('max')
  const levels = matched.model.supported_reasoning_levels?.map((row) => row.effort) ?? []
  return {
    model: matched.model,
    selector:
      (max ? variants?.max_key : variants?.standard_key) ??
      matched.model.config_name ??
      matched.model.slug,
    backendVariant: (max ? variants?.max_key : variants?.standard_key) ?? (max ? 'max' : undefined),
    effort: suffix.split('/').find((part) => levels.includes(part))
  }
}

export function sameTraeHarness(a: TraeHarnessMetadata | undefined, b: TraeHarnessMetadata) {
  return a?.family === b.family && a.variant === b.variant
}
