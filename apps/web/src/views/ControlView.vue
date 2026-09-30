<script setup lang="ts">
import AppHeader from "../components/AppHeader.vue";
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute } from "vue-router";
import { getColumnLabels, getRowLabels, type LabelMode } from "@bingo/shared";
import { useBoardsStore, type BoardDetail } from "../stores/boards";
import { buildGridCells } from "../utils/grid";

const route = useRoute();
const boardsStore = useBoardsStore();

const board = ref<BoardDetail | null>(null);
const notFound = ref(false);
const checkedState = reactive<Record<string, boolean>>({});
const pendingCells = reactive<Record<string, boolean>>({});
const toggleError = ref<string | null>(null);

function cellKey(row: number, col: number): string {
  return `${row}-${col}`;
}

function cellText(row: number, col: number): string {
  return board.value?.cells.find((c) => c.row === row && c.col === col)?.text ?? "";
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

async function toggleCell(row: number, col: number) {
  if (!board.value) {
    return;
  }
  const key = cellKey(row, col);
  if (pendingCells[key]) {
    return;
  }
  const previous = checkedState[key] ?? false;
  const next = !previous;
  checkedState[key] = next;
  pendingCells[key] = true;
  toggleError.value = null;
  try {
    await boardsStore.setCellChecked(board.value.id, row, col, next);
  } catch (err) {
    checkedState[key] = previous;
    toggleError.value =
      err instanceof Error ? err.message : "Häkchen konnte nicht gespeichert werden";
  } finally {
    pendingCells[key] = false;
  }
}

onMounted(async () => {
  const id = route.params.id as string;
  const result = await boardsStore.fetchBoard(id);
  if (!result) {
    notFound.value = true;
    return;
  }
  board.value = result;
  for (const cell of result.cells) {
    checkedState[cellKey(cell.row, cell.col)] = cell.checked;
  }
});
</script>

<template>
  <main class="min-h-screen bg-slate-900 text-slate-100">
    <AppHeader show-back />
    <div class="p-6">
    <div v-if="notFound">Board nicht gefunden.</div>
    <div v-else-if="board" class="mx-auto max-w-3xl">
      <h1 class="mb-4 text-2xl font-bold">{{ board.name }}</h1>
      <p v-if="toggleError" class="mb-2 text-red-400">{{ toggleError }}</p>

      <div
        class="grid gap-1"
        :style="{ gridTemplateColumns: `repeat(${board.size + 2}, minmax(2.5rem, 1fr))` }"
      >
        <template v-for="(gridCell, index) in gridCells" :key="index">
          <div v-if="gridCell.kind === 'empty'" class="aspect-square" />
          <div
            v-else-if="gridCell.kind === 'label'"
            class="flex aspect-square items-center justify-center font-semibold"
          >
            {{ gridCell.text }}
          </div>
          <button
            v-else
            type="button"
            class="relative flex aspect-square items-center justify-center rounded bg-slate-800 p-1 text-center text-sm hover:bg-slate-700"
            @click="toggleCell(gridCell.row, gridCell.col)"
          >
            <span>{{ cellText(gridCell.row, gridCell.col) }}</span>
            <span
              v-if="checkedState[cellKey(gridCell.row, gridCell.col)]"
              class="pointer-events-none absolute inset-0 flex items-center justify-center [container-type:size]"
            >
              <span class="text-[65cqmin] font-bold text-red-500">✕</span>
            </span>
          </button>
        </template>
      </div>
    </div>
    <p v-else>Lade...</p>
    </div>
  </main>
</template>
