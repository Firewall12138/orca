import { agentJournalItemKey } from '../../../shared/agent-session/journal/agent-session-journal-item-key'
import type { AcpHistoryCandidate } from './acp-history-turn-matching'
import {
  acpHistoryHasOutput,
  acpPromptDigest,
  type AcpNativeTurn
} from './acp-history-turn-content'

/** A missing text reply needs a unique provider receipt inside the original execution. */
export function matchAcpHistoryReceiptTimes(
  candidates: readonly AcpHistoryCandidate[],
  natives: readonly AcpNativeTurn[],
  check: () => void
): ReadonlyMap<string, number> {
  const byText = new Map<string, Map<string, number>>()
  for (const { source } of candidates) {
    check()
    const text = source.textOnly ? acpPromptDigest(source.user.blocks) : null
    if (text !== null && source.startedAt !== null) {
      const roots = byText.get(text) ?? new Map<string, number>()
      roots.set(source.turn, source.startedAt)
      byText.set(text, roots)
    }
  }
  const owners = new Map<string, number[]>()
  for (const [index, native] of natives.entries()) {
    check()
    if (
      native.text === null ||
      native.startedAt === undefined ||
      native.completedAt === undefined
    ) {
      continue
    }
    const { startedAt, completedAt } = native
    const roots = [...(byText.get(native.text) ?? [])].filter(([, at]) => {
      check()
      return startedAt <= at && at <= completedAt
    })
    if (roots.length === 1) {
      const id = roots[0][0]
      owners.set(id, [...(owners.get(id) ?? []), index])
    }
  }
  return new Map(
    [...owners].flatMap(([id, found]) => (found.length === 1 ? [[id, found[0]] as const] : []))
  )
}

export function matchMissingAcpTextReplies(
  candidates: readonly AcpHistoryCandidate[],
  natives: readonly AcpNativeTurn[],
  check: () => void
): ReadonlyMap<string, number> {
  const owners = matchAcpHistoryReceiptTimes(candidates, natives, check)
  const matched = new Map<string, number>()
  for (const { source, items, legacyMessageKeys } of candidates) {
    check()
    const found = owners.get(source.turn)
    const output = items.filter((item) => acpHistoryHasOutput(item.body))
    if (
      found !== undefined &&
      !natives[found].output &&
      output.length > 0 &&
      output.every(
        (item) =>
          legacyMessageKeys?.has(agentJournalItemKey(item.identity)) &&
          item.body.kind === 'message' &&
          item.body.role === 'assistant' &&
          item.body.blocks.every((block) => block.type === 'text')
      )
    ) {
      matched.set(source.turn, found)
    }
  }
  return matched
}
