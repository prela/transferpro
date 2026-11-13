import { describe, expect, it } from 'vitest'
import { OPERATING_AREA_OUT_OF_BOUNDS, OperatingAreaError, parseOperatingAreaArgs } from './operating-area-args'

const area = ['--slug', 'tenant-primjer', '--name', 'Područje Primjer', '--lat', '12.5', '--lng', '-7.25', '--radius-km', '15']

describe('parseOperatingAreaArgs', () => {
  it('reads an area, an optional country, a country alone, and archive', () => {
    expect(parseOperatingAreaArgs(area)).toEqual({
      mode: 'area',
      slug: 'tenant-primjer',
      name: 'Područje Primjer',
      latitude: '12.50000',
      longitude: '-7.25000',
      radiusM: 15000,
    })
    expect(parseOperatingAreaArgs([...area, '--country', ' gb '])).toMatchObject({
      mode: 'area',
      country: 'GB',
      radiusM: 15000,
    })
    expect(parseOperatingAreaArgs(['--slug', 'tenant-primjer', '--country', 'hr'])).toEqual({
      mode: 'country',
      slug: 'tenant-primjer',
      country: 'HR',
    })
    expect(parseOperatingAreaArgs(['--slug=tenant-primjer', '--archive'])).toEqual({
      mode: 'archive',
      slug: 'tenant-primjer',
    })
    expect(parseOperatingAreaArgs(['--radius-km', '1', '--lng', '180', '--lat', '-90', '--name', '  Područje Primjer  ', '--slug', 'tenant-primjer'])).toEqual({
      mode: 'area',
      slug: 'tenant-primjer',
      name: 'Područje Primjer',
      latitude: '-90.00000',
      longitude: '180.00000',
      radiusM: 1000,
    })
    const widest = parseOperatingAreaArgs([...area.slice(0, 9), '50'])
    expect(widest).toMatchObject({ mode: 'area', radiusM: 50000 })
  })

  it('refuses a value outside the table bounds without repeating it', () => {
    const longName = 'N'.repeat(201)
    const refused: Array<{ argv: string[], secret: string }> = [
      { argv: [...area.slice(0, 5), '99.99111', ...area.slice(6)], secret: '99.99111' },
      { argv: [...area.slice(0, 7), '181', ...area.slice(8)], secret: '181' },
      { argv: [...area.slice(0, 9), '0'], secret: '0' },
      { argv: [...area.slice(0, 9), '51'], secret: '51' },
      { argv: [...area.slice(0, 9), '15.5'], secret: '15.5' },
      { argv: ['--slug', 'tenant-primjer', '--name', longName, '--lat', '1', '--lng', '1', '--radius-km', '10'], secret: longName },
      { argv: ['--slug', 'tenant-primjer', '--name', '   ', '--lat', '1', '--lng', '1', '--radius-km', '10'], secret: '   ' },
      { argv: ['--slug', 'tenant-primjer', '--country', 'uk'], secret: 'uk' },
      { argv: ['--slug', 'Bad_Slug', '--archive'], secret: 'Bad_Slug' },
    ]
    for (const { argv, secret } of refused) {
      expect(() => parseOperatingAreaArgs(argv)).toThrow(OperatingAreaError)
      try {
        parseOperatingAreaArgs(argv)
      }
      catch (error) {
        expect(error).toBeInstanceOf(OperatingAreaError)
        expect((error as Error).message).toBe(OPERATING_AREA_OUT_OF_BOUNDS)
        expect((error as Error).message.includes(secret)).toBe(false)
      }
    }
  })

  it('prints usage when the shape is not one of the three, and does not repeat the value', () => {
    const secret = 'Područje Tajna'
    const shapes = [
      ['--slug', 'tenant-primjer', '--name', secret],
      ['--slug', 'tenant-primjer', '--archive', '--country', 'HR'],
      ['--slug', 'tenant-primjer', '--archive', '--name', secret, '--lat', '1', '--lng', '1', '--radius-km', '10'],
      ['--archive'],
      ['--country', 'HR'],
    ]
    for (const argv of shapes) {
      expect(() => parseOperatingAreaArgs(argv)).toThrow(/^Usage: /)
      try {
        parseOperatingAreaArgs(argv)
      }
      catch (error) {
        expect((error as Error).message).not.toContain(secret)
        expect((error as Error).message).not.toContain('HR')
      }
    }
  })

  it('refuses an unknown flag, a repeated flag, a missing value, and a password', () => {
    expect(() => parseOperatingAreaArgs(['--slug', 'tenant-primjer', '--nope'])).toThrow('Unknown argument --nope.')
    expect(() => parseOperatingAreaArgs(['--slug', 'tenant-primjer', '--slug', 'other'])).toThrow('Repeated argument --slug.')
    expect(() => parseOperatingAreaArgs(['--slug'])).toThrow('Missing value for --slug.')
    expect(() => parseOperatingAreaArgs(['--password', 'secret-value'])).toThrow('Password must not be passed as an argument.')
    expect(() => parseOperatingAreaArgs(['bare'])).toThrow('Unexpected argument.')
  })
})
