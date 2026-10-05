import { expect, it } from 'vitest'
import { parseCreateVehicle, parseVehiclePatch, VEHICLE_DESCRIPTION_MAX_LENGTH, VEHICLE_PLATE_MAX_LENGTH, vehicleDateError, vehicleDescriptionError, VehicleInputError, vehicleKindError, vehicleListSchema, vehiclePlateError } from './vehicle'

const plate = 'DU123AB'

const createBody = {
  registrationPlate: '  du 123 ab  ',
  kind: 'fixed' as const,
  registrationExpiresOn: '2027-06-01',
  technicalInspectionExpiresOn: '2028-01-31',
  insuranceExpiresOn: '2029-03-03',
}

it('accepts a Vehicle, trims spaces, and stores the plate in uppercase without spaces', () => {
  expect(parseCreateVehicle(createBody)).toEqual({
    registrationPlate: plate,
    kind: 'fixed',
    registrationExpiresOn: '2027-06-01',
    technicalInspectionExpiresOn: '2028-01-31',
    insuranceExpiresOn: '2029-03-03',
    description: null,
  })
  expect(parseCreateVehicle({ ...createBody, kind: 'occasional' }).kind).toBe('occasional')
})

it('accepts a description, trims it, and treats blank as null', () => {
  expect(parseCreateVehicle({ ...createBody, description: '  Mercedes Vito 8+1, crni  ' }).description).toBe('Mercedes Vito 8+1, crni')
  expect(parseCreateVehicle({ ...createBody, description: '   ' }).description).toBeNull()
  expect(parseCreateVehicle({ ...createBody, description: null }).description).toBeNull()
  expect(() => parseCreateVehicle({ ...createBody, description: 'A'.repeat(VEHICLE_DESCRIPTION_MAX_LENGTH + 1) })).toThrow(VehicleInputError)
})

it('accepts a leap day and refuses a day that is not on the calendar', () => {
  expect(parseCreateVehicle({ ...createBody, registrationExpiresOn: '2024-02-29' }).registrationExpiresOn).toBe('2024-02-29')
  expect(() => parseCreateVehicle({ ...createBody, registrationExpiresOn: '2025-02-29' })).toThrow(VehicleInputError)
  expect(() => parseCreateVehicle({ ...createBody, technicalInspectionExpiresOn: '2026-02-31' })).toThrow(VehicleInputError)
  expect(() => parseCreateVehicle({ ...createBody, insuranceExpiresOn: '01.06.2027' })).toThrow(VehicleInputError)
  expect(() => parseCreateVehicle({ ...createBody, insuranceExpiresOn: '2027-06-01T00:00:00Z' })).toThrow(VehicleInputError)
})

it('refuses an empty plate, a long plate, an unknown kind, and a key that is not a Vehicle field', () => {
  expect(() => parseCreateVehicle({ ...createBody, registrationPlate: '   ' })).toThrow(VehicleInputError)
  expect(() => parseCreateVehicle({ ...createBody, registrationPlate: 'A'.repeat(VEHICLE_PLATE_MAX_LENGTH + 1) })).toThrow(VehicleInputError)
  expect(() => parseCreateVehicle({ ...createBody, kind: 'own' })).toThrow(VehicleInputError)
  expect(() => parseCreateVehicle({ ...createBody, name: 'Van' })).toThrow(VehicleInputError)
  expect(() => parseCreateVehicle({ ...createBody, archivedAt: '2026-10-05T00:00:00.000Z' })).toThrow(VehicleInputError)
  const { registrationPlate: _plate, ...withoutPlate } = createBody
  expect(() => parseCreateVehicle(withoutPlate)).toThrow(VehicleInputError)
})

it('accepts a correction of one field and an empty patch', () => {
  expect(parseVehiclePatch({ registrationPlate: '  zg 111 aa  ' })).toEqual({ registrationPlate: 'ZG111AA' })
  expect(parseVehiclePatch({ kind: 'occasional' })).toEqual({ kind: 'occasional' })
  expect(parseVehiclePatch({ description: '  van  ' })).toEqual({ description: 'van' })
  expect(parseVehiclePatch({ description: null })).toEqual({ description: null })
  expect(parseVehiclePatch({})).toEqual({})
  expect(() => parseVehiclePatch({ registrationPlate: ' ' })).toThrow(VehicleInputError)
  expect(() => parseVehiclePatch({ insuranceExpiresOn: '2026-13-01' })).toThrow(VehicleInputError)
  expect(() => parseVehiclePatch({ notes: 'spare' })).toThrow(VehicleInputError)
  expect(() => parseVehiclePatch({ archivedAt: null })).toThrow(VehicleInputError)
})

it('names the field the form got wrong, and the error text never carries the plate', () => {
  expect(vehiclePlateError('   ')).toBe('empty')
  expect(vehiclePlateError('A'.repeat(VEHICLE_PLATE_MAX_LENGTH + 1))).toBe('too-long')
  expect(vehiclePlateError(plate)).toBeNull()
  expect(vehicleKindError('')).toBe('invalid')
  expect(vehicleKindError('fixed')).toBeNull()
  expect(vehicleDateError('')).toBe('invalid')
  expect(vehicleDateError('2027-06-01')).toBeNull()
  expect(vehicleDescriptionError('A'.repeat(VEHICLE_DESCRIPTION_MAX_LENGTH + 1))).toBe('too-long')
  expect(vehicleDescriptionError('Mercedes Vito')).toBeNull()

  let message = ''
  try {
    parseCreateVehicle({ ...createBody, registrationPlate: ' ' })
  }
  catch (error) {
    message = error instanceof Error ? `${error.name} ${error.message}` : ''
  }
  expect(message).toBe('VehicleInputError Bad request')
  expect(message).not.toContain('du')
})

it('lists a Vehicle the office can correct or archive later', () => {
  const listed = vehicleListSchema.parse({
    vehicles: [{
      id: 'a1b2c3d4-5555-4555-8555-555555555555',
      registrationPlate: plate,
      kind: 'fixed',
      registrationExpiresOn: '2027-06-01',
      technicalInspectionExpiresOn: '2028-01-31',
      insuranceExpiresOn: '2029-03-03',
      description: null,
      archivedAt: null,
    }],
  })
  expect(listed.vehicles[0]?.archivedAt).toBeNull()
  expect(vehicleListSchema.safeParse({
    vehicles: [{ ...listed.vehicles[0], kind: 'own' }],
  }).success).toBe(false)
})
