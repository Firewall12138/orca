import type * as Monaco from 'monaco-editor'
import { GO_TOKEN_PREFIX } from '../editor/appearance/plugin-monaco-token-rules'
import { defineBuiltInTextMateThemes } from './textmate-monaco-theme-rules'
import { createTokensProvider, loadEditorCore } from './textmate-token-provider'
import { createTextMateScopeMapper } from './textmate-token-scopes'

export async function createGoTokensProvider(
  monaco: Pick<typeof Monaco, 'editor'>
): Promise<Monaco.languages.TokensProvider> {
  const [editorCore, { default: grammars }, { dark, light }] = await Promise.all([
    loadEditorCore(),
    import('shiki/langs/go.mjs'),
    defineBuiltInTextMateThemes(monaco)
  ])
  await editorCore.core.loadLanguage(...grammars)
  const registration = grammars[0]
  const selectors = new Set(
    [...dark, ...light]
      .filter((rule) => rule.token.startsWith(GO_TOKEN_PREFIX))
      .map((rule) => rule.token.slice(GO_TOKEN_PREFIX.length))
  )
  return createTokensProvider(
    editorCore,
    editorCore.core.getLanguage(registration.name),
    GO_TOKEN_PREFIX + registration.scopeName,
    createTextMateScopeMapper(selectors, GO_TOKEN_PREFIX, registration.scopeName)
  )
}
