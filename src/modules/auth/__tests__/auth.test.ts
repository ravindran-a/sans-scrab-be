/**
 * Auth & Token Tests — verifies JWT generation, verification, expiry,
 * refresh flow, and auth middleware behavior.
 */
import jwt from "jsonwebtoken";
import { ENV } from "../../../config/env";

// Direct JWT functions (mirrors auth.service.ts without DB dependency)
const ACCESS_TOKEN_EXPIRY = "2h";
const REFRESH_TOKEN_EXPIRY = "7d";

interface JwtPayload {
  userId: string;
  username: string;
  subscription: string;
  iat?: number;
  exp?: number;
}

function generateAccessToken(payload: {
  userId: string;
  username: string;
  subscription: string;
}): string {
  return jwt.sign(payload, ENV.JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
}

function generateRefreshToken(payload: {
  userId: string;
  username: string;
  subscription: string;
}): string {
  return jwt.sign(payload, ENV.JWT_REFRESH_SECRET, {
    expiresIn: REFRESH_TOKEN_EXPIRY,
  });
}

function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, ENV.JWT_SECRET) as JwtPayload;
}

function verifyRefreshToken(token: string): JwtPayload {
  return jwt.verify(token, ENV.JWT_REFRESH_SECRET) as JwtPayload;
}

const testUser = {
  userId: "user123",
  username: "testplayer",
  subscription: "free",
};

describe("Auth & Token System", () => {
  describe("Token Generation", () => {
    it("should generate a valid access token", () => {
      const token = generateAccessToken(testUser);
      expect(token).toBeDefined();
      expect(typeof token).toBe("string");
      expect(token.split(".")).toHaveLength(3); // JWT format
    });

    it("should generate a valid refresh token", () => {
      const token = generateRefreshToken(testUser);
      expect(token).toBeDefined();
      expect(token.split(".")).toHaveLength(3);
    });

    it("should embed correct payload in access token", () => {
      const token = generateAccessToken(testUser);
      const decoded = verifyAccessToken(token);
      expect(decoded.userId).toBe("user123");
      expect(decoded.username).toBe("testplayer");
      expect(decoded.subscription).toBe("free");
    });

    it("should embed correct payload in refresh token", () => {
      const token = generateRefreshToken(testUser);
      const decoded = verifyRefreshToken(token);
      expect(decoded.userId).toBe("user123");
      expect(decoded.username).toBe("testplayer");
      expect(decoded.subscription).toBe("free");
    });

    it("should generate different tokens for different users", () => {
      const token1 = generateAccessToken(testUser);
      const token2 = generateAccessToken({ ...testUser, userId: "user456" });
      expect(token1).not.toBe(token2);
    });

    it("should include iat and exp claims", () => {
      const token = generateAccessToken(testUser);
      const decoded = jwt.decode(token) as JwtPayload;
      expect(decoded.iat).toBeDefined();
      expect(decoded.exp).toBeDefined();
      expect(decoded.exp!).toBeGreaterThan(decoded.iat!);
    });
  });

  describe("Token Expiry Configuration", () => {
    it("access token should expire in 2 hours (7200 seconds)", () => {
      const token = generateAccessToken(testUser);
      const decoded = jwt.decode(token) as JwtPayload;
      const ttl = decoded.exp! - decoded.iat!;
      expect(ttl).toBe(7200); // 2h = 7200s
    });

    it("refresh token should expire in 7 days (604800 seconds)", () => {
      const token = generateRefreshToken(testUser);
      const decoded = jwt.decode(token) as JwtPayload;
      const ttl = decoded.exp! - decoded.iat!;
      expect(ttl).toBe(604800); // 7d = 604800s
    });

    it("access token should be valid immediately after creation", () => {
      const token = generateAccessToken(testUser);
      expect(() => verifyAccessToken(token)).not.toThrow();
    });

    it("should reject an expired access token", () => {
      // Create a token that expired 1 second ago
      const token = jwt.sign(testUser, ENV.JWT_SECRET, { expiresIn: "-1s" });
      expect(() => verifyAccessToken(token)).toThrow();
    });

    it("should reject an expired refresh token", () => {
      const token = jwt.sign(testUser, ENV.JWT_REFRESH_SECRET, {
        expiresIn: "-1s",
      });
      expect(() => verifyRefreshToken(token)).toThrow();
    });
  });

  describe("Token Verification", () => {
    it("should reject access token verified with wrong secret", () => {
      const token = jwt.sign(testUser, "wrong_secret", { expiresIn: "2h" });
      expect(() => verifyAccessToken(token)).toThrow();
    });

    it("should reject refresh token verified with access secret", () => {
      const token = generateRefreshToken(testUser);
      // Refresh tokens use JWT_REFRESH_SECRET, not JWT_SECRET
      expect(() => verifyAccessToken(token)).toThrow();
    });

    it("should reject access token verified with refresh secret", () => {
      const token = generateAccessToken(testUser);
      expect(() => verifyRefreshToken(token)).toThrow();
    });

    it("should reject a malformed token", () => {
      expect(() => verifyAccessToken("not.a.valid.token")).toThrow();
    });

    it("should reject an empty string", () => {
      expect(() => verifyAccessToken("")).toThrow();
    });

    it("should reject a tampered token", () => {
      const token = generateAccessToken(testUser);
      // Flip a character in the signature
      const tampered =
        token.slice(0, -1) + (token.slice(-1) === "a" ? "b" : "a");
      expect(() => verifyAccessToken(tampered)).toThrow();
    });
  });

  describe("Auth Middleware Logic", () => {
    // Simulate middleware behavior without Express (pure logic test)

    function simulateMiddleware(authHeader: string | undefined): {
      status?: number;
      error?: string;
      userId?: string;
    } {
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return { status: 401, error: "Access token required" };
      }

      const token = authHeader.split(" ")[1];
      try {
        const decoded = verifyAccessToken(token);
        return { userId: decoded.userId };
      } catch {
        return { status: 401, error: "Invalid or expired token" };
      }
    }

    it("should pass with a valid token", () => {
      const token = generateAccessToken(testUser);
      const result = simulateMiddleware(`Bearer ${token}`);
      expect(result.userId).toBe("user123");
      expect(result.error).toBeUndefined();
    });

    it("should reject missing Authorization header", () => {
      const result = simulateMiddleware(undefined);
      expect(result.status).toBe(401);
      expect(result.error).toBe("Access token required");
    });

    it("should reject empty Authorization header", () => {
      const result = simulateMiddleware("");
      expect(result.status).toBe(401);
      expect(result.error).toBe("Access token required");
    });

    it("should reject non-Bearer auth scheme", () => {
      const token = generateAccessToken(testUser);
      const result = simulateMiddleware(`Basic ${token}`);
      expect(result.status).toBe(401);
      expect(result.error).toBe("Access token required");
    });

    it("should reject expired token", () => {
      const token = jwt.sign(testUser, ENV.JWT_SECRET, { expiresIn: "-1s" });
      const result = simulateMiddleware(`Bearer ${token}`);
      expect(result.status).toBe(401);
      expect(result.error).toBe("Invalid or expired token");
    });

    it("should reject token with wrong secret", () => {
      const token = jwt.sign(testUser, "wrong_secret", { expiresIn: "2h" });
      const result = simulateMiddleware(`Bearer ${token}`);
      expect(result.status).toBe(401);
      expect(result.error).toBe("Invalid or expired token");
    });

    it("should work for all subscription tiers", () => {
      for (const sub of ["free", "pro", "guru"]) {
        const token = generateAccessToken({ ...testUser, subscription: sub });
        const result = simulateMiddleware(`Bearer ${token}`);
        expect(result.userId).toBe("user123");
      }
    });
  });

  describe("Token Refresh Flow (unit logic)", () => {
    it("refresh token should remain valid long after access token would expire", () => {
      const accessToken = generateAccessToken(testUser);
      const refreshToken = generateRefreshToken(testUser);

      const accessDecoded = jwt.decode(accessToken) as JwtPayload;
      const refreshDecoded = jwt.decode(refreshToken) as JwtPayload;

      // Refresh token expires much later than access token
      expect(refreshDecoded.exp!).toBeGreaterThan(accessDecoded.exp!);
      // Difference should be ~6d22h (7d - 2h)
      const diffSeconds = refreshDecoded.exp! - accessDecoded.exp!;
      expect(diffSeconds).toBe(604800 - 7200); // 597600s
    });

    it("new access token from same payload should have fresh expiry", () => {
      const token1 = generateAccessToken(testUser);
      const decoded1 = jwt.decode(token1) as JwtPayload;

      // Simulate a tiny delay
      const token2 = generateAccessToken(testUser);
      const decoded2 = jwt.decode(token2) as JwtPayload;

      // Both should have same TTL (2h)
      expect(decoded2.exp! - decoded2.iat!).toBe(7200);
      expect(decoded1.exp! - decoded1.iat!).toBe(7200);
    });

    it("simulated refresh: expired access + valid refresh → new access token", () => {
      // Simulate: access token expired, refresh token still valid
      const expiredAccess = jwt.sign(testUser, ENV.JWT_SECRET, {
        expiresIn: "-1s",
      });
      const validRefresh = generateRefreshToken(testUser);

      // Access token should fail
      expect(() => verifyAccessToken(expiredAccess)).toThrow();

      // Refresh token should still work
      const refreshPayload = verifyRefreshToken(validRefresh);
      expect(refreshPayload.userId).toBe("user123");

      // Generate new access token from refresh payload
      const newAccess = generateAccessToken({
        userId: refreshPayload.userId,
        username: refreshPayload.username,
        subscription: refreshPayload.subscription,
      });

      // New access token should be valid
      const newDecoded = verifyAccessToken(newAccess);
      expect(newDecoded.userId).toBe("user123");
      expect(newDecoded.exp! - newDecoded.iat!).toBe(7200);
    });
  });

  describe("Socket Auth Simulation", () => {
    // Simulates the socket auth middleware from socket-server.ts

    function simulateSocketAuth(handshakeAuth: { token?: string }): {
      error?: string;
      userId?: string;
    } {
      const token = handshakeAuth.token;
      if (!token) {
        return { error: "Authentication required" };
      }
      try {
        const decoded = verifyAccessToken(token);
        return { userId: decoded.userId };
      } catch {
        return { error: "Invalid token" };
      }
    }

    it("should authenticate socket with valid token", () => {
      const token = generateAccessToken(testUser);
      const result = simulateSocketAuth({ token });
      expect(result.userId).toBe("user123");
      expect(result.error).toBeUndefined();
    });

    it("should reject socket with no token", () => {
      const result = simulateSocketAuth({});
      expect(result.error).toBe("Authentication required");
    });

    it("should reject socket with expired token", () => {
      const token = jwt.sign(testUser, ENV.JWT_SECRET, { expiresIn: "-1s" });
      const result = simulateSocketAuth({ token });
      expect(result.error).toBe("Invalid token");
    });

    it("should accept socket reconnection with refreshed token", () => {
      // Simulate: old token expired, user refreshed, reconnecting with new token
      const expiredToken = jwt.sign(testUser, ENV.JWT_SECRET, {
        expiresIn: "-1s",
      });
      const result1 = simulateSocketAuth({ token: expiredToken });
      expect(result1.error).toBe("Invalid token");

      // User refreshes and gets new token
      const newToken = generateAccessToken(testUser);
      const result2 = simulateSocketAuth({ token: newToken });
      expect(result2.userId).toBe("user123");
    });

    it("2h token should survive a long game session", () => {
      const token = generateAccessToken(testUser);
      const decoded = jwt.decode(token) as JwtPayload;

      // Token should be valid for 2 hours from now
      const now = Math.floor(Date.now() / 1000);
      const expiresIn = decoded.exp! - now;

      // Should have at least ~7190 seconds remaining (allowing for test execution time)
      expect(expiresIn).toBeGreaterThan(7100);
      expect(expiresIn).toBeLessThanOrEqual(7200);
    });
  });
});
