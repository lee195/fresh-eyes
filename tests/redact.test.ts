import { describe, expect, it } from 'vitest'
import { passesLuhn, redactSensitive } from '@/shared/redact'

describe('redactSensitive', () => {
  it('removes email addresses but keeps the surrounding sentence', () => {
    expect(redactSensitive('Signed in as jisu.lee@seibert.group — not you?')).toBe(
      'Signed in as [email] — not you?',
    )
  })

  it('removes card numbers that pass the checksum', () => {
    // A well-known test number; the checksum is what identifies it as a card.
    expect(redactSensitive('Paying with 4242 4242 4242 4242')).toBe('Paying with [card number]')
  })

  it('leaves long reference numbers alone', () => {
    // Order and invoice numbers are exactly as long as card numbers and are
    // often the text the analysis most needs. Only the checksum separates them.
    const text = 'Order 1234567890123456 confirmed'
    expect(passesLuhn('1234567890123456')).toBe(false)
    expect(redactSensitive(text)).toBe(text)
  })

  it('removes credentials by their recognisable prefixes', () => {
    const samples = [
      ['Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K', '[token]'],
      ['key=sk-abcdefghijklmnopqrstuvwx', '[api key]'],
      ['token ghp_abcdefghijklmnopqrstuvwxyz0123', '[api key]'],
      ['AKIAIOSFODNN7EXAMPLE', '[api key]'],
    ] as const

    for (const [input, marker] of samples) {
      expect(redactSensitive(input)).toContain(marker)
    }
  })

  it('does not disturb ordinary page copy', () => {
    const text = 'Free for 30 days. No card needed. Cancel any time.'
    expect(redactSensitive(text)).toBe(text)
  })
})
