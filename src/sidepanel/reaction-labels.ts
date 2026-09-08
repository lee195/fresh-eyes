// Plain-English labels for the closed vocabularies.
//
// The enums exist so runs stay comparable; these exist so a developer never has
// to read `opens_new_tab_to_search` and translate it in their head.
import type { Cause, Feeling, UserAction } from '@/shared/types'

export const ACTION_LABELS: Record<UserAction, string> = {
  reads_on: 'keeps reading',
  hesitates: 'hesitates',
  rereads: 'reads it again',
  scrolls_past: 'scrolls past it',
  clicks_wrong_thing: 'clicks the wrong thing',
  opens_new_tab_to_search: 'opens a tab to search',
  switches_tab: 'switches tab',
  closes_page: 'closes the page',
  asks_someone_for_help: 'asks someone for help',
  abandons_task: 'gives up',
  completes_step: 'gets through this step',
}

export const ACTION_ICONS: Record<UserAction, string> = {
  reads_on: '→',
  hesitates: '…',
  rereads: '↺',
  scrolls_past: '↓',
  clicks_wrong_thing: '✗',
  opens_new_tab_to_search: '⧉',
  switches_tab: '⇥',
  closes_page: '✕',
  asks_someone_for_help: '?',
  abandons_task: '⊘',
  completes_step: '✓',
}

export const FEELING_LABELS: Record<Feeling, string> = {
  confused: 'confused',
  annoyed: 'annoyed',
  anxious: 'uneasy',
  bored: 'bored',
  reassured: 'reassured',
  delighted: 'pleased',
}

export const CAUSE_LABELS: Record<Cause, string> = {
  jargon: 'words they do not know',
  unclear_next_step: 'no obvious next step',
  trust: 'trust',
  cost_uncertainty: 'unclear cost',
  wall_of_text: 'too much text',
  slow: 'waiting',
  error: 'something broke',
  form_friction: 'the form',
  lost_in_nav: 'lost',
  visual_noise: 'too much going on',
  cant_find_it: 'could not find it',
}

export const OUTCOME_LABELS = {
  completed: 'Got through it',
  completed_with_friction: 'Got through it, with difficulty',
  abandoned: 'Gave up',
} as const
