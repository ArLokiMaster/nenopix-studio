import path from "path";
import os from "os";
import fs from "fs-extra";
import Database from "better-sqlite3";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../generated/prisma/client";

const DB_DIR = path.join(os.homedir(), ".nenopix");
const DB_FILE = path.join(DB_DIR, "nenopix.db");

// Idempotent schema bootstrap — mirrors prisma/migrations/*/migration.sql exactly.
// Applied with a plain better-sqlite3 handle so the app never has to shell out to
// the Prisma migrate engine at runtime; the typed PrismaClient below just talks
// to tables that are already guaranteed to exist.
function ensureSchema(dbFile: string): void {
  fs.ensureDirSync(DB_DIR);
  const raw = new Database(dbFile);
  raw.pragma("journal_mode = WAL");
  raw.pragma("foreign_keys = ON");
  raw.exec(`
    CREATE TABLE IF NOT EXISTS "AppSetting" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
      "authMode" TEXT NOT NULL DEFAULT 'solo'
    );

    CREATE TABLE IF NOT EXISTS "User" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "username" TEXT NOT NULL,
      "passwordHash" TEXT,
      "role" TEXT NOT NULL DEFAULT 'MEMBER',
      "allowedProviders" TEXT NOT NULL DEFAULT '[]',
      "costLimit" REAL,
      "costUsed" REAL NOT NULL DEFAULT 0,
      "genLimit" INTEGER,
      "genUsed" INTEGER NOT NULL DEFAULT 0,
      "isActive" BOOLEAN NOT NULL DEFAULT true,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "User_username_key" ON "User"("username");

    CREATE TABLE IF NOT EXISTS "ChatProject" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "instructions" TEXT NOT NULL DEFAULT '',
      "color" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      CONSTRAINT "ChatProject_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    );
    CREATE INDEX IF NOT EXISTS "ChatProject_userId_idx" ON "ChatProject"("userId");

    CREATE TABLE IF NOT EXISTS "ChatSession" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "projectId" TEXT,
      "title" TEXT NOT NULL,
      "thumbnail" TEXT,
      "rootId" TEXT,
      "activeLeafId" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      CONSTRAINT "ChatSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "ChatSession_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ChatProject" ("id") ON DELETE SET NULL ON UPDATE CASCADE
    );
    CREATE INDEX IF NOT EXISTS "ChatSession_userId_idx" ON "ChatSession"("userId");
    CREATE INDEX IF NOT EXISTS "ChatSession_projectId_idx" ON "ChatSession"("projectId");

    CREATE TABLE IF NOT EXISTS "ChatNode" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "sessionId" TEXT NOT NULL,
      "parentId" TEXT,
      "role" TEXT NOT NULL,
      "content" TEXT,
      "resultJson" TEXT,
      "refThumb" TEXT,
      "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "ChatNode_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChatSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    );
    CREATE INDEX IF NOT EXISTS "ChatNode_sessionId_idx" ON "ChatNode"("sessionId");
    CREATE INDEX IF NOT EXISTS "ChatNode_parentId_idx" ON "ChatNode"("parentId");

    INSERT OR IGNORE INTO "AppSetting" ("id", "authMode") VALUES (1, 'solo');
  `);
  raw.close();
}

ensureSchema(DB_FILE);

const adapter = new PrismaBetterSqlite3({ url: DB_FILE });
export const prisma = new PrismaClient({ adapter });
export const DB_FILE_PATH = DB_FILE;
