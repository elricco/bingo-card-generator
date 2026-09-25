import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createWebHistory } from "vue-router";
import BoardEditView from "./BoardEditView.vue";

function createTestRouter() {
  const router = createRouter({
    history: createWebHistory(),
    routes: [{ path: "/boards/:id/edit", name: "board-edit", component: BoardEditView }],
  });
  return router;
}

describe("BoardEditView", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("zeigt Name und Größe des geladenen Boards", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ id: "b1", name: "Mein Board", size: 5 }),
    } as Response);

    const router = createTestRouter();
    router.push("/boards/b1/edit");
    await router.isReady();

    const wrapper = mount(BoardEditView, { global: { plugins: [router] } });
    await flushPromises();

    expect(wrapper.text()).toContain("Mein Board");
    expect(wrapper.text()).toContain("5×5");
  });

  it("zeigt 'nicht gefunden' bei 404", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, json: async () => ({}) } as Response);

    const router = createTestRouter();
    router.push("/boards/missing/edit");
    await router.isReady();

    const wrapper = mount(BoardEditView, { global: { plugins: [router] } });
    await flushPromises();

    expect(wrapper.text()).toContain("nicht gefunden");
  });
});
