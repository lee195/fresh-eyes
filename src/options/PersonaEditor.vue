<script setup lang="ts">
// The form for one persona.
//
// The fields are the ones the prompt actually uses, in the order they appear in
// it, and each is labelled with what it does to the run rather than with its
// name in the type. A developer writing a persona is guessing at which knob
// changes the answer; saying so is most of the work of this screen.
import { computed, ref, watch } from 'vue'
import { copyPersona, LIMITS, validatePersona, type PersonaDraft } from '@/shared/personas'
import type { Device, Patience, TechLevel } from '@/shared/types'

const props = defineProps<{ draft: PersonaDraft; isNew: boolean }>()
const emit = defineEmits<{ save: [PersonaDraft]; cancel: [] }>()

/** Edited locally and only handed back on save, so Cancel really cancels. */
const form = ref<PersonaDraft>(copyPersona(props.draft))
const showErrors = ref(false)

// Lists are edited as text: one quirk per line, words separated by commas.
// A row-by-row editor with add and remove buttons is more chrome than content
// for four short lines.
const quirkText = ref(props.draft.quirks.join('\n'))
const wordText = ref(props.draft.unknownWords.join(', '))

watch(
  () => props.draft,
  (next) => {
    form.value = copyPersona(next)
    quirkText.value = next.quirks.join('\n')
    wordText.value = next.unknownWords.join(', ')
    showErrors.value = false
  },
)

const current = computed<PersonaDraft>(() => ({
  ...form.value,
  quirks: quirkText.value.split('\n'),
  unknownWords: wordText.value.split(','),
}))

const problems = computed(() => validatePersona(current.value))
const problem = (field: string) => (showErrors.value ? problems.value[field] : undefined)

const TECH_LEVELS: { value: TechLevel; label: string }[] = [
  { value: 1, label: '1 — needs help to install an app' },
  { value: 2, label: '2 — uses what they know, avoids the rest' },
  { value: 3, label: '3 — comfortable with anything app-shaped' },
  { value: 4, label: '4 — reads settings screens on purpose' },
  { value: 5, label: '5 — builds software' },
]

const PATIENCES: { value: Patience; label: string }[] = [
  { value: 'low', label: 'Low — leaves at the first snag' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High — will work at it' },
]

const DEVICES: { value: Device; label: string }[] = [
  { value: 'desktop', label: 'Desktop' },
  { value: 'mobile', label: 'Phone — runs need a phone-sized window' },
]

function submit() {
  showErrors.value = true
  if (Object.keys(problems.value).length) return
  emit('save', current.value)
}
</script>

<template>
  <form class="stack editor" @submit.prevent="submit">
    <h3>{{ isNew ? 'New person' : `Editing ${draft.name}` }}</h3>

    <label class="field">
      <span>Name</span>
      <input v-model="form.name" type="text" :maxlength="LIMITS.name" placeholder="Margaret, 68" />
    </label>
    <p v-if="problem('name')" class="bad hint">{{ problem('name') }}</p>

    <label class="field">
      <span>Who they are</span>
      <textarea
        v-model="form.context"
        rows="3"
        :maxlength="LIMITS.context"
        placeholder="Retired teacher. Uses an iPad in the kitchen and her bank app. Reads every word before touching anything."
      />
    </label>
    <p class="dim hint">
      A sentence or two of life, not a job title. This is where the voice in the
      quotes comes from.
    </p>
    <p v-if="problem('context')" class="bad hint">{{ problem('context') }}</p>

    <label class="field">
      <span>Technology</span>
      <select v-model.number="form.techLevel">
        <option v-for="level in TECH_LEVELS" :key="level.value" :value="level.value">
          {{ level.label }}
        </option>
      </select>
    </label>

    <label class="field">
      <span>Patience</span>
      <select v-model="form.patience">
        <option v-for="p in PATIENCES" :key="p.value" :value="p.value">{{ p.label }}</option>
      </select>
    </label>

    <label class="field">
      <span>On</span>
      <select v-model="form.device">
        <option v-for="d in DEVICES" :key="d.value" :value="d.value">{{ d.label }}</option>
      </select>
    </label>

    <label class="field">
      <span>Why they came</span>
      <textarea
        v-model="form.motivation"
        rows="2"
        :maxlength="LIMITS.motivation"
        placeholder="Her son sent her the link and said it would help."
      />
    </label>
    <p class="dim hint">Motivation decides how much friction they will absorb before leaving.</p>
    <p v-if="problem('motivation')" class="bad hint">{{ problem('motivation') }}</p>

    <label class="field">
      <span>How they behave</span>
      <textarea
        v-model="quirkText"
        rows="4"
        placeholder="Reads instructions in full and believes them literally&#10;Will not click something she cannot predict the outcome of"
      />
    </label>
    <p class="dim hint">
      One rule per line, up to {{ LIMITS.quirks }}. Concrete beats characterful —
      “won’t type card details before seeing a price” changes a run; “is cautious”
      does not.
    </p>
    <p v-if="problem('quirks')" class="bad hint">{{ problem('quirks') }}</p>

    <label class="field">
      <span>Words they do not know</span>
      <textarea
        v-model="wordText"
        rows="2"
        placeholder="dashboard, workspace, sync, provision, onboarding"
      />
    </label>
    <p class="dim hint">
      Comma separated. The highest-signal field there is: it is what turns your
      copy into the thing that stops them.
    </p>

    <div class="row">
      <button class="primary" type="submit">{{ isNew ? 'Add this person' : 'Save changes' }}</button>
      <button type="button" @click="emit('cancel')">Cancel</button>
    </div>
  </form>
</template>

<style scoped>
.editor {
  border: 1px solid var(--accent);
  border-radius: var(--radius);
  background: var(--bg-sunken);
  padding: 12px;
}

h3 {
  font-size: 13px;
}

.field {
  display: grid;
  grid-template-columns: 140px 1fr;
  align-items: start;
  gap: 10px;
}

.field > span {
  color: var(--text-dim);
  padding-top: 7px;
}

textarea {
  resize: vertical;
  line-height: 1.45;
}

.hint {
  margin: -6px 0 0 150px;
  font-size: 11px;
  max-width: 52ch;
}

.bad {
  color: var(--sev-5);
}
</style>
