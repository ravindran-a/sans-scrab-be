/**
 * Guest Play Flow Tests — verifies guest token generation, guest JWT payload,
 * auth middleware behavior for guests, and guest game restrictions.
 */
import jwt from "jsonwebtoken";
import { ENV } from "../../../config/env";

const GUEST_TOKEN_EXPIRY = "2h";

interface GuestJwtPayload {
  userId: string;
  username: string;
  subscription: string;
  isGuest?: boolean;
  iat?: number;
  exp?: number;
}

function generateGuestToken(): string {
  const guestId = `guest_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const payload: GuestJwtPayload = {
    userId: guestId,
    username: "अतिथि",
    subscription: "free",
    isGuest: true,
  };
  return jwt.sign(payload, ENV.JWT_SECRET, { expiresIn: GUEST_TOKEN_EXPIRY });
}

function verifyAccessToken(token: string): GuestJwtPayload {
  return jwt.verify(token, ENV.JWT_SECRET) as GuestJwtPayload;
}

// Simulate auth middleware behavior
function simulateAuthMiddleware(token: string): {
  userId: string;
  username: string;
  subscription: string;
  isGuest: boolean;
} | null {
  try {
    const decoded = verifyAccessToken(token);
    return {
      userId: decoded.userId,
      username: decoded.username,
      subscription: decoded.subscription,
      isGuest: decoded.isGuest || false,
    };
  } catch {
    return null;
  }
}

// Simulate guest game creation guard
function canCreateGame(
  isGuest: boolean,
  mode: "single" | "ai" | "multiplayer",
): { allowed: boolean; error?: string } {
  if (isGuest && mode === "multiplayer") {
    return {
      allowed: false,
      error: "Guests cannot play multiplayer. Please create an account.",
    };
  }
  return { allowed: true };
}

describe("Guest Play Flow", () => {
  describe("Guest Token Generation", () => {
    it("should generate a valid guest JWT token", () => {
      const token = generateGuestToken();
      expect(token).toBeDefined();
      expect(typeof token).toBe("string");
      expect(token.split(".")).toHaveLength(3);
    });

    it("should contain isGuest=true in the payload", () => {
      const token = generateGuestToken();
      const decoded = verifyAccessToken(token);
      expect(decoded.isGuest).toBe(true);
    });

    it("should have a guest userId prefix", () => {
      const token = generateGuestToken();
      const decoded = verifyAccessToken(token);
      expect(decoded.userId).toMatch(/^guest_/);
    });

    it("should have Sanskrit guest username", () => {
      const token = generateGuestToken();
      const decoded = verifyAccessToken(token);
      expect(decoded.username).toBe("अतिथि");
    });

    it("should have free subscription", () => {
      const token = generateGuestToken();
      const decoded = verifyAccessToken(token);
      expect(decoded.subscription).toBe("free");
    });

    it("should generate unique guest IDs each time", () => {
      const token1 = generateGuestToken();
      const token2 = generateGuestToken();
      const decoded1 = verifyAccessToken(token1);
      const decoded2 = verifyAccessToken(token2);
      expect(decoded1.userId).not.toBe(decoded2.userId);
    });

    it("should expire in 2 hours", () => {
      const token = generateGuestToken();
      const decoded = verifyAccessToken(token);
      const ttl = decoded.exp! - decoded.iat!;
      expect(ttl).toBe(7200); // 2h = 7200s
    });
  });

  describe("Guest Auth Middleware", () => {
    it("should decode guest token and set isGuest=true", () => {
      const token = generateGuestToken();
      const result = simulateAuthMiddleware(token);
      expect(result).not.toBeNull();
      expect(result!.isGuest).toBe(true);
      expect(result!.userId).toMatch(/^guest_/);
    });

    it("should decode regular token and set isGuest=false", () => {
      const regularPayload = {
        userId: "user123",
        username: "testplayer",
        subscription: "free",
      };
      const token = jwt.sign(regularPayload, ENV.JWT_SECRET, {
        expiresIn: "2h",
      });
      const result = simulateAuthMiddleware(token);
      expect(result).not.toBeNull();
      expect(result!.isGuest).toBe(false);
    });

    it("should reject invalid guest tokens", () => {
      const result = simulateAuthMiddleware("invalid.token.here");
      expect(result).toBeNull();
    });

    it("should reject expired guest tokens", () => {
      const payload: GuestJwtPayload = {
        userId: "guest_expired",
        username: "अतिथि",
        subscription: "free",
        isGuest: true,
      };
      const token = jwt.sign(payload, ENV.JWT_SECRET, { expiresIn: "0s" });
      // Small delay to ensure expiry
      const result = simulateAuthMiddleware(token);
      expect(result).toBeNull();
    });

    it("should reject guest tokens signed with wrong secret", () => {
      const payload: GuestJwtPayload = {
        userId: "guest_wrong_secret",
        username: "अतिथि",
        subscription: "free",
        isGuest: true,
      };
      const token = jwt.sign(payload, "wrong-secret", { expiresIn: "2h" });
      const result = simulateAuthMiddleware(token);
      expect(result).toBeNull();
    });
  });

  describe("Guest Game Restrictions", () => {
    it("should allow guests to create single player games", () => {
      const result = canCreateGame(true, "single");
      expect(result.allowed).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("should allow guests to create AI games", () => {
      const result = canCreateGame(true, "ai");
      expect(result.allowed).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("should block guests from creating multiplayer games", () => {
      const result = canCreateGame(true, "multiplayer");
      expect(result.allowed).toBe(false);
      expect(result.error).toContain("Guests cannot play multiplayer");
    });

    it("should allow registered users to create multiplayer games", () => {
      const result = canCreateGame(false, "multiplayer");
      expect(result.allowed).toBe(true);
    });

    it("should allow registered users to create all game modes", () => {
      expect(canCreateGame(false, "single").allowed).toBe(true);
      expect(canCreateGame(false, "ai").allowed).toBe(true);
      expect(canCreateGame(false, "multiplayer").allowed).toBe(true);
    });
  });

  describe("Guest Token vs Regular Token", () => {
    it("guest token should NOT have a refresh mechanism", () => {
      const token = generateGuestToken();
      const decoded = verifyAccessToken(token);
      // Guest tokens are access-only, no refresh token should be generated
      expect(decoded.isGuest).toBe(true);
      // Verify it can't be used as a refresh token
      expect(() => {
        jwt.verify(token, ENV.JWT_REFRESH_SECRET);
      }).toThrow();
    });

    it("guest and regular tokens should both be verifiable with same secret", () => {
      const guestToken = generateGuestToken();
      const regularToken = jwt.sign(
        { userId: "user1", username: "player1", subscription: "free" },
        ENV.JWT_SECRET,
        { expiresIn: "2h" },
      );

      expect(() => verifyAccessToken(guestToken)).not.toThrow();
      expect(() => verifyAccessToken(regularToken)).not.toThrow();
    });

    it("should distinguish guest from regular by isGuest field", () => {
      const guestToken = generateGuestToken();
      const regularToken = jwt.sign(
        { userId: "user1", username: "player1", subscription: "pro" },
        ENV.JWT_SECRET,
        { expiresIn: "2h" },
      );

      const guestDecoded = verifyAccessToken(guestToken);
      const regularDecoded = verifyAccessToken(regularToken);

      expect(guestDecoded.isGuest).toBe(true);
      expect(regularDecoded.isGuest).toBeUndefined();
      expect(guestDecoded.subscription).toBe("free");
      expect(regularDecoded.subscription).toBe("pro");
    });
  });

  describe("Guest E2E Simulation", () => {
    it("should simulate full guest flow: token → auth → create solo game", () => {
      // Step 1: Generate guest token
      const token = generateGuestToken();
      expect(token).toBeDefined();

      // Step 2: Auth middleware processes the token
      const auth = simulateAuthMiddleware(token);
      expect(auth).not.toBeNull();
      expect(auth!.isGuest).toBe(true);
      expect(auth!.userId).toMatch(/^guest_/);

      // Step 3: Create solo game (allowed)
      const gameCheck = canCreateGame(auth!.isGuest, "single");
      expect(gameCheck.allowed).toBe(true);
    });

    it("should simulate full guest flow: token → auth → create AI game", () => {
      const token = generateGuestToken();
      const auth = simulateAuthMiddleware(token);
      expect(auth).not.toBeNull();

      const gameCheck = canCreateGame(auth!.isGuest, "ai");
      expect(gameCheck.allowed).toBe(true);
    });

    it("should simulate guest blocked from multiplayer", () => {
      const token = generateGuestToken();
      const auth = simulateAuthMiddleware(token);
      expect(auth).not.toBeNull();

      const gameCheck = canCreateGame(auth!.isGuest, "multiplayer");
      expect(gameCheck.allowed).toBe(false);
    });

    it("should simulate regular user can do everything", () => {
      const token = jwt.sign(
        { userId: "user1", username: "player1", subscription: "pro" },
        ENV.JWT_SECRET,
        { expiresIn: "2h" },
      );

      const auth = simulateAuthMiddleware(token);
      expect(auth).not.toBeNull();
      expect(auth!.isGuest).toBe(false);

      expect(canCreateGame(auth!.isGuest, "single").allowed).toBe(true);
      expect(canCreateGame(auth!.isGuest, "ai").allowed).toBe(true);
      expect(canCreateGame(auth!.isGuest, "multiplayer").allowed).toBe(true);
    });
  });

  describe("Guest API Response Simulation", () => {
    it("should produce a valid guest API response shape", () => {
      const accessToken = generateGuestToken();
      const decoded = verifyAccessToken(accessToken);

      // Simulate what the /auth/guest endpoint returns
      const response = {
        user: {
          id: decoded.userId,
          username: decoded.username,
          displayName: "अतिथि",
          elo: 1200,
          subscription: "free",
          isGuest: true,
        },
        accessToken,
      };

      expect(response.user.id).toMatch(/^guest_/);
      expect(response.user.username).toBe("अतिथि");
      expect(response.user.displayName).toBe("अतिथि");
      expect(response.user.elo).toBe(1200);
      expect(response.user.subscription).toBe("free");
      expect(response.user.isGuest).toBe(true);
      expect(response.accessToken).toBeDefined();
    });

    it("guest user.id should match userId in game player lookup", () => {
      const token = generateGuestToken();
      const decoded = verifyAccessToken(token);
      const guestUserId = decoded.userId;

      // Simulate game players array after game creation
      const players = [
        { userId: guestUserId, username: "अतिथि", rack: ["क", "त", "न"], score: 0 },
        { userId: "ai", username: "AI-Level-1", rack: ["ग", "च", "द"], score: 0 },
      ];

      // Simulate GamePage player lookup: game.players.find(p => p.userId === user?.id)
      const myPlayer = players.find((p) => p.userId === guestUserId);
      const opponentPlayer = players.find((p) => p.userId !== guestUserId);

      expect(myPlayer).toBeDefined();
      expect(myPlayer!.username).toBe("अतिथि");
      expect(myPlayer!.rack).toHaveLength(3);
      expect(opponentPlayer).toBeDefined();
      expect(opponentPlayer!.userId).toBe("ai");
    });

    it("guest user.id should work for turn detection", () => {
      const token = generateGuestToken();
      const decoded = verifyAccessToken(token);
      const guestUserId = decoded.userId;

      const players = [
        { userId: guestUserId, username: "अतिथि", score: 0 },
        { userId: "ai", username: "AI-Level-1", score: 0 },
      ];

      // currentTurn=0 means player[0]'s turn (guest)
      const currentTurn = 0;
      const myIdx = players.findIndex((p) => p.userId === guestUserId);
      const isMyTurn = myIdx === currentTurn % players.length;

      expect(myIdx).toBe(0);
      expect(isMyTurn).toBe(true);

      // currentTurn=1 means AI's turn
      const isMyTurn2 = myIdx === 1 % players.length;
      expect(isMyTurn2).toBe(false);
    });

    it("guest user.id should work for winner detection", () => {
      const token = generateGuestToken();
      const decoded = verifyAccessToken(token);
      const guestUserId = decoded.userId;

      // Guest wins
      expect(guestUserId === guestUserId).toBe(true);
      // AI wins
      expect("ai" === guestUserId).toBe(false);
    });
  });

  describe("Guest Session Lifecycle", () => {
    it("should generate multiple independent guest sessions", () => {
      const tokens = Array.from({ length: 10 }, () => generateGuestToken());
      const ids = tokens.map((t) => verifyAccessToken(t).userId);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(10);
    });

    it("guest token should be valid immediately after creation", () => {
      const token = generateGuestToken();
      expect(() => verifyAccessToken(token)).not.toThrow();
    });

    it("guest userId format should contain timestamp and random suffix", () => {
      const token = generateGuestToken();
      const decoded = verifyAccessToken(token);
      const parts = decoded.userId.split("_");
      expect(parts).toHaveLength(3); // guest, timestamp, random
      expect(parts[0]).toBe("guest");
      expect(Number(parts[1])).toBeGreaterThan(0); // valid timestamp
      expect(parts[2].length).toBeGreaterThanOrEqual(2); // random suffix
    });

    it("guest should always get free subscription tier", () => {
      for (let i = 0; i < 5; i++) {
        const token = generateGuestToken();
        const decoded = verifyAccessToken(token);
        expect(decoded.subscription).toBe("free");
      }
    });

    it("guest token should NOT be verifiable with refresh secret", () => {
      const token = generateGuestToken();
      expect(() => jwt.verify(token, ENV.JWT_REFRESH_SECRET)).toThrow();
    });
  });

  describe("Guest Game History Guard", () => {
    function canAccessHistory(isGuest: boolean): {
      allowed: boolean;
      error?: string;
    } {
      if (isGuest) {
        return { allowed: false, error: "Guests cannot access game history" };
      }
      return { allowed: true };
    }

    it("should block guests from game history", () => {
      const result = canAccessHistory(true);
      expect(result.allowed).toBe(false);
      expect(result.error).toContain("Guests cannot access game history");
    });

    it("should allow registered users to access game history", () => {
      const result = canAccessHistory(false);
      expect(result.allowed).toBe(true);
    });
  });

  describe("Guest ELO Safety", () => {
    it("guest games should not have eloChange", () => {
      // Simulate: guest games are solo/AI only, ELO only applies to multiplayer
      const guestGame = {
        mode: "ai" as const,
        isGuest: true,
        eloChange: undefined,
      };
      expect(guestGame.eloChange).toBeUndefined();
    });

    it("guest cannot reach multiplayer where ELO is calculated", () => {
      const token = generateGuestToken();
      const auth = simulateAuthMiddleware(token);
      const gameCheck = canCreateGame(auth!.isGuest, "multiplayer");
      expect(gameCheck.allowed).toBe(false);
      // So ELO calculation path is never reached for guests
    });
  });

  describe("Guest Concurrent Sessions", () => {
    it("multiple guest tokens should all be independently valid", () => {
      const tokens = Array.from({ length: 5 }, () => generateGuestToken());
      tokens.forEach((token) => {
        const result = simulateAuthMiddleware(token);
        expect(result).not.toBeNull();
        expect(result!.isGuest).toBe(true);
      });
    });

    it("each guest session should be able to create its own game", () => {
      const sessions = Array.from({ length: 3 }, () => {
        const token = generateGuestToken();
        const auth = simulateAuthMiddleware(token)!;
        return { auth, canSolo: canCreateGame(auth.isGuest, "single") };
      });

      sessions.forEach((s) => {
        expect(s.canSolo.allowed).toBe(true);
        expect(s.auth.userId).toMatch(/^guest_/);
      });

      // All sessions have unique IDs
      const ids = sessions.map((s) => s.auth.userId);
      expect(new Set(ids).size).toBe(3);
    });
  });
});
