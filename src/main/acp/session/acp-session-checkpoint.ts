import { withTimeout } from '../../../shared/concurrency/promise-timeout-fallback'
import type { AcpStructuredSession } from './acp-structured-session-contract'
import type { AcpStructuredConnection } from '../process/acp-structured-connection'
import type { AcpStructuredLaunch } from '../launch/acp-structured-launch-resolution'

export async function openAcpWithCheckpoint(
  connection: AcpStructuredConnection,
  params: Parameters<AcpStructuredConnection['start']>[0],
  received: Parameters<AcpStructuredConnection['start']>[1],
  context: { launch: AcpStructuredLaunch; dataDirectory: string }
) {
  const opened = await connection.start(params, received)
  const validate = context.launch.spec.validateResumeCheckpoint
  if (
    opened.kind === 'resume' &&
    validate &&
    !(await validate({
      ...context,
      sessionId: opened.sessionId
    }))
  ) {
    return connection.start({ ...params, resumePreference: 'load' }, received)
  }
  return opened
}

/** Never reuse a native file unless every admitted journal write was committed before its close. */
export async function prepareAcpSessionCheckpoint(
  session: AcpStructuredSession
): Promise<(() => Promise<void>) | null> {
  if (
    !session.prepareClosedCheckpoint ||
    session.journalClosed !== null ||
    session.turns.running ||
    !session.lane.checkpointReady ||
    !session.events?.written
  ) {
    return null
  }
  const written = await withTimeout(session.events.written(), 1_000, null)
  if (!written?.ok || !session.lane.checkpointReady) {
    return null
  }
  return withTimeout(session.prepareClosedCheckpoint(), 1_000, null)
}

export async function commitAcpSessionCheckpoint(commit: (() => Promise<void>) | null) {
  if (commit) {
    await withTimeout(commit(), 1_000, undefined)
  }
}
