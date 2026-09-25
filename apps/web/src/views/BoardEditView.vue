<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { getColumnLabels, getRowLabels, type LabelMode } from "@bingo/shared";
import { useBoardsStore, type BoardDetail } from "../stores/boards";
import { buildGridCells } from "../utils/grid";

const route = useRoute();
const boardsStore = useBoardsStore();

const board = ref<BoardDetail | null>(null);
const notFound = ref(false);
const name = ref("");
const labelMode = ref<LabelMode>("letters");
const columnLabels = ref<string[]>([]);

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

function cellText(row: number, col: number): string {
  return board.value?.cells.find((c) => c.row === row && c.col === col)?.text ?? "";
}

onMounted(async () => {
  const id = route.params.id as string;
  const result = await boardsStore.fetchBoard(id);
  if (!result) {
    notFound.value = true;
    return;
  }
  board.value = result;
  name.value = result.name;
  labelMode.value = result.labelMode as LabelMode;
  columnLabels.value = result.columnLabels ?? [];
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
        class="grid gap-1"
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
            class="flex min-h-16 items-center justify-center rounded bg-slate-800 p-1 text-center text-sm"
          >
            {{ cellText(gridCell.row, gridCell.col) }}
          </div>
        </template>
      </div>
    </div>
    <p v-else>Lade...</p>
  </main>
</template>
