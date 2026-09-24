import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createRouter, createWebHistory } from "vue-router";
import BoardsView from "./BoardsView.vue";
import { useAuthStore } from "../stores/auth";

function createTestRouter() {
  return createRouter({
    history: createWebHistory(),
    routes: [{ path: "/", name: "home", component: { template: "<div />" } }],
  });
}

async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("BoardsView", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("zeigt den eingeloggten User inkl. Ausloggen-Button", async () => {
    const router = createTestRouter();
    const auth = useAuthStore();
    auth.user = { id: "1", login: "streamerin", displayName: "Streamerin", avatarUrl: null };

    const wrapper = mount(BoardsView, { global: { plugins: [router] } });
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain("Streamerin");
    expect(wrapper.find("button").text()).toContain("Ausloggen");
  });

  it("ruft beim Klick auf Ausloggen den Logout-Store-Action auf und navigiert zu Home", async () => {
    const router = createTestRouter();
    const auth = useAuthStore();
    auth.user = { id: "1", login: "streamerin", displayName: "Streamerin", avatarUrl: null };
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({}) } as Response);

    const wrapper = mount(BoardsView, { global: { plugins: [router] } });
    await wrapper.find("button").trigger("click");
    await flushPromises();

    expect(auth.user).toBeNull();
    expect(router.currentRoute.value.name).toBe("home");
  });
});
