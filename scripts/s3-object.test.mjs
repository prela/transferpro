import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it } from 'vitest'
import { startFakeBackupBucket } from './fake-backup-bucket.mjs'
import {
  backupObjectKey,
  getBackupObject,
  keysToPrune,
  latestDailyKey,
  loadBackupS3Env,
  pruneDailyBackups,
  putBackupObject,
  signAwsRequest,
} from './s3-object.mjs'

const emptySha = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

it('signs the AWS SigV4 GET Object example', () => {
  const signed = signAwsRequest({
    method: 'GET',
    url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
    headers: { range: 'bytes=0-9' },
    payloadHash: emptySha,
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    region: 'us-east-1',
    now: new Date('2013-05-24T00:00:00.000Z'),
  })
  assert.equal(signed.canonicalHash, '7344ae5b7ee6c3e7e6b0fe0640412a37625d1fbfff95c48bbb2dc43964946972')
  assert.equal(
    signed.authorization,
    'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request,SignedHeaders=host;range;x-amz-content-sha256;x-amz-date,Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
  )
})

it('uses region auto in the credential scope for R2', () => {
  const signed = signAwsRequest({
    method: 'PUT',
    url: new URL('https://example.r2.cloudflarestorage.com/bucket/daily/file.dump.gpg'),
    payloadHash: emptySha,
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    region: 'auto',
    now: new Date('2026-10-14T12:00:00.000Z'),
  })
  assert.match(signed.authorization, /\/20261014\/auto\/s3\/aws4_request/)
})

it('keeps 14 daily backups and deletes the older ones', () => {
  const now = new Date('2026-10-14T00:00:00.000Z')
  const objects = [
    { key: 'daily/20260930T000000Z.dump.gpg', lastModified: new Date('2026-09-30T00:00:00.000Z') },
    { key: 'daily/20261001T000000Z.dump.gpg', lastModified: new Date('2026-10-01T00:00:00.000Z') },
    { key: 'daily/notes.txt', lastModified: new Date('2026-01-01T00:00:00.000Z') },
  ]
  assert.deepEqual(keysToPrune(objects, now, 'daily'), ['daily/20260930T000000Z.dump.gpg'])
  assert.equal(latestDailyKey(objects, 'daily'), 'daily/20261001T000000Z.dump.gpg')
  assert.equal(backupObjectKey('daily', now), 'daily/20261014T000000Z.dump.gpg')
})

it('refuses an http endpoint unless the local test allows it', () => {
  assert.throws(
    () => loadBackupS3Env({
      BACKUP_S3_BUCKET: 'bucket',
      BACKUP_S3_ENDPOINT: 'http://127.0.0.1:9',
      AWS_ACCESS_KEY_ID: 'key',
      AWS_SECRET_ACCESS_KEY: 'secret',
    }),
    /must use https/,
  )
})

it('puts and prunes through the S3 API', async () => {
  const bucket = await startFakeBackupBucket()
  const directory = await mkdtemp(join(tmpdir(), 'backup-s3-'))
  try {
    const settings = loadBackupS3Env({
      BACKUP_S3_BUCKET: 'transferpro',
      BACKUP_S3_ENDPOINT: bucket.url,
      BACKUP_S3_REGION: 'auto',
      AWS_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
      AWS_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      BACKUP_S3_ALLOW_HTTP: '1',
    })
    const source = join(directory, 'dump.gpg')
    const copy = join(directory, 'restored.gpg')
    await writeFile(source, 'encrypted-bytes')
    const key = backupObjectKey(settings.prefix, new Date())
    await putBackupObject(settings, key, source)
    await getBackupObject(settings, key, copy)
    assert.equal(await readFile(copy, 'utf8'), 'encrypted-bytes')

    bucket.objects.set('daily/20200101T000000Z.dump.gpg', {
      body: Buffer.from('old'),
      lastModified: '2020-01-01T00:00:00.000Z',
    })
    const removed = await pruneDailyBackups(settings)
    assert.deepEqual(removed, ['daily/20200101T000000Z.dump.gpg'])
    assert.equal(bucket.objects.has('daily/20200101T000000Z.dump.gpg'), false)
    assert.equal(bucket.objects.has(key), true)
  }
  finally {
    await bucket.close()
    await rm(directory, { recursive: true, force: true })
  }
})
