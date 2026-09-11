<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { api } from '@/shared/browser'
import { sendToBackground, type BackgroundEvent, type PanelContext } from '@/shared/messages'
import { matchPatternFor, SETTINGS_KEY } from '@/shared/settings'
import { DEFAULT_PERSONAS } from '@/shared/personas/defaults'
import { TERMINAL_ACTIONS, type Reaction, type Session } from '@/shared/types'
import {
  ACTION_ICONS,
  ACTION_LABELS,
  CAUSE_LABELS,
  FEELING_LABELS,
  OUTCOME_LABELS,
} from './reaction-labels'

const context = ref<PanelContext | null>(null)
const session = ref<Session | null>(null)
const personaId = ref(DEFAULT_PERSONAS[0]!.id)
const goal = ref('Sign up for an account')
const busy = ref(false)
const stage = ref<string | null>(null)
const error = ref<string | null>(null)
const selected = ref<string | null>(null)
const causeFilter = ref<string | null>(null)
const showDiscarded = ref(false)

const persona = computed(() => DEFAULT_PERSONAS.find((p) => p.id === personaId.value))
const analysis = computed(() => session.value?.analysis ?? null)

/** The seq after which nothing was ever seen. */
const abandonedAt = computed(() => analysis.value?.verdict.abandonedAtSeq ?? null)

const visibleReactions = computed(() => {
  const all = analysis.value?.reactions ?? []
  if (!causeFilter.value) return all
  return all.filter((r) => r.cause === causeFilter.value)
})

const causes = computed(() => {
  const counts = new Map<string, number>()
  for (const r of analysis.value?.reactions ?? []) {
    counts.set(r.cause, (counts.get(r.cause) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])
})

/** True once the run has ended for this person — everything after is unseen. */
function isUnseen(reaction: Reaction): boolean {
  return abandonedAt.value !== null && reaction.seq > abandonedAt.value
}

function isTerminal(reaction: Reaction): boolean {
  return TERMINAL_ACTIONS.includes(reaction.action)
}

async function refresh() {
  // activeTab is granted when the toolbar button is pressed and lost again on
  // navigation, so a refresh can come back with no URL for the very tab we could
  // read a moment ago. Hand the last address back rather than let the panel fall
  // into "can't read this tab" with no way out; the background still re-checks it
  // against the current allowlist, so adding the origin in Settings still lands.
  const known = context.value
  const lastKnown =
    known?.tabId != null && known.origin ? { tabId: known.tabId, origin: known.origin } : undefined

  const res = await sendToBackground({ type: 'GET_CONTEXT', lastKnown })
  if (res.type === 'CONTEXT') context.value = res.context
}

async function run() {
  busy.value = true
  error.value = null
  session.value = null
  selected.value = null
  stage.value = 'Reading the page…'

  const res = await sendToBackground({ type: 'RUN', personaId: personaId.value, goal: goal.value })
  busy.value = false
  stage.value = null

  if (res.type === 'SESSION') session.value = res.session
  else if (res.type === 'ERROR') error.value = res.message
}

const needsPermissionFor = computed(() => {
  const match = error.value?.match(/NEEDS_PERMISSION:(\S+)/)
  return match?.[1] ?? null
})

/**
 * Asks for a lasting permission for one origin.
 *
 * Called straight from the panel rather than through the service worker:
 * Chrome only honours permissions.request() inside a user gesture, and a
 * gesture does not survive a round trip through runtime.sendMessage.
 */
async function grantOrigin(origin: string): Promise<boolean> {
  const match = matchPatternFor(origin)
  if (!match) return false
  try {
    return await api.permissions.request({ origins: [match] })
  } catch {
    return false
  }
}

async function grantEndpointAccess() {
  const origin = needsPermissionFor.value
  if (!origin) return
  if (await grantOrigin(origin)) {
    error.value = null
    run()
  }
}

/**
 * Trades the one-shot activeTab grant for a lasting one on this site, so the
 * address stays readable and a run still works after the page reloads.
 */
async function grantSiteAccess() {
  const origin = context.value?.origin
  if (!origin) return
  if (await grantOrigin(origin)) await refresh()
}

function select(reaction: Reaction) {
  selected.value = selected.value === reaction.anchorId ? null : reaction.anchorId
  sendToBackground({ type: 'FOCUS_ANCHOR', anchorId: selected.value })
}

function openOptions() {
  api.runtime.openOptionsPage()
}

function onBackgroundEvent(message: unknown) {
  const event = message as BackgroundEvent
  if (event?.type === 'PROGRESS') {
    stage.value =
      event.stage === 'capturing'
        ? 'Reading the page…'
        : event.stage === 'grounding'
          ? 'Checking the answer against the page…'
          : (event.detail ?? 'Thinking…')
  } else if (event?.type === 'PIN_CLICKED') {
    selected.value = event.anchorId
  }
}

/**
 * Settings saved in the options page have to reach this panel on their own.
 *
 * The side panel document stays mounted across tab switches and while the
 * options page sits in another tab, so without these listeners `context` keeps
 * whatever it was built with when the panel first opened — which is how an
 * origin added to the allowlist still reads as "not on the allowed list".
 */
function onStorageChanged(changes: Record<string, chrome.storage.StorageChange>, area: string) {
  if (area === 'local' && changes[SETTINGS_KEY]) refresh()
}

onMounted(() => {
  refresh()
  api.runtime.onMessage.addListener(onBackgroundEvent)
  api.storage.onChanged.addListener(onStorageChanged)
  api.tabs.onActivated.addListener(refresh)
})

onUnmounted(() => {
  api.runtime.onMessage.removeListener(onBackgroundEvent)
  api.storage.onChanged.removeListener(onStorageChanged)
  api.tabs.onActivated.removeListener(refresh)
  sendToBackground({ type: 'CLEAR_PINS' })
})
</script>

<template>
  <div class="panel">
    <header class="row">
      <h1>Fresh Eyes</h1>
      <button class="ghost" @click="openOptions">Settings</button>
    </header>

    <!-- Setup -->
    <section class="stack setup">
      <label class="field">
        <span>Who</span>
        <select v-model="personaId">
          <option v-for="p in DEFAULT_PERSONAS" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </label>
      <p v-if="persona" class="dim persona">{{ persona.context }}</p>

      <label class="field">
        <span>Trying to</span>
        <input v-model="goal" type="text" placeholder="find out what it costs" />
      </label>

      <button class="primary" :disabled="busy || !context?.backend" @click="run">
        {{ busy ? (stage ?? 'Working…') : 'See what they think' }}
      </button>

      <p class="dim note">
        <template v-if="!context?.backend">
          No model endpoint configured yet — open Settings.
        </template>
        <template v-else-if="!context.origin">
          Can't read this tab's address. Press the toolbar button on the page you want
          analysed, or grant Fresh Eyes lasting access to it in Settings.
        </template>
        <template v-else-if="!context.originAllowed">
          {{ context.origin }} is not on the allowed list.
          <button class="linkish" @click="openOptions">Add it</button>
        </template>
        <template v-else>
          Sends this page and a screenshot to {{ context.backend.endpointHost }}.
        </template>
      </p>

      <p v-if="context?.origin && context.originAllowed && !context.hostPermission" class="dim note">
        Access to this tab ends when it navigates.
        <button class="linkish" @click="grantSiteAccess">
          Keep access to {{ context.origin }}
        </button>
        so runs survive a reload.
      </p>
    </section>

    <section v-if="error" class="card error stack">
      <p v-if="needsPermissionFor">
        Fresh Eyes needs your permission to reach {{ needsPermissionFor }}.
      </p>
      <pre v-else>{{ error }}</pre>
      <button v-if="needsPermissionFor" @click="grantEndpointAccess">
        Grant access to {{ needsPermissionFor }}
      </button>
    </section>

    <!-- Verdict -->
    <section v-if="analysis" class="card verdict" :class="analysis.verdict.outcome">
      <h2>{{ OUTCOME_LABELS[analysis.verdict.outcome] }}</h2>
      <p class="summary">{{ analysis.verdict.summary }}</p>

      <ol v-if="analysis.verdict.topFixes.length" class="fixes">
        <li v-for="fix in analysis.verdict.topFixes" :key="fix.fix">{{ fix.fix }}</li>
      </ol>

      <p class="dim conf">
        {{ analysis.verdict.confidence }} confidence · {{ analysis.reactions.length }} reactions
        <template v-if="analysis.discarded.length">
          ·
          <button class="linkish" @click="showDiscarded = !showDiscarded">
            {{ analysis.discarded.length }} discarded as ungrounded
          </button>
        </template>
      </p>

      <ul v-if="showDiscarded" class="discarded">
        <li v-for="(d, i) in analysis.discarded" :key="i">
          <span class="dim">{{ d.why }}</span>
          <em>“{{ d.reaction.quote }}”</em>
        </li>
      </ul>
    </section>

    <!-- Cause filter -->
    <div v-if="causes.length > 1" class="chips">
      <button
        v-for="[cause, count] in causes"
        :key="cause"
        class="chip"
        :class="{ on: causeFilter === cause }"
        @click="causeFilter = causeFilter === cause ? null : cause"
      >
        {{ CAUSE_LABELS[cause as keyof typeof CAUSE_LABELS] }} {{ count }}
      </button>
    </div>

    <!-- Feed -->
    <ol v-if="analysis" class="feed">
      <template v-for="reaction in visibleReactions" :key="reaction.seq">
        <li
          v-if="abandonedAt !== null && reaction.seq === abandonedAt + 1"
          class="divider"
          aria-hidden="true"
        >
          <span>{{ persona?.name.split(',')[0] }} never got this far</span>
        </li>

        <li
          class="reaction"
          :class="[
            `sev-${reaction.severity}`,
            { unseen: isUnseen(reaction), terminal: isTerminal(reaction), on: selected === reaction.anchorId },
          ]"
          @click="select(reaction)"
        >
          <span class="marker" :title="`Severity ${reaction.severity}`">{{ reaction.seq }}</span>
          <div class="body">
            <p class="quote">“{{ reaction.quote }}”</p>
            <p class="meta">
              <span class="action">{{ ACTION_ICONS[reaction.action] }} {{ ACTION_LABELS[reaction.action] }}</span>
              <span class="dim">· {{ FEELING_LABELS[reaction.feeling] }}</span>
              <span class="dim">· {{ CAUSE_LABELS[reaction.cause] }}</span>
            </p>
            <p class="evidence dim">{{ reaction.evidence }}</p>
          </div>
        </li>
      </template>
    </ol>
  </div>
</template>

<style scoped>
.panel {
  padding: 12px;
  min-width: 300px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

header {
  justify-content: flex-start;
}

header button {
  margin-left: auto;
  padding: 3px 8px;
  font-size: 12px;
}

.setup {
  gap: 8px;
}

.field {
  display: grid;
  grid-template-columns: 62px 1fr;
  align-items: center;
  gap: 8px;
}

.field > span {
  color: var(--text-dim);
}

.persona {
  margin: -4px 0 0 70px;
  font-size: 11px;
  line-height: 1.4;
}

.note {
  margin: 0;
  font-size: 11px;
  text-align: center;
}

.error {
  border-color: var(--sev-5);
}

.error pre {
  white-space: pre-wrap;
  margin: 0;
  color: var(--sev-5);
}

/* Verdict */
.verdict h2 {
  font-size: 15px;
}

.verdict.abandoned {
  border-color: var(--sev-5);
}

.verdict.completed {
  border-color: #2f9e44;
}

.summary {
  margin: 4px 0 0;
}

.fixes {
  margin: 8px 0 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.conf {
  margin: 8px 0 0;
  font-size: 11px;
}

.linkish {
  border: none;
  background: none;
  padding: 0;
  font-size: 11px;
  color: var(--accent);
  text-decoration: underline;
}

.discarded {
  list-style: none;
  margin: 8px 0 0;
  padding: 8px;
  background: var(--bg-sunken);
  border-radius: var(--radius);
  font-size: 11px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.discarded em {
  display: block;
  font-style: normal;
}

/* Chips */
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.chip {
  padding: 2px 8px;
  font-size: 11px;
  border-radius: 999px;
}

.chip.on {
  background: var(--accent-soft);
  border-color: var(--accent);
}

/* Feed */
.feed {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.reaction {
  display: flex;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-left-width: 3px;
  border-radius: var(--radius);
  background: var(--bg-raised);
  cursor: pointer;
}

.reaction.on {
  border-color: var(--accent);
}

.reaction.sev-1 { border-left-color: var(--sev-1); }
.reaction.sev-2 { border-left-color: var(--sev-2); }
.reaction.sev-3 { border-left-color: var(--sev-3); }
.reaction.sev-4 { border-left-color: var(--sev-4); }
.reaction.sev-5 { border-left-color: var(--sev-5); }

.reaction.terminal {
  background: color-mix(in srgb, var(--sev-5) 8%, var(--bg-raised));
}

/* Everything past the point they left. Shown, because "what they never saw"
   is often the most useful thing on the screen — but visibly out of reach. */
.reaction.unseen {
  opacity: 0.45;
}

.marker {
  flex: 0 0 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--bg-sunken);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.body {
  min-width: 0;
}

.quote {
  margin: 0;
  font-size: 13px;
}

.meta {
  margin: 3px 0 0;
  font-size: 11px;
}

.action {
  font-weight: 600;
}

.evidence {
  margin: 3px 0 0;
  font-size: 10px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.divider {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 6px 0 2px;
  font-size: 11px;
  color: var(--sev-5);
}

.divider::before,
.divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--sev-5);
  opacity: 0.4;
}
</style>
