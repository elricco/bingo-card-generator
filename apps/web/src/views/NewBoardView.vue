<script setup lang="ts">
import AppHeader from "../components/AppHeader.vue";
import { ref, computed, watch } from "vue";
import { useRouter } from "vue-router";
import { BOARD_SIZES, DEFAULT_BOARD_NAME, type BoardSize, type LabelMode } from "@bingo/shared";
import { useBoardsStore } from "../stores/boards";

const router = useRouter();
const boardsStore = useBoardsStore();

const name = ref(DEFAULT_BOARD_NAME);
const size = ref<BoardSize>(3);
const labelMode = ref<LabelMode>("letters");
const columnLabels = ref<string[]>([]);
const error = ref<string | null>(null);
const isSubmitting = ref(false);

const canUseBingo = computed(() => size.value === 5);

watch([size, labelMode], () => {
  if (labelMode.value === "custom") {
    columnLabels.value = Array.from({ length: size.value }, (_, i) => columnLabels.value[i] ?? "");
  }
  if (labelMode.value === "bingo" && !canUseBingo.value) {
    labelMode.value = "letters";
  }
});

async function handleSubmit() {
  error.value = null;
  isSubmitting.value = true;
  try {
    const board = await boardsStore.createBoard({
      name: name.value,
      size: size.value,
      label_mode: labelMode.value,
      column_labels: labelMode.value === "custom" ? columnLabels.value : undefined,
    });
    router.push(`/boards/${board.id}/edit`);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unbekannter Fehler";
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <main class="min-h-screen bg-slate-900 text-slate-100">
    <AppHeader show-back />
    <div class="p-6">
    <div class="mx-auto max-w-md">
      <h1 class="mb-4 text-2xl font-bold">Neues Board</h1>

      <form class="flex flex-col gap-4" @submit.prevent="handleSubmit">
        <label class="flex flex-col gap-1">
          Name
          <input v-model="name" type="text" maxlength="60" class="rounded bg-slate-800 p-2" />
        </label>

        <label class="flex flex-col gap-1">
          Größe
          <select v-model.number="size" class="rounded bg-slate-800 p-2">
            <option v-for="s in BOARD_SIZES" :key="s" :value="s">{{ s }}×{{ s }}</option>
          </select>
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
          <label v-for="(_, i) in columnLabels" :key="i" class="flex flex-col gap-1">
            Spalte {{ i + 1 }}
            <input v-model="columnLabels[i]" type="text" maxlength="20" class="rounded bg-slate-800 p-2" />
          </label>
        </div>

        <p v-if="error" class="text-red-400">{{ error }}</p>

        <button
          type="submit"
          :disabled="isSubmitting"
          class="rounded bg-purple-600 px-4 py-2 font-semibold hover:bg-purple-700"
        >
          Board erstellen
        </button>
      </form>
    </div>
    </div>
  </main>
</template>
