import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const configuracoesSistema = mysqlTable("voting_config", {
  id: int("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  logo: text("logo"),
  status: mysqlEnum("status", ["open", "closed"]).default("open").notNull(),
  sheetsUrl: text("sheets_url").notNull(),
  sheetsId: varchar("sheets_id", { length: 255 }).notNull(),
  sheetsTab: varchar("sheets_tab", { length: 255 }).notNull(),
  sheetsBaseline: int("sheets_baseline").default(0).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export const grupos = mysqlTable("voting_groups", {
  id: varchar("id", { length: 32 }).primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  logo: text("logo"),
  description: text("description").notNull(),
  active: int("active").default(1).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const votos = mysqlTable("voting_votes", {
  id: varchar("id", { length: 64 }).primaryKey(),
  groupId: varchar("group_id", { length: 32 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  requestId: varchar("request_id", { length: 64 }).unique(),
  synced: int("synced").default(1).notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type SystemConfig = typeof configuracoesSistema.$inferSelect;
export type Group = typeof grupos.$inferSelect;
export type Vote = typeof votos.$inferSelect;
