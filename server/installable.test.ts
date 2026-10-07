import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { expect, it } from 'vitest'

function pngSize(path: string): { width: number, height: number } {
  const bytes = readFileSync(path)
  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

it('the manifest can be installed to the home screen', () => {
  const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8')) as {
    name: string
    short_name: string
    start_url: string
    display: string
    prefer_related_applications?: boolean
    icons: Array<{ src: string, sizes: string, type: string }>
  }
  expect(manifest.name).toBe('Transferpro')
  expect(manifest.short_name).toBe('Transferpro')
  expect(manifest.start_url).toBe('/')
  expect(manifest.display).toBe('standalone')
  expect(manifest.prefer_related_applications).toBeUndefined()
  expect(manifest.icons.map(icon => icon.sizes)).toEqual(['192x192', '512x512'])
  expect(manifest.icons.every(icon => icon.type === 'image/png')).toBe(true)
  expect(pngSize('public/icons/icon-192.png')).toEqual({ width: 192, height: 192 })
  expect(pngSize('public/icons/icon-512.png')).toEqual({ width: 512, height: 512 })
})

it('the service worker does not cache ride data', () => {
  const source = readFileSync('public/sw.js', 'utf8')
  expect(source).toContain('fetch')
  expect(source).not.toContain('caches.')
  expect(source).not.toContain('cache.put')
  expect(source).not.toContain('cache.add')

  interface FetchHandlerEvent {
    request: { method: string, url: string }
    respondWith: (result: unknown) => void
  }

  const listeners = new Map<string, (event: FetchHandlerEvent) => void>()
  runInNewContext(source, {
    addEventListener(type: string, listener: (event: FetchHandlerEvent) => void) {
      listeners.set(type, listener)
    },
    location: { origin: 'https://app.example' },
    fetch: (request: unknown) => Promise.resolve(request),
    URL,
  })

  function intercepted(url: string, method = 'GET'): boolean {
    const listener = listeners.get('fetch')
    expect(listener).toBeTypeOf('function')
    let called = false
    listener!({
      request: { method, url },
      respondWith() {
        called = true
      },
    })
    return called
  }

  expect(intercepted('https://app.example/api/rides/upcoming')).toBe(true)
  expect(intercepted('https://app.example/api/auth/sign-in/email', 'POST')).toBe(false)
  expect(intercepted('https://other.example/track')).toBe(false)
})
