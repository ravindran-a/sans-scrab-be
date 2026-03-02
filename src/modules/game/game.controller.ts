import { Router, Request, Response } from 'express';
import { GameService } from './game.service';
import { authMiddleware } from '../../middleware/auth.middleware';

const router = Router();

router.post('/create', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { mode, aiDifficulty, turnTimer } = req.body;
    const userId = (req as any).userId;
    const username = (req as any).username;

    const game = await GameService.createGame({
      mode,
      userId,
      username,
      aiDifficulty,
      turnTimer,
    });

    return res.status(201).json({ game: sanitizeGameForPlayer(game, userId) });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

router.post('/:id/move', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { placements, rackIndices } = req.body;

    const { game, moveScore, wordsFormed } = await GameService.makeMove({
      gameId: req.params.id,
      userId,
      placements,
      rackIndices,
    });

    return res.json({
      game: sanitizeGameForPlayer(game, userId),
      moveScore,
      wordsFormed,
    });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

router.post('/:id/pass', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const game = await GameService.passTurn(req.params.id, userId);
    return res.json({ game: sanitizeGameForPlayer(game, userId) });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

router.post('/:id/exchange', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { rackIndices } = req.body;
    const game = await GameService.exchangeTiles(req.params.id, userId, rackIndices);
    return res.json({ game: sanitizeGameForPlayer(game, userId) });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

router.get('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const game = await GameService.getGame(req.params.id);
    if (!game) return res.status(404).json({ error: 'Game not found' });
    return res.json({ game: sanitizeGameForPlayer(game, userId) });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

router.get('/user/history', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const games = await GameService.getGamesByUser(userId);
    return res.json({ games: games.map(g => sanitizeGameForPlayer(g, userId)) });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

router.post('/:id/abandon', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const game = await GameService.abandonGame(req.params.id, userId);
    return res.json({ game: sanitizeGameForPlayer(game, userId) });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

/**
 * Sanitize game state for a specific player.
 * Hide opponent's rack (anti-cheat).
 */
function sanitizeGameForPlayer(game: any, userId: string) {
  const obj = game.toObject ? game.toObject() : { ...game };
  obj.players = obj.players.map((p: any) => {
    if (p.userId !== userId && p.userId !== 'ai') {
      return { ...p, rack: undefined, rackCount: p.rack?.length || 0 };
    }
    return p;
  });
  // Don't expose tile bag
  obj.tileBagCount = obj.tileBag?.length || 0;
  delete obj.tileBag;
  return obj;
}

export const gameRouter = router;
