import {
  pgTable,
  uuid,
  text,
  smallint,
  boolean,
  timestamp,
  jsonb,
  primaryKey,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  twitchId: text("twitch_id").notNull().unique(),
  login: text("login").notNull(),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const boards = pgTable(
  "boards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    size: smallint("size").notNull(),
    labelMode: text("label_mode").notNull(),
    columnLabels: jsonb("column_labels").$type<string[] | null>(),
    overlayToken: text("overlay_token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    sizeCheck: check("boards_size_check", sql`${table.size} IN (3, 5, 7, 9)`),
    labelModeCheck: check(
      "boards_label_mode_check",
      sql`${table.labelMode} IN ('letters', 'bingo', 'custom')`
    ),
  })
);

export const boardCells = pgTable(
  "board_cells",
  {
    boardId: uuid("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    row: smallint("row").notNull(),
    col: smallint("col").notNull(),
    text: text("text").notNull().default(""),
    checked: boolean("checked").notNull().default(false),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.boardId, table.row, table.col] }),
  })
);

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
