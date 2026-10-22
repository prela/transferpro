import { expect, it } from 'vitest'
import { rideDetailEmbedUrls, rideDetailMapOpen } from './ride-detail-map'

const startId = 'a1b2c3d4-5555-4555-8555-555555555555'
const endId = 'b1b2c3d4-5555-4555-8555-555555555555'
const startUrl = 'about:blank#placeRef=ChIJstart&language=hr'
const endUrl = 'about:blank#placeRef=ChIJend&language=hr'
const replacedUrl = 'about:blank#placeRef=ChIJreplaced&language=hr'

const closed = { start: false, end: false }
const bothOpen = { start: true, end: true }

it('offers a map for the start and the end, and only the start when they are the same Location', () => {
  expect(rideDetailEmbedUrls({
    startLocationId: startId,
    endLocationId: endId,
    startEmbedUrl: startUrl,
    endEmbedUrl: endUrl,
  })).toEqual({ start: startUrl, end: endUrl })

  expect(rideDetailEmbedUrls({
    startLocationId: startId,
    endLocationId: endId,
    startEmbedUrl: null,
    endEmbedUrl: endUrl,
  })).toEqual({ start: null, end: endUrl })

  expect(rideDetailEmbedUrls({
    startLocationId: startId,
    endLocationId: endId,
    startEmbedUrl: startUrl,
    endEmbedUrl: null,
  })).toEqual({ start: startUrl, end: null })

  // The same Location would show the same map twice. Only the start has a button.
  expect(rideDetailEmbedUrls({
    startLocationId: startId,
    endLocationId: startId,
    startEmbedUrl: startUrl,
    endEmbedUrl: startUrl,
  })).toEqual({ start: startUrl, end: null })
})

it('keeps an open map across a refresh when the URL stays or is replaced, and closes it when the URL is gone', () => {
  const staying = {
    rideChanged: false,
    startUrl,
    endUrl,
    phone: false,
    press: null,
  }
  expect(rideDetailMapOpen(bothOpen, staying)).toEqual(bothOpen)
  expect(rideDetailMapOpen(bothOpen, { ...staying, startUrl: replacedUrl })).toEqual(bothOpen)
  expect(rideDetailMapOpen(bothOpen, { ...staying, startUrl: null })).toEqual({ start: false, end: true })
  expect(rideDetailMapOpen(bothOpen, { ...staying, endUrl: null })).toEqual({ start: true, end: false })
})

it('opens the two maps independently on a desktop and one at a time on a phone', () => {
  const urls = { rideChanged: false, startUrl, endUrl, press: { slot: 'start' as const, open: true } }
  expect(rideDetailMapOpen(closed, { ...urls, phone: false })).toEqual({ start: true, end: false })
  expect(rideDetailMapOpen(
    { start: true, end: false },
    { ...urls, phone: false, press: { slot: 'end', open: true } },
  )).toEqual(bothOpen)
  expect(rideDetailMapOpen(
    bothOpen,
    { ...urls, phone: false, press: { slot: 'start', open: false } },
  )).toEqual({ start: false, end: true })

  expect(rideDetailMapOpen(closed, { ...urls, phone: true })).toEqual({ start: true, end: false })
  expect(rideDetailMapOpen(
    { start: true, end: false },
    { ...urls, phone: true, press: { slot: 'end', open: true } },
  )).toEqual({ start: false, end: true })
  expect(rideDetailMapOpen(
    { start: false, end: true },
    { ...urls, phone: true, press: { slot: 'end', open: false } },
  )).toEqual(closed)
})

it('closes both maps when another Ride opens', () => {
  expect(rideDetailMapOpen(bothOpen, {
    rideChanged: true,
    startUrl,
    endUrl,
    phone: false,
    press: null,
  })).toEqual(closed)
  // A press in the same change does not reopen a map on the Ride that just closed.
  expect(rideDetailMapOpen(bothOpen, {
    rideChanged: true,
    startUrl,
    endUrl,
    phone: false,
    press: { slot: 'start', open: true },
  })).toEqual(closed)
})
