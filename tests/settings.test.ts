import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  isOriginAllowed,
  matchPatternFor,
  normalizePattern,
  originMatches,
} from '@/shared/settings'

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

  it('matches a pattern that was saved without a scheme', () => {
    // The regression: a host pasted from the address bar arrives scheme-less,
    // and used to be discarded by new URL() without a word to anyone.
    expect(originMatches('https://staging.acme.com', 'staging.acme.com')).toBe(true)
    expect(originMatches('http://staging.acme.com', 'staging.acme.com')).toBe(false)
  })

  it('tolerates a pattern pasted with a path, a port or a trailing dot', () => {
    expect(originMatches('https://acme.com', 'https://acme.com/dashboard')).toBe(true)
    expect(originMatches('https://acme.com', 'https://acme.com:8443')).toBe(true)
    expect(originMatches('https://acme.com', 'https://acme.com.')).toBe(true)
    expect(originMatches('https://acme.com.', 'https://acme.com')).toBe(true)
  })

  it('still refuses a pattern with no host in it', () => {
    expect(originMatches('https://acme.com', 'not a url')).toBe(false)
    expect(originMatches('https://acme.com', '')).toBe(false)
  })
})

describe('normalizePattern', () => {
  it('defaults a scheme-less host to https, because the address bar hides the scheme', () => {
    expect(normalizePattern('staging.acme.com')).toBe('https://staging.acme.com')
    expect(normalizePattern('*.acme.com')).toBe('https://*.acme.com')
  })

  it('keeps an explicit scheme', () => {
    expect(normalizePattern('http://staging.acme.com')).toBe('http://staging.acme.com')
  })

  it('drops the parts that are not compared anyway', () => {
    expect(normalizePattern('https://acme.com:8443/app?x=1#y')).toBe('https://acme.com')
    expect(normalizePattern('localhost:3000')).toBe('https://localhost')
  })

  it('folds case and the trailing root dot', () => {
    expect(normalizePattern('HTTPS://ACME.com.')).toBe('https://acme.com')
  })

  it('strips the invisible characters a paste carries', () => {
    // A zero-width space survives .trim() and leaves a pattern that looks right.
    expect(normalizePattern('https://acme.com\u200b')).toBe('https://acme.com')
    expect(normalizePattern('\ufeffacme.com ')).toBe('https://acme.com')
  })

  it('returns null for what cannot be a host, rather than a pattern that matches nothing', () => {
    expect(normalizePattern('')).toBeNull()
    expect(normalizePattern('   ')).toBeNull()
    expect(normalizePattern('not a url')).toBeNull()
  })
})

describe('matchPatternFor', () => {
  it('turns an allowlist entry into a host permission Chrome will accept', () => {
    expect(matchPatternFor('https://staging.acme.com')).toBe('https://staging.acme.com/*')
    expect(matchPatternFor('staging.acme.com')).toBe('https://staging.acme.com/*')
    expect(matchPatternFor('http://localhost:5173')).toBe('http://localhost/*')
  })

  it('keeps the subdomain wildcard, which is a valid match pattern', () => {
    expect(matchPatternFor('https://*.acme.com')).toBe('https://*.acme.com/*')
  })

  it('refuses a scheme optional_host_permissions cannot cover', () => {
    expect(matchPatternFor('file:///Users/me/app.html')).toBeNull()
    expect(matchPatternFor('not a url')).toBeNull()
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
