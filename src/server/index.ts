import express from "express";
import http from "http";
import { Server as SocketServer, Socket } from "socket.io";
import path from "path";
import os from "os";
import fs from "fs-extra";
import { execFile } from "child_process";
import chalk from "chalk";
import open from "open";
import { engine as forgeEngine } from "../core/engine.js";
import { registry } from "../core/provider-registry.js";
import { promptAgent } from "../core/prompt-agent.js";
import { config } from "../storage/config.js";
import { credentialStore } from "../storage/credentials.js";
import { history } from "./history.js";
import { GenerateOptions } from "../types/index.js";
import {
  AuthUser,
  checkQuota,
  createSubUser,
  deleteUser,
  ensureSoloOwner,
  getAuthMode,
  getUserById,
  listUsers,
  login,
  needsSetup,
  providerAllowed,
  recordUsage,
  setupSolo,
  setupTeam,
  updateUser,
  verifyToken,
} from "./auth.js";

// Opens the native OS folder-picker. Windows only for now (via PowerShell);
// other platforms fall back to manual path entry in the UI.
function pickFolderNative(initialDir?: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (process.platform !== "win32") return resolve(null);
    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      $f = New-Object System.Windows.Forms.FolderBrowserDialog
      $f.Description = "Choose an output folder"
      ${initialDir ? `if (Test-Path "${initialDir.replace(/"/g, '`"')}") { $f.SelectedPath = "${initialDir.replace(/"/g, '`"')}" }` : ""}
      if ($f.ShowDialog() -eq "OK") { Write-Output $f.SelectedPath }
    `;
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { timeout: 60000 },
      (err, stdout) => {
        if (err) return resolve(null);
        const out = stdout.trim();
        resolve(out || null);
      }
    );
  });
}

// Validates a directory is usable as an output location: creatable + writable.
async function checkOutputDir(dir: string): Promise<{ success: boolean; message: string }> {
  try {
    if (!dir || !dir.trim()) return { success: false, message: "Path can't be empty" };
    await fs.ensureDir(dir);
    const probe = path.join(dir, `.imageforge-write-test-${Date.now()}`);
    await fs.writeFile(probe, "ok");
    await fs.remove(probe);
    return { success: true, message: "Folder is ready for output" };
  } catch (err: any) {
    return { success: false, message: err?.message || "Folder isn't writable" };
  }
}

function publicUser(u: AuthUser) {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    allowedProviders: u.allowedProviders,
    costLimit: u.costLimit,
    costUsed: u.costUsed,
    genLimit: u.genLimit,
    genUsed: u.genUsed,
    isActive: u.isActive,
  };
}

export async function startServer(
  port = 7842,
  autoOpen = true
): Promise<void> {
  const app = express();
  app.use(express.json());
  const httpServer = http.createServer(app);
  // Allow large payloads for reference-image uploads (base64 data URLs).
  const io = new SocketServer(httpServer, {
    cors: { origin: "*" },
    maxHttpBufferSize: 2.5e7, // ~25MB
  });

  // ── Static assets ────────────────────────────────────────────────────
  app.use(express.static(path.join(__dirname, "../web")));

  // Serve generated images
  app.use("/output", (req, res, next) => {
    const outputDir = config.get("outputDir");
    express.static(outputDir)(req, res, next);
  });

  // ── REST auth helpers ───────────────────────────────────────────────────
  async function userFromRequest(req: express.Request): Promise<AuthUser | null> {
    const mode = await getAuthMode();
    if (mode === "solo") return ensureSoloOwner();
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return null;
    const payload = verifyToken(token);
    if (!payload) return null;
    return getUserById(payload.sub);
  }
  function requireAdmin(handler: (req: express.Request, res: express.Response, user: AuthUser) => any) {
    return async (req: express.Request, res: express.Response) => {
      const user = await userFromRequest(req);
      if (!user) return res.status(401).json({ error: "Not authenticated" });
      if (user.role !== "SUPER_ADMIN") return res.status(403).json({ error: "Admin only" });
      try {
        await handler(req, res, user);
      } catch (err: any) {
        res.status(500).json({ error: err?.message || "Server error" });
      }
    };
  }

  // ── Auth + setup REST routes ────────────────────────────────────────────
  app.get("/api/auth/status", async (_req, res) => {
    res.json({ needsSetup: await needsSetup(), authMode: await getAuthMode() });
  });

  app.post("/api/auth/setup", async (req, res) => {
    try {
      if (!(await needsSetup())) return res.status(400).json({ error: "Setup already completed" });
      const { mode, username, password } = req.body || {};
      if (mode === "solo") {
        const { user } = await setupSolo();
        return res.json({ user: publicUser(user), token: null });
      }
      if (mode === "team") {
        if (!username || !password || password.length < 6) {
          return res.status(400).json({ error: "Username and a password of 6+ characters are required" });
        }
        const { user, token } = await setupTeam(username.trim(), password);
        return res.json({ user: publicUser(user), token });
      }
      return res.status(400).json({ error: "mode must be 'solo' or 'team'" });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Setup failed" });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: "Username and password required" });
    const result = await login(username.trim(), password);
    if (!result) return res.status(401).json({ error: "Invalid username or password" });
    res.json({ user: publicUser(result.user), token: result.token });
  });

  app.get("/api/auth/me", async (req, res) => {
    const user = await userFromRequest(req);
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    res.json({ user: publicUser(user) });
  });

  // ── Sub-account management (SUPER_ADMIN only) ───────────────────────────
  app.get("/api/users", requireAdmin(async (_req, res) => {
    res.json({ users: (await listUsers()).map(publicUser) });
  }));

  app.post("/api/users", requireAdmin(async (req, res) => {
    const { username, password, allowedProviders, costLimit, genLimit } = req.body || {};
    if (!username || !password || password.length < 6) {
      return res.status(400).json({ error: "Username and a password of 6+ characters are required" });
    }
    const user = await createSubUser({
      username: String(username).trim(),
      password,
      allowedProviders: Array.isArray(allowedProviders) ? allowedProviders : [],
      costLimit: costLimit != null && costLimit !== "" ? Number(costLimit) : null,
      genLimit: genLimit != null && genLimit !== "" ? Number(genLimit) : null,
    });
    res.json({ user: publicUser(user) });
  }));

  app.patch("/api/users/:id", requireAdmin(async (req, res, admin) => {
    const targetId = String(req.params.id);
    if (targetId === admin.id) return res.status(400).json({ error: "Use account settings to edit yourself" });
    const { allowedProviders, costLimit, genLimit, isActive, password } = req.body || {};
    const user = await updateUser(targetId, {
      allowedProviders: Array.isArray(allowedProviders) ? allowedProviders : undefined,
      costLimit: costLimit !== undefined ? (costLimit === "" ? null : Number(costLimit)) : undefined,
      genLimit: genLimit !== undefined ? (genLimit === "" ? null : Number(genLimit)) : undefined,
      isActive: typeof isActive === "boolean" ? isActive : undefined,
      password: password || undefined,
    });
    res.json({ user: publicUser(user) });
  }));

  app.delete("/api/users/:id", requireAdmin(async (req, res, admin) => {
    const targetId = String(req.params.id);
    if (targetId === admin.id) return res.status(400).json({ error: "You can't delete your own account" });
    await deleteUser(targetId);
    res.json({ ok: true });
  }));

  // Strip heavy base64 payloads before persisting / sending over the wire —
  // the browser loads images from /output/<filename> instead.
  const slimResult = (result: any) => ({
    ...result,
    images: (result.images || []).map((img: any) => {
      const { base64, ...rest } = img;
      return { ...rest, filename: img.path ? path.basename(img.path) : img.filename };
    }),
  });

  // ── Socket.io auth ───────────────────────────────────────────────────────
  io.use(async (socket, next) => {
    try {
      if (await needsSetup()) return next(new Error("setup_required"));
      const mode = await getAuthMode();
      if (mode === "solo") {
        socket.data.user = await ensureSoloOwner();
        return next();
      }
      const token = (socket.handshake.auth as any)?.token;
      const payload = token && verifyToken(token);
      const user = payload ? await getUserById(payload.sub) : null;
      if (!user || !user.isActive) return next(new Error("unauthorized"));
      socket.data.user = user;
      next();
    } catch (err: any) {
      next(new Error("unauthorized"));
    }
  });

  // ── Socket.io ─────────────────────────────────────────────────────────
  // A thrown error inside any handler below would otherwise crash the whole
  // CLI process (and every other open browser tab/session with it).
  const safe = (fn: (...args: any[]) => any) => async (...args: any[]) => {
    try {
      await fn(...args);
    } catch (err: any) {
      console.error(chalk.red("[socket handler error]"), err?.stack || err?.message || err);
    }
  };

  io.on("connection", (socket: Socket) => {
    const user: AuthUser = socket.data.user;
    const userId = user.id;
    const visibleProviders = async () => {
      const all = await registry.getAllInfo();
      if (user.role === "SUPER_ADMIN" || !user.allowedProviders.length) return all;
      return all.filter((p) => user.allowedProviders.includes(p.id));
    };

    socket.emit("auth:me", publicUser(user));

    // Providers (includes `features` + `models`, used by the UI to gate controls)
    socket.on("get:providers", safe(async () => {
      socket.emit("providers:data", await visibleProviders());
    }));

    socket.on("get:config", safe(() => socket.emit("config:data", config.getAll())));

    socket.on("get:models", safe(async (providerId: string) => {
      if (!providerAllowed(user, providerId)) return;
      const provider = registry.get(providerId);
      if (!provider) return;
      socket.emit("models:data", await provider.listModels());
    }));

    // ── Sessions ──────────────────────────────────────────────────────
    socket.on("get:sessions", safe(async () => {
      socket.emit("sessions:data", await history.getSessions(userId));
    }));

    socket.on("get:session", safe(async (id: string) => {
      const session = await history.getSession(userId, id);
      if (session) socket.emit("session:data", session);
    }));

    socket.on("delete:session", safe(async (id: string) => {
      await history.deleteSession(userId, id);
      socket.emit("sessions:data", await history.getSessions(userId));
    }));

    socket.on("rename:session", safe(async ({ id, title }: { id: string; title: string }) => {
      await history.renameSession(userId, id, title);
      socket.emit("sessions:data", await history.getSessions(userId));
    }));

    socket.on("session:assign", safe(async ({ id, projectId }: { id: string; projectId: string | null }) => {
      await history.assignSession(userId, id, projectId);
      socket.emit("sessions:data", await history.getSessions(userId));
    }));

    socket.on("branch:setActive", safe(async ({ sessionId, nodeId }: { sessionId: string; nodeId: string }) => {
      const session = await history.setActiveLeaf(userId, sessionId, nodeId);
      if (session) socket.emit("session:data", session);
    }));

    // ── Gallery (every image across this user's chats) ─────────────────
    socket.on("get:gallery", safe(async () => {
      socket.emit("gallery:data", await history.getAllImages(userId));
    }));

    // ── Projects ──────────────────────────────────────────────────────
    socket.on("get:projects", safe(async () => socket.emit("projects:data", await history.getProjects(userId))));

    socket.on(
      "project:create",
      safe(async ({ name, color, instructions }: { name: string; color?: string; instructions?: string }) => {
        const project = await history.createProject(userId, name, color);
        if (instructions) await history.updateProject(userId, project.id, { instructions });
        socket.emit("projects:data", await history.getProjects(userId));
      })
    );

    socket.on("project:update", safe(async ({ id, ...patch }: any) => {
      await history.updateProject(userId, id, patch);
      socket.emit("projects:data", await history.getProjects(userId));
    }));

    socket.on("project:delete", safe(async (id: string) => {
      await history.deleteProject(userId, id);
      socket.emit("projects:data", await history.getProjects(userId));
      socket.emit("sessions:data", await history.getSessions(userId));
    }));

    // ── Inline prompt enhancement (magic-pen) ─────────────────────────
    socket.on(
      "enhance:now",
      safe(async ({ prompt, provider, style, quality }: any) => {
        try {
          if (!prompt || !prompt.trim()) return;
          const result = await promptAgent.enhance(prompt, {
            targetProvider: provider || config.get("defaultProvider"),
            style: style || undefined,
            quality: quality || undefined,
          });
          socket.emit("enhance:result", {
            original: prompt,
            enhanced: result.enhanced,
          });
        } catch (err: any) {
          socket.emit("enhance:error", err.message);
        }
      })
    );

    // ── Main generation ───────────────────────────────────────────────
    socket.on("generate", safe(async (opts: any) => {
      try {
        const quota = checkQuota(user);
        if (!quota.ok) {
          socket.emit("generate:error", quota.reason);
          return;
        }
        const desiredProvider = opts.provider || config.get("defaultProvider");
        if (desiredProvider && !providerAllowed(user, desiredProvider)) {
          socket.emit("generate:error", "You don't have access to this provider. Ask your admin for access.");
          return;
        }

        // Resolve project memory for this chat (existing session wins over payload).
        let projectId: string | null = opts.projectId ?? null;
        if (opts.sessionId) {
          const existing = await history.getSession(userId, opts.sessionId);
          if (existing) projectId = existing.projectId ?? null;
        }
        const project = projectId ? await history.getProject(userId, projectId) : null;
        const memory = project?.instructions?.trim();

        const displayPrompt: string = opts.prompt;
        const genPrompt = memory ? `${memory}\n\n${displayPrompt}` : displayPrompt;

        const options: GenerateOptions = {
          prompt: genPrompt,
          provider: opts.provider || undefined,
          model: opts.model || undefined,
          size: opts.size || undefined,
          quality: opts.quality || undefined,
          style: opts.style || undefined,
          count: parseInt(opts.count) || 1,
          enhance: opts.enhance !== false,
          negativePrompt: opts.negative || undefined,
          referenceImage: opts.referenceImage || undefined,
          seed: opts.seed != null && opts.seed !== "" ? parseInt(opts.seed) : undefined,
          steps: opts.steps ? parseInt(opts.steps) : undefined,
          cfgScale: opts.cfgScale ? parseFloat(opts.cfgScale) : undefined,
          format: opts.format || undefined,
          outputDir: config.get("outputDir"),
        };

        socket.emit("generate:start", { prompt: displayPrompt });

        const result = await forgeEngine.generate(options);
        // Show the user's own prompt back (not the memory-augmented one).
        result.prompt = displayPrompt;
        const richResult = slimResult(result);

        const { session, userNodeId, assistantNodeId } = await history.addGeneration(
          userId,
          opts.sessionId,
          displayPrompt,
          richResult,
          {
            parentNodeId: opts.parentNodeId || undefined,
            refThumb: opts.refThumb || undefined,
            projectId,
          }
        );

        if (result.success) {
          await recordUsage(userId, result.cost || 0);
        }

        socket.emit("generate:done", {
          ...richResult,
          sessionId: session.id,
          userNodeId,
          assistantNodeId,
        });
        socket.emit("session:data", session);
        socket.emit("sessions:data", await history.getSessions(userId));
      } catch (err: any) {
        socket.emit("generate:error", err.message);
      }
    }));

    socket.on("open:folder", safe(() => open(config.get("outputDir"))));

    socket.on("config:set", safe(({ key, value }: { key: string; value: any }) => {
      if (user.role !== "SUPER_ADMIN") return;
      try {
        config.set(key as any, value);
        socket.emit("config:data", config.getAll());
      } catch {
        /* ignore unknown keys */
      }
    }));

    // ── Output directory: native browse + end-to-end validation ───────
    socket.on("dialog:pickFolder", safe(async () => {
      if (user.role !== "SUPER_ADMIN") return;
      const dir = await pickFolderNative(config.get("outputDir"));
      socket.emit("dialog:folderPicked", { dir });
    }));

    socket.on("config:setOutputDir", safe(async ({ dir }: { dir: string }) => {
      if (user.role !== "SUPER_ADMIN") return;
      const check = await checkOutputDir(dir);
      if (check.success) config.set("outputDir", dir);
      socket.emit("outputDir:result", { dir, ...check });
      socket.emit("config:data", config.getAll());
    }));

    // ── Provider API keys: save + live end-to-end connection test ─────
    socket.on(
      "provider:setKey",
      safe(async ({ id, apiKey, baseUrl }: { id: string; apiKey: string; baseUrl?: string }) => {
        if (user.role !== "SUPER_ADMIN") return;
        const provider = registry.get(id);
        if (!provider) return;
        credentialStore.set(id, {
          apiKey: apiKey ? apiKey.trim() : undefined,
          baseUrl: baseUrl ? baseUrl.trim() : undefined,
        });
        const test = await provider.testConnection();
        credentialStore.markTested(id, test.success);
        socket.emit("provider:keyResult", { id, ...test });
        socket.emit("providers:data", await visibleProviders());
      })
    );

    socket.on(
      "provider:removeKey",
      safe(async ({ id }: { id: string }) => {
        if (user.role !== "SUPER_ADMIN") return;
        credentialStore.remove(id);
        socket.emit("providers:data", await visibleProviders());
      })
    );

    socket.on(
      "provider:test",
      safe(async ({ id }: { id: string }) => {
        if (user.role !== "SUPER_ADMIN") return;
        const provider = registry.get(id);
        if (!provider) return;
        const test = await provider.testConnection();
        credentialStore.markTested(id, test.success);
        socket.emit("provider:keyResult", { id, ...test });
      })
    );
  });

  // ── Start ─────────────────────────────────────────────────────────────
  return new Promise((resolve) => {
    httpServer.listen(port, () => {
      const url = `http://localhost:${port}`;
      console.log();
      console.log(
        chalk.cyan("  ⚡ ImageForge Web UI") +
          chalk.gray(" is running at ") +
          chalk.white.underline(url)
      );
      console.log(chalk.dim("  Press Ctrl+C to stop\n"));

      if (autoOpen) setTimeout(() => open(url), 800);
      resolve();
    });

    httpServer.on("error", (err: any) => {
      if (err.code === "EADDRINUSE") {
        console.log(chalk.yellow(`  Port ${port} in use, trying ${port + 1}...`));
        httpServer.close();
        startServer(port + 1, autoOpen).then(resolve);
      }
    });
  });
}
