import type { OperatingAreaCommand } from './operating-area-args'
import { z } from 'zod'
import { DEMO_SLUG } from './demo-seed-picture'
import { OPERATING_AREA_OUT_OF_BOUNDS, OperatingAreaError, parseOperatingAreaArgs } from './operating-area-args'

/**
 * A refusal the operator can read. The message is a fixed sentence.
 * It never repeats a password, a coordinate, or a country code.
 */
export class DemoSeedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DemoSeedError'
  }
}

/**
 * Optional operating area for `pnpm db:seed:demo`.
 * A blank value counts as unset, the same way `DEMO_SEED_PASSWORD` does.
 * The four area names are one set. The country may stand alone.
 */
export interface DemoSeedAreaEnv {
  readonly DEMO_SEED_AREA_NAME?: string
  readonly DEMO_SEED_AREA_LAT?: string
  readonly DEMO_SEED_AREA_LNG?: string
  readonly DEMO_SEED_AREA_RADIUS_KM?: string
  readonly DEMO_SEED_AREA_COUNTRY?: string
}

export type DemoSeedAreaPlan
  = | { readonly mode: 'none' }
    | { readonly mode: 'area', readonly command: Extract<OperatingAreaCommand, { mode: 'area' }> }
    | { readonly mode: 'country', readonly command: Extract<OperatingAreaCommand, { mode: 'country' }> }

const AREA_VARIABLES = [
  ['DEMO_SEED_AREA_NAME', '--name'],
  ['DEMO_SEED_AREA_LAT', '--lat'],
  ['DEMO_SEED_AREA_LNG', '--lng'],
  ['DEMO_SEED_AREA_RADIUS_KM', '--radius-km'],
] as const

const areaEnvSchema = z.object({
  DEMO_SEED_AREA_NAME: z.string().optional(),
  DEMO_SEED_AREA_LAT: z.string().optional(),
  DEMO_SEED_AREA_LNG: z.string().optional(),
  DEMO_SEED_AREA_RADIUS_KM: z.string().optional(),
  DEMO_SEED_AREA_COUNTRY: z.string().optional(),
})

/**
 * Decide the area before any connection.
 * A full set, or the country alone, is checked by `parseOperatingAreaArgs`,
 * so the seed does not keep a second copy of the bounds. A partial set
 * names the variables that are present and does not repeat their values.
 */
export function planDemoSeedArea(env: DemoSeedAreaEnv): DemoSeedAreaPlan {
  const parsed = areaEnvSchema.safeParse(env)
  if (!parsed.success)
    throw new DemoSeedError('The demo seed area variables are not text.')

  const present = AREA_VARIABLES.filter(([name]) => isSet(parsed.data[name]))
  const country = isSet(parsed.data.DEMO_SEED_AREA_COUNTRY)
  if (present.length > 0 && present.length < AREA_VARIABLES.length)
    throw new DemoSeedError(partialSentence(present.map(([name]) => name), country))
  if (present.length === 0 && !country)
    return { mode: 'none' }

  const argv = ['--slug', DEMO_SLUG]
  if (present.length === AREA_VARIABLES.length) {
    for (const [name, flag] of AREA_VARIABLES) {
      const value = parsed.data[name]
      if (value === undefined)
        throw new DemoSeedError('The demo seed area variables are not text.')
      argv.push(flag, value.trim())
    }
  }
  if (country) {
    const countryValue = parsed.data.DEMO_SEED_AREA_COUNTRY
    if (countryValue === undefined)
      throw new DemoSeedError('The demo seed area variables are not text.')
    argv.push('--country', countryValue.trim())
  }

  try {
    const command = parseOperatingAreaArgs(argv)
    if (command.mode === 'area')
      return { mode: 'area', command }
    if (command.mode === 'country')
      return { mode: 'country', command }
    // Archive is not a seed shape. Treat it as a refused value.
    throw new OperatingAreaError(OPERATING_AREA_OUT_OF_BOUNDS)
  }
  catch (error) {
    if (error instanceof OperatingAreaError)
      throw new DemoSeedError(OPERATING_AREA_OUT_OF_BOUNDS)
    throw error
  }
}

function isSet(value: string | undefined): boolean {
  return value !== undefined && value.trim() !== ''
}

/**
 * The sentence is fixed. Only variable names are filled in, in the
 * same order as the env list, with the country last when it is set.
 */
function partialSentence(names: readonly string[], country: boolean): string {
  const set = country ? [...names, 'DEMO_SEED_AREA_COUNTRY'] : [...names]
  return `Set DEMO_SEED_AREA_NAME, DEMO_SEED_AREA_LAT, DEMO_SEED_AREA_LNG, and DEMO_SEED_AREA_RADIUS_KM together. Set: ${set.join(', ')}.`
}
