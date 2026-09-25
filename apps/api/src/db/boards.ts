import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "./client";
import { boards, boardCells } from "./schema";
import type { CreateBoardInput } from "@bingo/shared";

export async function createBoardWithCells(userId: string, input: CreateBoardInput) {
  const overlayToken = randomBytes(16).toString("base64url");

  const [board] = await db
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
  await db.insert(boardCells).values(cellRows);

  return board;
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
