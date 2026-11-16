<!--
  The program bus as a feed into the running flow stream.

  It shows what the server mixes over the music of this player's flow session: the
  session, the format a program has to come in, the claims the bus works under and
  the programs it holds or ended. Everything here is read-only: a program is heard
  over the tracks, so there is nothing to play, seek or drag.
-->
<template>
  <section
    class="audio-processing-group program-bus"
    data-section="program-bus"
    data-testid="program-bus"
  >
    <div class="audio-processing-header">
      <span
        class="audio-processing-quality-dot"
        :class="{ 'audio-processing-quality-dot--neutral': !busLive }"
      ></span>
      <span class="audio-processing-header-title">{{
        $t("program_bus.section_header")
      }}</span>
      <span
        class="audio-processing-header-meta"
        data-testid="program-bus-status"
        >{{ statusLabel }}</span
      >
      <span class="audio-processing-header-rule" aria-hidden="true"></span>
    </div>

    <div class="audio-processing-section">
      <AudioProcessingStage :stage="stage" @navigate="emit('navigate')" />

      <p class="program-bus-note">{{ $t("program_bus.flow_only_note") }}</p>

      <p
        v-if="failed"
        class="program-bus-note program-bus-note--warning"
        data-testid="program-bus-error"
      >
        {{ $t("program_bus.unavailable") }}
      </p>

      <p
        v-if="placementPaused"
        class="program-bus-note"
        data-testid="program-bus-no-position"
      >
        {{ $t("program_bus.no_audible_position") }}
      </p>

      <div
        v-if="overlays.length"
        class="program-bus-list"
        data-testid="program-bus-overlays"
      >
        <div
          v-for="(overlay, index) in overlays"
          :key="`overlay-${index}-${overlay.label}`"
          class="program-bus-row"
          data-testid="program-bus-overlay"
        >
          <div class="program-bus-row-main">
            <span class="program-bus-row-label">{{ overlay.label }}</span>
            <span class="program-bus-row-state">{{
              stateLabel(overlay.state)
            }}</span>
            <span class="program-bus-row-time">{{ startLabel(overlay) }}</span>
          </div>
          <span
            v-if="overlay.head_seconds > 0 || overlay.late_by_seconds > 0"
            class="program-bus-row-detail"
            data-testid="program-bus-timing"
          >
            {{ timingLabel(overlay) }}
          </span>
        </div>
      </div>

      <div
        v-if="last.length"
        class="program-bus-list"
        data-testid="program-bus-last"
      >
        <div class="program-bus-list-header">
          {{ $t("program_bus.last_header") }}
          <span
            v-if="lastHidden"
            class="program-bus-list-more"
            data-testid="program-bus-last-more"
          >
            {{ $t("program_bus.last_more", { count: lastHidden }) }}
          </span>
        </div>
        <div
          v-for="(ended, index) in last"
          :key="`last-${index}-${ended.label}`"
          class="program-bus-row program-bus-row--ended"
          data-testid="program-bus-ended"
        >
          <div class="program-bus-row-main">
            <span class="program-bus-row-label">{{ ended.label }}</span>
            <span class="program-bus-row-state">{{
              stateLabel(ended.state)
            }}</span>
            <span
              v-if="ended.reason"
              class="program-bus-row-reason"
              data-testid="program-bus-reason"
            >
              {{ reasonLabel(ended.reason) }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { Radio } from "@lucide/vue";
import AudioProcessingStage from "@/components/AudioProcessingStage.vue";
import type { AudioProcessingDisplayStage } from "@/composables/useAudioProcessingDetails";
import { formatDuration } from "@/helpers/utils";
import api from "@/plugins/api";
import type {
  ProgramBusFormat,
  ProgramBusOverlay,
  ProgramBusProgramState,
  ProgramBusView,
} from "@/plugins/api/interfaces";
import { $t, i18n } from "@/plugins/i18n";

// the bus state is only polled while the details are open; a program is placed on the
// server's clock, so a few seconds of delay is all this display needs
const POLL_INTERVAL_MS = 3000;

const props = defineProps<{
  // the queue whose flow session mixes the programs
  queueId: string;
}>();

const emit = defineEmits<{
  // the panel opened the page it links to, so the details can be closed
  (e: "navigate"): void;
}>();

const view = ref<ProgramBusView>();
const failed = ref(false);
let pollTimer: ReturnType<typeof setInterval> | undefined;
// the queue whose reading is still out, so one poll never stacks on another
let pendingQueue: string | undefined;

const enabled = computed(() => view.value?.enabled ?? false);
const busLive = computed(
  () => enabled.value && view.value?.session_active === true,
);
const overlays = computed(() => view.value?.overlays ?? []);
// the ledger keeps up to 16 entries, but the popover has to stay short enough to
// keep the output paths below it in view: show the newest few, count the rest
const RECENT_PROGRAMS_VISIBLE = 3;
const lastAll = computed(() => view.value?.last ?? []);
const last = computed(() => lastAll.value.slice(0, RECENT_PROGRAMS_VISIBLE));
const lastHidden = computed(() =>
  Math.max(0, lastAll.value.length - RECENT_PROGRAMS_VISIBLE),
);
const placementPaused = computed(
  () => view.value?.no_audible_position === true,
);

// nothing has been read yet (or the read failed), so the panel claims no state at
// all instead of calling the bus off while the status is unknown
const statusLabel = computed(() => {
  if (!view.value) return "";
  return enabled.value ? $t("program_bus.on") : $t("program_bus.off");
});

const subtitleParts = computed(() => {
  if (!view.value) return [];
  if (!enabled.value) return [$t("program_bus.off_hint")];
  if (!view.value.session_active) return [$t("program_bus.no_session")];
  return [
    $t("program_bus.session_active"),
    ...formatParts(view.value.format),
    ...claimParts(),
  ];
});

const stage = computed<AudioProcessingDisplayStage>(() => ({
  key: "program-bus",
  icon: Radio,
  title: $t("program_bus.title"),
  subtitleParts: subtitleParts.value,
  atomicSubtitleParts: true,
  // the switch lives in the core streams settings, only reachable by leaving this panel
  link:
    enabled.value || !view.value
      ? undefined
      : {
          to: "/settings/editcore/streams",
          label: $t("program_bus.open_settings"),
        },
}));

function formatParts(format: ProgramBusFormat | null): string[] {
  if (!format) return [];
  return [
    `${Math.round(format.sample_rate / 100) / 10} kHz`,
    `${format.bit_depth}-bit`,
    `${format.channels} ch`,
  ];
}

function claimParts(): string[] {
  const claims = view.value?.claims;
  if (!claims) return [];
  const parts: string[] = [];
  if (claims.flow) parts.push($t("program_bus.flow_claim"));
  if (claims.boundary) parts.push($t("program_bus.boundary_claim"));
  return parts;
}

function stateLabel(state: ProgramBusProgramState): string {
  return $t(`program_bus.state_${state}`);
}

function startLabel(overlay: ProgramBusOverlay): string {
  if (overlay.start_in_seconds === null)
    return $t("program_bus.starts_in_unknown");
  if (overlay.start_in_seconds <= 0) return $t("program_bus.starts_now");
  return $t("program_bus.starts_in", {
    time: formatDuration(overlay.start_in_seconds),
  });
}

// a program that carries no head or landed on time has nothing to say about it, so the
// zero part is left out instead of being spelled as a measurement
function timingLabel(overlay: ProgramBusOverlay): string {
  const parts: string[] = [];
  if (overlay.head_seconds > 0) {
    parts.push(
      $t("program_bus.head_label", {
        seconds: overlay.head_seconds.toFixed(1),
      }),
    );
  }
  if (overlay.late_by_seconds > 0) {
    parts.push(
      $t("program_bus.late_label", {
        seconds: overlay.late_by_seconds.toFixed(1),
      }),
    );
  }
  return parts.join(" · ");
}

// a reason the server sends but this translation does not know stays readable instead of
// turning into a key name the user can not do anything with
function reasonLabel(reason: string): string {
  const key = `program_bus.reason_${reason}`;
  return i18n.global.te(key) ? $t(key) : reason;
}

// what a later failure showed stays on screen: the bus keeps mixing, only its reading
// is missing, and a row that vanishes would look like the program was dropped
async function refresh(): Promise<void> {
  const queueId = props.queueId;
  if (pendingQueue === queueId) return;
  pendingQueue = queueId;
  try {
    const reading = await api.sendCommand<ProgramBusView>(
      "streams/program_bus",
      { queue_id: queueId },
    );
    // an answer of a queue that is no longer shown says nothing about this panel
    if (queueId !== props.queueId) return;
    view.value = reading;
    failed.value = false;
  } catch {
    if (queueId === props.queueId) failed.value = true;
  } finally {
    if (pendingQueue === queueId) pendingQueue = undefined;
  }
}

// the rows belong to the queue that was read; showing them for another one would lie
watch(
  () => props.queueId,
  () => {
    view.value = undefined;
    failed.value = false;
    void refresh();
  },
);

onMounted(() => {
  void refresh();
  pollTimer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
});

onUnmounted(() => {
  if (pollTimer !== undefined) clearInterval(pollTimer);
  pollTimer = undefined;
});
</script>

<style>
.program-bus .program-bus-note {
  margin: 1px 0 0 16px;
  color: var(--muted-foreground);
  font-size: 0.7rem;
  line-height: 1.35;
}

.program-bus .program-bus-note--warning {
  color: var(--destructive);
}

.program-bus .program-bus-list {
  display: grid;
  gap: 2px;
  margin: 3px 0 0 16px;
}

.program-bus .program-bus-list-header {
  color: var(--muted-foreground);
  font-size: 0.65rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.program-bus .program-bus-list-more {
  margin-left: 4px;
  font-weight: 500;
  letter-spacing: 0;
  text-transform: none;
}

.program-bus .program-bus-row {
  display: block;
  font-size: 0.72rem;
  line-height: 1.35;
}
.program-bus .program-bus-row-main {
  display: grid;
  grid-template-columns: minmax(0, 1fr) max-content max-content;
  column-gap: 8px;
  align-items: baseline;
}

.program-bus .program-bus-row-label {
  min-width: 0;
  overflow-wrap: anywhere;
}

.program-bus .program-bus-row-state,
.program-bus .program-bus-row-time,
.program-bus .program-bus-row-reason,
.program-bus .program-bus-row-detail {
  color: var(--muted-foreground);
  white-space: nowrap;
}

.program-bus .program-bus-row-detail {
  display: block;
  font-size: 0.65rem;
}

.program-bus .program-bus-row-time {
  font-variant-numeric: tabular-nums;
}
</style>
