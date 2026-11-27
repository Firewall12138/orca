import { lazyZodSchema } from '../../shared/schema/lazy-zod-schema'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import type { AcpResumePreparationInput } from '../acp/launch/acp-launch-contract'
import { runAgentModelCatalogListing } from '../native-chat/agent-model-catalog/agent-model-catalog-probe-runner'
import { spawnCodexAppServerConnection } from '../codex/app-server/codex-app-server-connection'
import { initializeCodexAppServerConnection } from '../codex/app-server/codex-app-server-handshake'
import { resolveTraeCliHome } from './trae-cli-home'
import { resolveSessionFilePath } from '../native-chat/session-file-resolver'
import {
  readTraeHarnessModels,
  selectedTraeHarnessModel,
  sameTraeHarness
} from './trae-harness-model'
import {
  resolveTraeHarnessReceipt,
  readTraeSessionState,
  traeHarnessReceiptPath,
  writeTraeHarnessReceipt
} from './trae-harness-state'
import { TraeHarnessContext } from './trae-harness-context'
import { canFastResumeTrae } from './trae-resume-checkpoint'

const threadSchema = lazyZodSchema(() =>
  z.object({
    id: z.string().min(1),
    path: z.string().min(1),
    model: z.string().nullish(),
    modelProvider: z.string().nullish(),
    reasoningEffort: z.string().nullish(),
    status: z.object({ type: z.string() }).optional()
  })
)

export async function prepareTraeHarnessResume(input: AcpResumePreparationInput) {
  const home = resolveTraeCliHome(input.launch.env, homedir())
  const previous = await resolveTraeHarnessReceipt(input.dataDirectory, home, input.sessionId)
  const sourceId = previous.sessionId
  const historySessionId = previous.historySessionId
  input.assertCurrent()
  const sourcePath = await resolveSessionFilePath(
    'codex',
    sourceId,
    {
      codexSessionsDirs: [join(home, 'sessions'), join(home, 'archived_sessions')],
      strictErrors: true
    },
    input.signal
  )
  if (!sourcePath) {
    return sourceId !== input.sessionId || historySessionId !== input.sessionId
      ? previous
      : undefined
  }
  const listing = await runAgentModelCatalogListing(
    { ...input.launch, args: [...input.prefixArgs, 'debug', 'models'] },
    { site: 'trae-harness-models', signal: input.signal }
  )
  const models = readTraeHarnessModels(listing)
  const state = await readTraeSessionState(sourcePath, input.signal)
  const confirmed = !state.inherited
  const saved = state.harness
  const unchanged = async () => {
    if (await canFastResumeTrae(input.dataDirectory, home, sourceId, sourcePath)) {
      return { ...previous, resumePreference: 'resume' as const }
    }
    return sourceId !== input.sessionId || historySessionId !== input.sessionId
      ? previous
      : undefined
  }
  if (
    confirmed &&
    input.model &&
    sameTraeHarness(saved, selectedTraeHarnessModel(models, input.model).model.harness_metadata)
  ) {
    return unchanged()
  }
  const rpcLaunch = {
    ...input.launch,
    args: [...input.prefixArgs, 'app-server']
  }
  const context = new TraeHarnessContext()
  const connection = await spawnCodexAppServerConnection(rpcLaunch, {
    onNotification: context.onNotification,
    onServerRequest: (request) =>
      connection.respondWithError(request.id, -32601, 'Harness alignment does not permit tools')
  })
  const aborted = () => void connection.close()
  input.signal?.addEventListener('abort', aborted, { once: true })
  let stopped = false
  let pendingReceipt: { sessionId: string; historySessionId: string } | undefined
  const aligned = await (async () => {
    input.signal?.throwIfAborted()
    await initializeCodexAppServerConnection(connection, 15_000)
    input.assertCurrent()
    const source = z
      .object({ thread: threadSchema })
      .parse(
        await connection.request('thread/read', { threadId: sourceId, includeTurns: false })
      ).thread
    const selection = input.model ?? source.model
    if (!selection) {
      throw new Error('TRAE did not report the saved conversation model')
    }
    const selected = selectedTraeHarnessModel(models, selection)
    input.assertCurrent()
    if (confirmed && sameTraeHarness(saved, selected.model.harness_metadata)) {
      return unchanged()
    }
    if (source.status?.type === 'active' || source.status?.type === 'inProgress') {
      throw new Error(
        'TRAE is still executing this conversation; Harness alignment waits for it to finish'
      )
    }
    const goal = z
      .object({ goal: z.object({ status: z.string() }).nullable() })
      .parse(await connection.request('thread/goal/get', { threadId: sourceId })).goal
    if (goal?.status === 'active') {
      throw new Error('TRAE Harness alignment waits for the active goal to pause or complete')
    }
    const model = selected.model
    const result = z.object({ thread: threadSchema }).parse(
      await connection.request('thread/fork', {
        threadId: sourceId,
        model: selected.selector,
        modelProvider: model.model_provider_id ?? source.modelProvider ?? 'trae',
        cwd: input.launch.cwd,
        baseInstructions: model.base_instructions,
        config: {
          ...(typeof model.tool_mode === 'string'
            ? { model_tool_modes: { [model.slug]: model.tool_mode } }
            : {}),
          ...(selected.backendVariant ? { model_backend_variant: selected.backendVariant } : {}),
          model_reasoning_effort: input.effort ?? selected.effort ?? source.reasoningEffort
        },
        excludeTurns: true,
        deferGoalContinuation: true,
        ephemeral: false
      })
    ).thread
    const contextId = await context.establish(
      connection,
      result.id,
      selected,
      input.effort ?? selected.effort ?? source.reasoningEffort ?? undefined,
      input.signal
    )
    const executed = await readTraeSessionState(result.path, input.signal)
    if (
      result.id === sourceId ||
      executed.turnId !== contextId ||
      !sameTraeHarness(executed.harness, model.harness_metadata)
    ) {
      throw new Error('TRAE did not confirm the aligned conversation Harness')
    }
    const receipt = { sessionId: result.id, historySessionId }
    pendingReceipt = receipt
    input.assertCurrent()
    return receipt
  })().finally(async () => {
    input.signal?.removeEventListener('abort', aborted)
    stopped = await connection.close()
  })
  if (!stopped) {
    throw new Error('TRAE Harness setup process could not be stopped')
  }
  input.assertCurrent()
  if (pendingReceipt) {
    for (const id of new Set([input.sessionId, sourceId, pendingReceipt.sessionId])) {
      await writeTraeHarnessReceipt(
        traeHarnessReceiptPath(input.dataDirectory, home, id),
        pendingReceipt
      )
    }
  }
  return aligned
}
