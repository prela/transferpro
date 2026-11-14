import { describe, expect, it } from 'vitest'
import { DemoSeedError } from './demo-seed'
import { planDemoSeedArea } from './demo-seed-area'
import { OPERATING_AREA_OUT_OF_BOUNDS } from './operating-area-args'

/**
 * The demo seed's operating area is decided from env names before any
 * database connection. Coordinates below are arbitrary and in bounds.
 * They are not a real place.
 */
const area = {
  DEMO_SEED_AREA_NAME: 'Područje Primjer',
  DEMO_SEED_AREA_LAT: '12.5',
  DEMO_SEED_AREA_LNG: '-7.25',
  DEMO_SEED_AREA_RADIUS_KM: '15',
}

describe('planDemoSeedArea', () => {
  it('sets no area when the variables are missing or blank', () => {
    expect(planDemoSeedArea({})).toEqual({ mode: 'none' })
    expect(planDemoSeedArea({
      DEMO_SEED_AREA_NAME: '',
      DEMO_SEED_AREA_LAT: '   ',
      DEMO_SEED_AREA_LNG: '',
      DEMO_SEED_AREA_RADIUS_KM: '',
      DEMO_SEED_AREA_COUNTRY: '  ',
    })).toEqual({ mode: 'none' })
  })

  it('reads a full area, with an optional country, through the operating-area command', () => {
    expect(planDemoSeedArea(area)).toEqual({
      mode: 'area',
      command: {
        mode: 'area',
        slug: 'demo',
        name: 'Područje Primjer',
        latitude: '12.50000',
        longitude: '-7.25000',
        radiusM: 15000,
      },
    })
    expect(planDemoSeedArea({ ...area, DEMO_SEED_AREA_COUNTRY: ' ax ' })).toEqual({
      mode: 'area',
      command: {
        mode: 'area',
        slug: 'demo',
        name: 'Područje Primjer',
        latitude: '12.50000',
        longitude: '-7.25000',
        radiusM: 15000,
        country: 'AX',
      },
    })
    expect(planDemoSeedArea({
      ...area,
      DEMO_SEED_AREA_LAT: '-90',
      DEMO_SEED_AREA_LNG: '180',
      DEMO_SEED_AREA_RADIUS_KM: '1',
    })).toMatchObject({
      mode: 'area',
      command: { latitude: '-90.00000', longitude: '180.00000', radiusM: 1000 },
    })
    expect(planDemoSeedArea({ ...area, DEMO_SEED_AREA_RADIUS_KM: '50' })).toMatchObject({
      mode: 'area',
      command: { radiusM: 50000 },
    })
  })

  it('sets only the country when that variable is the only one set', () => {
    expect(planDemoSeedArea({ DEMO_SEED_AREA_COUNTRY: 'qa' })).toEqual({
      mode: 'country',
      command: { mode: 'country', slug: 'demo', country: 'QA' },
    })
  })

  it('refuses a partial set before any value is repeated', () => {
    const secret = 'LATITUDE-SECRET'
    const partials = [
      { DEMO_SEED_AREA_NAME: 'Područje Primjer' },
      { DEMO_SEED_AREA_LAT: secret, DEMO_SEED_AREA_LNG: '-7.25' },
      { ...area, DEMO_SEED_AREA_RADIUS_KM: '   ', DEMO_SEED_AREA_COUNTRY: 'AX' },
    ]
    const sentences = [
      'Set DEMO_SEED_AREA_NAME, DEMO_SEED_AREA_LAT, DEMO_SEED_AREA_LNG, and DEMO_SEED_AREA_RADIUS_KM together. Set: DEMO_SEED_AREA_NAME.',
      'Set DEMO_SEED_AREA_NAME, DEMO_SEED_AREA_LAT, DEMO_SEED_AREA_LNG, and DEMO_SEED_AREA_RADIUS_KM together. Set: DEMO_SEED_AREA_LAT, DEMO_SEED_AREA_LNG.',
      'Set DEMO_SEED_AREA_NAME, DEMO_SEED_AREA_LAT, DEMO_SEED_AREA_LNG, and DEMO_SEED_AREA_RADIUS_KM together. Set: DEMO_SEED_AREA_NAME, DEMO_SEED_AREA_LAT, DEMO_SEED_AREA_LNG, DEMO_SEED_AREA_COUNTRY.',
    ]
    for (const [index, env] of partials.entries()) {
      expect(() => planDemoSeedArea(env)).toThrow(DemoSeedError)
      try {
        planDemoSeedArea(env)
      }
      catch (error) {
        expect((error as Error).message).toBe(sentences[index])
        expect((error as Error).message).not.toContain(secret)
        expect((error as Error).message).not.toContain('Područje')
        expect((error as Error).message).not.toContain('AX')
      }
    }
  })

  it('refuses an out-of-bounds value with the operating-area sentence', () => {
    const secret = '99.99111'
    expect(() => planDemoSeedArea({ ...area, DEMO_SEED_AREA_LAT: secret })).toThrow(DemoSeedError)
    try {
      planDemoSeedArea({ ...area, DEMO_SEED_AREA_LAT: secret })
    }
    catch (error) {
      expect((error as Error).message).toBe(OPERATING_AREA_OUT_OF_BOUNDS)
      expect((error as Error).message).not.toContain(secret)
    }
    expect(() => planDemoSeedArea({ ...area, DEMO_SEED_AREA_RADIUS_KM: '51' })).toThrow(OPERATING_AREA_OUT_OF_BOUNDS)
    expect(() => planDemoSeedArea({ DEMO_SEED_AREA_COUNTRY: 'not-a-country' })).toThrow(OPERATING_AREA_OUT_OF_BOUNDS)
    try {
      planDemoSeedArea({ DEMO_SEED_AREA_COUNTRY: 'not-a-country' })
    }
    catch (error) {
      expect((error as Error).message).not.toContain('not-a-country')
    }
  })
})
