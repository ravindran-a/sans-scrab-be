import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { createServer } from "http";
import mongoose from "mongoose";
import type { Server as SocketIOServer } from "socket.io";

import { connectDB } from "./config/db";
import { ENV } from "./config/env";
import { connectRedis, disconnectRedis } from "./config/redis";
import { DictionaryService } from "./modules/dictionary/dictionary.service";
import { initSocketServer } from "./websocket/socket-server";

import { authRouter } from "./modules/auth/auth.controller";
import { dictionaryRouter } from "./modules/dictionary/dictionary.controller";
import { gameRouter } from "./modules/game/game.controller";
import { leaderboardRouter } from "./modules/leaderboard/leaderboard.controller";
import { feedbackRouter } from "./modules/feedback/feedback.controller";
import { subscriptionRouter } from "./modules/subscription/subscription.controller";
import { SubscriptionService } from "./modules/subscription/subscription.service";

const app = express();
const httpServer = createServer(app);

// Stripe webhook needs raw body
app.post(
  "/api/subscription/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      const signature = req.headers["stripe-signature"] as string;
      await SubscriptionService.handleWebhook(req.body, signature);
      res.json({ received: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  },
);

// Middleware
app.use(
  cors({
    origin: ENV.CORS_ORIGIN.split(",").map((o) => o.trim()),
    credentials: true,
  }),
);
app.use(helmet());
app.use(cookieParser());
app.use(express.json());

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/", generalLimiter);

const gameLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/game/", gameLimiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many auth attempts, please try again later" },
});
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/register", authLimiter);
app.use("/api/auth/guest", authLimiter);

const feedbackLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many feedback submissions, please try again later" },
});
app.use("/api/feedback", feedbackLimiter);

// Routes
app.use("/api/auth", authRouter);
app.use("/api/game", gameRouter);
app.use("/api/dictionary", dictionaryRouter);
app.use("/api/leaderboard", leaderboardRouter);
app.use("/api/subscription", subscriptionRouter);
app.use("/api/feedback", feedbackRouter);

// Health check
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    dictionaryWords: DictionaryService.getWordCount(),
  });
});

let io: SocketIOServer | null = null;
let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Server] ${signal} received — shutting down`);

  // Stop accepting new HTTP + WS connections
  httpServer.close(() => console.log("[Server] HTTP closed"));
  if (io) {
    await new Promise<void>((resolve) => io!.close(() => resolve()));
    console.log("[Socket] Closed");
  }

  await disconnectRedis();
  console.log("[Redis] Disconnected");

  await mongoose.disconnect();
  console.log("[DB] Disconnected");

  // Give logs a tick to flush, then exit.
  setTimeout(() => process.exit(0), 100).unref();
}

// Initialize
async function start() {
  await connectDB();
  await connectRedis();
  await DictionaryService.loadDictionary();

  io = initSocketServer(httpServer);

  httpServer.listen(ENV.PORT, () => {
    console.log(`[Server] Running on port ${ENV.PORT}`);
    console.log(`[Server] Environment: ${ENV.NODE_ENV}`);
  });

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

// Only auto-start when executed directly (not when imported by tests).
if (require.main === module) {
  start().catch(console.error);
}

export { app, httpServer, start, shutdown };
