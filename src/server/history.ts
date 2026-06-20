import { v4 as uuidv4 } from "uuid";
import { GenerateResult } from "../types/index.js";
import { prisma } from "./db.js";

// ─── Branching conversation tree ───────────────────────────────────────────────
// Persisted in SQLite (one row per node) but reassembled into the same in-memory
// tree shape the front-end already understands (nodes map + children[] arrays),
// so the client and the rest of the server code didn't need to change shape.

export interface ChatNode {
  id: string;
  parentId: string | null;
  children: string[];
  role: "root" | "user" | "assistant";
  content?: string;
  result?: GenerateResult & { images: Array<any> };
  refThumb?: string;
  timestamp: string;
}

export interface Session {
  id: string;
  title: string;
  projectId?: string | null;
  nodes: Record<string, ChatNode>;
  rootId: string;
  activeLeafId: string;
  thumbnail?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SessionSummary {
  id: string;
  title: string;
  projectId?: string | null;
  thumbnail?: string | null;
  turns: number;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  name: string;
  instructions: string;
  color: string;
  createdAt: string;
  updatedAt: string;
}

export interface GalleryImage {
  src: string;
  filename: string;
  prompt: string;
  provider: string;
  width?: number;
  height?: number;
  sessionId: string;
  sessionTitle: string;
  timestamp: string;
}

const PROJECT_COLORS = [
  "#ea580c", "#3b82f6", "#10b981", "#8b5cf6",
  "#ec4899", "#f59e0b", "#06b6d4", "#ef4444",
];

function parseResult(json: string | null): any {
  if (!json) return undefined;
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

export class History {
  // ── Sessions ────────────────────────────────────────────────────────────────

  async getSessions(userId: string): Promise<SessionSummary[]> {
    const sessions = await prisma.chatSession.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      include: { _count: { select: { nodes: true } } },
    });
    return sessions.map((s) => ({
      id: s.id,
      title: s.title,
      projectId: s.projectId,
      thumbnail: s.thumbnail,
      turns: Math.max(0, Math.floor((s._count.nodes - 1) / 2)),
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    }));
  }

  /** Full session with a guaranteed tree, scoped to its owner. */
  async getSession(userId: string, id: string): Promise<Session | null> {
    const row = await prisma.chatSession.findFirst({ where: { id, userId } });
    if (!row) return null;
    const rows = await prisma.chatNode.findMany({ where: { sessionId: id } });
    const nodes: Record<string, ChatNode> = {};
    for (const n of rows) {
      nodes[n.id] = {
        id: n.id,
        parentId: n.parentId,
        children: [],
        role: n.role as ChatNode["role"],
        content: n.content ?? undefined,
        result: parseResult(n.resultJson),
        refThumb: n.refThumb ?? undefined,
        timestamp: n.timestamp.toISOString(),
      };
    }
    for (const n of rows) {
      if (n.parentId && nodes[n.parentId]) nodes[n.parentId].children.push(n.id);
    }
    return {
      id: row.id,
      title: row.title,
      projectId: row.projectId,
      nodes,
      rootId: row.rootId!,
      activeLeafId: row.activeLeafId!,
      thumbnail: row.thumbnail,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /**
   * Append a user prompt + assistant result as a new turn.
   * `parentNodeId` controls branching: omit (or pass the active leaf) for a normal
   * next turn; pass the parent of an earlier user node to fork a sibling branch.
   */
  async addGeneration(
    userId: string,
    sessionId: string | null | undefined,
    prompt: string,
    result: any,
    opts: { parentNodeId?: string | null; refThumb?: string; projectId?: string | null } = {}
  ): Promise<{ session: Session; userNodeId: string; assistantNodeId: string }> {
    let session = sessionId ? await this.getSession(userId, sessionId) : null;
    if (!session) session = await this.create(userId, prompt, opts.projectId);

    const parentId =
      (opts.parentNodeId && session.nodes[opts.parentNodeId] && opts.parentNodeId) ||
      session.activeLeafId ||
      session.rootId;

    const now = new Date();
    const userNodeId = uuidv4();
    const assistantNodeId = uuidv4();

    await prisma.chatNode.create({
      data: {
        id: userNodeId,
        sessionId: session.id,
        parentId,
        role: "user",
        content: prompt,
        refThumb: opts.refThumb,
        timestamp: now,
      },
    });
    await prisma.chatNode.create({
      data: {
        id: assistantNodeId,
        sessionId: session.id,
        parentId: userNodeId,
        role: "assistant",
        resultJson: JSON.stringify(result),
        timestamp: new Date(now.getTime() + 1),
      },
    });

    const firstImg = result?.images?.[0];
    const thumbnail = firstImg?.filename ? "/output/" + firstImg.filename : session.thumbnail;

    await prisma.chatSession.update({
      where: { id: session.id },
      data: { activeLeafId: assistantNodeId, thumbnail, updatedAt: new Date() },
    });

    const fresh = await this.getSession(userId, session.id);
    return { session: fresh!, userNodeId, assistantNodeId };
  }

  /** Activate a branch by id — walks to its most-recent leaf and sets the active path. */
  async setActiveLeaf(userId: string, sessionId: string, nodeId: string): Promise<Session | null> {
    const session = await this.getSession(userId, sessionId);
    if (!session || !session.nodes[nodeId]) return null;
    const leaf = this.deepestLeaf(session, nodeId);
    await prisma.chatSession.update({
      where: { id: sessionId },
      data: { activeLeafId: leaf, updatedAt: new Date() },
    });
    return this.getSession(userId, sessionId);
  }

  private deepestLeaf(session: Session, nodeId: string): string {
    let cur = nodeId;
    while (session.nodes[cur]?.children.length) {
      cur = session.nodes[cur].children[session.nodes[cur].children.length - 1];
    }
    return cur;
  }

  private async create(userId: string, title: string, projectId?: string | null): Promise<Session> {
    const id = uuidv4();
    const rootId = uuidv4();
    const now = new Date();
    await prisma.chatSession.create({
      data: {
        id,
        userId,
        projectId: projectId ?? null,
        title: (title || "New chat").replace(/\n/g, " ").substring(0, 60),
        rootId,
        activeLeafId: rootId,
        createdAt: now,
        updatedAt: now,
      },
    });
    await prisma.chatNode.create({
      data: { id: rootId, sessionId: id, parentId: null, role: "root", timestamp: now },
    });
    return (await this.getSession(userId, id))!;
  }

  async deleteSession(userId: string, id: string): Promise<void> {
    await prisma.chatSession.deleteMany({ where: { id, userId } });
  }

  async renameSession(userId: string, id: string, title: string): Promise<Session | null> {
    const owned = await prisma.chatSession.findFirst({ where: { id, userId } });
    if (!owned) return null;
    await prisma.chatSession.update({
      where: { id },
      data: { title: title.replace(/\n/g, " ").substring(0, 80), updatedAt: new Date() },
    });
    return this.getSession(userId, id);
  }

  async assignSession(userId: string, id: string, projectId: string | null): Promise<Session | null> {
    const owned = await prisma.chatSession.findFirst({ where: { id, userId } });
    if (!owned) return null;
    await prisma.chatSession.update({ where: { id }, data: { projectId, updatedAt: new Date() } });
    return this.getSession(userId, id);
  }

  /** Every generated image across all of this user's chats, newest first — powers the Gallery view. */
  async getAllImages(userId: string): Promise<GalleryImage[]> {
    const sessions = await prisma.chatSession.findMany({
      where: { userId },
      select: { id: true, title: true },
    });
    const byId = new Map(sessions.map((s) => [s.id, s.title]));
    if (!sessions.length) return [];
    const nodes = await prisma.chatNode.findMany({
      where: { sessionId: { in: sessions.map((s) => s.id) }, role: "assistant" },
      orderBy: { timestamp: "desc" },
    });
    const images: GalleryImage[] = [];
    for (const n of nodes) {
      const result = parseResult(n.resultJson);
      for (const img of result?.images || []) {
        if (!img?.filename) continue;
        images.push({
          src: "/output/" + img.filename,
          filename: img.filename,
          prompt: result.prompt || "",
          provider: result.provider || "",
          width: img.width,
          height: img.height,
          sessionId: n.sessionId,
          sessionTitle: byId.get(n.sessionId) || "Untitled",
          timestamp: n.timestamp.toISOString(),
        });
      }
    }
    return images;
  }

  // ── Projects ──────────────────────────────────────────────────────────────────

  async getProjects(userId: string): Promise<Project[]> {
    const rows = await prisma.chatProject.findMany({ where: { userId }, orderBy: { updatedAt: "desc" } });
    return rows.map((p) => ({
      id: p.id,
      name: p.name,
      instructions: p.instructions,
      color: p.color,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    }));
  }

  async getProject(userId: string, id: string): Promise<Project | null> {
    const p = await prisma.chatProject.findFirst({ where: { id, userId } });
    if (!p) return null;
    return {
      id: p.id,
      name: p.name,
      instructions: p.instructions,
      color: p.color,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  }

  async createProject(userId: string, name: string, color?: string): Promise<Project> {
    const existing = await prisma.chatProject.count({ where: { userId } });
    const p = await prisma.chatProject.create({
      data: {
        userId,
        name: (name || "New project").substring(0, 60),
        color: color || PROJECT_COLORS[existing % PROJECT_COLORS.length],
      },
    });
    return {
      id: p.id,
      name: p.name,
      instructions: p.instructions,
      color: p.color,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  }

  async updateProject(
    userId: string,
    id: string,
    patch: Partial<Pick<Project, "name" | "instructions" | "color">>
  ): Promise<Project | null> {
    const owned = await prisma.chatProject.findFirst({ where: { id, userId } });
    if (!owned) return null;
    const data: any = {};
    if (patch.name !== undefined) data.name = patch.name.substring(0, 60);
    if (patch.instructions !== undefined) data.instructions = patch.instructions;
    if (patch.color !== undefined) data.color = patch.color;
    const p = await prisma.chatProject.update({ where: { id }, data });
    return {
      id: p.id,
      name: p.name,
      instructions: p.instructions,
      color: p.color,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  }

  async deleteProject(userId: string, id: string): Promise<void> {
    await prisma.chatProject.deleteMany({ where: { id, userId } });
    // Sessions detach automatically (onDelete: SetNull on ChatSession.projectId).
  }
}

export const history = new History();
