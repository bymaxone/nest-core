/**
 * @fileoverview ESLint rule: a non-trivial file opens with a block comment that states its layer.
 * @layer scripts
 *
 * The header is the first thing a reader sees and says what the file is for and where it sits, so it
 * must come before any code (a shebang line may precede it) and be a `/** ... *\/` block that names a
 * layer, either as the tag `@layer` or as a `Layer:` line, each at the start of a header line and
 * followed by the name. A file shorter than {@link TRIVIAL} lines is exempt.
 *
 * Plain ESM with no dependencies.
 */

/** Files with fewer lines than this are exempt. */
export const TRIVIAL = 10

/** A line of the header that declares the layer: the tag at the start of the line, then its name. */
const LAYER = /^[ \t]*\*?[ \t]*(?:@layer|Layer:)[ \t]+[^\s*]/m

export default {
  meta: { type: 'problem', schema: [] },
  create(context) {
    return {
      Program(program) {
        const source = context.sourceCode
        if (source.lines.length < TRIVIAL) return
        const first = source.getAllComments().find((comment) => comment.type !== 'Shebang')
        const opensFile =
          first !== undefined &&
          (program.body[0] === undefined || first.range[0] < program.body[0].range[0])
        if (
          opensFile &&
          first.type === 'Block' &&
          first.value.startsWith('*') &&
          LAYER.test(first.value)
        )
          return
        context.report({
          loc: { line: 1, column: 0 },
          message:
            'The file must open with a `/** ... */` header that states its layer (`@layer` or `Layer:`).'
        })
      }
    }
  }
}
