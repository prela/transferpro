import { expect, it } from 'vitest'
import { closeMailOutboxQueue, closeWithMailOutboxQueue } from './queue'

it('runs each registered closer once when the queue closes', async () => {
  const closed: string[] = []
  closeWithMailOutboxQueue(async () => {
    closed.push('retention pool')
  })

  await closeMailOutboxQueue()
  await closeMailOutboxQueue()

  expect(closed).toEqual(['retention pool'])
})
