// The four shipped personas.
//
// They are chosen to span the axes that actually change a verdict rather than
// to be demographically representative: how much vocabulary the person has,
// how much friction their motivation will absorb, whether they are sitting down
// or standing on a train, and what makes them close a tab. A team should edit
// these into their own users; these are a starting point, not a claim.
import type { Persona } from '@/shared/types'

export const DEFAULT_PERSONAS: Persona[] = [
  {
    id: 'margaret',
    name: 'Margaret, 68',
    context:
      'Retired teacher. Uses an iPad in the kitchen, an email account her son set up, and her bank app. Reads every word on a page before touching anything.',
    techLevel: 1,
    patience: 'medium',
    device: 'desktop',
    motivation: 'Her son sent her the link and said it would help.',
    quirks: [
      'Reads instructions in full and believes them literally',
      'Assumes any mistake she makes is her own fault',
      'Will not click something she cannot predict the outcome of',
      'Looks for a phone number when stuck',
    ],
    unknownWords: [
      'dashboard',
      'workspace',
      'instance',
      'sync',
      'provision',
      'API',
      'integration',
      'onboarding',
      'tenant',
      'configure',
    ],
  },
  {
    id: 'dani',
    name: 'Dani, 26',
    context:
      'Works shifts in a warehouse. Phone only, one hand, usually on the bus with patchy signal. Fluent with apps, impatient with anything that behaves unlike one.',
    techLevel: 3,
    patience: 'low',
    device: 'mobile',
    motivation: 'Saw it in an ad, mildly curious, has about ninety seconds.',
    quirks: [
      'Never reads a paragraph longer than two lines',
      'Taps the biggest thing on screen and expects it to work',
      'Leaves the moment a form asks for a third field',
      'Will not switch to a laptop to finish something',
    ],
    unknownWords: ['self-hosted', 'SSO', 'webhook', 'CLI', 'repository', 'deploy', 'environment'],
  },
  {
    id: 'ruth',
    name: 'Ruth, 44',
    context:
      'Runs a two-person florist. Buying software with her own money, on a laptop, late in the evening after closing. Needs this to work and is prepared to concentrate.',
    techLevel: 2,
    patience: 'high',
    device: 'desktop',
    motivation: 'Her current spreadsheet is failing her and she has decided to fix it tonight.',
    quirks: [
      'Wants the total price before anything else, including any per-user maths',
      'Will not enter card details during a free trial',
      'Reads the cancellation terms before the feature list',
      'Forgives ugly, does not forgive unclear',
    ],
    unknownWords: ['seat', 'tier', 'usage-based', 'overage', 'provisioning', 'SLA', 'add-on'],
  },
  {
    id: 'tomas',
    name: 'Tomás, 35',
    context:
      'Office manager. Comfortable with software, deeply unwilling to hand over data. Has been phished once at a previous job and has not forgotten it.',
    techLevel: 4,
    patience: 'medium',
    motivation: 'Evaluating this for his team; he is the one who will be blamed if it goes wrong.',
    device: 'desktop',
    quirks: [
      'Checks what a permission request actually grants before accepting',
      'Distrusts a page that asks for more than it needs',
      'Looks for who the company is and where they are based',
      'Abandons rather than guess when a consequence is unclear',
    ],
    unknownWords: ['data residency', 'sub-processor', 'scopes', 'retention window'],
  },
]

export function personaById(id: string): Persona | undefined {
  return DEFAULT_PERSONAS.find((p) => p.id === id)
}
