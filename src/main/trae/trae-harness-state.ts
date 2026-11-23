import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { readTranscriptSlice } from '../native-chat/transcript-filesystem/wsl-transcript-fs-access'
import { traeHarnessMetadataSchema } from './trae-harness-model'

const receiptSchema = z.object({
  sessionId: z.string().min(1),
  historySessionId: z.string().min(1)
})
export type TraeHarnessReceipt = z.infer<typeof receiptSchema>

export async function readTraeSessionHarness(path: string, signal?: AbortSignal) {
  const head = await readTranscriptSlice(path, 0, 256 * 1024, 'exact', signal)
  const line = head.toString('utf8').split(/\r?\n/, 1)[0]
  const parsed = z
    .object({
      type: z.literal('session_meta'),
      payload: z.looseObject({
        harness_metadata: traeHarnessMetadataSchema.optional()
      })
    })
    .parse(JSON.parse(line))
  return parsed.payload.harness_metadata
}

export function traeHarnessReceiptPath(directory: string, home: string, sessionId: string) {
  const key = createHash('sha256')
    .update(JSON.stringify([home, sessionId]))
    .digest('hex')
  return join(directory, 'trae-harness-alignment', `${key}.json`)
}

export async function readTraeHarnessReceipt(
  path: string
): Promise<TraeHarnessReceipt | undefined> {
  try {
    return receiptSchema.parse(JSON.parse(await readFile(path, 'utf8')))
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined
    }
    throw error
  }
}

export async function writeTraeHarnessReceipt(path: string, value: TraeHarnessReceipt) {
  const folder = dirname(path)
  await mkdir(folder, { recursive: true, mode: 0o700 })
  const temporary = `${path}.${randomUUID()}`
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 })
  await rename(temporary, path)
}
