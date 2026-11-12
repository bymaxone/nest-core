/**
 * Unit tests for the `./http` public barrel.
 *
 * Layer: unit.
 * Goal: the subpath publishes the bootstrap helper and nothing else; the loader stays private.
 * Mocks: none.
 */
import * as barrel from './index'

describe('http subpath barrel', () => {
  it('exports only applyHttpFloors', () => {
    expect(Object.keys(barrel)).toEqual(['applyHttpFloors'])
    expect(typeof barrel.applyHttpFloors).toBe('function')
  })
})
