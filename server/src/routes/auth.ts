import { Router, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { JWT_SECRET, JWT_EXPIRES_IN } from "../config.js";
import { db, toSafeUser, type UserRecord } from "../db.js";
import { authenticateToken } from "../middleware/auth.js";

export const authRouter = Router();

// Constant dummy hash for timing attack mitigation on non-existent users
const DUMMY_HASH = "$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012345";

// POST /api/auth/login
authRouter.post("/login", (req: Request, res: Response) => {
  const { username, password } = req.body || {};

  if (username === undefined || password === undefined) {
    res.status(400).json({
      success: false,
      error: {
        code: "INVALID_REQUEST",
        message: "Username and password are required",
      },
      message: "Username and password are required",
    });
    return;
  }

  const cleanUsername = String(username).trim();
  const cleanPassword = String(password);

  if (!cleanUsername || !cleanPassword) {
    res.status(400).json({
      success: false,
      error: {
        code: "INVALID_REQUEST",
        message: "Username and password cannot be empty",
      },
      message: "Username and password cannot be empty",
    });
    return;
  }

  const user = db.prepare(`SELECT * FROM users WHERE username = ? COLLATE NOCASE`).get(cleanUsername) as UserRecord | undefined;

  if (!user) {
    // Run dummy compare to equalize timing
    bcrypt.compareSync(cleanPassword, DUMMY_HASH);
    res.status(401).json({
      success: false,
      error: {
        code: "INVALID_CREDENTIALS",
        message: "Invalid username or password",
      },
      message: "Invalid username or password",
    });
    return;
  }

  const isValidPassword = bcrypt.compareSync(cleanPassword, user.password_hash);
  if (!isValidPassword) {
    res.status(401).json({
      success: false,
      error: {
        code: "INVALID_CREDENTIALS",
        message: "Invalid username or password",
      },
      message: "Invalid username or password",
    });
    return;
  }

  if (user.status === "disabled") {
    res.status(403).json({
      success: false,
      error: {
        code: "ACCOUNT_DISABLED",
        message: "Account is disabled. Please contact administrator.",
      },
      message: "Account is disabled. Please contact administrator.",
    });
    return;
  }

  const token = jwt.sign(
    { userId: user.id, sub: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );

  res.json({
    success: true,
    token,
    user: toSafeUser(user),
  });
});

// GET /api/auth/me
authRouter.get("/me", authenticateToken, (req: Request, res: Response) => {
  res.json({
    success: true,
    user: req.user,
  });
});

// POST /api/auth/logout
authRouter.post("/logout", (_req: Request, res: Response) => {
  res.json({
    success: true,
  });
});
