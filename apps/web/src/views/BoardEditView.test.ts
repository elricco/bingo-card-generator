import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createRouter, createWebHistory } from "vue-router";
import BoardEditView from "./BoardEditView.vue";

function createTestRouter() {
  return createRouter({
    history: createWebHistory(),
    routes: [{ path: "/boards/:id/edit", name: "board-edit", component: BoardEditView }],
  });
}

const sampleBoard = {
  id: "b1",
  name: "Mein Board",
  size: 3,
  labelMode: "letters",
  columnLabels: null,
  overlayToken: "token",
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
  cells: [
    { row: 0, col: 0, text: "Erste Zelle", checked: false },
    { row: 1, col: 1, text: "", checked: false },
  ],
};

describe("BoardEditView", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("zeigt Name, Spaltenlabels (A/B/C) und Zelltext", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => sampleBoard } as Response);

    const router = createTestRouter();
    router.push("/boards/b1/edit");
    await router.isReady();

    const wrapper = mount(BoardEditView, { global: { plugins: [router] } });
    await flushPromises();

    expect((wrapper.find("input[type=text]").element as HTMLInputElement).value).toBe(
      "Mein Board"
    );
    expect(wrapper.text()).toContain("A");
    expect(wrapper.text()).toContain("C");
    expect(wrapper.text()).toContain("Erste Zelle");
  });

  it("zeigt die BINGO-Option nur bei size=5 aktiviert", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ ...sampleBoard, size: 3 }),
    } as Response);

    const router = createTestRouter();
    router.push("/boards/b1/edit");
    await router.isReady();

    const wrapper = mount(BoardEditView, { global: { plugins: [router] } });
    await flushPromises();

    const bingoOption = wrapper.find("option[value=bingo]");
    expect((bingoOption.element as HTMLOptionElement).disabled).toBe(true);
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
