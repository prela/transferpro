import type { APIRequestContext, APIResponse } from '@playwright/test'

/**
 * Posts one Transfer create. Each call sends a fresh entry key, so the same
 * helper still records a new Transfer once that key is required. A body
 * that already names `externalId` keeps that id: the spread comes after
 * the fresh one.
 */
export function recordTransfer(
  request: APIRequestContext,
  options: { readonly data: object },
): Promise<APIResponse> {
  return request.post('/api/transfers', {
    data: {
      externalId: crypto.randomUUID(),
      ...options.data,
    },
  })
}
