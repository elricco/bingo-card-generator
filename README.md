# Bingo Card Generator

Web-App für Streamer zum Erstellen, Verwalten und als OBS-Overlay Einbinden eigener Bingo-Karten.

Die vollständige Projektspezifikation (Ziel, Funktionen, Datenmodell, API, Stack, Akzeptanzkriterien) steht in [SPEC.md](./SPEC.md).

## Status

Projekt befindet sich in der Planungsphase. Setup- und Entwicklungsanleitung folgen mit dem initialen Monorepo-Setup (siehe SPEC.md, Abschnitt 10 „Umsetzungsreihenfolge").

## Stack

Vue 3 + TypeScript (Frontend), Fastify + TypeScript (Backend), PostgreSQL + Drizzle ORM, Zod, Server-Sent Events, Docker Compose. Details siehe [SPEC.md](./SPEC.md#3-technischer-stack).
