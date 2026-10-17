import { expect, it } from 'vitest'
import { accountInitials, officeNav, officePhoneBar } from './office-nav'

const labels = {
  operations: 'Operativa',
  catalogs: 'Katalozi',
  management: 'Uprava',
  home: 'Početna',
  transfers: 'Transferi',
  roster: 'Raspored',
  clients: 'Naručitelji',
  locations: 'Lokacije',
  drivers: 'Vozači',
  vehicles: 'Vozila',
  audit: 'Revizija',
  companySettings: 'Postavke tvrtke',
}

it('gives an admin the three groups and leaves the urgent count empty', () => {
  const groups = officeNav('admin', labels)
  expect(groups.map(group => group.label)).toEqual(['Operativa', 'Katalozi', 'Uprava'])
  expect(groups[0]?.links.map(item => item.label)).toEqual(['Početna', 'Transferi', 'Raspored'])
  expect(groups[1]?.links.map(item => item.to)).toEqual(['/clients', '/locations', '/drivers', '/vehicles'])
  expect(groups[2]?.links.map(item => item.label)).toEqual(['Revizija', 'Postavke tvrtke'])
  expect(groups[2]?.links.map(item => item.to)).toEqual(['/audit', '/settings'])
  expect(groups[0]?.links[0]?.urgentCount).toBeNull()
  expect(groups.flatMap(group => group.links).some(item => item.to === '/partners' || item.to === '/prices')).toBe(false)
})

it('hides audit and company settings from a dispatcher', () => {
  const groups = officeNav('dispatcher', labels)
  expect(groups.map(group => group.id)).toEqual(['operations', 'catalogs'])
  const labelsSeen = groups.flatMap(group => group.links.map(item => item.label))
  expect(labelsSeen).not.toContain('Revizija')
  expect(labelsSeen).not.toContain('Postavke tvrtke')
})

it('puts the urgent Ride count on Početna and on the phone bar', () => {
  const groups = officeNav('admin', labels, 3)
  expect(groups[0]?.links[0]?.urgentCount).toBe(3)
  expect(groups[0]?.links[1]?.urgentCount).toBeNull()
  expect(officePhoneBar(groups)[0]?.urgentCount).toBe(3)
  expect(officeNav('dispatcher', labels, 0)[0]?.links[0]?.urgentCount).toBe(0)
})

it('puts home, transfers, and roster on the phone bar', () => {
  expect(officePhoneBar(officeNav('admin', labels)).map(item => item.id)).toEqual(['home', 'transfers', 'roster'])
})

it('takes initials from the account name', () => {
  expect(accountInitials('Ana Mora')).toBe('AM')
  expect(accountInitials('Čeda')).toBe('Č')
  expect(accountInitials('  ada   lovric  ')).toBe('AL')
})
