import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import {
  readTranscriptSlice,
  transcriptFileStat
} from '../native-chat/transcript-filesystem/wsl-transcript-fs-access'
import { traeHarnessMetadataSchema } from './trae-harness-model'

const receiptSchema = z.object({
  sessionId: z.string().min(1),
  historySessionId: z.string().min(1)
})
export type TraeHarnessReceipt = z.infer<typeof receiptSchema>

const contextSchema = z.object({
  type: z.literal('turn_context'),
  payload: z.looseObject({
    turn_id: z.string(),
    harness_metadata: traeHarnessMetadataSchema.optional()
  })
})
const CONTEXT_SCAN_BYTES = 256 * 1024
const MAX_CONTEXT_LINE_BYTES = 2 * 1024 * 1024

/** The latest executed context outranks the declaration at the start of a fork. */
export async function readTraeSessionState(path: string, signal?: AbortSignal) {
  const stat = await transcriptFileStat(path, 'exact', signal)
  let end = stat.size
  let fragments: Buffer[] = []
  let fragmentBytes = 0
  let overflow = false
  while (end > 0) {
    const start = Math.max(0, end - CONTEXT_SCAN_BYTES)
    const part = await readTranscriptSlice(path, start, end - start, 'exact', signal)
    let right = part.length
    while (right > 0) {
      const newline = part.lastIndexOf(10, right - 1)
      const segment = part.subarray(newline + 1, right)
      if (newline !== -1 || start === 0) {
        const first = segment.length ? segment : fragments[0]
        if (first && /"type"\s*:\s*"turn_context"/.test(first.subarray(0, 256).toString('utf8'))) {
          if (overflow) {
            throw new Error('TRAE execution context exceeds the bounded metadata reader')
          }
          const line = Buffer.concat([segment, ...fragments]).toString('utf8')
          const context = contextSchema.parse(JSON.parse(line)).payload
          return { harness: context.harness_metadata, turnId: context.turn_id, inherited: false }
        }
        fragments = []
        fragmentBytes = 0
        overflow = false
      } else {
        fragments.unshift(segment)
        fragmentBytes += segment.length
        if (fragmentBytes > MAX_CONTEXT_LINE_BYTES) {
          fragments = []
          fragmentBytes = 0
          overflow = true
        }
      }
      right = newline
    }
    end = start
  }
  const head = await readTranscriptSlice(path, 0, 256 * 1024, 'exact', signal)
  const line = head.toString('utf8').split(/\r?\n/, 1)[0]
  const parsed = z
    .object({
      type: z.literal('session_meta'),
      payload: z.looseObject({
        harness_metadata: traeHarnessMetadataSchema.optional(),
        history_base: z.unknown().optional()
      })
    })
    .parse(JSON.parse(line))
  return {
    harness: parsed.payload.harness_metadata,
    turnId: null,
    inherited: parsed.payload.history_base !== undefined
  }
}

export async function readTraeSessionHarness(path: string, signal?: AbortSignal) {
  return (await readTraeSessionState(path, signal)).harness
}

/** Follow older migration receipts without creating a second fork of an already migrated id. */
export async function resolveTraeHarnessReceipt(
  directory: string,
  home: string,
  sessionId: string
) {
  const seen = new Set<string>()
  let current = sessionId
  let historySessionId = sessionId
  for (let depth = 0; depth < 32; depth += 1) {
    if (seen.has(current)) {
      throw new Error('TRAE Harness migration receipts form a cycle')
    }
    seen.add(current)
    const receipt = await readTraeHarnessReceipt(traeHarnessReceiptPath(directory, home, current))
    if (!receipt) {
      return { sessionId: current, historySessionId }
    }
    historySessionId = receipt.historySessionId
    if (receipt.sessionId === current) {
      return receipt
    }
    current = receipt.sessionId
  }
  throw new Error('TRAE Harness migration chain is too long')
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
  return writeTraeStateRecord(path, value)
}

export async function writeTraeStateRecord(path: string, value: unknown) {
  const folder = dirname(path)
  await mkdir(folder, { recursive: true, mode: 0o700 })
  const temporary = `${path}.${randomUUID()}`
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 })
  await rename(temporary, path)
}
