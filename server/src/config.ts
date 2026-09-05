import fs from "node:fs";
import path from "node:path";

export const PORT = parseInt(process.env.PORT || "3001", 10);
const DEFAULT_JWT_SECRET = "canvas-dev-jwt-secret-replace-in-production";
export const JWT_SECRET = process.env.JWT_SECRET || DEFAULT_JWT_SECRET;
export const JWT_EXPIRES_IN = (process.env.JWT_EXPIRES_IN || "7d") as any;
export const NODE_ENV = process.env.NODE_ENV || "development";

if (NODE_ENV === "production" && JWT_SECRET === DEFAULT_JWT_SECRET) {
  throw new Error("JWT_SECRET must be configured in production");
}

export const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), "data");
export const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, "canvas.db");
export const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(DATA_DIR, "uploads");

// Ensure data and uploads directories exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
