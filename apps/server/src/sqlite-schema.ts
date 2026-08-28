import { integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const rooms = sqliteTable("rooms", {
  roomId: text("room_id").primaryKey(),
  roomCode: text("room_code").notNull(),
  createdAtMs: integer("created_at_ms").notNull(),
  updatedAtMs: integer("updated_at_ms").notNull(),
});

export const roomsRoomCodeIndex = uniqueIndex("rooms_room_code_unique").on(rooms.roomCode);

export const snapshots = sqliteTable("snapshots", {
  roomId: text("room_id")
    .primaryKey()
    .references(() => rooms.roomId, { onDelete: "cascade" }),
  revision: integer("revision").notNull(),
  stateJson: text("state_json").notNull(),
  updatedAtMs: integer("updated_at_ms").notNull(),
});

export const sessions = sqliteTable(
  "sessions",
  {
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.roomId, { onDelete: "cascade" }),
    seatId: text("seat_id").notNull(),
    sessionGeneration: integer("session_generation").notNull(),
    secretDigest: text("secret_digest").notNull(),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
    revokedAtMs: integer("revoked_at_ms"),
  },
  (table) => [primaryKey({ columns: [table.roomId, table.seatId] })],
);

export const domainEvents = sqliteTable("domain_events", {
  eventId: integer("event_id").primaryKey({ autoIncrement: true }),
  roomId: text("room_id")
    .notNull()
    .references(() => rooms.roomId, { onDelete: "cascade" }),
  revision: integer("revision").notNull(),
  eventIndex: integer("event_index").notNull(),
  eventType: text("event_type").notNull(),
  eventJson: text("event_json").notNull(),
  createdAtMs: integer("created_at_ms").notNull(),
});

export const commandReceipts = sqliteTable(
  "command_receipts",
  {
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.roomId, { onDelete: "cascade" }),
    seatId: text("seat_id").notNull(),
    sessionGeneration: integer("session_generation").notNull(),
    commandId: text("command_id").notNull(),
    payloadHash: text("payload_hash").notNull(),
    status: text("status", { enum: ["accepted", "rejected"] }).notNull(),
    revision: integer("revision").notNull(),
    commandType: text("command_type").notNull(),
    rejectionCode: text("rejection_code"),
  },
  (table) => [
    primaryKey({
      columns: [table.roomId, table.seatId, table.sessionGeneration, table.commandId],
    }),
  ],
);

export const timers = sqliteTable("timers", {
  roomId: text("room_id")
    .notNull()
    .references(() => rooms.roomId, { onDelete: "cascade" }),
  timerId: text("timer_id").notNull(),
  timerIndex: integer("timer_index").notNull(),
  kind: text("kind", { enum: ["snapWindow", "reconnectGrace", "emptyRoomTtl"] }).notNull(),
  generation: integer("generation").notNull(),
  dueAtMs: integer("due_at_ms").notNull(),
  seatId: text("seat_id"),
  windowId: text("window_id"),
  remainingMs: integer("remaining_ms"),
}, (table) => [
  primaryKey({ columns: [table.roomId, table.timerId] }),
]);

export const sqliteSchema = {
  rooms,
  snapshots,
  sessions,
  domainEvents,
  commandReceipts,
  timers,
};
