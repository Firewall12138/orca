import { agentJournalItemKey } from '../../../shared/agent-session/journal/agent-session-journal-item-key'
import { createLegacyProviderTimelineIdentityScheme } from '../../native-chat/agent-session-timeline/provider-timeline-identity'
import { readAcpSessionEvent } from '../protocol/acp-session-events'
import { acpNamedTextKey } from '../timeline/acp-turn-messages'
import type { AcpIdentifiedHistoryTurn } from './acp-history-replay'
import type { AcpHistoryScope } from './acp-history-translation'

/** Old unscoped keys are migration evidence only when their owning prompt also matches. */
export function acpHistoryLegacyMessageKeys(
  scope: AcpHistoryScope,
  turn: AcpIdentifiedHistoryTurn,
  savedScope?: string
): ReadonlyMap<string, string> {
  const keys = new Map<string, string>()
  if (!scope.dialect.turnScopedMessageIds) {
    return keys
  }
  const scheme = createLegacyProviderTimelineIdentityScheme(scope)
  const key = (messageId: string, messageScope?: string) =>
    agentJournalItemKey(
      scheme.item({
        namespace: scope.providerSessionId,
        thread: scope.providerSessionId,
        family: 'item',
        key: { source: 'provider', value: acpNamedTextKey(messageId, 'assistant', messageScope) }
      })
    )
  for (const observation of turn.observations) {
    if ('blocks' in observation) {
      continue
    }
    const event = readAcpSessionEvent(observation.params)
    const update = event?.kind === 'known' ? event.notification.update : undefined
    if (update?.sessionUpdate === 'agent_message_chunk' && update.messageId) {
      keys.set(key(update.messageId, turn.turn), key(update.messageId, savedScope))
    }
  }
  return keys
}
