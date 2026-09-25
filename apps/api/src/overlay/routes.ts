import type { FastifyInstance } from "fastify";
import { getBoardByOverlayToken } from "../db/boards";
import { subscribeToBoard } from "../events/board-events";
import { toPublicBoard } from "./public-board";

export async function registerOverlayRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { token: string } }>("/api/overlay/:token", async (request, reply) => {
    const board = await getBoardByOverlayToken(request.params.token);
    if (!board) {
      return reply.status(404).send();
    }
    return toPublicBoard(board);
  });

  app.get<{ Params: { token: string } }>("/api/overlay/:token/events", async (request, reply) => {
    const board = await getBoardByOverlayToken(request.params.token);
    if (!board) {
      return reply.status(404).send();
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    function send(payload: unknown) {
      reply.raw.write(`event: board-update\ndata: ${JSON.stringify(payload)}\n\n`);
    }

    send(toPublicBoard(board));

    const unsubscribe = subscribeToBoard(board.id, (payload) => {
      send(payload);
    });

    const heartbeat = setInterval(() => {
      reply.raw.write(": heartbeat\n\n");
    }, 30000);

    request.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
      reply.raw.end();
    });
  });
}
