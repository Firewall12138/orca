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
  readTraeHarnessReceipt,
  readTraeSessionHarness,
  traeHarnessReceiptPath,
  writeTraeHarnessReceipt
} from './trae-harness-state'

const threadSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  model: z.string().nullish(),
  modelProvider: z.string().nullish(),
  reasoningEffort: z.string().nullish(),
  status: z.object({ type: z.string() }).optional()
})

export async function prepareTraeHarnessResume(input: AcpResumePreparationInput) {
  const home = resolveTraeCliHome(input.launch.env, homedir())
  const path = traeHarnessReceiptPath(input.dataDirectory, home, input.sessionId)
  const previous = await readTraeHarnessReceipt(path)
  const sourceId = previous?.sessionId ?? input.sessionId
  const historySessionId = previous?.historySessionId ?? input.sessionId
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
    return previous ? { sessionId: sourceId, historySessionId } : undefined
  }
  const listing = await runAgentModelCatalogListing(
    { ...input.launch, args: [...input.prefixArgs, 'debug', 'models'] },
    { site: 'trae-harness-models', signal: input.signal }
  )
  const models = readTraeHarnessModels(listing)
  const saved = await readTraeSessionHarness(sourcePath, input.signal)
  if (
    input.model &&
    sameTraeHarness(saved, selectedTraeHarnessModel(models, input.model).model.harness_metadata)
  ) {
    return previous ? { sessionId: sourceId, historySessionId } : undefined
  }
  const rpcLaunch = {
    ...input.launch,
    args: [...input.prefixArgs, 'app-server']
  }
  const connection = await spawnCodexAppServerConnection(rpcLaunch)
  const aborted = () => void connection.close()
  input.signal?.addEventListener('abort', aborted, { once: true })
  let stopped = false
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
    if (sameTraeHarness(saved, selected.model.harness_metadata)) {
      return previous ? { sessionId: sourceId, historySessionId } : undefined
    }
    if (source.status?.type === 'active' || source.status?.type === 'inProgress') {
      throw new Error(
        'TRAE is still executing this conversation; Harness alignment waits for it to finish'
      )
    }
    const model = selected.model
    const result = z.object({ thread: threadSchema }).parse(
      await connection.request('thread/fork', {
        threadId: sourceId,
        model: model.slug,
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
    if (
      result.id === sourceId ||
      !sameTraeHarness(
        await readTraeSessionHarness(result.path, input.signal),
        model.harness_metadata
      )
    ) {
      throw new Error('TRAE did not confirm the aligned conversation Harness')
    }
    const receipt = { sessionId: result.id, historySessionId }
    await writeTraeHarnessReceipt(path, receipt)
    await writeTraeHarnessReceipt(
      traeHarnessReceiptPath(input.dataDirectory, home, result.id),
      receipt
    )
    input.assertCurrent()
    return receipt
  })().finally(async () => {
    input.signal?.removeEventListener('abort', aborted)
    stopped = await connection.close()
  })
  if (!stopped) {
    throw new Error('TRAE Harness setup process could not be stopped')
  }
  return aligned
}
