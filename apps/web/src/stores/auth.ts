import { defineStore } from "pinia";

export interface AuthUser {
  id: string;
  login: string;
  displayName: string;
  avatarUrl: string | null;
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:3001";

export const useAuthStore = defineStore("auth", {
  state: () => ({
    user: null as AuthUser | null,
    isLoading: false,
  }),
  actions: {
    async fetchMe() {
      this.isLoading = true;
      try {
        const response = await fetch(`${API_BASE_URL}/api/me`, {
          credentials: "include",
        });
        this.user = response.ok ? ((await response.json()) as AuthUser) : null;
      } finally {
        this.isLoading = false;
      }
    },
    async logout() {
      await fetch(`${API_BASE_URL}/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
      this.user = null;
    },
    loginUrl(): string {
      return `${API_BASE_URL}/auth/twitch`;
    },
  },
});
