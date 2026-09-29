import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import "./env";
import { registerAuthRoutes } from "./auth/routes";
import { registerBoardRoutes } from "./boards/routes";
import { registerOverlayRoutes } from "./overlay/routes";
import type { OAuthProvider } from "./auth/types";
import { createE2EProvider, registerE2ERoutes } from "./e2e/setup";

export interface BuildServerOptions {
  authProvider?: OAuthProvider;
}

export async function buildServer(options: BuildServerOptions = {}) {
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
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: "Zu viele Anfragen — bitte kurz warten.",
    }),
  });

  app.get("/health", async () => ({ status: "ok" }));

  await registerAuthRoutes(app, { provider: options.authProvider });
  await registerBoardRoutes(app);
  await registerOverlayRoutes(app);

  return app;
}

async function main() {
  const isE2ETestMode = process.env.E2E_TEST_MODE === "1";
  if (isE2ETestMode) {
    console.warn(
      "E2E_TEST_MODE aktiv — Fake-Login-Routen (/e2e/*) sind registriert. Niemals in Produktion verwenden."
    );
  }
  const app = await buildServer(isE2ETestMode ? { authProvider: createE2EProvider() } : {});
  if (isE2ETestMode) {
    await registerE2ERoutes(app);
  }
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
