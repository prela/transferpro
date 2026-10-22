<script setup lang="ts">
import type { Driver, Partner } from '../../shared'
import { handedOffRideResultSchema } from '../../shared'
import { useCapacityRefusal } from '../composables/capacity-refusal'
import { useWorkOrderPresenter } from '../composables/kept-work-orders'
import { commandControlClass, commandControlSize, commandInputClass } from '../ride-detail'
import { errorCode, httpStatus } from '../transfer-day-http'

const props = defineProps<{
  rideId: string
  guestName: string
  partners: Partner[]
  drivers: Driver[]
  /**
   * The Partner already on the Ride. A change leaves that one off the
   * picker: the same active Partner is 409 `ride_partner_unchanged`.
   */
  currentPartnerId: string | null
  /**
   * True when the Ride still has a Driver or a Vehicle. A handoff from
   * assigned or accepted clears both (ADR-0048). The form states that
   * before the office submits (ADR-0038).
   */
  clearsCrew: boolean
  mode: 'handOff' | 'changePartner'
  /** The Transfer version this form was opened with. ADR-0046. */
  version: number
  /** Phone uses the large targets and a list. Desktop uses the select. */
  phone?: boolean
  /** 409 stale_save. Awaited so the notice is up before the button enables. */
  onStale: () => Promise<void>
}>()

const emit = defineEmits<{
  saved: []
  cancel: []
}>()

const controlSize = computed(() => commandControlSize(props.phone === true))
const controlClass = computed(() => commandControlClass(props.phone === true))

const { t } = useI18n()
const toast = useToast()
const { present } = useWorkOrderPresenter()
const { notifyAuditChanged } = useAuditRefresh()
const titleId = useId()

const partnerId = ref<string | undefined>()
const pending = ref(false)
const formErrorKey = ref<HandOffFailure | null>(null)
const { refusalOpen, refusalReason, handleCapacityRefusal } = useCapacityRefusal({
  onStale: () => props.onStale(),
  initialReason: 'unavailable',
})

type HandOffFailure
  = 'ride.partnerArchived'
    | 'ride.notHandoffable'
    | 'ride.notHandedOff'
    | 'ride.partnerUnchanged'
    | 'ride.notFound'
    | 'ride.rejected'
    | 'ride.forbidden'
    | 'ride.signedOut'
    | 'ride.handOffFailed'

/**
 * Archived Partners stay in the catalog so a Ride already handed to one
 * keeps the name. They are not a new handoff (409 ride_partner_archived).
 */
const offerable = computed(() => props.partners.filter(partner =>
  partner.archivedAt === null && (props.mode === 'handOff' || partner.id !== props.currentPartnerId),
))

const partnerItems = computed(() => offerable.value.map(partner => ({
  label: partner.name,
  value: partner.id,
})))

const canSubmit = computed(() => Boolean(partnerId.value))

const titleKey = computed(() => props.mode === 'handOff' ? 'ride.handOffTitle' : 'ride.changePartnerTitle')
const emptyKey = computed(() => props.mode === 'handOff' ? 'ride.noPartners' : 'ride.noOtherPartner')
const submitKey = computed(() => {
  if (pending.value)
    return props.mode === 'handOff' ? 'ride.handingOff' : 'ride.changingPartner'
  return props.mode === 'handOff' ? 'ride.handOffSubmit' : 'ride.changePartnerSubmit'
})

function failureKey(error: unknown): HandOffFailure {
  // The thrown message is never shown: it can carry an id or a stack.
  switch (errorCode(error)) {
    case 'ride_partner_archived': return 'ride.partnerArchived'
    case 'ride_not_handoffable': return 'ride.notHandoffable'
    case 'ride_not_handed_off': return 'ride.notHandedOff'
    case 'ride_partner_unchanged': return 'ride.partnerUnchanged'
  }
  switch (httpStatus(error)) {
    case 400: return 'ride.rejected'
    case 401: return 'ride.signedOut'
    case 403: return 'ride.forbidden'
    case 404: return 'ride.notFound'
    default: return 'ride.handOffFailed'
  }
}

/**
 * POST /api/rides/:id/hand-off or /partner. The body is the Partner and the
 * version. A fully booked window is 409 `fully_booked` and the dialog
 * offers no confirmation. An unavailable Partner is 409 `ride_unavailable`
 * and writes nothing; the same body with `confirm: true` passes that
 * window (ADR-0034).
 * A Partner is not mailed. From assigned or accepted the Driver gets no
 * longer yours.
 */
async function save(confirm = false) {
  const chosen = partnerId.value
  if (!chosen || pending.value)
    return
  pending.value = true
  formErrorKey.value = null
  try {
    const path = props.mode === 'handOff' ? 'hand-off' : 'partner'
    const saved = handedOffRideResultSchema.parse(await $fetch(`/api/rides/${props.rideId}/${path}`, {
      method: 'POST',
      body: {
        partnerId: chosen,
        version: props.version,
        ...(confirm ? { confirm: true } : {}),
      },
    }))
    refusalOpen.value = false
    notifyAuditChanged()
    const title = t(props.mode === 'handOff' ? 'ride.handedOff' : 'ride.partnerChanged')
    const notice = saved.workOrders[0]
    if (notice === undefined) {
      const savedNotice = { title, color: 'success' as const, role: 'status' }
      toast.add(savedNotice)
    }
    else {
      const driverName = props.drivers.find(driver => driver.id === notice.driverId)?.name ?? t('ride.unknownDriver')
      present(props.rideId, notice.outcome, driverName, title)
    }
    emit('saved')
  }
  catch (error) {
    await handleCapacityRefusal(error, () => {
      formErrorKey.value = failureKey(error)
    })
  }
  finally {
    pending.value = false
  }
}
</script>

<template>
  <form
    class="mt-6"
    :aria-labelledby="titleId"
    @submit.prevent="save()"
  >
    <h2
      :id="titleId"
      class="mb-4 text-xl font-semibold"
    >
      {{ t(titleKey) }}
    </h2>
    <p class="mb-4">
      {{ guestName }}
    </p>
    <p
      v-if="mode === 'handOff' && clearsCrew"
      class="mb-4"
    >
      {{ t('ride.handOffClearsCrew') }}
    </p>
    <UAlert
      v-if="formErrorKey"
      color="error"
      variant="subtle"
      role="alert"
      class="mb-4"
      :description="t(formErrorKey)"
    />
    <p
      v-if="offerable.length === 0"
      class="mb-4"
    >
      {{ t(emptyKey) }}
    </p>
    <ul
      v-else-if="phone"
      class="mb-4 flex flex-col gap-2"
      :aria-label="t('ride.partner')"
    >
      <li
        v-for="partner in offerable"
        :key="partner.id"
      >
        <UButton
          type="button"
          color="neutral"
          :variant="partnerId === partner.id ? 'solid' : 'outline'"
          size="xl"
          class="min-h-12 w-full justify-start"
          :disabled="pending"
          :aria-pressed="partnerId === partner.id"
          @click="partnerId = partner.id"
        >
          {{ partner.name }}
        </UButton>
      </li>
    </ul>
    <UFormField
      v-else
      :label="t('ride.partner')"
      name="hand-off-partner"
      class="mb-4"
      :class="commandInputClass"
      :size="controlSize"
    >
      <USelect
        id="hand-off-partner"
        v-model="partnerId"
        name="hand-off-partner"
        :items="partnerItems"
        :placeholder="t('ride.choosePartner')"
        :disabled="pending"
        autofocus
        class="w-full"
      />
    </UFormField>
    <div class="flex flex-wrap gap-2">
      <UButton
        type="submit"
        :size="controlSize"
        :class="controlClass"
        :disabled="pending || !canSubmit"
        :loading="pending"
      >
        {{ t(submitKey) }}
      </UButton>
      <UButton
        type="button"
        color="neutral"
        variant="outline"
        :size="controlSize"
        :class="controlClass"
        :disabled="pending"
        @click="emit('cancel')"
      >
        {{ t('ride.cancel') }}
      </UButton>
    </div>
  </form>
  <RideOverlapDialog
    v-model:open="refusalOpen"
    :pending="pending"
    :reason="refusalReason"
    @confirm="save(true)"
  />
</template>
