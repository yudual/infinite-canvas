import path from "node:path";
import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import { PORT, UPLOADS_DIR, NODE_ENV } from "./config.js";
import { getSystemNotice } from "./db.js";
import { setupRouter } from "./routes/setup.js";
import { authRouter } from "./routes/auth.js";
import { adminRouter } from "./routes/admin.js";
import { aiRouter } from "./routes/ai.js";
import { projectsRouter } from "./routes/projects.js";
import { assetsRouter } from "./routes/assets.js";

const app = express();

// Enable CORS
app.use(cors());

// Parse JSON and form bodies
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Static asset serving for uploaded files
app.use("/uploads", express.static(UPLOADS_DIR));

// Mount API route modules
app.use("/api/setup", setupRouter);
app.use("/api/auth", authRouter);
app.use("/api/admin", adminRouter);
app.use("/api/ai", aiRouter);
app.use("/api/projects", projectsRouter);
app.use("/api/assets", assetsRouter);
app.use("/api/upload", assetsRouter); // Alias for convenient uploads

// Public System Announcement endpoint
app.get("/api/notice", (_req: Request, res: Response) => {
  const notice = getSystemNotice();
  res.json({ success: true, notice });
});

// Health check endpoint
app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Global 404 for unhandled /api requests
app.use("/api", (_req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: {
      code: "NOT_FOUND",
      message: "API endpoint not found",
    },
    message: "API endpoint not found",
  });
});

// Production SPA static serving
if (NODE_ENV === "production") {
  const webDistPath = path.resolve(process.cwd(), "web/dist");
  app.use(express.static(webDistPath));
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/uploads")) {
      return next();
    }
    res.sendFile(path.join(webDistPath, "index.html"));
  });
}

// Global error handler
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Unhandled Server Error:", err);
  const status = err.status || 500;
  const code = err.code || "INTERNAL_SERVER_ERROR";
  const message = err.message || "An unexpected error occurred";
  res.status(status).json({
    success: false,
    error: {
      code,
      message,
    },
    message,
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[Yu-canvas Server] Running on http://0.0.0.0:${PORT} (${NODE_ENV})`);
});

export default app;
