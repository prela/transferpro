/**
 * Loaders the mail outbox worker calls. They return tenant data and check
 * no role: the worker has no actor (#344). This array is the only list.
 *
 * A non-test file under server/api or server/routes may import or call a
 * name here only when the function that uses it, or a function enclosing
 * that use, calls `officeOnly` or `requireRole`. The lint rule
 * `transferpro/worker-loader-role` reads this array.
 *
 * `workerLoaderModules` are the infrastructure files that exist to serve
 * those loaders. Importing one is the same breach as naming a loader.
 * `workerLoaderBarrels` are the module indexes that re-export a loader.
 * `export *` from one of them would publish the loader without naming it.
 *
 * This file stays out of server/. Nitro scans server/modules for its own
 * modules, and an ESM namespace cannot take the setup function it adds.
 */
export const workerUsedLoaders = [
  'loadInvitationAttempt',
  'invitationAttemptStore',
  'loadOutboxAttempt',
  'outboxAttemptStore',
  'mailOutboxStore',
  'readInvitationForMail',
]

export const workerLoaderModules = [
  'invitation-attempt',
  'work-order-attempt',
]

export const workerLoaderBarrels = [
  'mail',
  'transfers',
  'tenancy',
]
