import type * as Monaco from 'monaco-editor'
import { MIN_SYNTAX_CONTRAST } from '../editor/appearance/plugin-monaco-theme'
import {
  MARKDOWN_TOKEN_PREFIX,
  GO_TOKEN_PREFIX,
  markdownTokenRules,
  goTokenRules,
  scopeTokenRules
} from '../editor/appearance/plugin-monaco-token-rules'
import { contrastRatio, type Rgba } from '../../../../shared/color/rgba-contrast'
import { matchesPrefix } from './textmate-token-scopes'

type ThemeRule = Monaco.editor.ITokenThemeRule
type ThemeBase = 'light' | 'dark'

/** Dark+ / Light+ colors for the namespaced Markdown and Go grammars. */
export type BuiltInTextMateRules = { rules: ThemeRule[]; plainForeground: string }

const loaded: Partial<Record<ThemeBase, Promise<BuiltInTextMateRules>>> = {}

/** `#rrggbb` for an opaque `#rrggbb` / `#rrggbbff`, as Monaco reads a rule color; else null. */
function opaqueHex(value: string | undefined): string | null {
  const match = /^#([0-9a-f]{6})(?:ff)?$/i.exec(value ?? '')
  return match ? `#${match[1].toLowerCase()}` : null
}

function rgb(hex: string): Rgba {
  const channel = (index: number): number => Number.parseInt(hex.slice(index, index + 2), 16)
  return [channel(1), channel(3), channel(5), 1]
}

export function loadBuiltInTextMateRules(base: ThemeBase): Promise<BuiltInTextMateRules> {
  loaded[base] ??= (
    base === 'dark' ? import('shiki/themes/dark-plus.mjs') : import('shiki/themes/light-plus.mjs')
  ).then(({ default: theme }) => {
    const tokenColors = theme.tokenColors ?? []
    const color = (value: string) => value
    const scopes = scopeTokenRules(tokenColors, color)
    return {
      rules: [
        ...markdownTokenRules(tokenColors, color, scopes),
        ...goTokenRules(tokenColors, color, scopes)
      ],
      plainForeground: opaqueHex(theme.colors?.['editor.foreground']) ?? ''
    }
  })
  loaded[base].catch(() => {
    // Why: a failed chunk load must not stick; the next theme definition retries.
    delete loaded[base]
  })
  return loaded[base]
}

/** A plugin theme plus readable built-in colors where its namespaced rules leave a style unset. */
export function withBuiltInTextMateRules(
  data: Monaco.editor.IStandaloneThemeData,
  builtIn: BuiltInTextMateRules
): Monaco.editor.IStandaloneThemeData {
  const own = data.rules.filter(
    (rule) => rule.token.startsWith(MARKDOWN_TOKEN_PREFIX) || rule.token.startsWith(GO_TOKEN_PREFIX)
  )
  const ownForeground = new Set(own.filter((rule) => rule.foreground).map((rule) => rule.token))
  const ownFontStyle = new Set(
    own.filter((rule) => rule.fontStyle !== undefined).map((rule) => rule.token)
  )
  const themeForeground = opaqueHex(data.colors['editor.foreground'])
  const background = opaqueHex(data.colors['editor.background'])
  // Why: the built-in colors were picked for Monaco's own background, not the theme's.
  const readable = (color: string | undefined): string | undefined => {
    const value = opaqueHex(color)
    if (!value) {
      return undefined
    }
    if (value === builtIn.plainForeground && themeForeground) {
      // Dark+ / Light+ write plain text (embedded code, operators) in their own foreground.
      return themeForeground
    }
    return !background || contrastRatio(rgb(value), rgb(background)) >= MIN_SYNTAX_CONTRAST
      ? value
      : undefined
  }
  const fallback = builtIn.rules.flatMap((rule): ThemeRule[] => {
    const foreground = matchesPrefix(ownForeground, rule.token)
      ? undefined
      : readable(rule.foreground)
    const fontStyle = matchesPrefix(ownFontStyle, rule.token) ? undefined : rule.fontStyle
    if (foreground === undefined && fontStyle === undefined) {
      return []
    }
    return [
      {
        token: rule.token,
        ...(foreground !== undefined ? { foreground } : {}),
        ...(fontStyle !== undefined ? { fontStyle } : {})
      }
    ]
  })
  return { ...data, rules: [...fallback, ...data.rules] }
}

/** Both grammars define the same built-in rules so loading either never removes the other's colors. */
export async function defineBuiltInTextMateThemes(monaco: {
  editor: Pick<typeof Monaco.editor, 'defineTheme'>
}): Promise<{ dark: ThemeRule[]; light: ThemeRule[] }> {
  const [dark, light] = await Promise.all([
    loadBuiltInTextMateRules('dark'),
    loadBuiltInTextMateRules('light')
  ])
  monaco.editor.defineTheme('vs-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: dark.rules,
    colors: {}
  })
  monaco.editor.defineTheme('vs', { base: 'vs', inherit: true, rules: light.rules, colors: {} })
  return { dark: dark.rules, light: light.rules }
}

export async function monacoThemeDataWithTextMate(
  data: Monaco.editor.IStandaloneThemeData
): Promise<Monaco.editor.IStandaloneThemeData> {
  const base: ThemeBase = data.base === 'vs' || data.base === 'hc-light' ? 'light' : 'dark'
  try {
    return withBuiltInTextMateRules(data, await loadBuiltInTextMateRules(base))
  } catch (error) {
    console.warn(
      '[textmate] built-in token colors failed to load; using the theme unchanged',
      error
    )
    return data
  }
}
