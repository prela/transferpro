<script setup lang="ts">
import type { DisplayLocale, OfficeHome } from '../../shared'
import { formatInstant } from '../../shared'

type Row = OfficeHome['waitingOnAcceptance'][number]

const props = defineProps<{
  ride: Row
  timeZone: string
  locale: DisplayLocale
}>()

const { t } = useI18n()

function pickupLabel(pickupAt: string): string {
  return formatInstant(new Date(pickupAt), props.timeZone, props.locale)
}

/** EUR, two decimals. Croatian uses a comma. The stored value stays a dot. */
function priceLabel(price: string): string {
  const shown = props.locale === 'hr' ? price.replace('.', ',') : price
  return `${shown} EUR`
}
</script>

<template>
  <time
    class="mt-1 block"
    :datetime="ride.pickupAt"
  >
    {{ pickupLabel(ride.pickupAt) }}
  </time>
  <p class="mt-1">
    {{ ride.start }}
  </p>
  <p>{{ ride.end }}</p>
  <p>{{ t(`transfers.states.${ride.state}`) }}</p>
  <p>
    {{ t('ride.driver') }}: {{ ride.driverName ?? '—' }}
  </p>
  <p>
    {{ t('ride.vehicle') }}: {{ ride.vehiclePlate ?? '—' }}
  </p>
  <!--
    Office Home shows the price and the method for cash, card, and invoice
    to agency. The Driver phone still hides card and invoice to agency.
  -->
  <p>{{ priceLabel(ride.price) }}</p>
  <p>{{ t(`transfers.payments.${ride.payment}`) }}</p>
  <!-- The flight number is text. A live flight link is not on this row. -->
  <p v-if="ride.flightNumber">
    {{ t('transfers.fields.flightNumber') }}: {{ ride.flightNumber }}
  </p>
</template>
