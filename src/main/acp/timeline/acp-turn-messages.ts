import type { AcpItemOwnership } from './acp-item-ownership'
import type { SessionUpdate } from '../generated/acp-protocol.generated'
import type { ProviderTimelineTextChannel } from '../../native-chat/agent-session-timeline/provider-timeline-event'
import { providerTimelineKeyPart } from '../../native-chat/agent-session-timeline/provider-timeline-identity'

/** One provider message may contain both reasoning and visible text. */
export function acpNamedTextKey(
  messageId: string,
  channel: ProviderTimelineTextChannel,
  scope?: string
): string {
  return scope === undefined
    ? `message:${JSON.stringify([messageId, channel])}`
    : `turn-message:${JSON.stringify([scope, messageId, channel])}`
}

type MessagePosition = { ordinal: number; channel?: string }

export type AcpMessageOwner = { turn?: string; settled?: boolean }

export type AcpTextDrop = {
  reason: 'turn-settled' | 'stream-mismatch'
  itemId: string | undefined
  channel: ProviderTimelineTextChannel
  threadId: string | undefined
  turnId: string | undefined
  producerAgentId?: string
}

export class AcpTurnMessages {
  private readonly turns = new Map<string, MessagePosition>()
  private readonly scopes = new Map<string, string>()

  constructor(
    private readonly owners: AcpItemOwnership,
    private readonly turnScoped = false
  ) {}

  scope(turn: string | undefined): string | undefined {
    return this.turnScoped && turn !== undefined ? (this.scopes.get(turn) ?? turn) : undefined
  }

  textKeys(turn: string | undefined, update: SessionUpdate, keyed = false) {
    return {
      messageKey: turn && (this.turnScoped || keyed) ? this.key(turn, update) : undefined,
      messageScope: this.scope(turn)
    }
  }

  /** Keep trailing chunks on the provider message's original turn. */
  owner(
    turn: string | undefined,
    update: SessionUpdate,
    settled: (turn: string) => boolean
  ): AcpMessageOwner {
    if (
      (update.sessionUpdate !== 'agent_message_chunk' &&
        update.sessionUpdate !== 'agent_thought_chunk') ||
      !update.messageId
    ) {
      return { turn }
    }
    const key = `message:${providerTimelineKeyPart(update.messageId)}`
    const owner = this.owners.get(key)
    if (owner) {
      return { ...owner, settled: owner.settled || settled(owner.turn) }
    }
    return { turn, settled: turn !== undefined && settled(turn) }
  }

  observe(turn: string | undefined, update: SessionUpdate | undefined): void {
    if (
      this.turnScoped &&
      turn !== undefined &&
      update?.sessionUpdate === 'user_message_chunk' &&
      update.messageId &&
      !this.scopes.has(turn)
    ) {
      this.scopes.set(turn, update.messageId)
    }
    if (
      turn !== undefined &&
      (update?.sessionUpdate === 'agent_message_chunk' ||
        update?.sessionUpdate === 'agent_thought_chunk') &&
      update.messageId
    ) {
      this.owners.remember(`message:${providerTimelineKeyPart(update.messageId)}`, turn)
    }
  }

  rejection(
    update: SessionUpdate | undefined,
    owner: AcpMessageOwner,
    threadId: string,
    turnId: string | undefined
  ): AcpTextDrop | undefined {
    if (
      !owner.settled ||
      (update?.sessionUpdate !== 'agent_message_chunk' &&
        update?.sessionUpdate !== 'agent_thought_chunk') ||
      !update.messageId
    ) {
      return undefined
    }
    const channel = update.sessionUpdate === 'agent_thought_chunk' ? 'reasoning' : 'assistant'
    return {
      reason: 'turn-settled',
      itemId: acpNamedTextKey(update.messageId, channel),
      channel,
      threadId,
      turnId
    }
  }

  key(turn: string, update: SessionUpdate): string | undefined {
    if (
      (update.sessionUpdate === 'agent_message_chunk' ||
        update.sessionUpdate === 'agent_thought_chunk') &&
      update.messageId
    ) {
      return acpNamedTextKey(
        update.messageId,
        update.sessionUpdate === 'agent_thought_chunk' ? 'reasoning' : 'assistant',
        this.scope(turn)
      )
    }
    if (!this.owners.isLive(turn)) {
      return undefined
    }
    const state = this.turns.get(turn) ?? { ordinal: 0 }
    this.turns.set(turn, state)
    if (
      update.sessionUpdate !== 'agent_message_chunk' &&
      update.sessionUpdate !== 'agent_thought_chunk'
    ) {
      if (
        ['user_message_chunk', 'tool_call', 'tool_call_update', 'plan'].includes(
          update.sessionUpdate
        )
      ) {
        state.channel = undefined
      }
      return undefined
    }
    if (state.channel !== update.sessionUpdate) {
      state.ordinal += 1
      state.channel = update.sessionUpdate
    }
    return `turn-message:${JSON.stringify([turn, state.ordinal])}`
  }

  dispose(): void {
    this.turns.clear()
    this.scopes.clear()
  }

  end(turn: string): void {
    this.turns.delete(turn)
    this.scopes.delete(turn)
  }
}
