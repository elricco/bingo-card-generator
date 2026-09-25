import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createRouter, createWebHistory } from "vue-router";
import BoardsView from "./BoardsView.vue";
import { useAuthStore } from "../stores/auth";
import { useBoardsStore } from "../stores/boards";

function createTestRouter() {
  return createRouter({
    history: createWebHistory(),
    routes: [
      { path: "/", name: "home", component: { template: "<div />" } },
      { path: "/boards/new", name: "board-new", component: { template: "<div />" } },
      { path: "/boards/:id/edit", name: "board-edit", component: { template: "<div />" } },
    ],
  });
}

describe("BoardsView", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("fetch", vi.fn());
    vi.spyOn(window, "confirm").mockReturnValue(true);
    // Configure fetch to return the current store state for GET requests
    vi.mocked(fetch).mockImplementation(async (_url, options) => {
      const method = ((options as any)?.method || "GET").toUpperCase();
      if (method === "DELETE") {
        return { ok: true } as Response;
      }
      // For GET/POST requests, return current boards
      const store = useBoardsStore();
      return {
        ok: true,
        json: async () => store.boards,
      } as Response;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("zeigt User-Header und Boardliste", async () => {
    const router = createTestRouter();
    const auth = useAuthStore();
    const boardsStore = useBoardsStore();
    auth.user = { id: "1", login: "x", displayName: "Streamerin", avatarUrl: null };
    boardsStore.boards = [
      { id: "b1", name: "Board Eins", size: 3, checkedCount: 2 } as never,
    ];

    const wrapper = mount(BoardsView, { global: { plugins: [router] } });
    await wrapper.vm.$nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(wrapper.text()).toContain("Streamerin");
    expect(wrapper.text()).toContain("Board Eins");
    expect(wrapper.text()).toContain("3×3");
    expect(wrapper.text()).toContain("2 abgehakt");
  });

  it("zeigt Leerzustand ohne Boards", async () => {
    const router = createTestRouter();
    const auth = useAuthStore();
    auth.user = { id: "1", login: "x", displayName: "Streamerin", avatarUrl: null };

    const wrapper = mount(BoardsView, { global: { plugins: [router] } });
    await wrapper.vm.$nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(wrapper.text()).toContain("Noch keine Boards vorhanden");
  });

  it("löscht ein Board nach Bestätigung", async () => {
    const router = createTestRouter();
    const auth = useAuthStore();
    const boardsStore = useBoardsStore();
    auth.user = { id: "1", login: "x", displayName: "Streamerin", avatarUrl: null };
    boardsStore.boards = [{ id: "b1", name: "Board Eins", size: 3, checkedCount: 0 } as never];

    const wrapper = mount(BoardsView, { global: { plugins: [router] } });
    await wrapper.vm.$nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.find("button.bg-red-700").trigger("click");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(boardsStore.boards).toHaveLength(0);
  });
});
