import { expect, it, vi } from 'vitest'
import { useCapacityRefusal } from './capacity-refusal'

function refused(code: string) {
  return { data: { code }, statusCode: 409 }
}

it('opens Popunjeno and does not confirm a fully booked window', async () => {
  const onStale = vi.fn()
  const onFailure = vi.fn()
  const { refusalOpen, refusalReason, handleCapacityRefusal } = useCapacityRefusal({ onStale })

  await handleCapacityRefusal(refused('fully_booked'), onFailure)

  expect(refusalOpen.value).toBe(true)
  expect(refusalReason.value).toBe('fullyBooked')
  expect(onStale).not.toHaveBeenCalled()
  expect(onFailure).not.toHaveBeenCalled()
})

it('opens the overlap dialog so the same confirmation can pass it', async () => {
  const onFailure = vi.fn()
  const { refusalOpen, refusalReason, handleCapacityRefusal } = useCapacityRefusal({ onStale: vi.fn() })

  await handleCapacityRefusal(refused('ride_overlap'), onFailure)

  expect(refusalOpen.value).toBe(true)
  expect(refusalReason.value).toBe('overlap')
  expect(onFailure).not.toHaveBeenCalled()
})

it('opens the unavailability dialog so the same confirmation can pass it', async () => {
  const onFailure = vi.fn()
  const { refusalOpen, refusalReason, handleCapacityRefusal } = useCapacityRefusal({ onStale: vi.fn() })

  await handleCapacityRefusal(refused('ride_unavailable'), onFailure)

  expect(refusalOpen.value).toBe(true)
  expect(refusalReason.value).toBe('unavailable')
  expect(onFailure).not.toHaveBeenCalled()
})

it('reloads a stale save and leaves the dialog closed', async () => {
  const onStale = vi.fn()
  const onFailure = vi.fn()
  const refusal = useCapacityRefusal({ onStale })
  await refusal.handleCapacityRefusal(refused('fully_booked'), onFailure)

  await refusal.handleCapacityRefusal(refused('stale_save'), onFailure)

  expect(onStale).toHaveBeenCalledOnce()
  expect(onFailure).not.toHaveBeenCalled()
  expect(refusal.refusalOpen.value).toBe(false)
})

it('leaves a stale save to the caller when no reload was given', async () => {
  const onFailure = vi.fn()
  const { refusalOpen, handleCapacityRefusal } = useCapacityRefusal()

  await handleCapacityRefusal(refused('stale_save'), onFailure)

  expect(onFailure).toHaveBeenCalledOnce()
  expect(refusalOpen.value).toBe(false)
})

it('leaves any other error to the caller and closes the dialog', async () => {
  const onFailure = vi.fn()
  const refusal = useCapacityRefusal({ onStale: vi.fn() })
  await refusal.handleCapacityRefusal(refused('ride_overlap'), onFailure)

  await refusal.handleCapacityRefusal(refused('ride_not_unassigned'), onFailure)

  expect(onFailure).toHaveBeenCalledOnce()
  expect(refusal.refusalOpen.value).toBe(false)
  expect(refusal.refusalReason.value).toBe('overlap')
})

it('keeps a hand-off on unavailability until a refusal names another reason', () => {
  const { refusalOpen, refusalReason } = useCapacityRefusal({ initialReason: 'unavailable' })

  expect(refusalOpen.value).toBe(false)
  expect(refusalReason.value).toBe('unavailable')
})
