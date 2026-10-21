import { expect, it } from 'vitest'
import { companySettingsRedirect, companySettingsTab } from './company-settings'

it('sends an admin from the old settings addresses to the new tabs', () => {
  expect(companySettingsRedirect('/settings/tenant', 'admin')).toBe('/settings')
  expect(companySettingsRedirect('/settings/members/', 'admin')).toBe('/settings?tab=members')
  expect(companySettingsRedirect('/settings/profile', 'admin')).toBe('/profile')
  expect(companySettingsRedirect('/settings', 'admin')).toBeNull()
  expect(companySettingsRedirect('/settings/', 'admin')).toBeNull()
})

it('refuses a dispatcher and a driver on the company settings route itself', () => {
  for (const role of ['dispatcher', 'driver'] as const) {
    expect(companySettingsRedirect('/settings', role)).toBe('/profile')
    expect(companySettingsRedirect('/settings/tenant', role)).toBe('/profile')
    expect(companySettingsRedirect('/settings/members', role)).toBe('/profile')
    expect(companySettingsRedirect('/settings/profile', role)).toBe('/profile')
  }
})

it('leaves a path that is not company settings alone', () => {
  expect(companySettingsRedirect('/audit', 'admin')).toBeNull()
  expect(companySettingsRedirect('/profile', 'dispatcher')).toBeNull()
})

it('treats a differently cased settings address as the same protected route', () => {
  expect(companySettingsRedirect('/Settings', 'dispatcher')).toBe('/profile')
  expect(companySettingsRedirect('/SETTINGS/tenant', 'driver')).toBe('/profile')
  expect(companySettingsRedirect('/Settings/members/', 'admin')).toBe('/settings?tab=members')
  expect(companySettingsRedirect('/Settings/Profile', 'admin')).toBe('/profile')
})

it('leaves the public password route alone in either case', () => {
  expect(companySettingsRedirect('/forgot-password', 'admin')).toBeNull()
  expect(companySettingsRedirect('/Forgot-password', 'dispatcher')).toBeNull()
  expect(companySettingsRedirect('/reset-password', 'driver')).toBeNull()
})

it('reads the members tab only from the members query', () => {
  expect(companySettingsTab(undefined)).toBe('operations')
  expect(companySettingsTab('operations')).toBe('operations')
  expect(companySettingsTab('members')).toBe('members')
  expect(companySettingsTab(['members', 'operations'])).toBe('members')
  expect(companySettingsTab(['nope'])).toBe('operations')
})
