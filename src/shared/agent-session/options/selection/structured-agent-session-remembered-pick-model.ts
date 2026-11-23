import { STRUCTURED_LAUNCH_SEED_OPTION_IDS } from '../../../native-chat/input/session-options/native-chat-session-option-defaults'
import {
  decodeStructuredAgentSessionOptionValue,
  encodeStructuredAgentSessionOptionValue
} from './structured-agent-session-option-codec'
import {
  structuredAgentSessionDescribedModel,
  structuredAgentSessionDisplayCatalog,
  structuredAgentSessionShownModel
} from '../view/structured-agent-session-option-snapshot'
import type {
  StructuredAgentSessionOptionState,
  StructuredSessionOptionPick
} from '../structured-agent-session-options'

/** The model a pick is remembered under: a model pick's own, else the one its values were chosen under
 *  (the chat's own, else the default shown, joined to the listed row that runs it). Only a new chat's
 *  value picks adopt that model as the new-chat default; an existing chat's keep the remembered model. */
export function structuredAgentSessionRememberedPickModel(
  state: StructuredAgentSessionOptionState,
  committedModel: string | undefined,
  existingChat: boolean
): { modelId: string; adoptModelAsLaunchDefault?: false } | null {
  if (typeof committedModel === 'string' && committedModel.trim()) {
    return { modelId: committedModel }
  }
  const catalog = structuredAgentSessionDisplayCatalog(state)
  const controlsModelId = catalog
    ? structuredAgentSessionShownModel(catalog, catalog.models, state.record).controlsModelId
    : null
  if (!controlsModelId) {
    return null
  }
  const modelId =
    structuredAgentSessionDescribedModel(state, controlsModelId)?.id ?? controlsModelId
  return existingChat ? { modelId, adoptModelAsLaunchDefault: false } : { modelId }
}

export function structuredAgentSessionRememberedPicks(
  state: StructuredAgentSessionOptionState,
  committed: Readonly<Record<string, string>>,
  existingChat = false
): StructuredSessionOptionPick[] {
  if (!state.catalog) {
    return []
  }
  const remembered = structuredAgentSessionRememberedPickModel(state, committed.model, existingChat)
  if (!remembered) {
    return []
  }
  return STRUCTURED_LAUNCH_SEED_OPTION_IDS.flatMap((optionId) => {
    const value = committed[optionId]
    if (
      optionId === 'contextSize' &&
      !state.catalog?.models
        .find((row) => row.id === remembered.modelId)
        ?.options.some(
          (option) =>
            option.id === 'contextSize' &&
            option.kind.type === 'select' &&
            option.kind.choices.some((choice) => choice.value === value)
        )
    ) {
      return []
    }
    if (value === undefined) {
      return []
    }
    const decoded = decodeStructuredAgentSessionOptionValue(optionId, value)
    return decoded === null ||
      (typeof decoded === 'string' && !decoded.trim()) ||
      encodeStructuredAgentSessionOptionValue(optionId, decoded) === null
      ? []
      : [{ ...remembered, optionId, value: decoded }]
  })
}
