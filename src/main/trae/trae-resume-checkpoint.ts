import { lazyZodSchema } from '../../shared/schema/lazy-zod-schema'
import { createHash, webcrypto } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import type { AcpClosedCheckpointInput } from '../acp/launch/acp-launch-contract'
import { resolveTraeCliHome } from './trae-cli-home'
import { resolveSessionFilePath } from '../native-chat/session-file-resolver'
import {
  transcriptFileStat,
  readTranscriptSlice
} from '../native-chat/transcript-filesystem/wsl-transcript-fs-access'
import { writeTraeStateRecord } from './trae-harness-state'

const stampSchema = lazyZodSchema(() =>
  z.object({
    path: z.string(),
    size: z.number(),
    mtimeMs: z.number(),
    ctimeMs: z.number(),
    ino: z.number(),
    dev: z.number()
  })
)
type Stamp = z.infer<typeof stampSchema>
const checkpointSchema = lazyZodSchema(() => stampSchema.extend({ digest: z.string().length(64) }))
const MAX_DIGEST_BYTES = 128 * 1024 * 1024
const MAX_SETTINGS_APPEND_BYTES = 1024 * 1024

async function digest(path: string, size: number) {
  const data = await readTranscriptSlice(path, 0, size, 'exact')
  return Buffer.from(await webcrypto.subtle.digest('SHA-256', new Uint8Array(data))).toString('hex')
}

function checkpointPath(directory: string, home: string, id: string) {
  const key = createHash('sha256')
    .update(JSON.stringify([home, id]))
    .digest('hex')
  return join(directory, 'trae-resume-checkpoints', `${key}.json`)
}

async function stamp(path: string): Promise<Stamp> {
  const stat = await transcriptFileStat(path, 'exact')
  return stampSchema.parse({ path, ...stat })
}

function sameStamp(a: Stamp, b: Stamp) {
  return (
    a.path === b.path &&
    a.size === b.size &&
    a.mtimeMs === b.mtimeMs &&
    a.ctimeMs === b.ctimeMs &&
    a.ino === b.ino &&
    a.dev === b.dev
  )
}

export async function canFastResumeTrae(directory: string, home: string, id: string, path: string) {
  try {
    const saved = checkpointSchema.parse(
      JSON.parse(await readFile(checkpointPath(directory, home, id), 'utf8'))
    )
    return sameStamp(saved, await stamp(path))
  } catch {
    return false
  }
}

/** Native resume may append settings; any conversation record or changed prefix requires replay. */
export async function validateTraeResumeCheckpoint(input: AcpClosedCheckpointInput) {
  const home = resolveTraeCliHome(input.launch.env, homedir())
  try {
    const saved = checkpointSchema.parse(
      JSON.parse(await readFile(checkpointPath(input.dataDirectory, home, input.sessionId), 'utf8'))
    )
    const current = await stamp(saved.path)
    if (sameStamp(saved, current)) {
      return true
    }
    if (
      saved.dev !== current.dev ||
      saved.ino !== current.ino ||
      saved.size > MAX_DIGEST_BYTES ||
      current.size < saved.size ||
      current.size - saved.size > MAX_SETTINGS_APPEND_BYTES ||
      (await digest(saved.path, saved.size)) !== saved.digest
    ) {
      return false
    }
    const appended = await readTranscriptSlice(
      saved.path,
      saved.size,
      current.size - saved.size,
      'exact'
    )
    for (const line of appended.toString('utf8').split('\n').filter(Boolean)) {
      const record = z
        .object({
          type: z.literal('event_msg'),
          payload: z.object({
            type: z.literal('thread_settings_applied'),
            thread_id: z.literal(input.sessionId)
          })
        })
        .safeParse(JSON.parse(line))
      if (!record.success) {
        return false
      }
    }
    return sameStamp(current, await stamp(saved.path))
  } catch {
    return false
  }
}

export async function captureTraeClosedCheckpoint(input: AcpClosedCheckpointInput) {
  const home = resolveTraeCliHome(input.launch.env, homedir())
  const path = await resolveSessionFilePath('codex', input.sessionId, {
    codexSessionsDirs: [join(home, 'sessions'), join(home, 'archived_sessions')],
    strictErrors: true
  })
  if (!path) {
    return null
  }
  const before = await stamp(path)
  if (before.size > MAX_DIGEST_BYTES) {
    return null
  }
  const hash = await digest(path, before.size)
  return async () => {
    if (sameStamp(before, await stamp(path))) {
      await writeTraeStateRecord(checkpointPath(input.dataDirectory, home, input.sessionId), {
        ...before,
        digest: hash
      })
    }
  }
}
