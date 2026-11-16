import type { TransferFilterMemoryStore } from '../../shared'
import { clearTransferFilterMemory, forgetTransferFilterMemory } from '../../shared'

/**
 * The tab's sessionStorage for the remembered Transfer filters (ADR-0064).
 * A blocked store is "no memory": the list still works from the address.
 */
export function browserTransferFilterMemory(): TransferFilterMemoryStore | null {
  if (!import.meta.client)
    return null
  try {
    return sessionStore(sessionStorage)
  }
  catch {
    return null
  }
}

/** Every key of this kind in the tab. The draft is a different prefix. */
export function clearBrowserTransferFilterMemory(): void {
  try {
    const store = browserTransferFilterMemory()
    if (store)
      clearTransferFilterMemory(store)
  }
  catch {
    // Sign-out and sign-in still finish when storage is blocked.
  }
}

/** The company being left. The destination's key, if it has one, stays. */
export function forgetBrowserTransferFilterMemory(tenantId: string, userId: string): void {
  try {
    const store = browserTransferFilterMemory()
    if (store)
      forgetTransferFilterMemory(store, tenantId, userId)
  }
  catch {
    // The switch still reloads when storage is blocked.
  }
}

function sessionStore(storage: Storage): TransferFilterMemoryStore {
  return {
    getItem: key => storage.getItem(key),
    setItem: (key, value) => {
      storage.setItem(key, value)
    },
    removeItem: (key) => {
      storage.removeItem(key)
    },
    keys: () => {
      const names: string[] = []
      for (let index = 0; index < storage.length; index += 1) {
        const name = storage.key(index)
        if (name !== null)
          names.push(name)
      }
      return names
    },
  }
}
