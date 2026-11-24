import { z } from 'zod'
import { waitForPromiseWithSignal } from '../../shared/concurrency/abort-signal-reason'
import type { CodexAppServerConnection } from '../codex/app-server/codex-app-server-connection-types'
import type { selectedTraeHarnessModel } from './trae-harness-model'

const completedSchema = z.object({
  turn: z.object({ id: z.string(), status: z.string() })
})
const startedSchema = z.object({ turn: z.object({ id: z.string() }) })

/** One controlled turn persists the configured execution context before ACP restores it. */
export class TraeHarnessContext {
  private completed = new Map<string, string>()
  private waiters = new Map<string, (status: string) => void>()

  onNotification = (method: string, params: unknown): void => {
    if (method !== 'turn/completed') {
      return
    }
    const parsed = completedSchema.safeParse(params)
    if (parsed.success) {
      const { id, status } = parsed.data.turn
      this.completed.set(id, status)
      this.waiters.get(id)?.(status)
    }
  }

  async establish(
    connection: CodexAppServerConnection,
    threadId: string,
    selected: ReturnType<typeof selectedTraeHarnessModel>,
    effort: string | undefined,
    signal?: AbortSignal
  ): Promise<string> {
    signal?.throwIfAborted()
    const { turn } = startedSchema.parse(
      await connection.request('turn/start', {
        threadId,
        input: [
          {
            type: 'text',
            text: '本条仅用于 Orca 对齐会话执行框架。不要调用任何工具，不要读写文件，不要继续业务任务，只回复“会话执行框架已对齐”。'
          }
        ],
        displayText: 'Orca 正在对齐会话执行框架',
        environments: [],
        capabilities: { skills: [], mcpServers: [] },
        model: selected.selector,
        modelProvider: selected.model.model_provider_id,
        modelBackendVariant: selected.backendVariant,
        effort,
        collaborationMode: {
          mode: 'default',
          settings: {
            model: selected.selector,
            reasoning_effort: effort,
            developer_instructions: null
          }
        }
      })
    )
    const pending = new Promise<string>((resolve) => {
      this.waiters.set(turn.id, resolve)
      const done = this.completed.get(turn.id)
      if (done) {
        resolve(done)
      }
    })
    try {
      const bounded = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(120_000)])
        : AbortSignal.timeout(120_000)
      const status = await waitForPromiseWithSignal(pending, bounded)
      if (status !== 'completed') {
        throw new Error(`TRAE Harness configuration turn ended ${status}`)
      }
      return turn.id
    } finally {
      this.waiters.delete(turn.id)
      this.completed.delete(turn.id)
    }
  }
}
