import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createBoardSchema } from "@bingo/shared";
import { requireAuth } from "../auth/require-auth";
import { createBoardWithCells, listBoardsForUser, getBoardById, deleteBoard } from "../db/boards";

const boardIdParamSchema = z.object({ id: z.string().uuid() });

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
}
