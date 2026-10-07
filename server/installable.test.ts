import { readFileSync } from 'node:fs'
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
  expect(source).not.toContain('caches')
  expect(source).not.toContain('cache')
})
