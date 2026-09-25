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
