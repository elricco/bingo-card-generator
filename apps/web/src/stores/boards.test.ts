import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useBoardsStore } from "./boards";

describe("useBoardsStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetchBoards füllt boards bei erfolgreicher Antwort", async () => {
    const mockBoards = [{ id: "1", name: "Test", size: 3, checkedCount: 0 }];
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => mockBoards } as Response);

    const store = useBoardsStore();
    await store.fetchBoards();

    expect(store.boards).toEqual(mockBoards);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/boards"),
      expect.objectContaining({ credentials: "include" })
    );
  });

  it("fetchBoards setzt boards auf leeres Array bei Fehler", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, json: async () => ({}) } as Response);

    const store = useBoardsStore();
    await store.fetchBoards();

    expect(store.boards).toEqual([]);
  });

  it("createBoard sendet POST mit korrektem Body und liefert das erstellte Board", async () => {
    const created = { id: "1", name: "Neu", size: 3 };
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => created } as Response);

    const store = useBoardsStore();
    const result = await store.createBoard({ name: "Neu", size: 3, label_mode: "letters" });

    expect(result).toEqual(created);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/boards"),
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ name: "Neu", size: 3, label_mode: "letters" }),
      })
    );
  });

  it("createBoard wirft bei Fehlerantwort", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      json: async () => ({ error: "ungültig" }),
    } as Response);

    const store = useBoardsStore();
    await expect(
      store.createBoard({ name: "Neu", size: 3, label_mode: "letters" })
    ).rejects.toThrow();
  });

  it("deleteBoard sendet DELETE und entfernt das Board aus dem State", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({}) } as Response);

    const store = useBoardsStore();
    store.boards = [{ id: "1", name: "Test", size: 3, checkedCount: 0 } as never];

    await store.deleteBoard("1");

    expect(store.boards).toHaveLength(0);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/boards/1"),
      expect.objectContaining({ method: "DELETE", credentials: "include" })
    );
  });
});
