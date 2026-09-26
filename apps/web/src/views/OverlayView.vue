<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { getColumnLabels, getRowLabels, type LabelMode } from "@bingo/shared";
import { buildGridCells } from "../utils/grid";

interface PublicCell {
  row: number;
  col: number;
  text: string;
  checked: boolean;
}

interface PublicBoard {
  size: number;
  labelMode: string;
  columnLabels: string[] | null;
  cells: PublicCell[];
}

const route = useRoute();
const board = ref<PublicBoard | null>(null);
let eventSource: EventSource | null = null;

const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:3001";

function cellText(row: number, col: number): string {
  return board.value?.cells.find((c) => c.row === row && c.col === col)?.text ?? "";
}

function isChecked(row: number, col: number): boolean {
  return board.value?.cells.find((c) => c.row === row && c.col === col)?.checked ?? false;
}

const columnLabelsForGrid = computed(() => {
  if (!board.value) {
    return [];
  }
  try {
    return getColumnLabels(
      board.value.size,
      board.value.labelMode as LabelMode,
      board.value.columnLabels ?? undefined
    );
  } catch {
    return Array.from({ length: board.value.size }, () => "");
  }
});

const rowLabelsForGrid = computed(() => (board.value ? getRowLabels(board.value.size) : []));

const gridCells = computed(() =>
  board.value
    ? buildGridCells(board.value.size, columnLabelsForGrid.value, rowLabelsForGrid.value)
    : []
);

onMounted(async () => {
  const token = route.params.token as string;

  const response = await fetch(`${API_BASE_URL}/api/overlay/${token}`);
  if (response.ok) {
    board.value = (await response.json()) as PublicBoard;
  }

  eventSource = new EventSource(`${API_BASE_URL}/api/overlay/${token}/events`);
  eventSource.addEventListener("board-update", (event) => {
    board.value = JSON.parse((event as MessageEvent).data) as PublicBoard;
  });
});

onBeforeUnmount(() => {
  eventSource?.close();
});
</script>

<template>
  <div class="overlay-root">
    <div
      v-if="board"
      class="overlay-grid"
      :style="{ gridTemplateColumns: `repeat(${board.size + 2}, 1fr)` }"
    >
      <template v-for="(gridCell, index) in gridCells" :key="index">
        <div v-if="gridCell.kind === 'empty'" class="overlay-cell" />
        <div v-else-if="gridCell.kind === 'label'" class="overlay-cell overlay-label">
          {{ gridCell.text }}
        </div>
        <div v-else class="overlay-cell overlay-content">
          <span class="overlay-text">{{ cellText(gridCell.row, gridCell.col) }}</span>
          <span v-if="isChecked(gridCell.row, gridCell.col)" class="overlay-mark">✕</span>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
:global(html),
:global(body) {
  background: transparent;
}

.overlay-root {
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
}

.overlay-grid {
  display: grid;
  width: min(100vw, 100vh);
  height: min(100vw, 100vh);
  gap: 0.3vmin;
}

.overlay-cell {
  aspect-ratio: 1 / 1;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
}

.overlay-label {
  color: white;
  font-weight: 700;
  font-size: clamp(0.6rem, 3vmin, 2rem);
  text-shadow:
    -1px -1px 0 #000,
    1px -1px 0 #000,
    -1px 1px 0 #000,
    1px 1px 0 #000;
}

.overlay-content {
  background: rgba(15, 23, 42, 0.55);
  border-radius: 0.4vmin;
}

.overlay-text {
  color: white;
  font-size: clamp(0.5rem, 2.2vmin, 1.5rem);
  text-align: center;
  padding: 0.4vmin;
  word-break: break-word;
  text-shadow:
    -1px -1px 0 #000,
    1px -1px 0 #000,
    -1px 1px 0 #000,
    1px 1px 0 #000;
}

.overlay-mark {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ef4444;
  font-size: clamp(1rem, 6vmin, 4rem);
  font-weight: 900;
  text-shadow:
    -1px -1px 0 #000,
    1px -1px 0 #000,
    -1px 1px 0 #000,
    1px 1px 0 #000;
  pointer-events: none;
}
</style>
