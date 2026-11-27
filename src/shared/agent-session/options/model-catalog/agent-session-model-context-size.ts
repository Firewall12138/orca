import type { AgentSessionModelOption } from './agent-session-model-option'
import type { CatalogOption } from '../catalog-providers/agent-session-option-catalog-types'

export function modelContextSizeOption(model: AgentSessionModelOption): CatalogOption | null {
  const choices = model.contextSizes
  if (!choices?.length) {
    return null
  }
  return {
    id: 'contextSize',
    label: 'Context size',
    category: 'model_config',
    kind: {
      type: 'select',
      choices,
      defaultValue: model.defaultContextSize ?? choices[0].value,
      ...(model.defaultContextSize ? { defaultIsCliDefault: true as const } : {})
    },
    apply: {}
  }
}

/** A saved preset follows only models that offer it. */
export function savedEffectiveContextSize(
  saved: { model?: string; contextSize?: string },
  models: readonly AgentSessionModelOption[]
): string | undefined {
  if (!saved.contextSize) {
    return undefined
  }
  const model = models.find((row) => row.id === saved.model)
  if (!model?.contextSizes?.length) {
    return undefined
  }
  return model.contextSizes.some((choice) => choice.value === saved.contextSize)
    ? saved.contextSize
    : model?.defaultContextSize
}

/** Unknown live menus keep catalog presets; an observed empty menu removes support. */
export function modelWithKnownContextSizes(
  model: AgentSessionModelOption,
  known: AgentSessionModelOption | undefined
): AgentSessionModelOption {
  const choices = model.contextSizes ?? known?.contextSizes
  const defaultValue = model.defaultContextSize ?? known?.defaultContextSize
  const { defaultContextSize: _default, ...rest } = model
  return {
    ...rest,
    ...(choices !== undefined ? { contextSizes: choices } : {}),
    ...(defaultValue && choices?.some((choice) => choice.value === defaultValue)
      ? { defaultContextSize: defaultValue }
      : {})
  }
}

export function selectedContextSize(
  saved: { model?: string; contextSize?: string },
  models: readonly AgentSessionModelOption[],
  observed: {
    reported: { model?: string; contextSize?: string }
    selected: { contextSize?: string }
  }
): string | undefined {
  return saved.contextSize !== undefined
    ? savedEffectiveContextSize(saved, models)
    : saved.model === observed.reported.model
      ? observed.reported.contextSize
      : observed.selected.contextSize
}
