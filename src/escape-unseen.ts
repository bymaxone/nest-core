/**
 * @fileoverview How a string the host wrote is shown in a log line or an error property: characters
 * that break, reorder or hide text are written out, and a long string is cut.
 * @layer Utility
 */

/** The longest one string is shown, so a long route template or key cannot fill a log line. */
const MAX_SHOWN = 200

/** Control, format, lone surrogate, line and paragraph separator characters: they break, reorder or hide text. */
const UNSEEN = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u

/**
 * A string made safe for a log line: a character that breaks, reorders or hides text (a control, a
 * format character such as a direction override or a zero-width joiner, a lone surrogate, a line or
 * paragraph separator) is written as `\uXXXX`, or `\u{X}` past the Basic Multilingual Plane, and a
 * string longer than the limit is cut before the first character whose text does not fit, so an
 * escape is never left in part, and ends with an ellipsis.
 *
 * @param text - What the host wrote.
 * @returns The text to show.
 */
export function escapeUnseen(text: string): string {
  let shown = ''
  for (const char of text) {
    const code = char.codePointAt(0) as number
    const hex = code.toString(16)
    const written = UNSEEN.test(char)
      ? char.length > 1
        ? `\\u{${hex}}`
        : `\\u${hex.padStart(4, '0')}`
      : char
    if (shown.length + written.length > MAX_SHOWN) return `${shown}…`
    shown += written
  }
  return shown
}
