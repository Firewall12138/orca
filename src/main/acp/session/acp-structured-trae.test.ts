import { describe, expect, it } from 'vitest'
import { AcpStructuredOptions } from '../options/acp-structured-options'
import { TRAE_ACP_DIALECT } from '../acp-dialects/trae-dialect'

describe('TRAE model identifiers', () => {
  it('sends the native MAX model identifier instead of the lossy configuration family', () => {
    const options = new AcpStructuredOptions(TRAE_ACP_DIALECT)
    options.adoptSession(
      {
        models: {
          currentModelId: 'gpt-6.1-sol/max/xhigh',
          availableModels: [{ modelId: 'gpt-6.1-sol/max/xhigh', name: 'GPT-6.1-Sol (xhigh, max)' }]
        },
        configOptions: [
          {
            id: 'model',
            name: 'Model',
            category: 'model',
            type: 'select',
            currentValue: 'gpt-6.1-sol',
            options: [{ value: 'gpt-6.1-sol', name: 'GPT-6.1-Sol' }]
          },
          {
            id: 'reasoning_effort',
            name: 'Reasoning',
            category: 'thought_level',
            type: 'select',
            currentValue: 'xhigh',
            options: [{ value: 'xhigh', name: 'Xhigh' }]
          }
        ]
      },
      'loaded'
    )
    expect(options.read().current).toEqual({ model: 'gpt-6.1-sol/max/xhigh', confirmed: ['model'] })
    expect(options.write('model', 'gpt-6.1-sol/max/xhigh')).toEqual({
      method: 'model',
      modelId: 'gpt-6.1-sol/max/xhigh'
    })
  })
})
