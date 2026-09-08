import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, isOriginAllowed, originMatches } from '@/shared/settings'

describe('originMatches', () => {
  it('ignores the port, because dev servers change theirs constantly', () => {
    expect(originMatches('http://localhost:5173', 'http://localhost')).toBe(true)
    expect(originMatches('http://localhost:3000', 'http://localhost')).toBe(true)
  })

  it('requires the protocol to match', () => {
    expect(originMatches('https://localhost:5173', 'http://localhost')).toBe(false)
  })

  it('matches subdomains under a *. pattern', () => {
    expect(originMatches('http://app.localhost:8080', 'http://*.localhost')).toBe(true)
  })

  it('does not let a lookalike domain slip through the *. pattern', () => {
    // The case the wildcard exists to get right: a suffix match on the string
    // "localhost" alone would accept this.
    expect(originMatches('http://localhost.example.com', 'http://*.localhost')).toBe(false)
    expect(originMatches('http://evil-localhost.com', 'http://*.localhost')).toBe(false)
  })

  it('does not treat the bare domain as its own subdomain', () => {
    expect(originMatches('http://localhost', 'http://*.localhost')).toBe(false)
  })

  it('returns false for unparseable input rather than throwing', () => {
    expect(originMatches('not a url', 'http://localhost')).toBe(false)
  })
})

describe('isOriginAllowed', () => {
  it('allows localhost out of the box and nothing else', () => {
    expect(isOriginAllowed('http://localhost:5173', DEFAULT_SETTINGS)).toBe(true)
    expect(isOriginAllowed('https://acme.com', DEFAULT_SETTINGS)).toBe(false)
  })

  it('honours an origin the developer confirmed by hand', () => {
    const settings = { ...DEFAULT_SETTINGS, confirmedOrigins: ['https://staging.acme.com'] }
    expect(isOriginAllowed('https://staging.acme.com', settings)).toBe(true)
    expect(isOriginAllowed('https://acme.com', settings)).toBe(false)
  })
})
