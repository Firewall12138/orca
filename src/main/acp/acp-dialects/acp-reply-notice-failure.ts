import { z } from 'zod'
import type { AcpDialectNotification, AcpTurnEnding } from './acp-dialect'

// Reads only these fields, so the many tool updates of a turn are rejected at the literal.
const replyTextSchema = z.object({
  update: z.object({
    sessionUpdate: z.literal('agent_message_chunk'),
    content: z.object({ type: z.literal('text'), text: z.string() })
  })
})

/** The text of a reply chunk; undefined for every other notification. */
export function acpReplyChunkText(method: string, params: unknown): string | undefined {
  return method === 'session/update'
    ? replyTextSchema.safeParse(params).data?.update.content.text
    : undefined
}

/** A reply chunk that is wholly the agent's own failure notice fails the turn in its place. */
export function acpReplyNoticeFailure(
  method: string,
  params: unknown,
  notice: RegExp,
  cause: Pick<AcpTurnEnding, 'notSignedIn'> = {}
): AcpDialectNotification | undefined {
  const text = acpReplyChunkText(method, params)
  return text && notice.test(text)
    ? { disposition: 'map', failure: { stopReason: 'error', ...cause, failureDetail: text.trim() } }
    : undefined
}
