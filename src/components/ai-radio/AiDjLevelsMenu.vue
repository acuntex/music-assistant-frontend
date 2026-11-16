<!--
  Voice and ducking levels of a queue's AI DJ, as a popout of the queue menu.
  Each control writes its own command — ai_radio/queue_dj/set_voice_level or
  ai_radio/queue_dj/set_duck — so one never overwrites the other's stored value,
  and takes the map the server answers with as the new state.
-->
<template>
  <div class="flex flex-col gap-3 p-2" @pointerdown.stop @click.stop>
    <div class="flex flex-col gap-1.5">
      <div class="flex items-center gap-3">
        <span class="flex-1 text-sm">{{
          $t("providers.ai_radio.queue_dj.voice_level")
        }}</span>
        <span
          data-testid="ai-dj-voice-value"
          class="min-w-[5ch] text-right text-sm tabular-nums"
        >
          {{ levelDbText(voiceDraft) }}
        </span>
      </div>
      <div data-testid="ai-dj-voice-slider">
        <Slider
          :model-value="[voiceDraft]"
          :min="VOICE_LEVEL_DB_MIN"
          :max="VOICE_LEVEL_DB_MAX"
          :step="LEVEL_DB_STEP"
          :thumb-label="$t('providers.ai_radio.queue_dj.voice_level')"
          @update:model-value="onVoiceInput"
          @value-commit="onVoiceCommit"
        />
      </div>
      <p class="text-xs text-muted-foreground">
        {{ $t("providers.ai_radio.queue_dj.voice_level_help") }}
      </p>
    </div>

    <DropdownMenuSeparator />

    <div class="flex flex-col gap-1.5">
      <div class="flex items-center gap-3">
        <span class="flex-1 text-sm">{{
          $t("providers.ai_radio.queue_dj.ducking")
        }}</span>
        <span
          data-testid="ai-dj-duck-value"
          class="min-w-[5ch] text-right text-sm tabular-nums"
        >
          {{ duckLabel }}
        </span>
      </div>
      <div class="flex items-center gap-2">
        <Switch
          id="ai-dj-duck-standard"
          data-testid="ai-dj-duck-standard"
          :model-value="duckStandard"
          @update:model-value="onDuckStandardChange"
        />
        <Label for="ai-dj-duck-standard" class="text-xs">
          {{ $t("providers.ai_radio.queue_dj.ducking_standard_use") }}
        </Label>
      </div>
      <div data-testid="ai-dj-duck-slider">
        <Slider
          :model-value="[duckDraft]"
          :min="DUCK_LEVEL_DB_MIN"
          :max="DUCK_LEVEL_DB_MAX"
          :step="LEVEL_DB_STEP"
          :disabled="duckStandard"
          :thumb-label="$t('providers.ai_radio.queue_dj.ducking')"
          @update:model-value="onDuckInput"
          @value-commit="onDuckCommit"
        />
      </div>
      <p class="text-xs text-muted-foreground">
        {{
          $t(
            duckStandard
              ? "providers.ai_radio.queue_dj.ducking_standard_help"
              : "providers.ai_radio.queue_dj.ducking_help",
          )
        }}
      </p>
    </div>

    <template v-if="hint">
      <DropdownMenuSeparator />
      <div
        data-testid="ai-dj-bus-hint"
        class="flex flex-col gap-1 text-xs text-muted-foreground"
      >
        <span>{{ hint }}</span>
        <a
          v-if="hintLink"
          data-testid="ai-dj-bus-hint-link"
          :href="hintLink"
          class="underline underline-offset-2"
          @click.prevent.stop="openHintLink"
        >
          {{ $t("providers.ai_radio.queue_dj.bus_off_link") }}
        </a>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useHosts } from "@/composables/ai-radio/useHosts";
import {
  clampDuckLevelDb,
  clampVoiceLevelDb,
  CUSTOM_DUCK_FALLBACK_DB,
  DUCK_LEVEL_DB_MAX,
  DUCK_LEVEL_DB_MIN,
  errorMessage,
  LEVEL_DB_STEP,
  levelDbText,
  VOICE_LEVEL_DB_MAX,
  VOICE_LEVEL_DB_MIN,
} from "@/helpers/ai_radio";
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { toast } from "vue-sonner";
import { $t } from "@/plugins/i18n";

const props = defineProps<{
  /** The queue whose DJ levels this edits. */
  queueId: string;
}>();

const router = useRouter();
const { queueDjStatus, setQueueDjVoiceLevel, setQueueDjDuck } = useHosts();

const entry = computed(() => queueDjStatus.value[props.queueId]);
const voiceLevel = computed(() =>
  clampVoiceLevelDb(entry.value?.voice_level_db),
);
// null keeps the server's own default depth, which is not the same as 0 (no ducking)
const duckLevel = computed<number | null>(() => {
  const value = entry.value?.duck_db;
  return value === null || value === undefined ? null : clampDuckLevelDb(value);
});
const duckStandard = computed(() => duckLevel.value === null);
const hint = computed(() =>
  entry.value?.bus_enabled === false ? entry.value.hint || "" : "",
);
const hintLink = computed(() => entry.value?.hint_link || "");

// The sliders keep their own value while a drag runs, so the readout follows
// the thumb instead of waiting for the write to land.
const voiceDraft = ref(voiceLevel.value);
// while the queue uses the server default, the thumb already sits where turning
// that default off would start: the depth the server mixes at, not 0 dB
const duckDraft = ref(duckLevel.value ?? CUSTOM_DUCK_FALLBACK_DB);

watch(voiceLevel, (value) => (voiceDraft.value = value));
watch(duckLevel, (value) => {
  if (value !== null) duckDraft.value = value;
});

// A standard depth has no number to show, so the readout names the choice.
const duckLabel = computed(() =>
  duckStandard.value
    ? $t("providers.ai_radio.queue_dj.ducking_standard")
    : levelDbText(duckDraft.value),
);

function onVoiceInput(value: number[] | undefined) {
  if (!value) return;
  voiceDraft.value = clampVoiceLevelDb(value[0]);
}

function onVoiceCommit(value: number[] | undefined) {
  if (!value) return;
  voiceDraft.value = clampVoiceLevelDb(value[0]);
  void commitVoiceLevel(voiceDraft.value);
}

function onDuckInput(value: number[] | undefined) {
  if (!value || duckStandard.value) return;
  duckDraft.value = clampDuckLevelDb(value[0]);
}

function onDuckCommit(value: number[] | undefined) {
  if (!value || duckStandard.value) return;
  duckDraft.value = clampDuckLevelDb(value[0]);
  void commitDuck(duckDraft.value);
}

// "Standard" is a real choice of its own: it clears the depth to null rather
// than to 0, which would mean no ducking at all. Turning it off starts at the
// depth the queue already mixes at, so the music does not jump back to full level.
function onDuckStandardChange(standard: boolean | "indeterminate") {
  void commitDuck(standard === true ? null : duckDraft.value);
}

/** Writes the voice level on its own and reports a failed write. */
async function commitVoiceLevel(voiceLevelDb: number): Promise<void> {
  try {
    await setQueueDjVoiceLevel(props.queueId, voiceLevelDb);
  } catch (error) {
    toast.error(errorMessage(error));
  }
}

/** Writes the ducking depth on its own, null being "use the server default". */
async function commitDuck(duckDb: number | null): Promise<void> {
  try {
    await setQueueDjDuck(props.queueId, duckDb);
  } catch (error) {
    toast.error(errorMessage(error));
  }
}

function openHintLink() {
  if (hintLink.value) void router.push(hintLink.value);
}
</script>
