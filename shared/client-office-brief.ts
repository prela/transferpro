import { z } from 'zod'
import { clientNameSchema } from './client'
import { CLIENT_NOTE_MAX_LENGTH } from './client-note'
import { CONTACT_PERSON_ROLE_MAX_LENGTH } from './contact-person'
import { driverEmailSchema, driverPhoneSchema } from './driver'

/**
 * A contact person as the Ride detail shows them. The card's version columns
 * stay off this shape: the detail does not edit, and the Transfer form must
 * not be able to save a contact. A removed person is not in this list.
 * ADR-0049.
 */
export const clientOfficeContactSchema = z.object({
  id: z.uuid(),
  name: clientNameSchema,
  role: z.string().trim().min(1).max(CONTACT_PERSON_ROLE_MAX_LENGTH).nullable(),
  phone: driverPhoneSchema.nullable(),
  email: driverEmailSchema.nullable(),
}).refine(person => person.phone !== null || person.email !== null)

export type ClientOfficeContact = z.infer<typeof clientOfficeContactSchema>

/**
 * One Client's live contact persons and standing note, for the office screens
 * that sit on a Ride. The note is the text only. Nothing here is stored on
 * the Transfer. ADR-0049.
 */
export const clientOfficeBriefSchema = z.object({
  clientId: z.uuid(),
  contactPersons: z.array(clientOfficeContactSchema),
  note: z.string().trim().min(1).max(CLIENT_NOTE_MAX_LENGTH).nullable(),
})

export type ClientOfficeBrief = z.infer<typeof clientOfficeBriefSchema>
