import type { AgentJournalItemBody } from '../../../shared/agent-session/journal/agent-session-journal-types'

/** Replay may extend the same message, but cannot truncate a newer saved snapshot. */
export function canCompleteAcpHistoryMessage(
  saved: AgentJournalItemBody,
  replay: AgentJournalItemBody
): boolean {
  return (
    saved.kind === 'message' &&
    replay.kind === 'message' &&
    saved.role === 'assistant' &&
    replay.role === 'assistant' &&
    saved.blocks.length === replay.blocks.length &&
    saved.blocks.every((block, index) => {
      const next = replay.blocks[index]
      return block.type === 'text' && next?.type === 'text'
        ? next.text.startsWith(block.text)
        : JSON.stringify(block) === JSON.stringify(next)
    })
  )
}
