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
      json: async () => ({ error: "Ungültige Eingabe", details: { formErrors: [], fieldErrors: {} } }),
    } as Response);

    const store = useBoardsStore();
    await expect(
      store.createBoard({ name: "Neu", size: 3, label_mode: "letters" })
    ).rejects.toThrow("Ungültige Eingabe");
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

  it("deleteBoard wirft bei Serverfehler und entfernt das Board nicht aus dem State", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as Response);

    const store = useBoardsStore();
    store.boards = [{ id: "1", name: "Test", size: 3, checkedCount: 0 } as never];

    await expect(store.deleteBoard("1")).rejects.toThrow();

    expect(store.boards).toHaveLength(1);
  });

  describe("fetchBoard", () => {
    it("liefert das Board bei erfolgreicher Antwort", async () => {
      const detail = {
        id: "b1",
        name: "Board",
        size: 3,
        labelMode: "letters",
        columnLabels: null,
        overlayToken: "token",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
        cells: [],
      };
      vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => detail } as Response);

      const store = useBoardsStore();
      const result = await store.fetchBoard("b1");

      expect(result).toEqual(detail);
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/boards/b1"),
        expect.objectContaining({ credentials: "include" })
      );
    });

    it("liefert null bei Fehlerantwort", async () => {
      vi.mocked(fetch).mockResolvedValue({ ok: false, json: async () => ({}) } as Response);

      const store = useBoardsStore();
      const result = await store.fetchBoard("b1");

      expect(result).toBeNull();
    });
  });

  describe("updateBoard", () => {
    it("sendet PATCH mit korrektem Body und liefert das aktualisierte Board", async () => {
      const updated = {
        id: "b1",
        name: "Neuer Name",
        size: 3,
        labelMode: "letters",
        columnLabels: null,
        overlayToken: "token",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-02T00:00:00Z",
        cells: [],
      };
      vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => updated } as Response);

      const store = useBoardsStore();
      const result = await store.updateBoard("b1", { name: "Neuer Name" });

      expect(result).toEqual(updated);
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/boards/b1"),
        expect.objectContaining({
          method: "PATCH",
          credentials: "include",
          body: JSON.stringify({ name: "Neuer Name" }),
        })
      );
    });

    it("wirft bei Fehlerantwort mit der Server-Fehlermeldung", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        json: async () => ({ error: "Ungültige Eingabe" }),
      } as Response);

      const store = useBoardsStore();
      await expect(store.updateBoard("b1", { name: "x" })).rejects.toThrow("Ungültige Eingabe");
    });
  });

  describe("setCellChecked", () => {
    it("sendet PUT mit korrektem Body an den Checked-Endpoint", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ row: 1, col: 1, text: "", checked: true, checkedAt: "2024-01-01T00:00:00Z" }),
      } as Response);

      const store = useBoardsStore();
      await store.setCellChecked("b1", 1, 1, true);

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/boards/b1/cells/1/1/checked"),
        expect.objectContaining({
          method: "PUT",
          credentials: "include",
          body: JSON.stringify({ checked: true }),
        })
      );
    });

    it("wirft bei Fehlerantwort mit der Server-Fehlermeldung", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        json: async () => ({ error: "Ungültige Eingabe" }),
      } as Response);

      const store = useBoardsStore();
      await expect(store.setCellChecked("b1", 1, 1, true)).rejects.toThrow("Ungültige Eingabe");
    });
  });

  describe("duplicateBoard", () => {
    it("sendet POST und lädt die Boardliste danach neu", async () => {
      vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => [] } as Response);

      const store = useBoardsStore();
      await store.duplicateBoard("b1");

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/boards/b1/duplicate"),
        expect.objectContaining({ method: "POST", credentials: "include" })
      );
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it("wirft bei Fehlerantwort", async () => {
      vi.mocked(fetch).mockResolvedValue({ ok: false, json: async () => ({}) } as Response);

      const store = useBoardsStore();
      await expect(store.duplicateBoard("b1")).rejects.toThrow();
    });
  });

  describe("resetBoardChecks", () => {
    it("sendet POST und lädt die Boardliste danach neu", async () => {
      vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => [] } as Response);

      const store = useBoardsStore();
      await store.resetBoardChecks("b1");

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/boards/b1/reset"),
        expect.objectContaining({ method: "POST", credentials: "include" })
      );
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it("wirft bei Fehlerantwort", async () => {
      vi.mocked(fetch).mockResolvedValue({ ok: false, json: async () => ({}) } as Response);

      const store = useBoardsStore();
      await expect(store.resetBoardChecks("b1")).rejects.toThrow();
    });
  });

  describe("regenerateOverlayToken", () => {
    it("sendet POST und lädt die Boardliste danach neu", async () => {
      vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => [] } as Response);

      const store = useBoardsStore();
      await store.regenerateOverlayToken("b1");

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/boards/b1/regenerate-token"),
        expect.objectContaining({ method: "POST", credentials: "include" })
      );
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it("wirft bei Fehlerantwort", async () => {
      vi.mocked(fetch).mockResolvedValue({ ok: false, json: async () => ({}) } as Response);

      const store = useBoardsStore();
      await expect(store.regenerateOverlayToken("b1")).rejects.toThrow();
    });
  });
});
