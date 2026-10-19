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
const noticeText = computed(() => {
  if (notice.value === 'stale')
    return t('officeHome.failedMail.stale')
  if (notice.value === 'failed')
    return t('officeHome.failedMail.notSent')
  return ''
})

/**
 * One click, one attempt. The list comes from the next Home read, so a
 * success or a stale mail leaves this block without a local delete.
 * The sentence stays after that read: a stale resend of the last row
 * would otherwise unmount the alert with the empty block.
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
  catch (error) {
    // 404: another member already settled this row. Refresh the list and
    // stay quiet. Any other failure is "Mail nije poslan."
    if (httpStatus(error) === 404) {
      await refreshSharedOfficeHome()
      return
    }
    notice.value = 'failed'
  }
  finally {
    pendingId.value = null
  }
}

function httpStatus(error: unknown): number | null {
  if (typeof error === 'object' && error !== null && 'statusCode' in error && typeof error.statusCode === 'number')
    return error.statusCode
  return null
}
</script>

<template>
  <!--
    Below Pozornost, and outside both attention tiers (ADR-0045).
    The heading is hidden when the list is empty. The alert stays,
    including when the last resend is no longer current.
    The button text is the label. The accessible name adds the Driver
    and the pickup so two rows are not the same control.
  -->
  <div
    v-if="mails.length > 0 || notice"
    class="mt-6"
  >
    <p
      v-if="notice"
      role="alert"
      class="mb-2 text-sm"
    >
      {{ noticeText }}
    </p>
    <section
      v-if="mails.length > 0"
      :aria-labelledby="titleId"
    >
      <h2
        :id="titleId"
        class="mb-3 text-sm font-semibold"
      >
        {{ t('officeHome.failedMail.title') }} ({{ mails.length }})
      </h2>
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
  </div>
</template>
