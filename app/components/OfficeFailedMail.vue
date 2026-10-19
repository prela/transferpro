<script setup lang="ts">
import type { DisplayLocale, OfficeHome } from '../../shared'
import { failedMailResendSchema, formatInstant } from '../../shared'
import { refreshSharedOfficeHome } from '../composables/office-home-feed'

defineProps<{
  mails: OfficeHome['failedMails']
  timeZone: string
  locale: DisplayLocale
}>()

const { t } = useI18n()
const titleId = useId()
const pendingId = ref<string | null>(null)
const notice = ref<'stale' | 'failed' | null>(null)

/**
 * One click, one attempt. The list comes from the next Home read, so a
 * success or a stale mail leaves this block without a local delete.
 */
async function resend(entryId: string) {
  pendingId.value = entryId
  notice.value = null
  try {
    const body = failedMailResendSchema.parse(await $fetch(
      `/api/office-home/failed-mail/${entryId}/resend`,
      { method: 'POST' },
    ))
    if (body.outcome !== 'sent')
      notice.value = body.outcome
    await refreshSharedOfficeHome()
  }
  catch {
    notice.value = 'failed'
  }
  finally {
    pendingId.value = null
  }
}
</script>

<template>
  <!--
    Below Pozornost, and outside both attention tiers (ADR-0045).
    Hidden when empty so a quiet Home does not grow a heading.
    The button text is the label. The accessible name adds the Driver
    and the pickup so two rows are not the same control.
  -->
  <section
    v-if="mails.length > 0"
    class="mt-6"
    :aria-labelledby="titleId"
  >
    <h2
      :id="titleId"
      class="mb-3 text-sm font-semibold"
    >
      {{ t('officeHome.failedMail.title') }} ({{ mails.length }})
    </h2>
    <p
      v-if="notice"
      role="alert"
      class="mb-2 text-sm"
    >
      {{ notice === 'stale' ? t('officeHome.failedMail.stale') : t('officeHome.failedMail.notSent') }}
    </p>
    <ul class="flex flex-col gap-2">
      <li
        v-for="mail in mails"
        :key="mail.entryId"
        class="rounded-md border border-default px-2 py-2"
      >
        <p class="text-sm">
          <time
            class="tabular-nums"
            :datetime="mail.pickupAt"
          >{{ formatInstant(new Date(mail.pickupAt), timeZone, locale) }}</time>
          {{ mail.start }} → {{ mail.end }}
        </p>
        <p class="text-sm">
          {{ mail.driverName }} · {{ t(`officeHome.failedMail.status.${mail.status}`) }}
        </p>
        <UButton
          type="button"
          color="neutral"
          variant="outline"
          size="sm"
          class="mt-2 max-lg:min-h-11 max-lg:text-base"
          :loading="pendingId === mail.entryId"
          :disabled="pendingId !== null"
          :aria-label="t('officeHome.failedMail.resendFor', {
            driver: mail.driverName,
            when: formatInstant(new Date(mail.pickupAt), timeZone, locale),
          })"
          @click="resend(mail.entryId)"
        >
          {{ t('officeHome.failedMail.resend') }}
        </UButton>
      </li>
    </ul>
  </section>
</template>
