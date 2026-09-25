<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { getColumnLabels, getRowLabels, type LabelMode } from "@bingo/shared";
import { useBoardsStore, type BoardDetail, type PatchBoardInput } from "../stores/boards";
import { buildGridCells } from "../utils/grid";

const route = useRoute();
const boardsStore = useBoardsStore();

const board = ref<BoardDetail | null>(null);
const notFound = ref(false);
const name = ref("");
const labelMode = ref<LabelMode>("letters");
const columnLabels = ref<string[]>([]);
const cellTexts = reactive<Record<string, string>>({});
const editingCell = ref<{ row: number; col: number } | null>(null);
const isSaving = ref(false);
const saveError = ref<string | null>(null);

const canUseBingo = computed(() => board.value?.size === 5);

watch(labelMode, (mode) => {
  if (mode === "custom" && board.value && columnLabels.value.length !== board.value.size) {
    columnLabels.value = Array.from(
      { length: board.value.size },
      (_, i) => columnLabels.value[i] ?? ""
    );
  }
});

const columnLabelsForGrid = computed(() => {
  if (!board.value) {
    return [];
  }
  try {
    return getColumnLabels(
      board.value.size,
      labelMode.value,
      labelMode.value === "custom" ? columnLabels.value : undefined
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

function cellKey(row: number, col: number): string {
  return `${row}-${col}`;
}

function isEditing(row: number, col: number): boolean {
  return editingCell.value?.row === row && editingCell.value?.col === col;
}

async function startEditing(row: number, col: number) {
  editingCell.value = { row, col };
  await nextTick();
  document.querySelector<HTMLTextAreaElement>(`textarea[data-cell="${cellKey(row, col)}"]`)?.focus();
}

function stopEditing() {
  editingCell.value = null;
}

const isDirty = computed(() => {
  if (!board.value) {
    return false;
  }
  if (name.value !== board.value.name) {
    return true;
  }
  if (labelMode.value !== board.value.labelMode) {
    return true;
  }
  if (
    labelMode.value === "custom" &&
    JSON.stringify(columnLabels.value) !== JSON.stringify(board.value.columnLabels ?? [])
  ) {
    return true;
  }
  return board.value.cells.some(
    (cell) => (cellTexts[cellKey(cell.row, cell.col)] ?? "") !== cell.text
  );
});

function applyBoard(result: BoardDetail) {
  board.value = result;
  name.value = result.name;
  labelMode.value = result.labelMode as LabelMode;
  columnLabels.value = result.columnLabels ?? [];
  for (const cell of result.cells) {
    cellTexts[cellKey(cell.row, cell.col)] = cell.text;
  }
}

async function handleSave() {
  if (!board.value) {
    return;
  }
  isSaving.value = true;
  saveError.value = null;
  try {
    const changedCells = board.value.cells
      .filter((cell) => (cellTexts[cellKey(cell.row, cell.col)] ?? "") !== cell.text)
      .map((cell) => ({
        row: cell.row,
        col: cell.col,
        text: cellTexts[cellKey(cell.row, cell.col)] ?? "",
      }));

    const payload: PatchBoardInput = {};
    if (name.value !== board.value.name) {
      payload.name = name.value;
    }
    if (labelMode.value !== board.value.labelMode) {
      payload.label_mode = labelMode.value;
    }
    if (labelMode.value === "custom") {
      payload.column_labels = columnLabels.value;
    }
    if (changedCells.length > 0) {
      payload.cells = changedCells;
    }

    const updated = await boardsStore.updateBoard(board.value.id, payload);
    applyBoard(updated);
  } catch (err) {
    saveError.value = err instanceof Error ? err.message : "Speichern fehlgeschlagen";
  } finally {
    isSaving.value = false;
  }
}

onMounted(async () => {
  const id = route.params.id as string;
  const result = await boardsStore.fetchBoard(id);
  if (!result) {
    notFound.value = true;
    return;
  }
  applyBoard(result);
});
</script>

<template>
  <main class="min-h-screen bg-slate-900 p-6 text-slate-100">
    <div v-if="notFound">Board nicht gefunden.</div>
    <div v-else-if="board" class="mx-auto max-w-3xl">
      <div class="mb-4 flex flex-col gap-4">
        <label class="flex flex-col gap-1">
          Name
          <input v-model="name" type="text" maxlength="60" class="rounded bg-slate-800 p-2" />
        </label>
        <label class="flex flex-col gap-1">
          Beschriftung
          <select v-model="labelMode" class="rounded bg-slate-800 p-2">
            <option value="letters">Buchstaben (A, B, C, …)</option>
            <option value="bingo" :disabled="!canUseBingo">BINGO</option>
            <option value="custom">Eigene Wörter</option>
          </select>
        </label>
        <div v-if="labelMode === 'custom'" class="flex flex-col gap-2">
          <label v-for="i in board.size" :key="i" class="flex flex-col gap-1">
            Spalte {{ i }}
            <input
              v-model="columnLabels[i - 1]"
              type="text"
              maxlength="20"
              class="rounded bg-slate-800 p-2"
            />
          </label>
        </div>
      </div>

      <div
        class="mb-4 grid gap-1"
        :style="{ gridTemplateColumns: `repeat(${board.size + 2}, minmax(2.5rem, 1fr))` }"
      >
        <template v-for="(gridCell, index) in gridCells" :key="index">
          <div v-if="gridCell.kind === 'empty'" />
          <div
            v-else-if="gridCell.kind === 'label'"
            class="flex items-center justify-center font-semibold"
          >
            {{ gridCell.text }}
          </div>
          <div
            v-else
            class="min-h-16 rounded bg-slate-800 p-1 text-center text-sm"
            @click="!isEditing(gridCell.row, gridCell.col) && startEditing(gridCell.row, gridCell.col)"
          >
            <textarea
              v-if="isEditing(gridCell.row, gridCell.col)"
              v-model="cellTexts[cellKey(gridCell.row, gridCell.col)]"
              :data-cell="cellKey(gridCell.row, gridCell.col)"
              maxlength="80"
              class="h-full w-full resize-none bg-slate-700 p-1 text-center text-sm"
              @blur="stopEditing"
              @keydown.esc="stopEditing"
            />
            <span v-else>{{ cellTexts[cellKey(gridCell.row, gridCell.col)] }}</span>
          </div>
        </template>
      </div>

      <p v-if="saveError" class="mb-2 text-red-400">{{ saveError }}</p>
      <button
        :disabled="isSaving"
        class="rounded bg-purple-600 px-4 py-2 font-semibold hover:bg-purple-700"
        @click="handleSave"
      >
        Speichern
      </button>
    </div>
    <p v-else>Lade...</p>
  </main>
</template>
