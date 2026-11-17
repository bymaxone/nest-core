/**
 * @fileoverview ESLint rule for the 50-line function limit, with a baseline that can only shrink.
 * @layer scripts
 *
 * The unit is a function, or the body of one `it`/`test`: the callback of a grouping call
 * (`describe`, `context`, `suite`, and their `.each`/`.only`/`.skip` forms) is a table of cases and
 * is not counted. Lines are physical, comments and blanks included, from the line the function
 * starts on to the line it ends on.
 *
 * A function already over the limit is listed in the baseline under its file and its name, with
 * its length, so the rule can be red for what a change introduces without failing on what the
 * repository inherits. Entries are kept honest from both sides:
 *
 * - a function over the limit that is not listed fails (a new offender);
 * - a listed function that grew past its recorded length fails (the baseline cannot widen);
 * - a listed function that shrank but is still over the limit fails until its entry is lowered;
 * - a listed function now at or under the limit, or no longer in the file, fails until its entry
 *   is removed, so a fixed function cannot quietly regress later.
 *
 * A name is the chain of named functions around it, joined by ` > `; a function without a name of
 * its own is `(anonymous)`, and repeats of one name in a file are numbered from the second (`#2`).
 *
 * Plain ESM with no dependencies: copy this file and `function-length-baseline.json` as they are.
 */

/** The most lines a function may have. */
export const LIMIT = 50

const GROUPING_CALL = /^[xf]?(?:describe|context|suite)$/

/** Whether a call's callee is a grouping construct: `describe`, `describe.only`, `describe.each(t)`. */
function isGrouping(callee) {
  let node = callee
  while (node) {
    if (node.type === 'Identifier') return GROUPING_CALL.test(node.name)
    if (node.type === 'MemberExpression') node = node.object
    else if (node.type === 'CallExpression') node = node.callee
    else return false
  }
  return false
}

const ANONYMOUS = '(anonymous)'

/** The name a function is bound to, or `(anonymous)`. */
function ownName(node) {
  if (node.id?.type === 'Identifier') return node.id.name
  const parent = node.parent
  if (parent?.type === 'VariableDeclarator' && parent.id.type === 'Identifier')
    return parent.id.name
  const keyed = parent?.type === 'Property' || parent?.type === 'MethodDefinition'
  if (keyed && parent.key.type === 'Identifier') return parent.key.name
  return ANONYMOUS
}

/** Whether a function is the callback of a grouping call. */
function isGroupCallback(node) {
  const parent = node.parent
  return (
    parent?.type === 'CallExpression' &&
    parent.arguments.includes(node) &&
    isGrouping(parent.callee)
  )
}

/** The baseline's `functions` table for one file, as a map of name to recorded length. */
function recordedFor(baseline, file) {
  const entry = Object.entries(baseline?.functions ?? {}).find(([path]) => path === file)
  return new Map(Object.entries(entry?.[1] ?? {}))
}

/** Reports a function that disagrees with the baseline, if it does. */
function judge(context, node, name, recorded) {
  const length = node.loc.end.line - node.loc.start.line + 1
  if (length <= LIMIT) return false
  const listed = recorded.get(name)
  let message
  if (listed === undefined) {
    message = `${name} has ${length} lines, over the limit of ${LIMIT}. Split it by responsibility.`
  } else if (length > listed) {
    message = `${name} has ${length} lines, above the ${listed} recorded in the baseline.`
  } else if (length < listed) {
    message = `${name} has ${length} lines and is recorded at ${listed}: lower its baseline entry.`
  }
  if (message !== undefined) context.report({ node, message })
  return true
}

/** Reports each baseline entry of the file whose function was not found over the limit. */
function reportStale(context, program, recorded, seen) {
  for (const [name, listed] of recorded) {
    if (seen.has(name)) continue
    context.report({
      node: program,
      message: `${name} is recorded at ${listed} lines but is not over the limit of ${LIMIT} (or is gone): remove its baseline entry.`
    })
  }
}

export default {
  meta: { type: 'problem', schema: [{ type: 'object', additionalProperties: true }] },
  create(context) {
    const file = context.filename
      .slice(context.cwd.length + 1)
      .split('\\')
      .join('/')
    const recorded = recordedFor(context.options[0]?.baseline, file)
    const seen = new Set()
    const counts = new Map()
    const chain = []

    /** Opens a function: names it, and measures it unless it only groups cases. */
    function enter(node) {
      const own = ownName(node)
      const base = [...chain.filter(Boolean), own].join(' > ')
      chain.push(own === ANONYMOUS ? null : own)
      if (isGroupCallback(node)) return
      const nth = (counts.get(base) ?? 0) + 1
      counts.set(base, nth)
      const name = nth === 1 ? base : `${base} #${nth}`
      if (judge(context, node, name, recorded)) seen.add(name)
    }

    const leave = () => void chain.pop()
    return {
      FunctionDeclaration: enter,
      'FunctionDeclaration:exit': leave,
      FunctionExpression: enter,
      'FunctionExpression:exit': leave,
      ArrowFunctionExpression: enter,
      'ArrowFunctionExpression:exit': leave,
      'Program:exit': (program) => reportStale(context, program, recorded, seen)
    }
  }
}
