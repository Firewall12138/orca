import type { StructuredAgentSessionOptionState } from '../structured-agent-session-options'
import type {
  SessionOptionDescriptor,
  SessionOptionValue
} from '../../../native-chat/input/native-chat-session-options'

export function canSetStructuredSessionSnapshotOption(
  state: Pick<StructuredAgentSessionOptionState, 'fastModeRestricted' | 'permissionOwnSupported'>,
  id: string,
  value: SessionOptionValue,
  snapshot: readonly SessionOptionDescriptor[],
  interactionReady: boolean,
  pending: boolean
): boolean {
  if (!interactionReady || pending || (id === 'fastMode' && state.fastModeRestricted)) {
    return false
  }
  if (id === 'contextSize') {
    const descriptor = snapshot.find((entry) => entry.id === id)
    return (
      descriptor?.settable === true &&
      descriptor.kind.type === 'select' &&
      descriptor.kind.choices.some((choice) => choice.value === value)
    )
  }
  if (id === 'permissionMode' || id === 'interactionMode') {
    const descriptor = snapshot.find((entry) => entry.id === id)
    return (
      descriptor?.settable === true &&
      descriptor.kind.type === 'select' &&
      (value === 'own'
        ? state.permissionOwnSupported === true
        : descriptor.kind.choices.some((choice) => choice.value === value))
    )
  }
  return (
    (['model', 'effort', 'serviceTier', 'personality'].includes(id) &&
      typeof value === 'string' &&
      value.length > 0) ||
    (id === 'fastMode' && typeof value === 'boolean')
  )
}
