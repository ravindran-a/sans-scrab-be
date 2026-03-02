import { Router, Request, Response } from 'express';
import { LeaderboardService } from './leaderboard.service';
import { authMiddleware } from '../../middleware/auth.middleware';

const router = Router();

router.get('/global', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    const leaderboard = await LeaderboardService.getGlobalLeaderboard(limit, offset);
    return res.json({ leaderboard });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/country/:country', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    const leaderboard = await LeaderboardService.getCountryLeaderboard(
      req.params.country.toUpperCase(),
      limit,
      offset
    );
    return res.json({ leaderboard });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/rank', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const rank = await LeaderboardService.getPlayerRank(userId);
    return res.json({ rank });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export const leaderboardRouter = router;
