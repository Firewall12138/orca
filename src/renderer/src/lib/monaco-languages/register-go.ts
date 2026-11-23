import type * as Monaco from 'monaco-editor'

/** Keep Monaco's Go registration and editing configuration, replacing only its tokenizer. */
export function registerGoLanguage(monaco: Pick<typeof Monaco, 'languages' | 'editor'>): void {
  monaco.languages.registerTokensProviderFactory('go', {
    create: () =>
      import('./go-textmate-tokens')
        .then(({ createGoTokensProvider }) => createGoTokensProvider(monaco))
        .catch(async (error: unknown) => {
          console.warn('[go] TextMate highlighting failed to load; using Monarch', error)
          const { language } = await import('monaco-editor/esm/vs/basic-languages/go/go.js')
          return language
        })
  })
}
