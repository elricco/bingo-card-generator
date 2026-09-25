import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createRouter, createWebHistory } from "vue-router";
import NewBoardView from "./NewBoardView.vue";
import { useBoardsStore } from "../stores/boards";

function createTestRouter() {
  return createRouter({
    history: createWebHistory(),
    routes: [
      { path: "/", name: "home", component: { template: "<div />" } },
      { path: "/boards/:id/edit", name: "board-edit", component: { template: "<div />" } },
    ],
  });
}

describe("NewBoardView", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("startet mit Default-Name, size=3 und label_mode=letters, ohne Custom-Felder", () => {
    const router = createTestRouter();
    const wrapper = mount(NewBoardView, { global: { plugins: [router] } });

    expect((wrapper.find("input[type=text]").element as HTMLInputElement).value).toBe(
      "Neues Bingo"
    );
    expect(wrapper.findAll("input[type=text]")).toHaveLength(1);
    expect(wrapper.text()).not.toContain("Spalte");
  });

  it("zeigt bei label_mode=custom genau size Spalten-Inputs", async () => {
    const router = createTestRouter();
    const wrapper = mount(NewBoardView, { global: { plugins: [router] } });

    const sizeSelect = wrapper.findAll("select")[0];
    await sizeSelect.setValue("5");
    const labelSelect = wrapper.findAll("select")[1];
    await labelSelect.setValue("custom");

    const columnInputs = wrapper.findAll("input[type=text]").filter((_, i) => i > 0);
    expect(columnInputs).toHaveLength(5);
  });

  it("ruft beim Absenden createBoard auf und navigiert zum Editor", async () => {
    const router = createTestRouter();
    const boardsStore = useBoardsStore();
    vi.spyOn(boardsStore, "createBoard").mockResolvedValue({
      id: "new-board-id",
      name: "Neues Bingo",
      size: 3,
      checkedCount: 0,
    });
    const pushSpy = vi.spyOn(router, "push");

    const wrapper = mount(NewBoardView, { global: { plugins: [router] } });
    await wrapper.find("form").trigger("submit.prevent");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(boardsStore.createBoard).toHaveBeenCalledWith({
      name: "Neues Bingo",
      size: 3,
      label_mode: "letters",
      column_labels: undefined,
    });
    expect(pushSpy).toHaveBeenCalledWith("/boards/new-board-id/edit");
  });

  it("zeigt eine Fehlermeldung, wenn createBoard fehlschlägt", async () => {
    const router = createTestRouter();
    const boardsStore = useBoardsStore();
    vi.spyOn(boardsStore, "createBoard").mockRejectedValue(new Error("Serverfehler"));

    const wrapper = mount(NewBoardView, { global: { plugins: [router] } });
    await wrapper.find("form").trigger("submit.prevent");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(wrapper.text()).toContain("Serverfehler");
  });
});
