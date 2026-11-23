import type * as Monaco from 'monaco-editor'
import type { IToken } from 'shiki/textmate'
import type { BundledLanguageInfo } from 'shiki/types'
import {
  MARKDOWN_THEMABLE_SCOPES,
  MARKDOWN_TOKEN_PREFIX
} from '../editor/appearance/plugin-monaco-token-rules'
import { COLD_GRAMMAR_LINE_ATTEMPTS } from '../syntax-highlighting/textmate-core'
import { defineBuiltInTextMateThemes } from './textmate-monaco-theme-rules'
import { createTextMateScopeMapper } from './textmate-token-scopes'
import { createTokensProvider, loadEditorCore } from './textmate-token-provider'

type MonacoModule = {
  editor: Pick<typeof Monaco.editor, 'defineTheme'>
  languages: Pick<typeof Monaco.languages, 'setTokensProvider'>
}

const MARKDOWN_LANGUAGE_ID = 'markdown'
const MARKDOWN_SCOPE_NAME = 'text.html.markdown'
// The grammar's catch-all fence rule; a specific fence rule takes over once its grammar loads.
const UNKNOWN_FENCE_LANGUAGE_SCOPE = 'fenced_code.block.language'
// The catch-all rule captures the whole info string, e.g. `ts title="a.ts"`.
const FENCE_INFO_SEPARATOR = /[\s{,:?]/

function fenceLanguagesByLabel(
  bundledLanguagesInfo: readonly BundledLanguageInfo[],
  embeddedLanguageIds: readonly string[]
): Map<string, BundledLanguageInfo> {
  const embedded = new Set(embeddedLanguageIds)
  const byLabel = new Map<string, BundledLanguageInfo>()
  for (const info of bundledLanguagesInfo) {
    if (embedded.has(info.id)) {
      for (const label of [info.id, ...(info.aliases ?? [])]) {
        byLabel.set(label, info)
      }
    }
  }
  return byLabel
}

/** VS Code's markdown grammar with Dark+/Light+ colors; YAML loads up front for frontmatter, fence grammars on first sight. */
export async function createMarkdownTokensProvider(
  monaco: MonacoModule
): Promise<Monaco.languages.TokensProvider> {
  const [
    editorCore,
    { default: markdownGrammars },
    { default: yamlGrammars },
    { bundledLanguagesInfo },
    { dark: darkRules, light: lightRules }
  ] = await Promise.all([
    loadEditorCore(),
    import('shiki/langs/markdown.mjs'),
    import('shiki/langs/yaml.mjs'),
    import('shiki/langs'),
    defineBuiltInTextMateThemes(monaco)
  ])
  // Why: frontmatter embeds YAML at the document start, with no fence label to trigger a lazy load.
  await editorCore.core.loadLanguage(...markdownGrammars, ...yamlGrammars)

  const mapScopes = createTextMateScopeMapper(
    new Set([
      ...[...darkRules, ...lightRules]
        .filter((rule) => rule.token.startsWith(MARKDOWN_TOKEN_PREFIX))
        .map((rule) => rule.token.slice(MARKDOWN_TOKEN_PREFIX.length)),
      ...MARKDOWN_THEMABLE_SCOPES
    ]),
    MARKDOWN_TOKEN_PREFIX,
    MARKDOWN_SCOPE_NAME
  )

  const fenceLanguages = fenceLanguagesByLabel(
    bundledLanguagesInfo,
    markdownGrammars[0]?.embeddedLangsLazy ?? []
  )
  const requestedFenceLanguages = new Set<string>()
  let refreshQueued = false

  function refreshProvider(): void {
    if (refreshQueued) {
      return
    }
    refreshQueued = true
    queueMicrotask(() => {
      refreshQueued = false
      // Why: loading a grammar rebuilds markdown's grammar; replacing the provider retokenizes from its fresh start state.
      monaco.languages.setTokensProvider(MARKDOWN_LANGUAGE_ID, buildProvider())
    })
  }

  function loadFenceLanguage(label: string): void {
    const info = fenceLanguages.get(label.trim().split(FENCE_INFO_SEPARATOR)[0].toLowerCase())
    if (!info || requestedFenceLanguages.has(info.id)) {
      return
    }
    requestedFenceLanguages.add(info.id)
    void info
      .import()
      .then(({ default: grammars }) => editorCore.core.loadLanguage(...grammars))
      .then(refreshProvider)
      .catch((error: unknown) => {
        console.warn(
          `[markdown] failed to load the ${info.id} fence grammar; it stays plain`,
          error
        )
      })
  }

  function observeFenceLabels(line: string, tokens: readonly IToken[]): void {
    for (const token of tokens) {
      if (token.scopes.at(-1) === UNKNOWN_FENCE_LANGUAGE_SCOPE) {
        loadFenceLanguage(line.slice(token.startIndex, token.endIndex))
      }
    }
  }

  function buildProvider(): Monaco.languages.TokensProvider {
    return createTokensProvider(
      editorCore,
      editorCore.core.getLanguage(MARKDOWN_LANGUAGE_ID),
      MARKDOWN_SCOPE_NAME,
      mapScopes,
      observeFenceLabels,
      // Why: each fence grammar compiles on its first block, long after the markdown root has warmed.
      COLD_GRAMMAR_LINE_ATTEMPTS
    )
  }

  return buildProvider()
}
