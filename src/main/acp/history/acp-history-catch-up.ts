import {
  agentJournalItemKey,
  parseAgentJournalItemKey
} from '../../../shared/agent-session/journal/agent-session-journal-item-key'
import type { AgentJournalRenderItem } from '../../../shared/agent-session/journal/agent-session-journal-types'
import type { JournalLifecycleIdentityMutationInput } from '../../native-chat/agent-session-journal/writing/journal-lifecycle-mutation'
import { isHistoricalProviderTimelineItem } from '../../native-chat/agent-session-timeline/provider-timeline-history'
import type { StructuredAgentSessionEventSink } from '../../native-chat/agent-session-wire/journal-ingress/structured-agent-session-event-sink'
import {
  HISTORY_CATCH_UP_MAX_BYTES,
  continuedOutsideRecordId,
  createHistoryCatchUpBatch,
  runHistoryCatchUp
} from '../../native-chat/agent-session-wire/acquisition/structured-agent-session-history-catch-up'
import type { StructuredAgentSessionLogger } from '../../native-chat/agent-session-wire/host/structured-agent-session-logger'
import {
  acpHistoryTurns,
  type AcpIdentifiedHistoryTurn,
  type AcpLoadHistoryFrame
} from './acp-history-replay'
import { translateHistoryTurn, type AcpHistoryScope } from './acp-history-translation'
import { matchAcpHistoryTurns, type AcpHistoryCandidate } from './acp-history-turn-matching'
import {
  acpHistoryDividerKey,
  readAcpHistoryBodies,
  readAcpHistoryJournal
} from './acp-history-journal-view'
import { acpAgentName } from '../session/acp-structured-agent-definitions'
import { canCompleteAcpHistoryMessage } from './acp-history-message-reconciliation'
import { acpHistoryLegacyMessageKeys } from './acp-history-message-keys'
import type { AcpHistoryItem } from './acp-history-journal-overlay'

export type AcpHistoryCatchUpInput = AcpHistoryScope & {
  frames: readonly AcpLoadHistoryFrame[]
  sink: StructuredAgentSessionEventSink
  assertCurrent: () => void
  signal?: AbortSignal
  timeoutMs?: number
  logger?: StructuredAgentSessionLogger
}

/** Optional history work owns no sends; one checked runner settlement lands all changed bodies. */
export async function catchUpAcpHistory(input: AcpHistoryCatchUpInput): Promise<void> {
  let candidates: AcpHistoryCandidate[] = []
  await runHistoryCatchUp({
    agentName: acpAgentName(input.agent),
    scope: 'acp-history-catch-up',
    sessionId: input.sessionId,
    sink: input.sink,
    assertCurrent: input.assertCurrent,
    signal: input.signal,
    timeoutMs: input.timeoutMs ?? 30_000,
    ...(input.logger ? { logger: input.logger } : {}),
    readView: (history) => readAcpHistoryJournal(input, history, candidates),
    prepare: async ({ view, history, check, yieldTurn }) => {
      // Derive source keys once without saved facts, then capture before any saved read or yield.
      candidates = acpHistoryTurns(
        input.frames,
        input.identity,
        check,
        input.dialect.historyStartsWithAssistant === true
      )
        .filter((turn): turn is AcpIdentifiedHistoryTurn => turn.turn !== null)
        .map((source) => ({
          source,
          items: translateHistoryTurn(input, source, check),
          legacyMessageKeys: acpHistoryLegacyMessageKeys(input, source)
        }))
      const baseline = await view()
      const { kind, matched, natives, replacedHistorical } = matchAcpHistoryTurns(
        input,
        baseline.journal,
        candidates,
        baseline.importedAt,
        baseline.requests,
        check,
        baseline.covered
      )
      const batch = createHistoryCatchUpBatch()
      const recovered = new Map<string, AcpHistoryItem[]>()
      for (const { source, items, legacyMessageKeys } of candidates) {
        const index = matched.get(source.turn)
        const native = index === undefined ? undefined : natives[index]
        if (!input.dialect.turnScopedMessageIds || !native) {
          continue
        }
        recovered.set(
          source.turn,
          items
            .filter((item) => legacyMessageKeys?.has(agentJournalItemKey(item.identity)))
            .map((item) => ({
              ...item,
              turnScope: { kind: 'turn' as const, turnItemId: native.itemId },
              linkage: undefined
            }))
        )
      }
      // The rows written name the import, so a later open's additions settle under their own id.
      const written: string[] = []
      // Only rows a plan may write need saved bodies: dividers, and turns no copy covers yet.
      const { read, canonical } = await readAcpHistoryBodies(
        history,
        baseline,
        candidates.flatMap(({ source, items, legacyMessageKeys, nativeMessageKeys }) => [
          acpHistoryDividerKey(input, source.turn),
          ...(recovered.get(source.turn) ?? []).flatMap((item) => {
            const key = agentJournalItemKey(item.identity)
            const legacyKey = legacyMessageKeys?.get(key)
            const nativeKey = nativeMessageKeys?.get(key)
            return [key, ...(nativeKey ? [nativeKey] : []), ...(legacyKey ? [legacyKey] : [])]
          }),
          ...(replacedHistorical.has(source.turn)
            ? items.map((item) => agentJournalItemKey(item.identity))
            : []),
          ...(kind.get(source.turn) === 'native' || kind.get(source.turn) === 'adopted'
            ? []
            : items.map((item) => agentJournalItemKey(item.identity)))
        ])
      )
      const desired = new Map<
        string,
        {
          mutation: JournalLifecycleIdentityMutationInput
          saved: AgentJournalRenderItem | null
          bytes: number
        }
      >()
      let retainedBytes = 0
      const compose = (mutation: JournalLifecycleIdentityMutationInput) => {
        check()
        const key = agentJournalItemKey(mutation.identity)
        if ((canonical.get(key) ?? key) !== key) {
          throw new Error('unowned-history-target')
        }
        const previous = desired.get(key)
        // Occurrences are complete snapshots; only the body replaces first creation metadata.
        const final =
          previous?.mutation.kind === 'item' && mutation.kind === 'item'
            ? { ...previous.mutation, body: mutation.body }
            : mutation
        const bytes = Buffer.byteLength(JSON.stringify(final), 'utf8')
        retainedBytes += bytes - (previous?.bytes ?? 0)
        if (retainedBytes > HISTORY_CATCH_UP_MAX_BYTES) {
          throw new Error('too-large')
        }
        desired.set(key, { mutation: final, saved: previous?.saved ?? read(key), bytes })
      }
      for (const { source, items, legacyMessageKeys, nativeMessageKeys } of candidates) {
        check()
        const coverage = kind.get(source.turn)
        const dividerIdentity = {
          provider: 'legacy',
          agent: input.agent,
          sessionId: input.sessionId,
          recordId: continuedOutsideRecordId(source.turn)
        } as const
        const dividerKey = acpHistoryDividerKey(input, source.turn)
        const savedDivider = read(dividerKey)
        if (savedDivider) {
          compose({ kind: 'tombstone', identity: dividerIdentity })
        }
        if (coverage === 'native') {
          if (replacedHistorical.has(source.turn)) {
            for (const item of items) {
              if (
                item.body.kind === 'turn' ||
                (item.body.kind === 'message' && item.body.role === 'user')
              ) {
                const key = agentJournalItemKey(item.identity)
                const saved = read(key)
                if (saved && isHistoricalProviderTimelineItem(saved, read)) {
                  compose({ kind: 'tombstone', identity: item.identity })
                }
              }
            }
          }
          for (const mutation of recovered.get(source.turn) ?? []) {
            const key = agentJournalItemKey(mutation.identity)
            const held = read(key)
            if (held) {
              const sameOwner =
                held.turnScope?.kind === 'turn' &&
                mutation.turnScope.kind === 'turn' &&
                held.turnScope.turnItemId === mutation.turnScope.turnItemId
              const historical =
                replacedHistorical.has(source.turn) && isHistoricalProviderTimelineItem(held, read)
              if (
                (!sameOwner && !historical) ||
                !canCompleteAcpHistoryMessage(held.body, mutation.body)
              ) {
                if (replacedHistorical.has(source.turn)) {
                  throw new Error('stale-history')
                }
                continue
              }
              compose({
                ...mutation,
                ...(sameOwner && held.turnScope
                  ? { turnScope: held.turnScope, linkage: undefined }
                  : {})
              })
              continue
            }
            const nativeKey = nativeMessageKeys?.get(key)
            const legacyKey = legacyMessageKeys?.get(key)
            const legacy =
              (nativeKey ? read(nativeKey) : null) ?? (legacyKey ? read(legacyKey) : null)
            if (
              legacy?.turnScope?.kind === 'turn' &&
              mutation.turnScope.kind === 'turn' &&
              legacy.turnScope.turnItemId === mutation.turnScope.turnItemId
            ) {
              const identity = parseAgentJournalItemKey(legacy.itemId)
              if (identity && canCompleteAcpHistoryMessage(legacy.body, mutation.body)) {
                compose({ ...mutation, identity, turnScope: legacy.turnScope, linkage: undefined })
              }
              continue
            }
            compose(mutation)
          }
          continue
        }
        if (coverage === 'adopted') {
          continue
        }
        for (const mutation of items) {
          check()
          const key = agentJournalItemKey(mutation.identity)
          const held = read(key)
          if (held && !isHistoricalProviderTimelineItem(held, read)) {
            throw new Error('unowned-history-target')
          }
          compose(
            held
              ? { ...mutation, turnScope: held.turnScope ?? mutation.turnScope, linkage: undefined }
              : mutation
          )
        }
        await yieldTurn()
      }
      for (const [key, { mutation, saved }] of desired) {
        check()
        if (mutation.kind === 'tombstone') {
          if (saved) {
            batch.expectItem(key, { canonicalItemId: key, revision: saved.revision })
            batch.push(mutation)
            written.push(key)
          }
        } else if (!saved) {
          batch.push(mutation)
          written.push(key)
        } else if (
          JSON.stringify(saved.body) !== JSON.stringify(mutation.body) ||
          JSON.stringify(saved.turnScope) !== JSON.stringify(mutation.turnScope)
        ) {
          batch.revise(mutation, { canonicalItemId: key, revision: saved.revision })
          written.push(key)
        }
        await yieldTurn()
      }
      return batch.size
        ? batch.finish('acp-history-import', [
            baseline.physicalCursor.epoch,
            input.providerSessionId,
            written
          ])
        : null
    }
  })
}
