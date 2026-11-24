import type { ProviderTimelineEvent } from '../../native-chat/agent-session-timeline/provider-timeline-event'
import type { AgentSessionProviderHandleLink } from '../../../shared/agent-session/lifecycle/provider-handles/agent-session-provider-handle'
import type { StructuredAgentSessionProviderOpenResult } from '../../native-chat/agent-session-wire/startup/structured-agent-session-provider-open-contract'
import { parseAgentJournalItemKey } from '../../../shared/agent-session/journal/agent-session-journal-item-key'
import type { createLegacyProviderTimelineIdentityScheme } from '../../native-chat/agent-session-timeline/provider-timeline-identity'

export function matchesAcpRequestRow(
  itemId: string,
  requestKey: string,
  context: { sessionId: string; generation: string },
  scheme: ReturnType<typeof createLegacyProviderTimelineIdentityScheme>
): boolean {
  const identity = parseAgentJournalItemKey(itemId)
  if (identity?.provider !== 'legacy' || identity.sessionId !== context.sessionId) {
    return false
  }
  const first = scheme.request({ generation: context.generation, key: requestKey, incarnation: 1 })
  const prefix = first.provider === 'legacy' ? first.recordId : null
  return identity.recordId === prefix || identity.recordId.startsWith(`${prefix}#`)
}

/** A configured migration proves its source without treating the Orca chat as newly created. */
export function acpSessionHandleProof(input: {
  handle: AgentSessionProviderHandleLink['handle']
  fence: number
  created: boolean
  linkId?: string
  observedAt: number
  resume: { sessionId: string; forkedFromKey?: string } | null
  takeover?: Pick<AgentSessionProviderHandleLink, 'replaces' | 'supersedesKey'> | null
}): Pick<StructuredAgentSessionProviderOpenResult, 'link' | 'newConversation'> {
  const { handle, fence, resume } = input
  const link: AgentSessionProviderHandleLink = {
    linkId: input.linkId ?? `${handle.agent}-${fence}-${handle.nativeId}`.slice(0, 128),
    handle,
    origin: input.created ? 'created' : 'resumed',
    mintedAtFence: fence,
    observedAt: input.observedAt,
    ...input.takeover
  }
  const forkedFromKey =
    link.origin === 'resumed' && link.handle.nativeId === resume?.sessionId
      ? resume?.forkedFromKey
      : undefined
  return forkedFromKey
    ? { link: { ...link, origin: 'forked', forkedFromKey }, newConversation: false }
    : { link }
}

/** A migrated transport retains the original root's journal keys. */
export function acpIdentitySessionEvent(
  event: ProviderTimelineEvent,
  transportSessionId: string,
  identitySessionId?: string
): ProviderTimelineEvent {
  return identitySessionId &&
    identitySessionId !== transportSessionId &&
    'join' in event &&
    event.join?.thread === transportSessionId
    ? { ...event, join: { ...event.join, thread: identitySessionId } }
    : event
}
