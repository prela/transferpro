import { expect, it } from 'vitest'
import { CLIENT_NOTE_MAX_LENGTH, ClientNoteInputError, parseClientNoteSave } from './client-note'

const note = 'Gosti se čekaju na izlazu.'

it('accepts a first save with no version, and trims the text', () => {
  expect(parseClientNoteSave({ note: `  ${note}  ` })).toEqual({ note })
})

it('treats an empty or blank save as clearing the text', () => {
  expect(parseClientNoteSave({ note: '' })).toEqual({ note: null })
  expect(parseClientNoteSave({ note: '   ' })).toEqual({ note: null })
  expect(parseClientNoteSave({ note: null })).toEqual({ note: null })
  expect(parseClientNoteSave({ note: '', version: 2 })).toEqual({ note: null, version: 2 })
})

it('accepts a later save that sends the version the form opened with', () => {
  expect(parseClientNoteSave({ note, version: 1 })).toEqual({ note, version: 1 })
  expect(parseClientNoteSave({ note, version: 0 })).toEqual({ note, version: 0 })
})

it('refuses a note past 2000 characters, a missing note, a bad version, or an unknown key', () => {
  expect(() => parseClientNoteSave({ note: 'A'.repeat(CLIENT_NOTE_MAX_LENGTH + 1) })).toThrow(ClientNoteInputError)
  expect(() => parseClientNoteSave({})).toThrow(ClientNoteInputError)
  expect(() => parseClientNoteSave({ note, version: -1 })).toThrow(ClientNoteInputError)
  expect(() => parseClientNoteSave({ note, version: 1.5 })).toThrow(ClientNoteInputError)
  expect(() => parseClientNoteSave({ note, version: '1' })).toThrow(ClientNoteInputError)
  // The text must not ride along under another key. The row is never deleted.
  expect(() => parseClientNoteSave({ note, text: 'Skriveni tekst' })).toThrow(ClientNoteInputError)
})
