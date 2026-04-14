import { Request, Response, Router } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { ENV } from "../../config/env";
import { authMiddleware } from "../../middleware/auth.middleware";
import { UserModel } from "./auth.model";
import { AuthService, JwtPayload } from "./auth.service";

const router = Router();

const registerSchema = z.object({
  username: z.string().min(3).max(30),
  email: z.string().email(),
  password: z.string().min(6),
  displayName: z.string().min(1).max(50),
  country: z.string().length(2).default("IN"),
});

const loginSchema = z.object({
  emailOrUsername: z.string().min(1),
  password: z.string().min(1),
});

router.post("/guest", async (_req: Request, res: Response) => {
  try {
    const accessToken = AuthService.generateGuestToken();
    const decoded = AuthService.verifyAccessToken(accessToken);
    return res.json({
      user: {
        id: decoded.userId,
        username: decoded.username,
        displayName: "अतिथि",
        elo: 1200,
        subscription: "free",
        isGuest: true,
      },
      accessToken,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.post("/register", async (req: Request, res: Response) => {
  try {
    const data = registerSchema.parse(req.body);
    const { user, tokens } = await AuthService.register(
      data.username,
      data.email,
      data.password,
      data.displayName,
      data.country,
    );

    res.cookie("refreshToken", tokens.refreshToken, {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.status(201).json({
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        displayName: user.displayName,
        elo: user.elo,
        subscription: user.subscription,
      },
      accessToken: tokens.accessToken,
    });
  } catch (err: any) {
    if (err.name === "ZodError") {
      return res
        .status(400)
        .json({ error: "Validation error", details: err.errors });
    }
    return res.status(400).json({ error: err.message });
  }
});

router.post("/login", async (req: Request, res: Response) => {
  try {
    const data = loginSchema.parse(req.body);
    const { user, tokens } = await AuthService.login(
      data.emailOrUsername,
      data.password,
    );

    res.cookie("refreshToken", tokens.refreshToken, {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.json({
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        displayName: user.displayName,
        elo: user.elo,
        subscription: user.subscription,
        avatar: user.avatar,
        gamesPlayed: user.gamesPlayed,
        gamesWon: user.gamesWon,
      },
      accessToken: tokens.accessToken,
    });
  } catch (err: any) {
    if (err.name === "ZodError") {
      return res
        .status(400)
        .json({ error: "Validation error", details: err.errors });
    }
    return res.status(401).json({ error: err.message });
  }
});

router.post("/refresh", async (req: Request, res: Response) => {
  try {
    const refreshToken = req.cookies?.refreshToken || req.body.refreshToken;
    if (!refreshToken) {
      return res.status(401).json({ error: "No refresh token" });
    }

    const tokens = await AuthService.refreshAccessToken(refreshToken);

    res.cookie("refreshToken", tokens.refreshToken, {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.json({ accessToken: tokens.accessToken });
  } catch (err: any) {
    return res.status(401).json({ error: err.message });
  }
});

router.get("/me", authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const user = await UserModel.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    return res.json({
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        displayName: user.displayName,
        elo: user.elo,
        subscription: user.subscription,
        avatar: user.avatar,
        gamesPlayed: user.gamesPlayed,
        gamesWon: user.gamesWon,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.post("/logout", async (req: Request, res: Response) => {
  try {
    // Identify user from refresh-token cookie so logout works even with an
    // expired access token. Falls back to auth header if present.
    const refreshToken = req.cookies?.refreshToken || req.body.refreshToken;
    let userId: string | undefined;
    if (refreshToken) {
      try {
        const decoded = jwt.verify(
          refreshToken,
          ENV.JWT_REFRESH_SECRET,
        ) as JwtPayload;
        userId = decoded.userId;
      } catch {
        /* ignore — still clear cookie */
      }
    }
    if (!userId) {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith("Bearer ")) {
        try {
          const decoded = AuthService.verifyAccessToken(
            authHeader.split(" ")[1],
          );
          userId = decoded.userId;
        } catch {
          /* ignore */
        }
      }
    }
    if (userId && !userId.startsWith("guest_")) {
      await AuthService.logout(userId);
    }
    res.clearCookie("refreshToken");
    return res.json({ message: "Logged out" });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export const authRouter = router;
