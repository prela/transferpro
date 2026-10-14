/**
 * In-memory S3 for the backup scripts. It stores bytes and lists them.
 * It does not check signatures; the SigV4 vector test does that.
 */
import { Buffer } from 'node:buffer'
import { createServer } from 'node:http'

/**
 * @returns {Promise<{ url: string, objects: Map<string, { body: Buffer, lastModified: string }>, close: () => Promise<void> }>} Listening bucket.
 */
export function startFakeBackupBucket() {
  /** @type {Map<string, { body: Buffer, lastModified: string }>} */
  const objects = new Map()
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
    const key = parts.slice(1).join('/')
    if (request.method === 'PUT') {
      const chunks = []
      for await (const chunk of request)
        chunks.push(chunk)
      objects.set(key, {
        body: Buffer.concat(chunks),
        lastModified: new Date().toISOString(),
      })
      response.writeHead(200)
      response.end()
      return
    }
    if (request.method === 'GET' && url.searchParams.get('list-type') === '2') {
      const prefix = url.searchParams.get('prefix') ?? ''
      const blocks = [...objects.entries()]
        .filter(([name]) => name.startsWith(prefix))
        .map(([name, object]) => {
          return `<Contents><Key>${escapeXml(name)}</Key><LastModified>${object.lastModified}</LastModified></Contents>`
        })
      response.writeHead(200, { 'content-type': 'application/xml' })
      response.end(`<ListBucketResult><IsTruncated>false</IsTruncated>${blocks.join('')}</ListBucketResult>`)
      return
    }
    if (request.method === 'GET') {
      const object = objects.get(key)
      if (!object) {
        response.writeHead(404)
        response.end('<Error><Code>NoSuchKey</Code></Error>')
        return
      }
      response.writeHead(200)
      response.end(object.body)
      return
    }
    if (request.method === 'DELETE') {
      objects.delete(key)
      response.writeHead(204)
      response.end()
      return
    }
    response.writeHead(405)
    response.end()
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('backup bucket did not bind a port'))
        return
      }
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        objects,
        close: () => new Promise((done, fail) => {
          server.close(error => error ? fail(error) : done())
        }),
      })
    })
  })
}

/**
 * @param {string} value
 */
function escapeXml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}
