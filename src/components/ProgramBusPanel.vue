<!--
  The program bus as a feed into the running flow stream.

  It shows what the server mixes over the music of this player's flow session: the
  session, the format a program has to come in, the claims the bus works under and
  the programs it holds or ended. Everything here is read-only: a program is heard
  over the tracks, so there is nothing to play, seek or drag.

  The whole reading hangs inside the one stage node of this section, so the chain's
  connector line runs from the input down to the outputs without a break. The ended
  programs are counted on one line and only listed when the reader opens them: the
  popover must not grow with the bus's history.

  The bus is an experimental switch, so this section exists only while it is on: a
  reader without it sees the chain as if there were no bus, not the off state of a
  feature they never turned on. The reading has to say so first, because until it
  arrives the panel can not tell whether the bus is on.
-->
<template>
  <section
    v-if="visible"
    class="audio-processing-group program-bus"
    data-section="program-bus"
    data-testid="program-bus"
  >
    <div class="audio-processing-header">
      <span
        class="audio-processing-quality-dot audio-processing-quality-dot--neutral"
      ></span>
      <span class="audio-processing-header-title">{{
        $t("program_bus.section_header")
      }}</span>
      <span
        class="audio-processing-header-meta"
        data-testid="program-bus-status"
        >{{ $t("program_bus.on") }}</span
      >
      <span class="audio-processing-header-rule" aria-hidden="true"></span>
    </div>

    <div class="audio-processing-section">
      <AudioProcessingStage :stage="stage" @navigate="emit('navigate')">
        <template #extra>
          <p
            v-if="failed"
            class="program-bus-warning"
            data-testid="program-bus-error"
          >
            {{ $t("program_bus.unavailable") }}
          </p>

          <button
            v-if="hasPrograms"
            type="button"
            class="program-bus-details-toggle"
            data-testid="program-bus-details-toggle"
            :aria-expanded="detailsOpen"
            :aria-controls="detailsId"
            @click="detailsOpen = !detailsOpen"
          >
            {{
              detailsOpen
                ? $t("program_bus.details_hide")
                : $t("program_bus.details_show")
            }}
            <ChevronUp v-if="detailsOpen" :size="12" aria-hidden="true" />
            <ChevronDown v-else :size="12" aria-hidden="true" />
          </button>

          <div
            v-if="detailsOpen && hasPrograms"
            :id="detailsId"
            class="program-bus-details"
          >
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
                  <span class="program-bus-row-time">{{
                    startLabel(overlay)
                  }}</span>
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
              </div>
              <div
                v-for="(ended, index) in lastRows"
                :key="`last-${index}-${ended.label}`"
                class="program-bus-row program-bus-row--ended"
                data-testid="program-bus-ended"
              >
                <div class="program-bus-row-main">
                  <span class="program-bus-row-label">{{ ended.label }}</span>
                  <span class="program-bus-row-state">{{ ended.state }}</span>
                  <span
                    v-if="ended.reason"
                    class="program-bus-row-reason"
                    data-testid="program-bus-reason"
                  >
                    {{ ended.reason }}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </template>
      </AudioProcessingStage>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useId, watch } from "vue";
import { ChevronDown, ChevronUp, Radio } from "@lucide/vue";
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
// the program list is asked for, so the panel keeps one line of height whatever
// the bus has played
const detailsOpen = ref(false);
const detailsId = useId();
let pollTimer: ReturnType<typeof setInterval> | undefined;
// the queue whose reading is still out, so one poll never stacks on another
let pendingQueue: string | undefined;

// the section appears only once a reading says the bus is on; a reader without the
// switch sees the chain as if there were no bus at all
const visible = computed(() => view.value?.enabled === true);
const sessionLive = computed(() => view.value?.session_active === true);
const overlays = computed(() => view.value?.overlays ?? []);
const last = computed(() => view.value?.last ?? []);

interface EndedRow {
  label: string;
  state: string;
  reason?: string;
}

// the words of one ended program: a reason that only repeats the status word is left
// out, since "skipped skipped" says nothing the row does not already say
const lastRows = computed<EndedRow[]>(() =>
  last.value.map((ended) => {
    const state = stateLabel(ended.state);
    const reason = ended.reason ? reasonLabel(ended.reason) : undefined;
    return {
      label: ended.label,
      state,
      reason: reason === state ? undefined : reason,
    };
  }),
);
const hasPrograms = computed(
  () => overlays.value.length > 0 || last.value.length > 0,
);
const placementPaused = computed(
  () => view.value?.no_audible_position === true,
);
// a live session without anything in it would otherwise show only its subtitle;
// without a session the missing-session line already says why nothing mixes
const nothingScheduled = computed(
  () => sessionLive.value && !hasPrograms.value,
);

const subtitleParts = computed(() => {
  if (!sessionLive.value) return [$t("program_bus.no_session")];
  return [$t("program_bus.session_active")];
});

// everything the reader needs to know about the bus, told in the node's own
// subtitle rows: the format a program has to come in, the claims, the states and
// one counted line instead of a list that grows with the history
const subtitleLines = computed(() => {
  const lines: string[] = [];
  if (sessionLive.value) {
    const format = formatParts(view.value?.format ?? null);
    if (format.length) lines.push(format.join(" · "));
    const claims = claimParts();
    if (claims.length) lines.push(claims.join(" · "));
  }
  if (placementPaused.value) lines.push($t("program_bus.no_audible_position"));
  if (nothingScheduled.value) lines.push($t("program_bus.empty"));
  lines.push($t("program_bus.flow_only_note"));
  const summary = summaryLabel();
  if (summary) lines.push(summary);
  return lines;
});

const stage = computed<AudioProcessingDisplayStage>(() => ({
  key: "program-bus",
  icon: Radio,
  title: $t("program_bus.title"),
  subtitleParts: subtitleParts.value,
  subtitleLines: subtitleLines.value,
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

// what the bus holds and what became of the rest, without naming a single program
function summaryLabel(): string {
  const parts: string[] = [];
  if (overlays.value.length) {
    parts.push(
      $t("program_bus.summary_scheduled", { count: overlays.value.length }),
    );
  }
  const aired = last.value.filter((ended) => ended.state === "aired").length;
  const dropped = last.value.length - aired;
  if (aired) parts.push($t("program_bus.summary_played", { count: aired }));
  if (dropped)
    parts.push($t("program_bus.summary_dropped", { count: dropped }));
  return parts.join(" · ");
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
    detailsOpen.value = false;
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
.program-bus .program-bus-warning {
  margin: 3px 0 0;
  color: var(--destructive);
  font-size: 0.7rem;
  line-height: 1.35;
}

.program-bus .program-bus-details-toggle {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-top: 3px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--muted-foreground);
  font-family: inherit;
  font-size: 0.68rem;
  line-height: 1.35;
  cursor: pointer;
}

.program-bus .program-bus-details-toggle:hover {
  color: var(--foreground);
  text-decoration: underline;
  text-underline-offset: 4px;
}

.program-bus .program-bus-details-toggle:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 1px;
  border-radius: 2px;
}

.program-bus .program-bus-details {
  display: grid;
  gap: 3px;
  margin-top: 3px;
}

.program-bus .program-bus-list {
  display: grid;
  gap: 2px;
}

.program-bus .program-bus-list-header {
  color: var(--muted-foreground);
  font-size: 0.65rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
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
.program-bus .program-bus-row-detail {
  color: var(--muted-foreground);
  white-space: nowrap;
}

/* the reason is the last column and the only free text in a row, so it wraps
   instead of widening the popover in a language with longer words */
.program-bus .program-bus-row-reason {
  color: var(--muted-foreground);
  text-align: right;
}

.program-bus .program-bus-row-detail {
  display: block;
  font-size: 0.65rem;
}

.program-bus .program-bus-row-time {
  font-variant-numeric: tabular-nums;
}
</style>
