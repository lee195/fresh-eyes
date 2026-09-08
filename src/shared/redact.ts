// Redaction applied to every piece of page text before it leaves the browser.
//
// A dev testing their own signup form types real things into it: their own
// email, a test card, a pasted token. Form control *values* are never captured
// at all, but the same data turns up in rendered text too — a confirmation
// screen, an account menu, a debug panel left open. This is the second net.
//
// Replacements name the kind of thing removed rather than deleting it, because
// "we replaced your email with [email]" is still useful context for the
// analysis, while the address itself is not.

const EMAIL = /\b[\w.%+-]+@[\w.-]+\.[a-z]{2,}\b/gi

/** 13–19 digits with optional spaces or dashes — filtered by Luhn below. */
const CARD_SHAPED = /\b(?:\d[ -]?){12,18}\d\b/g

/** Long opaque strings, and the well-known credential prefixes. */
const CREDENTIALS: [RegExp, string][] = [
  [/\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}\b/g, '[token]'],
  [/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/g, '[api key]'],
  [/\bghp_[A-Za-z0-9]{20,}\b/g, '[api key]'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, '[api key]'],
  [/\bpat-(?:na|eu)\d-[A-Za-z0-9-]{16,}\b/g, '[api key]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[api key]'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, '[api key]'],
  [/-----BEGIN[A-Z ]*PRIVATE KEY-----/g, '[private key]'],
]

/**
 * The Luhn checksum, used to tell a card number from an order number.
 *
 * Without it, every long reference number on an order page reads as a card and
 * the analysis loses the text it most needs to reason about.
 */
export function passesLuhn(digits: string): boolean {
  let sum = 0
  let double = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48
    if (d < 0 || d > 9) return false
    if (double) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
    double = !double
  }
  return sum % 10 === 0
}

export function redactSensitive(text: string): string {
  if (!text) return text

  let out = text.replace(EMAIL, '[email]')

  for (const [pattern, replacement] of CREDENTIALS) {
    out = out.replace(pattern, replacement)
  }

  out = out.replace(CARD_SHAPED, (match) => {
    const digits = match.replace(/[ -]/g, '')
    if (digits.length < 13 || digits.length > 19) return match
    return passesLuhn(digits) ? '[card number]' : match
  })

  return out
}
