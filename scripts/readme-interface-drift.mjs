/**
 * @fileoverview Re-declaration check for the published-surface gate: a README snippet
 * that restates an interface the package ships has to match it member for member.
 * @layer scripts
 *
 * A snippet's own declaration is a different type from the shipped one, so the compile
 * cannot see a member the README adds, drops or retypes. This module compares the two
 * declarations; `check-published-surface.mjs` supplies the compiler, the program and
 * the shipped exports, so nothing here depends on the package being checked.
 */

/** The members of a type as name, optionality and written type, sorted, so two
 * declarations can be compared. */
function memberShape(ts, checker, type, location) {
  return type
    .getProperties()
    .map((symbol) => {
      const optional = symbol.flags & ts.SymbolFlags.Optional ? '?' : ''
      const written = checker.typeToString(checker.getTypeOfSymbolAtLocation(symbol, location))
      return `${symbol.name}${optional}: ${written}`
    })
    .sort()
}

/**
 * Compare every top-level interface in the snippets with the shipped interface of the
 * same name, by member name, optionality and written type.
 *
 * @param {object} input
 * @param {object} input.ts - The TypeScript compiler API the gate loaded.
 * @param {object} input.program - The compiled gate program.
 * @param {string[]} input.snippetFiles - Absolute paths of the snippet files.
 * @param {{ name: string, checker: object, symbol: object }[]} input.shipped - Every
 *   shipped export with the checker of the program it was read from.
 * @returns {string[]} One line per interface that differs from the shipped one.
 */
export function redeclarationDrift({ ts, program, snippetFiles, shipped }) {
  const exported = new Map(shipped.map((entry) => [entry.name, entry]))
  const checker = program.getTypeChecker()
  const drift = []
  for (const file of snippetFiles) {
    const source = program.getSourceFile(file)
    if (source === undefined) continue
    for (const node of source.statements) {
      const real = ts.isInterfaceDeclaration(node) ? exported.get(node.name.text) : undefined
      if (real === undefined) continue
      const local = memberShape(ts, checker, checker.getTypeAtLocation(node.name), node)
      const declared = real.checker.getDeclaredTypeOfSymbol(real.symbol)
      const remote = memberShape(ts, real.checker, declared, real.symbol.declarations?.[0] ?? node)
      const missing = remote.filter((member) => !local.includes(member))
      const extra = local.filter((member) => !remote.includes(member))
      if (missing.length + extra.length > 0) {
        const name = file.split(/[\\/]/).pop()
        drift.push(
          `${name}: interface ${node.name.text} differs from the shipped one` +
            (missing.length > 0 ? `; missing or different: ${missing.join(', ')}` : '') +
            (extra.length > 0 ? `; not shipped: ${extra.join(', ')}` : '')
        )
      }
    }
  }
  return drift
}
