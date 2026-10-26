import { expect, it } from 'vitest'
import { applyOfficeClaim, isOfficeWrite, TENANT_CHANGED } from './expected-tenant'

it('names the refusal and the office writes, and leaves the session commands alone', () => {
  expect(TENANT_CHANGED).toBe('tenant_changed')
  const id = '00000000-0000-4000-8000-000000000001'
  expect(isOfficeWrite('post', '/api/transfers')).toBe(true)
  expect(isOfficeWrite('PATCH', `/api/transfers/${id}`)).toBe(true)
  expect(isOfficeWrite('POST', `/api/rides/${id}/accept-by-phone`)).toBe(true)
  expect(isOfficeWrite('PUT', '/api/roster')).toBe(true)
  expect(isOfficeWrite('DELETE', `/api/members/${id}`)).toBe(true)
  expect(isOfficeWrite('POST', '/api/invitations')).toBe(true)
  expect(isOfficeWrite('POST', `https://office.example/api/clients/${id}`)).toBe(false)
  expect(isOfficeWrite('PUT', `http://127.0.0.1:3000/api/clients/${id}/note`)).toBe(true)
  expect(isOfficeWrite('GET', '/api/clients')).toBe(false)
  expect(isOfficeWrite('POST', '/api/tenant-switch')).toBe(false)
  expect(isOfficeWrite('POST', '/api/tenant-choices')).toBe(false)
  expect(isOfficeWrite('POST', '/api/locale')).toBe(false)
  expect(isOfficeWrite('POST', '/api/auth/sign-in/email')).toBe(false)
  expect(isOfficeWrite('POST', '/api/invitations/accept')).toBe(false)
  expect(isOfficeWrite('POST', '/api/invitations/preview')).toBe(false)
  expect(isOfficeWrite('POST', '/api/locations/suggestions')).toBe(false)
  expect(isOfficeWrite('POST', `/api/rides/${id}/roster-vehicle`)).toBe(false)
})

it('adds the screen Tenant to an office write, and leaves a session command alone', () => {
  const id = '00000000-0000-4000-8000-000000000001'
  const saved = applyOfficeClaim({
    method: 'POST',
    url: '/api/clients',
    headers: new Headers(),
    body: { name: 'Agencija', kind: 'agency' },
  }, id)
  expect(saved.claimed).toBe(true)
  expect(saved.headers.get('x-expected-tenant-id')).toBe(id)
  expect(saved.body).toEqual({ name: 'Agencija', kind: 'agency', expectedTenantId: id })

  // The dialog posts an empty object. The only JSON key is the screen Tenant.
  const accepted = applyOfficeClaim({
    method: 'post',
    url: `/api/rides/${id}/accept-by-phone`,
    headers: new Headers(),
    body: {},
  }, id)
  expect(accepted.body).toEqual({ expectedTenantId: id })

  const noted = applyOfficeClaim({
    method: 'PUT',
    url: `http://127.0.0.1:3000/api/clients/${id}/note`,
    headers: new Headers(),
    body: JSON.stringify({ note: 'Stoj' }),
  }, id)
  expect(noted.body).toBe(JSON.stringify({ note: 'Stoj', expectedTenantId: id }))

  const switched = applyOfficeClaim({
    method: 'POST',
    url: '/api/tenant-switch',
    headers: new Headers(),
    body: { tenantId: id },
  }, id)
  expect(switched.claimed).toBe(false)
  expect(switched.headers.get('x-expected-tenant-id')).toBeNull()
  expect(switched.body).toEqual({ tenantId: id })
})
