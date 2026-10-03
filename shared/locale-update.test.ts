import { expect, it } from 'vitest'
import { LocaleChoiceError, saveDisplayLocale } from './locale-update'

it('writes hr and en and does not write anything else', async () => {
  const written: string[] = []
  const write = async (locale: string) => {
    written.push(locale)
  }

  await saveDisplayLocale({ locale: 'hr' }, write)
  await saveDisplayLocale({ locale: 'en' }, write)

  await expect(saveDisplayLocale({ locale: 'de' }, write)).rejects.toBeInstanceOf(LocaleChoiceError)
  await expect(saveDisplayLocale({ locale: 'en-US' }, write)).rejects.toBeInstanceOf(LocaleChoiceError)
  await expect(saveDisplayLocale({}, write)).rejects.toBeInstanceOf(LocaleChoiceError)

  expect(written).toEqual(['hr', 'en'])
})
