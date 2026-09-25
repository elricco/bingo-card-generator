import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "./client";
import { boards, boardCells } from "./schema";
import type { CreateBoardInput, PatchBoardInput } from "@bingo/shared";

export async function createBoardWithCells(userId: string, input: CreateBoardInput) {
  const overlayToken = randomBytes(16).toString("base64url");

  return db.transaction(async (tx) => {
    const [board] = await tx
      .insert(boards)
      .values({
        userId,
        name: input.name,
        size: input.size,
        labelMode: input.label_mode,
        columnLabels: input.column_labels ?? null,
        overlayToken,
      })
      .returning();

    const cellRows: Array<{ boardId: string; row: number; col: number }> = [];
    for (let row = 0; row < input.size; row++) {
      for (let col = 0; col < input.size; col++) {
        cellRows.push({ boardId: board.id, row, col });
      }
    }
    await tx.insert(boardCells).values(cellRows);

    return board;
  });
}

export async function listBoardsForUser(userId: string) {
  return db
    .select({
      id: boards.id,
      name: boards.name,
      size: boards.size,
      labelMode: boards.labelMode,
      overlayToken: boards.overlayToken,
      createdAt: boards.createdAt,
      updatedAt: boards.updatedAt,
      checkedCount: sql<number>`count(*) filter (where ${boardCells.checked})`.mapWith(Number),
    })
    .from(boards)
    .leftJoin(boardCells, eq(boardCells.boardId, boards.id))
    .where(eq(boards.userId, userId))
    .groupBy(boards.id)
    .orderBy(sql`${boards.updatedAt} desc`);
}

export async function getBoardById(userId: string, boardId: string) {
  const [board] = await db
    .select()
    .from(boards)
    .where(and(eq(boards.id, boardId), eq(boards.userId, userId)));

  if (!board) {
    return null;
  }

  const cells = await db.select().from(boardCells).where(eq(boardCells.boardId, boardId));

  return { ...board, cells };
}

export async function deleteBoard(userId: string, boardId: string): Promise<boolean> {
  const deleted = await db
    .delete(boards)
    .where(and(eq(boards.id, boardId), eq(boards.userId, userId)))
    .returning({ id: boards.id });

  return deleted.length > 0;
}

export async function updateBoard(userId: string, boardId: string, input: PatchBoardInput) {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: boards.id })
      .from(boards)
      .where(and(eq(boards.id, boardId), eq(boards.userId, userId)));

    if (!existing) {
      return null;
    }

    const boardUpdates: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) {
      boardUpdates.name = input.name;
    }
    if (input.label_mode !== undefined) {
      boardUpdates.labelMode = input.label_mode;
      if (input.label_mode !== "custom") {
        boardUpdates.columnLabels = null;
      }
    }
    if (input.column_labels !== undefined) {
      boardUpdates.columnLabels = input.column_labels;
    }

    await tx
      .update(boards)
      .set(boardUpdates)
      .where(and(eq(boards.id, boardId), eq(boards.userId, userId)));

    if (input.cells) {
      for (const cell of input.cells) {
        await tx
          .update(boardCells)
          .set({ text: cell.text })
          .where(
            and(
              eq(boardCells.boardId, boardId),
              eq(boardCells.row, cell.row),
              eq(boardCells.col, cell.col)
            )
          );
      }
    }

    const [board] = await tx
      .select()
      .from(boards)
      .where(and(eq(boards.id, boardId), eq(boards.userId, userId)));
    const cells = await tx.select().from(boardCells).where(eq(boardCells.boardId, boardId));

    return { ...board, cells };
  });
}

export async function setCellChecked(
  userId: string,
  boardId: string,
  row: number,
  col: number,
  checked: boolean
) {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: boards.id })
      .from(boards)
      .where(and(eq(boards.id, boardId), eq(boards.userId, userId)));

    if (!existing) {
      return null;
    }

    const [cell] = await tx
      .update(boardCells)
      .set({ checked, checkedAt: checked ? new Date() : null })
      .where(
        and(eq(boardCells.boardId, boardId), eq(boardCells.row, row), eq(boardCells.col, col))
      )
      .returning();

    return cell ?? null;
  });
}
