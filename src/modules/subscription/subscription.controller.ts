import { Request, Response, Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { SubscriptionService } from "./subscription.service";

const router = Router();

router.get("/status", authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const status = await SubscriptionService.getSubscriptionStatus(userId);
    return res.json(status);
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

router.post(
  "/checkout",
  authMiddleware,
  async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId;
      const { plan } = req.body;
      if (plan !== "pro" && plan !== "guru") {
        return res.status(400).json({ error: "Invalid plan" });
      }
      const url = await SubscriptionService.createCheckoutSession(userId, plan);
      return res.json({ url });
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }
  },
);

router.get("/plans", (_req: Request, res: Response) => {
  return res.json({ plans: SubscriptionService.PLANS });
});

export const subscriptionRouter = router;
