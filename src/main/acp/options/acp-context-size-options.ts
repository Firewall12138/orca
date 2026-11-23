import type { SessionConfigOption } from '../generated/acp-protocol.generated'
import type { AgentSessionOptionsResult } from '../../../shared/agent-session/options/protocol/agent-session-options-result'
import { acpSelectChoices } from './acp-select-choices'

type SelectOption = Extract<SessionConfigOption, { type: 'select' }>

export { acpNamedSelectOption as acpContextSizeOption } from './acp-select-choices'

export function acpContextSizeChoices(option: SelectOption | null) {
  return option
    ? acpSelectChoices(option).map((choice) => ({ value: choice.value, label: choice.name }))
    : []
}

export function withContextSizeOption<
  T extends Pick<AgentSessionOptionsResult, 'models' | 'current'>
>(menu: T, option: SelectOption | null): T {
  return {
    ...menu,
    models: menu.models.map((model) =>
      model.id === menu.current.model
        ? { ...model, contextSizes: acpContextSizeChoices(option) }
        : model
    ),
    current: {
      ...menu.current,
      ...(option
        ? {
            contextSize: option.currentValue,
            confirmed: [...(menu.current.confirmed ?? []), 'contextSize']
          }
        : {})
    }
  }
}
