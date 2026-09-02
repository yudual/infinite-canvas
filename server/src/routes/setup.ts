import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { JWT_SECRET, JWT_EXPIRES_IN } from "../config.js";
import { db, isSystemInitialized, toSafeUser, setSetting, type UserRecord } from "../db.js";

export const setupRouter = Router();

// GET /api/setup/status
setupRouter.get("/status", (_req: Request, res: Response) => {
  const initialized = isSystemInitialized();
  res.json({
    initialized,
    requiresSetup: !initialized,
  });
});

// POST /api/setup
setupRouter.post("/", (req: Request, res: Response) => {
  if (isSystemInitialized()) {
    res.status(403).json({
      success: false,
      error: {
        code: "ALREADY_INITIALIZED",
        message: "System is already initialized.",
      },
      message: "System is already initialized.",
    });
    return;
  }

  const { username, password, displayName, aiConfig } = req.body || {};

  if (!username && !password) {
    res.status(400).json({
      success: false,
      error: {
        code: "INVALID_REQUEST",
        message: "Username and password are required.",
      },
      message: "Username and password are required.",
    });
    return;
  }

  const cleanUsername = typeof username === "string" ? username.trim() : "";
  const cleanPassword = typeof password === "string" ? password : "";
  const cleanDisplayName = typeof displayName === "string" && displayName.trim() ? displayName.trim() : cleanUsername;

  if (!cleanUsername || cleanUsername.length < 3 || cleanUsername.length > 32) {
    res.status(400).json({
      success: false,
      error: {
        code: "INVALID_USERNAME",
        message: "Username must be between 3 and 32 characters.",
      },
      message: "Username must be between 3 and 32 characters.",
    });
    return;
  }

  if (!/^[a-zA-Z0-9_\-]+$/.test(cleanUsername)) {
    res.status(400).json({
      success: false,
      error: {
        code: "INVALID_USERNAME_FORMAT",
        message: "Username may only contain letters, numbers, hyphens, and underscores.",
      },
      message: "Username may only contain letters, numbers, hyphens, and underscores.",
    });
    return;
  }

  if (!cleanPassword || cleanPassword.length < 6) {
    res.status(400).json({
      success: false,
      error: {
        code: "INVALID_PASSWORD",
        message: "Password must be at least 6 characters long.",
      },
      message: "Password must be at least 6 characters long.",
    });
    return;
  }

  const initTransaction = db.transaction(() => {
    // Re-check under lock
    const adminCount = db.prepare(`SELECT COUNT(*) as count FROM users WHERE role = 'admin'`).get() as { count: number };
    if (adminCount.count > 0) {
      throw new Error("ALREADY_INITIALIZED");
    }

    const userId = crypto.randomUUID();
    const passwordHash = bcrypt.hashSync(cleanPassword, 10);
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO users (id, username, password_hash, display_name, role, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'admin', 'active', ?, ?)
    `).run(userId, cleanUsername, passwordHash, cleanDisplayName, now, now);

    // Store AI configuration if provided
    if (aiConfig && typeof aiConfig === "object") {
      if (typeof aiConfig.baseUrl === "string") {
        setSetting("ai.base_url", aiConfig.baseUrl.trim());
      }
      if (typeof aiConfig.apiKey === "string") {
        setSetting("ai.api_key", aiConfig.apiKey.trim());
      }
      if (Array.isArray(aiConfig.imageModels)) {
        setSetting("ai.image_models", JSON.stringify(aiConfig.imageModels));
      }
      if (typeof aiConfig.defaultModel === "string") {
        setSetting("ai.default_model", aiConfig.defaultModel.trim());
      }
      if (Array.isArray(aiConfig.chatModels)) {
        setSetting("ai.chat_models", JSON.stringify(aiConfig.chatModels));
      }
    }

    setSetting("system.initialized", "true");

    const createdUser = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId) as UserRecord;
    return createdUser;
  });

  try {
    const adminUser = initTransaction();
    const token = jwt.sign(
      { userId: adminUser.id, sub: adminUser.id, username: adminUser.username, role: adminUser.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.status(201).json({
      success: true,
      token,
      user: toSafeUser(adminUser),
    });
  } catch (err: any) {
    if (err.message === "ALREADY_INITIALIZED") {
      res.status(403).json({
        success: false,
        error: {
          code: "ALREADY_INITIALIZED",
          message: "System is already initialized.",
        },
        message: "System is already initialized.",
      });
    } else {
      res.status(500).json({
        success: false,
        error: {
          code: "SETUP_FAILED",
          message: err.message || "Failed to initialize system.",
        },
        message: err.message || "Failed to initialize system.",
      });
    }
  }
});
