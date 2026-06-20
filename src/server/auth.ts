import fs from "fs-extra";
import path from "path";
import os from "os";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "./db.js";

const SECRET_FILE = path.join(os.homedir(), ".nenopix", ".jwt-secret");

function getJwtSecret(): string {
  fs.ensureDirSync(path.dirname(SECRET_FILE));
  if (fs.existsSync(SECRET_FILE)) return fs.readFileSync(SECRET_FILE, "utf-8").trim();
  const secret = crypto.randomBytes(48).toString("hex");
  fs.writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
  return secret;
}
const JWT_SECRET = getJwtSecret();

export interface AuthUser {
  id: string;
  username: string;
  role: "SUPER_ADMIN" | "MEMBER";
  allowedProviders: string[];
  costLimit: number | null;
  costUsed: number;
  genLimit: number | null;
  genUsed: number;
  isActive: boolean;
}

function toAuthUser(u: any): AuthUser {
  let allowed: string[] = [];
  try {
    allowed = JSON.parse(u.allowedProviders || "[]");
  } catch {
    allowed = [];
  }
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    allowedProviders: allowed,
    costLimit: u.costLimit,
    costUsed: u.costUsed,
    genLimit: u.genLimit,
    genUsed: u.genUsed,
    isActive: u.isActive,
  };
}

export async function getAuthMode(): Promise<"solo" | "team"> {
  const row = await prisma.appSetting.findUnique({ where: { id: 1 } });
  return (row?.authMode as "solo" | "team") || "solo";
}

export async function needsSetup(): Promise<boolean> {
  const count = await prisma.user.count();
  return count === 0;
}

const SOLO_OWNER_USERNAME = "owner";

/** Solo mode: create (or fetch) the single local owner — no password, no login screen. */
export async function ensureSoloOwner(): Promise<AuthUser> {
  let owner = await prisma.user.findUnique({ where: { username: SOLO_OWNER_USERNAME } });
  if (!owner) {
    owner = await prisma.user.create({
      data: { username: SOLO_OWNER_USERNAME, role: "SUPER_ADMIN", passwordHash: null },
    });
  }
  return toAuthUser(owner);
}

export async function setupSolo(): Promise<{ user: AuthUser; token: string | null }> {
  await prisma.appSetting.upsert({
    where: { id: 1 },
    update: { authMode: "solo" },
    create: { id: 1, authMode: "solo" },
  });
  const user = await ensureSoloOwner();
  return { user, token: null }; // solo mode never needs a bearer token
}

export async function setupTeam(
  username: string,
  password: string
): Promise<{ user: AuthUser; token: string }> {
  await prisma.appSetting.upsert({
    where: { id: 1 },
    update: { authMode: "team" },
    create: { id: 1, authMode: "team" },
  });
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { username, passwordHash, role: "SUPER_ADMIN" },
  });
  const authUser = toAuthUser(user);
  return { user: authUser, token: signToken(authUser) };
}

export function signToken(user: AuthUser): string {
  return jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: "30d" });
}

export async function login(
  username: string,
  password: string
): Promise<{ user: AuthUser; token: string } | null> {
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || !user.passwordHash || !user.isActive) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return null;
  const authUser = toAuthUser(user);
  return { user: authUser, token: signToken(authUser) };
}

export async function getUserById(id: string): Promise<AuthUser | null> {
  const user = await prisma.user.findUnique({ where: { id } });
  return user ? toAuthUser(user) : null;
}

export function verifyToken(token: string): { sub: string } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as { sub: string };
  } catch {
    return null;
  }
}

// ── Sub-account management (SUPER_ADMIN only) ─────────────────────────────────

export async function listUsers(): Promise<AuthUser[]> {
  const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });
  return users.map(toAuthUser);
}

export async function createSubUser(opts: {
  username: string;
  password: string;
  allowedProviders?: string[];
  costLimit?: number | null;
  genLimit?: number | null;
}): Promise<AuthUser> {
  const passwordHash = await bcrypt.hash(opts.password, 10);
  const user = await prisma.user.create({
    data: {
      username: opts.username,
      passwordHash,
      role: "MEMBER",
      allowedProviders: JSON.stringify(opts.allowedProviders || []),
      costLimit: opts.costLimit ?? null,
      genLimit: opts.genLimit ?? null,
    },
  });
  return toAuthUser(user);
}

export async function updateUser(
  id: string,
  patch: Partial<{
    allowedProviders: string[];
    costLimit: number | null;
    genLimit: number | null;
    isActive: boolean;
    password: string;
  }>
): Promise<AuthUser> {
  const data: any = {};
  if (patch.allowedProviders !== undefined) data.allowedProviders = JSON.stringify(patch.allowedProviders);
  if (patch.costLimit !== undefined) data.costLimit = patch.costLimit;
  if (patch.genLimit !== undefined) data.genLimit = patch.genLimit;
  if (patch.isActive !== undefined) data.isActive = patch.isActive;
  if (patch.password) data.passwordHash = await bcrypt.hash(patch.password, 10);
  const user = await prisma.user.update({ where: { id }, data });
  return toAuthUser(user);
}

export async function deleteUser(id: string): Promise<void> {
  await prisma.user.delete({ where: { id } });
}

// ── Quota enforcement ──────────────────────────────────────────────────────────

export function checkQuota(user: AuthUser): { ok: boolean; reason?: string } {
  if (user.role === "SUPER_ADMIN") return { ok: true };
  if (user.genLimit != null && user.genUsed >= user.genLimit) {
    return { ok: false, reason: `Generation limit reached (${user.genUsed}/${user.genLimit}). Ask your admin to raise it.` };
  }
  if (user.costLimit != null && user.costUsed >= user.costLimit) {
    return { ok: false, reason: `Spending limit reached ($${user.costUsed.toFixed(4)}/$${user.costLimit.toFixed(2)}). Ask your admin to raise it.` };
  }
  return { ok: true };
}

export function providerAllowed(user: AuthUser, providerId: string): boolean {
  if (user.role === "SUPER_ADMIN") return true;
  if (!user.allowedProviders.length) return true; // empty = no restriction
  return user.allowedProviders.includes(providerId);
}

export async function recordUsage(userId: string, cost: number): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { genUsed: { increment: 1 }, costUsed: { increment: cost || 0 } },
  });
}
