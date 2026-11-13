import { z } from 'zod'
import { isoCountrySchema, LOCATION_NAME_MAX_LENGTH, locationNameSchema, OPERATING_AREA_LATITUDE_MAX, OPERATING_AREA_LATITUDE_MIN, OPERATING_AREA_LONGITUDE_MAX, OPERATING_AREA_LONGITUDE_MIN, OPERATING_AREA_RADIUS_MAX_M, OPERATING_AREA_RADIUS_MIN_M } from '../../../../shared'

/**
 * Arguments for `pnpm tenant:operating-area`.
 * A bad value is refused with a fixed sentence that does not repeat it (ADR-0063).
 */
export class OperatingAreaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OperatingAreaError'
  }
}

/** The sentence for a value outside the table's bounds. It names nothing the operator typed. */
export const OPERATING_AREA_OUT_OF_BOUNDS = 'The operating area is out of bounds.'

const USAGE = [
  'Usage: pnpm tenant:operating-area --slug <slug> --name <name> --lat <lat> --lng <lng> --radius-km <km> [--country <code>]',
  'pnpm tenant:operating-area --slug <slug> --country <code>',
  'pnpm tenant:operating-area --slug <slug> --archive',
].join('\n')

const FLAGS = ['slug', 'name', 'lat', 'lng', 'radius-km', 'country', 'archive'] as const
const AREA_FLAGS = ['name', 'lat', 'lng', 'radius-km'] as const

const slugSchema = z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)

const fiveDecimals = z.string().regex(/^-?\d+\.\d{5}$/)

const archiveCommand = z.object({
  mode: z.literal('archive'),
  slug: slugSchema,
})

const countryCommand = z.object({
  mode: z.literal('country'),
  slug: slugSchema,
  country: isoCountrySchema,
})

const areaCommand = z.object({
  mode: z.literal('area'),
  slug: slugSchema,
  name: locationNameSchema,
  latitude: fiveDecimals,
  longitude: fiveDecimals,
  radiusM: z.number().int().min(OPERATING_AREA_RADIUS_MIN_M).max(OPERATING_AREA_RADIUS_MAX_M),
  country: isoCountrySchema.optional(),
}).superRefine((value, context) => {
  const latitude = Number(value.latitude)
  const longitude = Number(value.longitude)
  if (latitude < OPERATING_AREA_LATITUDE_MIN || latitude > OPERATING_AREA_LATITUDE_MAX)
    context.addIssue({ code: 'custom', path: ['latitude'] })
  if (longitude < OPERATING_AREA_LONGITUDE_MIN || longitude > OPERATING_AREA_LONGITUDE_MAX)
    context.addIssue({ code: 'custom', path: ['longitude'] })
  if (value.name.length > LOCATION_NAME_MAX_LENGTH)
    context.addIssue({ code: 'custom', path: ['name'] })
})

/** What the command may do, after the bounds have been checked. */
export const operatingAreaCommandSchema = z.discriminatedUnion('mode', [
  archiveCommand,
  countryCommand,
  areaCommand,
])

export type OperatingAreaCommand = z.infer<typeof operatingAreaCommandSchema>

/**
 * Parse argv after the command name.
 * Three shapes: the area with an optional country, the country alone, or archive.
 * Anything else is the usage line. A value outside the table's bounds is the
 * fixed sentence, so the terminal history does not keep the value.
 */
export function parseOperatingAreaArgs(argv: readonly string[]): OperatingAreaCommand {
  const values = readFlags(argv)
  const archive = values.has('archive')
  const country = values.get('country')
  const areaCount = AREA_FLAGS.filter(flag => values.has(flag)).length
  const hasArea = areaCount === AREA_FLAGS.length
  const partialArea = areaCount > 0 && !hasArea
  if (!values.has('slug') || partialArea || (archive && (hasArea || country !== undefined)) || (!archive && !hasArea && country === undefined))
    throw new OperatingAreaError(USAGE)

  if (archive)
    return parseCommand({ mode: 'archive', slug: values.get('slug') })

  if (!hasArea) {
    const code = countryCode(country ?? '')
    if (code === undefined)
      throw new OperatingAreaError(OPERATING_AREA_OUT_OF_BOUNDS)
    return parseCommand({ mode: 'country', slug: values.get('slug'), country: code })
  }

  const name = values.get('name') ?? ''
  const latitude = roundCoordinate(values.get('lat') ?? '', OPERATING_AREA_LATITUDE_MIN, OPERATING_AREA_LATITUDE_MAX)
  const longitude = roundCoordinate(values.get('lng') ?? '', OPERATING_AREA_LONGITUDE_MIN, OPERATING_AREA_LONGITUDE_MAX)
  const radiusM = radiusMetres(values.get('radius-km') ?? '')
  const parsedCountry = country === undefined ? undefined : countryCode(country)
  if (locationNameSchema.safeParse(name).success === false || latitude === undefined || longitude === undefined || radiusM === undefined || (country !== undefined && parsedCountry === undefined))
    throw new OperatingAreaError(OPERATING_AREA_OUT_OF_BOUNDS)

  return parseCommand({
    mode: 'area',
    slug: values.get('slug'),
    name,
    latitude,
    longitude,
    radiusM,
    ...(parsedCountry === undefined ? {} : { country: parsedCountry }),
  })
}

function parseCommand(value: unknown): OperatingAreaCommand {
  const parsed = operatingAreaCommandSchema.safeParse(value)
  if (!parsed.success)
    throw new OperatingAreaError(OPERATING_AREA_OUT_OF_BOUNDS)
  return parsed.data
}

function readFlags(argv: readonly string[]): Map<string, string> {
  const values = new Map<string, string>()
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] ?? ''
    if (arg === '--')
      continue
    if (!arg.startsWith('--'))
      throw new OperatingAreaError('Unexpected argument.')
    const equals = arg.indexOf('=')
    const name = equals === -1 ? arg.slice(2) : arg.slice(2, equals)
    if (name === 'password' || name === 'admin-password')
      throw new OperatingAreaError('Password must not be passed as an argument.')
    if (!FLAGS.includes(name as typeof FLAGS[number]))
      throw new OperatingAreaError(`Unknown argument --${name}.`)
    if (values.has(name))
      throw new OperatingAreaError(`Repeated argument --${name}.`)
    if (name === 'archive') {
      if (equals !== -1)
        throw new OperatingAreaError(`Unknown argument --${name}.`)
      values.set(name, 'true')
      continue
    }
    const inline = equals === -1 ? undefined : arg.slice(equals + 1)
    const next = argv[index + 1]
    const value = inline ?? next
    if (value === undefined || (inline === undefined && value.startsWith('--')))
      throw new OperatingAreaError(`Missing value for --${name}.`)
    if (inline === undefined)
      index++
    values.set(name, value)
  }
  return values
}

/** Five decimal places, the same scale the table stores. Out of range is undefined. */
function roundCoordinate(raw: string, min: number, max: number): string | undefined {
  if (!/^-?\d+(?:\.\d+)?$/.test(raw))
    return undefined
  const value = Number(raw)
  if (!Number.isFinite(value))
    return undefined
  const rounded = value.toFixed(5)
  const again = Number(rounded)
  if (again < min || again > max)
    return undefined
  return rounded
}

/** Whole kilometres from 1 to 50, stored as metres. */
function radiusMetres(raw: string): number | undefined {
  if (!/^(?:[1-9]|[1-4]\d|50)$/.test(raw))
    return undefined
  return Number(raw) * 1000
}

function countryCode(raw: string): z.infer<typeof isoCountrySchema> | undefined {
  const parsed = isoCountrySchema.safeParse(raw.trim().toUpperCase())
  return parsed.success ? parsed.data : undefined
}
