/**
 * @fileoverview Importing the options module beside a polluted `Object.prototype`: the import itself never
 * throws, the guard speaks where the options are normalized.
 * @layer Test
 */
describe('importing the options beside a name planted on Object.prototype', () => {
  it('loads, and normalizing the options is what refuses', () => {
    Object.defineProperty(Object.prototype, 'planted', {
      value: 1,
      enumerable: true,
      configurable: true,
      writable: true
    })
    try {
      let loaded: typeof import('./core.options') | undefined
      jest.isolateModules(() => {
        loaded = require('./core.options') as typeof import('./core.options')
      })

      expect(loaded?.DEFAULT_CORE_OPTIONS).toBeDefined()
      expect(() => loaded?.normalizeCoreOptions()).toThrow('Object.prototype holds names')
    } finally {
      delete (Object.prototype as Record<string, unknown>)['planted']
    }
  })
})
