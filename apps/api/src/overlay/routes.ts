import type { FastifyInstance } from "fastify";
import type { OutgoingHttpHeaders } from "node:http";
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
    // reply.getHeaders() typet jeden bekannten Header-Namen (auch reine Request-Header wie
    // "accept") generisch als `number | string | string[] | undefined`, waehrend Node's
    // OutgoingHttpHeaders fuer einzelne Header striktere Typen vorschreibt. Zur Laufzeit sind
    // die von Fastify/Plugins (z.B. @fastify/cors) gesetzten Werte immer gueltige
    // Response-Header-Werte, daher ist die Assertion hier sicher.
    const sseHeaders = {
      ...reply.getHeaders(),
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    } as OutgoingHttpHeaders;
    reply.raw.writeHead(200, sseHeaders);

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
