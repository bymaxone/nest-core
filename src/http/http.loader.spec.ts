/**
 * Unit tests for the lazy `helmet` loader.
 *
 * Layer: unit.
 * Goal: an absent peer fails with a message naming the package and the install command, a failure
 * inside the peer propagates unchanged, and the installed peer resolves.
 * Mocks: `jest.doMock('helmet')` throwing, to simulate an absent peer and a failing one.
 */
import { loadHelmet } from './http.loader'

describe('loadHelmet', () => {
  afterEach(() => {
    jest.dontMock('helmet')
    jest.resetModules()
  })

  it('resolves the installed peer to its middleware factory', async () => {
    const helmet = await loadHelmet()
    expect(typeof helmet).toBe('function')
    expect(typeof helmet({ strictTransportSecurity: false })).toBe('function')
  })

  it('names the package and the install command when the peer is absent', async () => {
    jest.resetModules()
    jest.doMock('helmet', () => {
      throw Object.assign(new Error('Cannot find module helmet'), { code: 'MODULE_NOT_FOUND' })
    })
    const { loadHelmet: load } = require('./http.loader') as typeof import('./http.loader')
    await expect(load()).rejects.toMatchObject({
      message:
        'applyHttpFloors needs the optional peer helmet, which is not installed. Run: pnpm add helmet',
      cause: expect.objectContaining({ code: 'MODULE_NOT_FOUND' })
    })
  })

  it('does not report a failure inside the peer as an absent peer', async () => {
    jest.resetModules()
    jest.doMock('helmet', () => {
      throw new Error('helmet blew up')
    })
    const { loadHelmet: load } = require('./http.loader') as typeof import('./http.loader')
    await expect(load()).rejects.toThrow('helmet blew up')
  })
})
