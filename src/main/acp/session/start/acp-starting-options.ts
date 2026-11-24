import type { StructuredAgentSessionAcquireInput } from '../../../native-chat/agent-session-wire/providers/structured-agent-session-adapter'
import type { AcpStructuredLaunch } from '../../launch/acp-structured-launch-resolution'
import type { AcpStructuredOptions } from '../../options/acp-structured-options'
import type { AcpStructuredConnection } from '../../process/acp-structured-connection'
import type { AcpStructuredChild } from '../children/acp-structured-child'
import {
  ACP_OPTION_WRITE_TIMEOUT_MS,
  type AcpStructuredSessionAdapterDeps
} from '../acp-structured-session-adapter-deps'
import { writeAcpSessionOption } from '../../options/acp-session-option-write'
import { acpAgentName } from '../acp-structured-agent-definitions'

type StartingOptionsInput = {
  launch: Pick<AcpStructuredLaunch, 'spec' | 'launchModel' | 'startupOptions'>
  options: AcpStructuredOptions
  connection: AcpStructuredConnection
  permissionMode: StructuredAgentSessionAcquireInput['permissionMode']
  permissionModes: AcpStructuredChild['permissionModes']
  newSession: boolean
  signal: AbortSignal
  assertCurrent: () => void
} & Pick<AcpStructuredSessionAdapterDeps, 'optionWriteTimeoutMs'>

const STARTING_OPTIONS = [
  { key: 'model', label: 'model' },
  { key: 'contextSize', label: 'context size' },
  { key: 'effort', label: 'reasoning effort' },
  { key: 'fastMode', label: 'fast mode' }
] as const

export async function applyAcpStartingOptions(input: StartingOptionsInput): Promise<void> {
  const { launch, options, connection, assertCurrent } = input
  const agentName = acpAgentName(launch.spec.agent)
  const mode = launch.spec.permissionModeConfig
  if (mode && input.permissionMode !== 'own') {
    const wanted = input.permissionMode ?? 'ask'
    const requested = input.permissionModes?.[wanted]
    if (requested === undefined) {
      throw new Error(`${agentName} on this host cannot run in the ${wanted} permission mode`)
    }
    const configId = options.modeConfigId()
    await connection.setConfigOption(configId, requested, undefined, ({ configOptions }) => {
      assertCurrent()
      if (configOptions.find((option) => option.id === configId)?.currentValue !== requested) {
        throw new Error('Permission mode could not be confirmed')
      }
      options.adoptConfigOptions(configOptions)
    })
    assertCurrent()
  }
  if (!input.newSession) {
    return
  }
  if (launch.launchModel) {
    options.adoptLaunchModel(launch.launchModel)
  }
  // A model change refreshes the other controls, so apply its context and effort afterward.
  for (const { key, label } of STARTING_OPTIONS) {
    const value = launch.startupOptions?.[key]
    if (value === undefined) {
      continue
    }
    assertCurrent()
    options.notePick(key)
    if (String(options.read().current[key]) === value) {
      options.adoptOwnWrite(key, value)
      continue
    }
    const write = options.write(key, value)
    if (!write) {
      throw new Error(`${agentName} cannot apply the selected ${label}: ${value}`)
    }
    await writeAcpSessionOption(connection, options, write, {
      agent: launch.spec.agent,
      timeoutMs: input.optionWriteTimeoutMs ?? ACP_OPTION_WRITE_TIMEOUT_MS,
      signal: input.signal,
      onUncertain: () => void connection.close(),
      key,
      value
    })
    assertCurrent()
    if (String(options.read().current[key]) !== value) {
      throw new Error(`${agentName} did not confirm the selected ${label}: ${value}`)
    }
  }
  const current = options.read().current
  for (const { key, label } of STARTING_OPTIONS) {
    const value = launch.startupOptions?.[key]
    if (value !== undefined && String(current[key]) !== value) {
      throw new Error(`${agentName} did not retain the selected ${label}: ${value}`)
    }
  }
}
