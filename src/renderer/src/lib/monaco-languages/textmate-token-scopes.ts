/** Monaco matches token names and their dotted prefixes. */
export function matchesPrefix(tokens: ReadonlySet<string>, token: string): boolean {
  for (let end = token.length; end > 0; end = token.lastIndexOf('.', end - 1)) {
    if (tokens.has(token.slice(0, end))) {
      return true
    }
  }
  return false
}

/** Preserve the innermost styled scope, including a parent's color on unstyled punctuation. */
export function createTextMateScopeMapper(
  selectors: ReadonlySet<string>,
  prefix: string,
  fallbackScope: string
): (scopes: readonly string[]) => string {
  return (scopes) => {
    for (let index = scopes.length - 1; index >= 0; index -= 1) {
      if (matchesPrefix(selectors, scopes[index])) {
        return prefix + scopes[index]
      }
    }
    return prefix + fallbackScope
  }
}
