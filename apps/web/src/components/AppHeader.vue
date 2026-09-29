<script setup lang="ts">
import { RouterLink, useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth";

defineProps<{ showBack?: boolean }>();

const auth = useAuthStore();
const router = useRouter();

async function handleLogout() {
  await auth.logout();
  router.push({ name: "home" });
}
</script>

<template>
  <header class="flex items-center justify-between border-b border-slate-700 p-4">
    <div class="flex items-center gap-4">
      <RouterLink v-if="showBack" to="/boards" class="text-purple-400 hover:text-purple-300">
        ← Zur Übersicht
      </RouterLink>
      <div v-if="auth.user" class="flex items-center gap-3">
        <img
          v-if="auth.user.avatarUrl"
          :src="auth.user.avatarUrl"
          :alt="auth.user.displayName"
          class="h-10 w-10 rounded-full"
        />
        <span>{{ auth.user.displayName }}</span>
      </div>
    </div>
    <button
      class="rounded bg-purple-600 px-4 py-2 font-semibold hover:bg-purple-700"
      @click="handleLogout"
    >
      Ausloggen
    </button>
  </header>
</template>
