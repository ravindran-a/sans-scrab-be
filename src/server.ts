import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { createServer } from 'http';
import rateLimit from 'express-rate-limit';

import { ENV } from './config/env';
import { connectDB } from './config/db';
import { connectRedis } from './config/redis';
import { initSocketServer } from './websocket/socket-server';
import { DictionaryService } from './modules/dictionary/dictionary.service';

import { authRouter } from './modules/auth/auth.controller';
import { gameRouter } from './modules/game/game.controller';
import { dictionaryRouter } from './modules/dictionary/dictionary.controller';
import { leaderboardRouter } from './modules/leaderboard/leaderboard.controller';
import { subscriptionRouter } from './modules/subscription/subscription.controller';
import { SubscriptionService } from './modules/subscription/subscription.service';

const app = express();
const httpServer = createServer(app);

// Stripe webhook needs raw body
app.post('/api/subscription/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    try {
      const signature = req.headers['stripe-signature'] as string;
      await SubscriptionService.handleWebhook(req.body, signature);
      res.json({ received: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);

// Middleware
app.use(cors({
  origin: ENV.CORS_ORIGIN.split(',').map(o => o.trim()),
  credentials: true,
}));
app.use(helmet());
app.use(cookieParser());
app.use(express.json());

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth attempts, please try again later' },
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// Routes
app.use('/api/auth', authRouter);
app.use('/api/game', gameRouter);
app.use('/api/dictionary', dictionaryRouter);
app.use('/api/leaderboard', leaderboardRouter);
app.use('/api/subscription', subscriptionRouter);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    dictionaryWords: DictionaryService.getWordCount(),
  });
});

// Initialize
async function start() {
  await connectDB();
  await connectRedis();
  await DictionaryService.loadDictionary();

  initSocketServer(httpServer);

  httpServer.listen(ENV.PORT, () => {
    console.log(`[Server] Running on port ${ENV.PORT}`);
    console.log(`[Server] Environment: ${ENV.NODE_ENV}`);
  });
}

start().catch(console.error);

export { app, httpServer };
