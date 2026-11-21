/**
 * Unit tests for the boot error builder.
 *
 * Layer: unit.
 * Goal: the message is exactly the library text given; what the host declared is kept as properties,
 * a string or each string of a list written out so a line break, a direction override or a lone
 * surrogate cannot reach a logger that serializes the properties, and anything else kept as it is.
 * Mocks: none.
 */
import { bootError } from './boot-error'
import { checkedBlock } from './option-validation'

describe('bootError', () => {
  it('keeps the message as given and the fields as properties', () => {
    const error = bootError('library text', { contributor: 'Queue', count: 2, flag: true })

    expect(error.message).toBe('library text')
    expect(error).toMatchObject({ contributor: 'Queue', count: 2, flag: true })
  })

  it('writes out a string field that holds a line break, a direction override or a lone surrogate', () => {
    const error = bootError('m', { option: 'a\r\nb‮c\ud83dd' })

    expect((error as unknown as { option: string }).option).toBe('a\\u000d\\u000ab\\u202ec\\ud83dd')
  })

  it('writes out each string of a list and keeps a list of other values as it is', () => {
    const error = bootError('m', { keys: ['GET /a\nb', 'plain'], numbers: [1, 2] })

    expect(error).toMatchObject({ keys: ['GET /a\\u000ab', 'plain'], numbers: [1, 2] })
  })

  it('cuts a string field longer than the limit and ends it with an ellipsis', () => {
    const error = bootError('m', { option: 'x'.repeat(300) })

    expect((error as unknown as { option: string }).option).toBe(`${'x'.repeat(200)}…`)
  })

  it('chains the cause when it is given', () => {
    const cause = new Error('inner')

    expect(bootError('m', {}, { cause }).cause).toBe(cause)
  })
})

describe('an unknown option key', () => {
  it('is written out in the option property, so a line break in it cannot reach a logger', () => {
    let caught: unknown
    try {
      checkedBlock('blk', { 'bad\nkey‮': 1 }, {})
    } catch (error) {
      caught = error
    }

    expect(caught).toMatchObject({ option: 'bad\\u000akey\\u202e' })
    expect((caught as Error).message).toBe('blk has an unknown option')
  })
})
