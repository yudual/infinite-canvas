import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config.js";
import { db, toSafeUser, type SafeUserDto, type UserRecord } from "../db.js";

declare global {
  namespace Express {
    interface Request {
      user?: SafeUserDto;
    }
  }
}

export interface JwtPayload {
  userId?: string;
  sub?: string;
  username: string;
  role: "admin" | "user";
}

export function authenticateToken(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({
      success: false,
      error: {
        code: "UNAUTHORIZED",
        message: "Missing or invalid authorization token",
      },
      message: "Missing or invalid authorization token",
    });
    return;
  }

  const token = authHeader.substring(7).trim();
  if (!token) {
    res.status(401).json({
      success: false,
      error: {
        code: "TOKEN_MISSING",
        message: "Missing authorization token",
      },
      message: "Missing authorization token",
    });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] }) as JwtPayload;
    const userId = decoded.userId || decoded.sub;

    if (!userId) {
      res.status(401).json({
        success: false,
        error: {
          code: "INVALID_TOKEN",
          message: "Token payload missing user identifier",
        },
        message: "Token payload missing user identifier",
      });
      return;
    }

    const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId) as UserRecord | undefined;

    if (!user) {
      res.status(401).json({
        success: false,
        error: {
          code: "USER_NOT_FOUND",
          message: "User account no longer exists",
        },
        message: "User account no longer exists",
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

    req.user = toSafeUser(user);
    next();
  } catch (err: any) {
    if (err.name === "TokenExpiredError") {
      res.status(401).json({
        success: false,
        error: {
          code: "TOKEN_EXPIRED",
          message: "Token expired",
        },
        message: "Token expired",
      });
      return;
    }
    res.status(401).json({
      success: false,
      error: {
        code: "INVALID_TOKEN",
        message: "Token is invalid",
      },
      message: "Token is invalid",
    });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || req.user.role !== "admin") {
    res.status(403).json({
      success: false,
      error: {
        code: "FORBIDDEN",
        message: "Administrator privileges required",
      },
      message: "Administrator privileges required",
    });
    return;
  }
  next();
}

export function optionalAuthenticateToken(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next();
  }

  const token = authHeader.substring(7).trim();
  if (!token) return next();

  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] }) as JwtPayload;
    const userId = decoded.userId || decoded.sub;

    if (userId) {
      const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId) as UserRecord | undefined;
      if (user && user.status !== "disabled") {
        req.user = toSafeUser(user);
      }
    }
  } catch {}
  next();
}
