import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createBoardSchema, patchBoardSchema, validateLabelConfig } from "@bingo/shared";
import { requireAuth } from "../auth/require-auth";
import {
  createBoardWithCells,
  listBoardsForUser,
  getBoardById,
  deleteBoard,
  updateBoard,
  setCellChecked,
} from "../db/boards";

const boardIdParamSchema = z.object({ id: z.string().uuid() });
const cellCheckedParamsSchema = z.object({
  id: z.string().uuid(),
  row: z.coerce.number().int().min(0),
  col: z.coerce.number().int().min(0),
});
const cellCheckedBodySchema = z.object({ checked: z.boolean() });

export async function registerBoardRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/boards", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) {
      return;
    }

    const parseResult = createBoardSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply
        .status(400)
        .send({ error: "Ungültige Eingabe", details: parseResult.error.flatten() });
    }

    const board = await createBoardWithCells(user.id, parseResult.data);
    return reply.status(201).send(board);
  });

  app.get("/api/boards", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) {
      return;
    }

    return listBoardsForUser(user.id);
  });

  app.get<{ Params: { id: string } }>("/api/boards/:id", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) {
      return;
    }

    const paramsResult = boardIdParamSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(404).send({ error: "Board nicht gefunden" });
    }

    const board = await getBoardById(user.id, paramsResult.data.id);
    if (!board) {
      return reply.status(404).send({ error: "Board nicht gefunden" });
    }
    return board;
  });

  app.patch<{ Params: { id: string } }>("/api/boards/:id", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) {
      return;
    }

    const paramsResult = boardIdParamSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(404).send({ error: "Board nicht gefunden" });
    }

    const bodyResult = patchBoardSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply
        .status(400)
        .send({ error: "Ungültige Eingabe", details: bodyResult.error.flatten() });
    }

    const existingBoard = await getBoardById(user.id, paramsResult.data.id);
    if (!existingBoard) {
      return reply.status(404).send({ error: "Board nicht gefunden" });
    }

    const effectiveLabelMode = bodyResult.data.label_mode ?? existingBoard.labelMode;
    const effectiveColumnLabels =
      bodyResult.data.column_labels ??
      (effectiveLabelMode === "custom" ? existingBoard.columnLabels ?? undefined : undefined);
    const labelError = validateLabelConfig(
      existingBoard.size,
      effectiveLabelMode,
      effectiveColumnLabels
    );
    if (labelError) {
      return reply.status(400).send({
        error: "Ungültige Eingabe",
        details: { formErrors: [], fieldErrors: { [labelError.path]: [labelError.message] } },
      });
    }

    if (bodyResult.data.cells) {
      const outOfBounds = bodyResult.data.cells.some(
        (cell) => cell.row >= existingBoard.size || cell.col >= existingBoard.size
      );
      if (outOfBounds) {
        return reply.status(400).send({
          error: "Ungültige Eingabe",
          details: { formErrors: ["Zellkoordinaten außerhalb des Boards"], fieldErrors: {} },
        });
      }
    }

    const updated = await updateBoard(user.id, paramsResult.data.id, bodyResult.data);
    if (!updated) {
      return reply.status(404).send({ error: "Board nicht gefunden" });
    }
    return updated;
  });

  app.delete<{ Params: { id: string } }>("/api/boards/:id", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) {
      return;
    }

    const paramsResult = boardIdParamSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(404).send({ error: "Board nicht gefunden" });
    }

    const deleted = await deleteBoard(user.id, paramsResult.data.id);
    if (!deleted) {
      return reply.status(404).send({ error: "Board nicht gefunden" });
    }
    return reply.status(204).send();
  });

  app.put<{ Params: { id: string; row: string; col: string } }>(
    "/api/boards/:id/cells/:row/:col/checked",
    async (request, reply) => {
      const user = await requireAuth(request, reply);
      if (!user) {
        return;
      }

      const paramsResult = cellCheckedParamsSchema.safeParse(request.params);
      if (!paramsResult.success) {
        return reply.status(404).send({ error: "Board nicht gefunden" });
      }

      const bodyResult = cellCheckedBodySchema.safeParse(request.body);
      if (!bodyResult.success) {
        return reply
          .status(400)
          .send({ error: "Ungültige Eingabe", details: bodyResult.error.flatten() });
      }

      const existingBoard = await getBoardById(user.id, paramsResult.data.id);
      if (!existingBoard) {
        return reply.status(404).send({ error: "Board nicht gefunden" });
      }

      if (
        paramsResult.data.row >= existingBoard.size ||
        paramsResult.data.col >= existingBoard.size
      ) {
        return reply.status(400).send({
          error: "Ungültige Eingabe",
          details: { formErrors: ["Zellkoordinaten außerhalb des Boards"], fieldErrors: {} },
        });
      }

      const updatedCell = await setCellChecked(
        user.id,
        paramsResult.data.id,
        paramsResult.data.row,
        paramsResult.data.col,
        bodyResult.data.checked
      );
      if (!updatedCell) {
        return reply.status(404).send({ error: "Board nicht gefunden" });
      }
      return updatedCell;
    }
  );
}
