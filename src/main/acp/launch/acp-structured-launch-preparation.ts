// Startup never installs a managed runtime; missing installations must fail before spawn.

import '../../native-chat/agent-session-wire/providers/structured-agent-session-adapter'
import {
  AgentSessionPreSpawnError,
  launchPreparationFailure
} from '../../native-chat/agent-session-wire/providers/structured-agent-session-adapter-errors'
import type { StructuredAgentSessionAcquireInput } from '../../native-chat/agent-session-wire/providers/structured-agent-session-adapter'
import type { AntigravityChatAuthConfig } from '../../../shared/agent-accounts/antigravity/antigravity-chat-auth-config'
import type { AcpStructuredLaunch } from './acp-structured-launch-resolution'
import type { AcpStructuredSessionAdapterDeps } from '../session/acp-structured-session-adapter-deps'
import type { AcpLaunchSpec } from './acp-launch-contract'
import { agentSessionProviderHandleKey } from '../../../shared/agent-session/lifecycle/provider-handles/agent-session-provider-handle-encoding'

export async function prepareAcpStructuredLaunch(
  deps: Pick<AcpStructuredSessionAdapterDeps, 'resolveLaunch' | 'dataDirectory'>,
  acquire: Pick<
    StructuredAgentSessionAcquireInput,
    'identity' | 'spawnToken' | 'permissionMode' | 'signal'
  >,
  closedBeforeSpawn: () => void
): Promise<AcpStructuredLaunch> {
  const resolveLaunch = () =>
    deps.resolveLaunch({
      identity: acquire.identity,
      spawnToken: acquire.spawnToken,
      ...(acquire.permissionMode ? { permissionMode: acquire.permissionMode } : {})
    })
  const launch = await prepareAcpLaunch(resolveLaunch, closedBeforeSpawn)
  if (!launch.resume || !launch.spec.prepareResume) {
    return launch
  }
  const prepared = await launch.spec.prepareResume({
    launch,
    prefixArgs: launch.prefixArgs,
    sessionId: launch.resume.sessionId,
    model: launch.resume.model,
    effort: launch.resume.effort,
    dataDirectory: deps.dataDirectory,
    signal: acquire.signal,
    assertCurrent: closedBeforeSpawn
  })
  closedBeforeSpawn()
  return prepared
    ? {
        ...launch,
        resume: {
          ...launch.resume,
          ...prepared,
          ...(prepared.sessionId !== launch.resume.sessionId
            ? { forkedFromKey: launch.resume.key }
            : {}),
          key: agentSessionProviderHandleKey({
            transport: 'acp',
            agent: launch.spec.agent,
            nativeId: prepared.sessionId
          })
        }
      }
    : launch
}

/** Prepares the backend the launch resolved to, which the chat's account home pins. */
export async function prepareAcpLaunch<
  Launch extends {
    command: string
    env: Record<string, string>
    spec: AcpLaunchSpec
    antigravityChatAuth?: AntigravityChatAuthConfig
  }
>(resolve: () => Promise<Launch>, closedBeforeSpawn: () => void): Promise<Launch> {
  const preparationFailure = (error: unknown): never => {
    closedBeforeSpawn()
    throw launchPreparationFailure(error)
  }
  const launch = await resolve().catch(preparationFailure)
  const { spec } = launch
  closedBeforeSpawn()
  // Only a missed lookup returns the bare command; explicit Command settings resolve or fail.
  if (spec.managedRuntime && launch.command === spec.command) {
    throw new AgentSessionPreSpawnError(
      new Error(`${spec.managedRuntime.label} is not installed on this host`),
      { reason: 'runtimeNotInstalled' }
    )
  }
  const { prepare } = spec.account
  if (prepare) {
    await prepare(launch.env, launch.antigravityChatAuth, closedBeforeSpawn).catch(
      preparationFailure
    )
    closedBeforeSpawn()
  }
  return launch
}
