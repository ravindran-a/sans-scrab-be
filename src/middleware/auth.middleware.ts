import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../modules/auth/auth.service';

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Access token required' });
    return;
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = AuthService.verifyAccessToken(token);
    (req as any).userId = decoded.userId;
    (req as any).username = decoded.username;
    (req as any).subscription = decoded.subscription;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function subscriptionMiddleware(...allowedPlans: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const subscription = (req as any).subscription;
    if (!allowedPlans.includes(subscription)) {
      res.status(403).json({
        error: 'Subscription required',
        required: allowedPlans,
        current: subscription,
      });
      return;
    }
    next();
  };
}
