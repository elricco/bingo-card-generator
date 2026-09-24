import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import "./env";

export async function buildServer() {
  const app = Fastify({ logger: true });

  const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:5173";
  await app.register(cors, {
    origin: webOrigin,
    credentials: true,
  });

  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) {
    throw new Error("SESSION_SECRET ist nicht gesetzt");
  }
  await app.register(cookie, { secret: sessionSecret });

  app.get("/health", async () => ({ status: "ok" }));

  return app;
}

async function main() {
  const app = await buildServer();
  const port = Number(process.env.PORT ?? 3001);
  await app.listen({ port, host: "0.0.0.0" });
}

const isDirectRun = process.argv[1] === new URL(import.meta.url).pathname;
if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
