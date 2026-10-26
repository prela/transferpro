/**
 * RLS fixtures call office writes without a screen Tenant. The flag tells
 * `officeWriteClaim` to use the session Tenant for that missing claim.
 * The built server never imports this file, so e2e and production refuse
 * a write that names no Tenant. Unit tests turn it on only around the
 * one case that proves the flag, then turn it off.
 */
const officeClaimFixtureKey = '__transferproOfficeClaimFixture'

export function enableOfficeClaimFixture(): void {
  Reflect.set(globalThis, officeClaimFixtureKey, true)
}

export function disableOfficeClaimFixture(): void {
  Reflect.deleteProperty(globalThis, officeClaimFixtureKey)
}

export function officeClaimFixtureEnabled(): boolean {
  return Reflect.get(globalThis, officeClaimFixtureKey) === true
}
