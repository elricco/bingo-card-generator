import { describe, it, expect, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import "../env";
import { db } from "./client";
import { users, boards, boardCells } from "./schema";
import {
  createBoardWithCells,
  listBoardsForUser,
  getBoardById,
  deleteBoard,
  updateBoard,
  setCellChecked,
  getBoardByOverlayToken,
  duplicateBoard,
  resetBoardChecks,
  regenerateOverlayToken,
} from "./boards";

async function createTestUser() {
  const [user] = await db
    .insert(users)
    .values({
      twitchId: `test-${randomUUID()}`,
      login: "test-user",
      displayName: "Test User",
      avatarUrl: null,
    })
    .returning();
  return user;
}

describe("Board-DB-Helfer", () => {
  const createdUserIds: string[] = [];

  afterEach(async () => {
    for (const userId of createdUserIds.splice(0)) {
      await db.delete(users).where(eq(users.id, userId));
    }
  });

  it("createBoardWithCells legt Board mit korrekten Feldern und size×size Zellen an", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);

    const board = await createBoardWithCells(user.id, {
      name: "Mein Board",
      size: 3,
      label_mode: "letters",
    });

    expect(board.name).toBe("Mein Board");
    expect(board.size).toBe(3);
    expect(board.labelMode).toBe("letters");
    expect(board.userId).toBe(user.id);
    expect(board.overlayToken).toMatch(/^[A-Za-z0-9_-]{20,}$/);

    const cells = await db.select().from(boardCells).where(eq(boardCells.boardId, board.id));
    expect(cells).toHaveLength(9);
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const cell = cells.find((c) => c.row === row && c.col === col);
        expect(cell).toBeDefined();
        expect(cell?.text).toBe("");
        expect(cell?.checked).toBe(false);
      }
    }
  });

  it("listBoardsForUser liefert nur eigene Boards mit korrektem checkedCount", async () => {
    const owner = await createTestUser();
    const other = await createTestUser();
    createdUserIds.push(owner.id, other.id);

    const ownBoard = await createBoardWithCells(owner.id, {
      name: "Eigenes Board",
      size: 3,
      label_mode: "letters",
    });
    await createBoardWithCells(other.id, {
      name: "Fremdes Board",
      size: 3,
      label_mode: "letters",
    });

    await db
      .update(boardCells)
      .set({ checked: true })
      .where(and(eq(boardCells.boardId, ownBoard.id), eq(boardCells.row, 0), eq(boardCells.col, 0)));

    const result = await listBoardsForUser(owner.id);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(ownBoard.id);
    expect(result[0].checkedCount).toBe(1);
  });

  it("getBoardById liefert Board inkl. Zellen für den Eigentümer", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const board = await createBoardWithCells(user.id, {
      name: "Mein Board",
      size: 3,
      label_mode: "letters",
    });

    const result = await getBoardById(user.id, board.id);

    expect(result?.id).toBe(board.id);
    expect(result?.cells).toHaveLength(9);
  });

  it("getBoardById liefert null für fremden User", async () => {
    const owner = await createTestUser();
    const other = await createTestUser();
    createdUserIds.push(owner.id, other.id);
    const board = await createBoardWithCells(owner.id, {
      name: "Mein Board",
      size: 3,
      label_mode: "letters",
    });

    const result = await getBoardById(other.id, board.id);

    expect(result).toBeNull();
  });

  it("getBoardById liefert null für nicht existierende ID", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);

    const result = await getBoardById(user.id, randomUUID());

    expect(result).toBeNull();
  });

  it("deleteBoard löscht Board (und kaskadiert Zellen) für den Eigentümer", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const board = await createBoardWithCells(user.id, {
      name: "Mein Board",
      size: 3,
      label_mode: "letters",
    });

    const deleted = await deleteBoard(user.id, board.id);

    expect(deleted).toBe(true);
    const [row] = await db.select().from(boards).where(eq(boards.id, board.id));
    expect(row).toBeUndefined();
    const cells = await db.select().from(boardCells).where(eq(boardCells.boardId, board.id));
    expect(cells).toHaveLength(0);
  });

  it("deleteBoard löscht nichts und liefert false für fremden User", async () => {
    const owner = await createTestUser();
    const other = await createTestUser();
    createdUserIds.push(owner.id, other.id);
    const board = await createBoardWithCells(owner.id, {
      name: "Mein Board",
      size: 3,
      label_mode: "letters",
    });

    const deleted = await deleteBoard(other.id, board.id);

    expect(deleted).toBe(false);
    const [row] = await db.select().from(boards).where(eq(boards.id, board.id));
    expect(row).toBeDefined();
  });
});

describe("updateBoard", () => {
  const createdUserIds: string[] = [];

  afterEach(async () => {
    for (const userId of createdUserIds.splice(0)) {
      await db.delete(users).where(eq(users.id, userId));
    }
  });

  it("aktualisiert nur den Namen, andere Felder bleiben unverändert", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const board = await createBoardWithCells(user.id, {
      name: "Alt",
      size: 3,
      label_mode: "letters",
    });

    const result = await updateBoard(user.id, board.id, { name: "Neu" });

    expect(result?.name).toBe("Neu");
    expect(result?.labelMode).toBe("letters");
  });

  it("aktualisiert label_mode und column_labels gemeinsam", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const board = await createBoardWithCells(user.id, {
      name: "Board",
      size: 3,
      label_mode: "letters",
    });

    const result = await updateBoard(user.id, board.id, {
      label_mode: "custom",
      column_labels: ["WIN", "GG", "GLHF"],
    });

    expect(result?.labelMode).toBe("custom");
    expect(result?.columnLabels).toEqual(["WIN", "GG", "GLHF"]);
  });

  it("aktualisiert den Text einer einzelnen Zelle, andere bleiben unverändert", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const board = await createBoardWithCells(user.id, {
      name: "Board",
      size: 3,
      label_mode: "letters",
    });

    const result = await updateBoard(user.id, board.id, {
      cells: [{ row: 1, col: 1, text: "Mittelfeld" }],
    });

    const updatedCell = result?.cells.find((c) => c.row === 1 && c.col === 1);
    const otherCell = result?.cells.find((c) => c.row === 0 && c.col === 0);
    expect(updatedCell?.text).toBe("Mittelfeld");
    expect(otherCell?.text).toBe("");
  });

  it("aktualisiert mehrere Zellen in einem Aufruf", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const board = await createBoardWithCells(user.id, {
      name: "Board",
      size: 3,
      label_mode: "letters",
    });

    const result = await updateBoard(user.id, board.id, {
      cells: [
        { row: 0, col: 0, text: "A" },
        { row: 2, col: 2, text: "B" },
      ],
    });

    expect(result?.cells.find((c) => c.row === 0 && c.col === 0)?.text).toBe("A");
    expect(result?.cells.find((c) => c.row === 2 && c.col === 2)?.text).toBe("B");
  });

  it("bumpt updatedAt", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const board = await createBoardWithCells(user.id, {
      name: "Board",
      size: 3,
      label_mode: "letters",
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    const result = await updateBoard(user.id, board.id, { name: "Neu" });

    expect(new Date(result!.updatedAt).getTime()).toBeGreaterThan(
      new Date(board.updatedAt).getTime()
    );
  });

  it("liefert null für ein Board eines fremden Users, ohne etwas zu ändern", async () => {
    const owner = await createTestUser();
    const other = await createTestUser();
    createdUserIds.push(owner.id, other.id);
    const board = await createBoardWithCells(owner.id, {
      name: "Board",
      size: 3,
      label_mode: "letters",
    });

    const result = await updateBoard(other.id, board.id, { name: "Gehackt" });

    expect(result).toBeNull();
    const stillOwned = await getBoardById(owner.id, board.id);
    expect(stillOwned?.name).toBe("Board");
  });
});

describe("setCellChecked", () => {
  const createdUserIds: string[] = [];

  afterEach(async () => {
    for (const userId of createdUserIds.splice(0)) {
      await db.delete(users).where(eq(users.id, userId));
    }
  });

  it("setzt checked=true und einen checkedAt-Zeitstempel", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const board = await createBoardWithCells(user.id, {
      name: "Board",
      size: 3,
      label_mode: "letters",
    });

    const cell = await setCellChecked(user.id, board.id, 1, 1, true);

    expect(cell?.checked).toBe(true);
    expect(cell?.checkedAt).not.toBeNull();
  });

  it("setzt checked=false und löscht checkedAt", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const board = await createBoardWithCells(user.id, {
      name: "Board",
      size: 3,
      label_mode: "letters",
    });

    await setCellChecked(user.id, board.id, 1, 1, true);
    const cell = await setCellChecked(user.id, board.id, 1, 1, false);

    expect(cell?.checked).toBe(false);
    expect(cell?.checkedAt).toBeNull();
  });

  it("lässt andere Zellen unverändert", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const board = await createBoardWithCells(user.id, {
      name: "Board",
      size: 3,
      label_mode: "letters",
    });

    await setCellChecked(user.id, board.id, 0, 0, true);

    const cells = await db
      .select()
      .from(boardCells)
      .where(and(eq(boardCells.boardId, board.id), eq(boardCells.row, 1), eq(boardCells.col, 1)));
    expect(cells[0].checked).toBe(false);
  });

  it("ist idempotent (mehrfaches Setzen desselben Zielzustands erzeugt keinen Fehler)", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const board = await createBoardWithCells(user.id, {
      name: "Board",
      size: 3,
      label_mode: "letters",
    });

    await setCellChecked(user.id, board.id, 2, 2, true);
    const cell = await setCellChecked(user.id, board.id, 2, 2, true);

    expect(cell?.checked).toBe(true);
  });

  it("liefert null für ein Board eines fremden Users, ohne etwas zu ändern", async () => {
    const owner = await createTestUser();
    const other = await createTestUser();
    createdUserIds.push(owner.id, other.id);
    const board = await createBoardWithCells(owner.id, {
      name: "Board",
      size: 3,
      label_mode: "letters",
    });

    const cell = await setCellChecked(other.id, board.id, 0, 0, true);

    expect(cell).toBeNull();
    const stillUnchecked = await db
      .select()
      .from(boardCells)
      .where(and(eq(boardCells.boardId, board.id), eq(boardCells.row, 0), eq(boardCells.col, 0)));
    expect(stillUnchecked[0].checked).toBe(false);
  });
});

describe("getBoardByOverlayToken", () => {
  const createdUserIds: string[] = [];

  afterEach(async () => {
    for (const userId of createdUserIds.splice(0)) {
      await db.delete(users).where(eq(users.id, userId));
    }
  });

  it("liefert das Board inkl. Zellen für einen gültigen Token", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const board = await createBoardWithCells(user.id, {
      name: "Board",
      size: 3,
      label_mode: "letters",
    });

    const result = await getBoardByOverlayToken(board.overlayToken);

    expect(result?.id).toBe(board.id);
    expect(result?.cells).toHaveLength(9);
  });

  it("liefert null für einen ungültigen Token", async () => {
    const result = await getBoardByOverlayToken("token-existiert-nicht");

    expect(result).toBeNull();
  });
});

describe("duplicateBoard", () => {
  const createdUserIds: string[] = [];

  afterEach(async () => {
    for (const userId of createdUserIds.splice(0)) {
      await db.delete(users).where(eq(users.id, userId));
    }
  });

  it("erstellt eine Kopie mit angehängtem '(Kopie)', gleicher Größe/Beschriftung/Texten und zurückgesetzten Häkchen", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const board = await createBoardWithCells(user.id, {
      name: "Original",
      size: 3,
      label_mode: "letters",
    });
    await setCellChecked(user.id, board.id, 0, 0, true);
    await updateBoard(user.id, board.id, { cells: [{ row: 0, col: 0, text: "Hallo" }] });

    const duplicate = await duplicateBoard(user.id, board.id);

    expect(duplicate?.name).toBe("Original (Kopie)");
    expect(duplicate?.size).toBe(3);
    expect(duplicate?.labelMode).toBe("letters");
    expect(duplicate?.id).not.toBe(board.id);
    expect(duplicate?.overlayToken).not.toBe(board.overlayToken);

    const cells = await db.select().from(boardCells).where(eq(boardCells.boardId, duplicate!.id));
    expect(cells).toHaveLength(9);
    const copiedCell = cells.find((c) => c.row === 0 && c.col === 0);
    expect(copiedCell?.text).toBe("Hallo");
    expect(copiedCell?.checked).toBe(false);
  });

  it("kürzt den Basisnamen, damit der Kopie-Name das Längenlimit einhält", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const longName = "a".repeat(60);
    const board = await createBoardWithCells(user.id, {
      name: longName,
      size: 3,
      label_mode: "letters",
    });

    const duplicate = await duplicateBoard(user.id, board.id);

    expect(duplicate?.name.length).toBeLessThanOrEqual(60);
    expect(duplicate?.name.endsWith(" (Kopie)")).toBe(true);
  });

  it("liefert null für ein Board eines fremden Users, ohne etwas zu erstellen", async () => {
    const owner = await createTestUser();
    const other = await createTestUser();
    createdUserIds.push(owner.id, other.id);
    const board = await createBoardWithCells(owner.id, {
      name: "Board",
      size: 3,
      label_mode: "letters",
    });

    const duplicate = await duplicateBoard(other.id, board.id);

    expect(duplicate).toBeNull();
    const boardsForOwner = await listBoardsForUser(owner.id);
    expect(boardsForOwner).toHaveLength(1);
  });
});

describe("resetBoardChecks", () => {
  const createdUserIds: string[] = [];

  afterEach(async () => {
    for (const userId of createdUserIds.splice(0)) {
      await db.delete(users).where(eq(users.id, userId));
    }
  });

  it("setzt alle Häkchen und checkedAt-Zeitstempel zurück", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const board = await createBoardWithCells(user.id, {
      name: "Board",
      size: 3,
      label_mode: "letters",
    });
    await setCellChecked(user.id, board.id, 0, 0, true);
    await setCellChecked(user.id, board.id, 1, 1, true);

    const result = await resetBoardChecks(user.id, board.id);

    expect(result?.cells.every((c) => c.checked === false)).toBe(true);
    expect(result?.cells.every((c) => c.checkedAt === null)).toBe(true);
  });

  it("lässt Zelltexte unverändert", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const board = await createBoardWithCells(user.id, {
      name: "Board",
      size: 3,
      label_mode: "letters",
    });
    await updateBoard(user.id, board.id, { cells: [{ row: 0, col: 0, text: "Bleibt" }] });

    const result = await resetBoardChecks(user.id, board.id);

    expect(result?.cells.find((c) => c.row === 0 && c.col === 0)?.text).toBe("Bleibt");
  });

  it("liefert null für ein Board eines fremden Users, ohne etwas zu ändern", async () => {
    const owner = await createTestUser();
    const other = await createTestUser();
    createdUserIds.push(owner.id, other.id);
    const board = await createBoardWithCells(owner.id, {
      name: "Board",
      size: 3,
      label_mode: "letters",
    });
    await setCellChecked(owner.id, board.id, 0, 0, true);

    const result = await resetBoardChecks(other.id, board.id);

    expect(result).toBeNull();
    const cells = await db.select().from(boardCells).where(eq(boardCells.boardId, board.id));
    expect(cells.find((c) => c.row === 0 && c.col === 0)?.checked).toBe(true);
  });
});

describe("regenerateOverlayToken", () => {
  const createdUserIds: string[] = [];

  afterEach(async () => {
    for (const userId of createdUserIds.splice(0)) {
      await db.delete(users).where(eq(users.id, userId));
    }
  });

  it("setzt einen neuen, anderen Overlay-Token", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const board = await createBoardWithCells(user.id, {
      name: "Board",
      size: 3,
      label_mode: "letters",
    });

    const result = await regenerateOverlayToken(user.id, board.id);

    expect(result?.overlayToken).toBeDefined();
    expect(result?.overlayToken).not.toBe(board.overlayToken);
  });

  it("macht den alten Token ungültig (nicht mehr auffindbar)", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const board = await createBoardWithCells(user.id, {
      name: "Board",
      size: 3,
      label_mode: "letters",
    });

    await regenerateOverlayToken(user.id, board.id);

    const found = await getBoardByOverlayToken(board.overlayToken);
    expect(found).toBeNull();
  });

  it("liefert null für ein Board eines fremden Users, ohne den Token zu ändern", async () => {
    const owner = await createTestUser();
    const other = await createTestUser();
    createdUserIds.push(owner.id, other.id);
    const board = await createBoardWithCells(owner.id, {
      name: "Board",
      size: 3,
      label_mode: "letters",
    });

    const result = await regenerateOverlayToken(other.id, board.id);

    expect(result).toBeNull();
    const stillFound = await getBoardByOverlayToken(board.overlayToken);
    expect(stillFound?.id).toBe(board.id);
  });
});