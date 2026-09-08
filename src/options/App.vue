<script setup lang="ts">
// Two things live here, and both are gates rather than preferences: which
// origins may ever be analysed, and where the analysis is sent.
import { computed, onMounted, ref, watch } from 'vue'
import { api } from '@/shared/browser'
import { BACKENDS, DEFAULT_BACKEND_ID, getBackend } from '@/shared/backends'
import {
  DEFAULT_ALLOWLIST,
  getSettings,
  maskKey,
  saveSettings,
  type BackendConfig,
  type Settings,
} from '@/shared/settings'

const settings = ref<Settings | null>(null)
const newPattern = ref('')
const saved = ref(false)

/** Held separately so a stored key is never rendered into an input. */
const keyDraft = ref('')
const keyTouched = ref(false)

const testState = ref<{ status: 'idle' | 'testing' | 'ok' | 'fail'; detail?: string }>({
  status: 'idle',
})

const activeId = computed(() => settings.value?.activeBackendId ?? DEFAULT_BACKEND_ID)
const activeBackend = computed(() => getBackend(activeId.value))
const config = computed<BackendConfig | null>(() => {
  if (!settings.value) return null
  return settings.value.backends[activeId.value] ?? activeBackend.value?.defaults ?? null
})
const storedKeyMask = computed(() => maskKey(config.value?.apiKey ?? ''))

onMounted(async () => {
  settings.value = await getSettings()
  if (!settings.value.activeBackendId) await selectBackend(DEFAULT_BACKEND_ID)
})

watch(activeId, () => {
  keyDraft.value = ''
  keyTouched.value = false
  testState.value = { status: 'idle' }
})

async function persist(patch: Partial<Settings>) {
  settings.value = await saveSettings(patch)
  saved.value = true
  setTimeout(() => (saved.value = false), 1500)
}

async function selectBackend(id: string) {
  const backend = getBackend(id)
  if (!backend || !settings.value) return
  const existing = settings.value.backends[id]
  await persist({
    activeBackendId: id,
    backends: { ...settings.value.backends, [id]: existing ?? { ...backend.defaults } },
  })
}

async function updateConfig(patch: Partial<BackendConfig>) {
  if (!settings.value || !config.value) return
  await persist({
    backends: { ...settings.value.backends, [activeId.value]: { ...config.value, ...patch } },
  })
  testState.value = { status: 'idle' }
}

function commitKey() {
  if (!keyTouched.value) return
  updateConfig({ apiKey: keyDraft.value })
  keyDraft.value = ''
  keyTouched.value = false
}

function clearKey() {
  keyDraft.value = ''
  keyTouched.value = false
  updateConfig({ apiKey: '' })
}

/**
 * Asks for access to the endpoint's origin and then actually calls it.
 *
 * The extension ships with no host access, so without this the first real run
 * would fail with a bare network error that looks like the endpoint is down.
 */
async function testConnection() {
  if (!config.value) return
  testState.value = { status: 'testing' }

  let origin: string
  try {
    origin = new URL(config.value.baseUrl).origin
  } catch {
    testState.value = { status: 'fail', detail: 'That is not a valid URL.' }
    return
  }

  const granted = await api.permissions.request({ origins: [`${origin}/*`] })
  if (!granted) {
    testState.value = { status: 'fail', detail: `Access to ${origin} was declined.` }
    return
  }

  const isAnthropic = activeId.value === 'anthropic'
  const url = isAnthropic
    ? `${config.value.baseUrl.replace(/\/+$/, '')}/v1/models`
    : `${config.value.baseUrl.replace(/\/+$/, '')}/models`

  const headers: Record<string, string> = {}
  if (isAnthropic) {
    headers['x-api-key'] = config.value.apiKey
    headers['anthropic-version'] = '2023-06-01'
    headers['anthropic-dangerous-direct-browser-access'] = 'true'
  } else if (config.value.apiKey) {
    headers.Authorization = `Bearer ${config.value.apiKey}`
  }

  try {
    const res = await fetch(url, { headers })
    testState.value = res.ok
      ? { status: 'ok', detail: `${origin} answered.` }
      : { status: 'fail', detail: `${origin} returned ${res.status}.` }
  } catch (err) {
    testState.value = { status: 'fail', detail: `Could not reach ${origin}. ${String(err)}` }
  }
}

function addPattern() {
  const value = newPattern.value.trim()
  if (!value || !settings.value || settings.value.allowlist.includes(value)) return
  persist({ allowlist: [...settings.value.allowlist, value] })
  newPattern.value = ''
}

function removePattern(pattern: string) {
  if (!settings.value) return
  persist({ allowlist: settings.value.allowlist.filter((p) => p !== pattern) })
}
</script>

<template>
  <main v-if="settings && config" class="stack">
    <header>
      <h1>Fresh Eyes</h1>
      <p class="dim">
        Analysis sends the text of your page and a screenshot of it to the model
        endpoint you configure below. These settings decide which pages that may
        ever happen to, and where it goes.
      </p>
    </header>

    <section class="card stack">
      <h2>Model endpoint</h2>

      <label class="field">
        <span>Provider</span>
        <select :value="activeId" @change="selectBackend(($event.target as HTMLSelectElement).value)">
          <option v-for="b in BACKENDS" :key="b.id" :value="b.id">{{ b.label }}</option>
        </select>
      </label>

      <label class="field">
        <span>Base URL</span>
        <input
          type="url"
          :value="config.baseUrl"
          @change="updateConfig({ baseUrl: ($event.target as HTMLInputElement).value })"
        />
      </label>
      <p class="dim hint">{{ activeBackend?.hint }}</p>

      <label class="field">
        <span>Model</span>
        <input
          type="text"
          :value="config.model"
          @change="updateConfig({ model: ($event.target as HTMLInputElement).value })"
        />
      </label>

      <label class="field">
        <span>API key</span>
        <input
          v-model="keyDraft"
          type="password"
          autocomplete="off"
          :placeholder="storedKeyMask || 'Leave empty for a local server'"
          @input="keyTouched = true"
          @change="commitKey"
        />
      </label>
      <p class="dim hint">
        Stored on this machine only — never synced to your browser account, never
        shown again once saved, and never included in an exported session.
        <button v-if="config.apiKey" class="linkish" @click="clearKey">Remove the stored key</button>
      </p>

      <label class="check">
        <input
          type="checkbox"
          :checked="config.vision"
          @change="updateConfig({ vision: ($event.target as HTMLInputElement).checked })"
        />
        <span>
          Send a screenshot
          <em class="dim">— needed for reactions about layout, crowding and what stands out.</em>
        </span>
      </label>

      <label class="check">
        <input
          type="checkbox"
          :checked="config.structuredOutput"
          @change="updateConfig({ structuredOutput: ($event.target as HTMLInputElement).checked })"
        />
        <span>
          Request a strict JSON schema
          <em class="dim">— turn off if the server rejects response_format.</em>
        </span>
      </label>

      <div class="row">
        <button @click="testConnection" :disabled="testState.status === 'testing'">
          {{ testState.status === 'testing' ? 'Testing…' : 'Grant access and test' }}
        </button>
        <span v-if="testState.detail" :class="testState.status === 'ok' ? 'ok' : 'warn'">
          {{ testState.detail }}
        </span>
      </div>
    </section>

    <section class="card stack">
      <h2>Origins that may be analysed</h2>
      <p class="dim">
        Ports are ignored. A leading <code>*.</code> matches subdomains only —
        <code>http://*.localhost</code> covers <code>http://app.localhost</code>
        and never <code>http://localhost.example.com</code>.
      </p>

      <ul class="patterns">
        <li v-for="pattern in settings.allowlist" :key="pattern">
          <code>{{ pattern }}</code>
          <button @click="removePattern(pattern)">Remove</button>
        </li>
      </ul>

      <div class="row">
        <input
          v-model="newPattern"
          type="url"
          placeholder="http://staging.internal"
          @keyup.enter="addPattern"
        />
        <button @click="addPattern">Add</button>
      </div>

      <div class="row">
        <button @click="persist({ allowlist: [...DEFAULT_ALLOWLIST] })">
          Reset to localhost only
        </button>
        <button
          v-if="settings.confirmedOrigins.length"
          @click="persist({ confirmedOrigins: [] })"
        >
          Forget {{ settings.confirmedOrigins.length }} confirmed origin(s)
        </button>
      </div>
    </section>

    <p v-if="saved" class="dim">Saved.</p>
  </main>
</template>

<style scoped>
main {
  max-width: 640px;
  margin: 0 auto;
  padding: 32px 20px 80px;
}

h1 {
  font-size: 20px;
}

h2 {
  font-size: 14px;
}

header p {
  margin: 6px 0 0;
  max-width: 58ch;
}

.field {
  display: grid;
  grid-template-columns: 110px 1fr;
  align-items: center;
  gap: 10px;
}

.field > span {
  color: var(--text-dim);
}

.hint {
  margin: -6px 0 0 120px;
  font-size: 11px;
  max-width: 50ch;
}

.check {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.check input {
  margin-top: 3px;
}

.check em {
  font-style: normal;
}

.linkish {
  border: none;
  background: none;
  padding: 0;
  color: var(--accent);
  text-decoration: underline;
  font-size: 11px;
}

.patterns {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.patterns li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  background: var(--bg-sunken);
  border-radius: var(--radius);
}

.patterns code {
  flex: 1;
}

.patterns button {
  padding: 2px 8px;
  font-size: 11px;
}

.ok {
  color: #2f9e44;
}

.warn {
  color: var(--sev-4);
}
</style>
