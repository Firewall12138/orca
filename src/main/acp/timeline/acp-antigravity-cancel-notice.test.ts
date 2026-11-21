import { afterEach, expect, it } from 'vitest'
import { closeProviderTimelineRigs } from '../../native-chat/agent-session-timeline/provider-timeline-assembler-test-support'
import { ANTIGRAVITY_ACP_DIALECT } from '../acp-dialects/antigravity-dialect'
import type { AcpFixtureFrame } from './testing/acp-timeline-fixture.test-support'
import { openAcpFixtureRig } from './testing/acp-timeline-fixture.test-support'

afterEach(closeProviderTimelineRigs)

const sessionId = 'b01e6441-0494-436c-bcad-2a5387f91ae3'
const update = (value: unknown): AcpFixtureFrame => ({
  direction: 'in',
  process: 'A',
  message: { method: 'session/update', params: { sessionId, update: value } }
})
const reply = (text: string) =>
  update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } })

// Frames from agy 1.5.13 cancelled mid-reply (session/cancel, then stopReason "cancelled"). When the
// cancel lands on the model request, agy relays its backend's exception as one reply chunk before
// the stop reason; that chunk is what a group showed as a bot's whole answer (#46172, #45243).
const cancelledTurn = (notice: string): AcpFixtureFrame[] => [
  {
    direction: 'out',
    process: 'A',
    message: {
      id: 3,
      method: 'session/prompt',
      params: { sessionId, prompt: [{ type: 'text', text: 'Answer the question.' }] }
    }
  },
  update({ sessionUpdate: 'session_info_update', title: 'Answer' }),
  reply('Checking the logs first.'),
  { direction: 'out', process: 'A', message: { method: 'session/cancel', params: { sessionId } } },
  reply(notice),
  { direction: 'in', process: 'A', message: { id: 3, result: { stopReason: 'cancelled' } } }
]

async function replyText(frames: AcpFixtureFrame[]) {
  const fixture = await openAcpFixtureRig(ANTIGRAVITY_ACP_DIALECT)
  const rows = await fixture.feed(frames)
  const text = rows
    .flatMap((row) =>
      row.body.kind === 'message' && row.body.role === 'assistant' ? row.body.blocks : []
    )
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('')
  return { text, turns: await fixture.rig.turns(), rows }
}

it("keeps agy's cancellation notice out of a cancelled turn's reply", async () => {
  const { text, turns, rows } = await replyText(
    cancelledTurn('The request was cancelled by the client.')
  )
  expect(text).toBe('Checking the logs first.')
  expect(turns.map((turn) => [turn.state, turn.outcome])).toEqual([['interrupted', 'cancellation']])
  // A cancel is not a failure: no error row stands in for the dropped line either.
  expect(rows.some((row) => row.body.kind === 'status')).toBe(false)
})

it('drops the notice when it follows a cancelled tool error on the same line', async () => {
  const { text } = await replyText(
    cancelledTurn('context canceledThe request was cancelled by the client.')
  )
  expect(text).toBe('Checking the logs first.')
})

it('keeps a reply that only mentions the notice', async () => {
  const { text } = await replyText(
    cancelledTurn('The log says: The request was cancelled by the client.')
  )
  expect(text).toContain('The log says: The request was cancelled by the client.')
})
