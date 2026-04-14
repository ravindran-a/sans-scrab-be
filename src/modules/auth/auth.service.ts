import jwt from "jsonwebtoken";
import { ENV } from "../../config/env";
import { IUser, UserModel } from "./auth.model";

const ACCESS_TOKEN_EXPIRY = "2h";
const REFRESH_TOKEN_EXPIRY = "7d";

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface JwtPayload {
  userId: string;
  username: string;
  subscription: string;
  isGuest?: boolean;
}

const GUEST_TOKEN_EXPIRY = "2h";

function generateTokens(user: IUser): TokenPair {
  const payload: JwtPayload = {
    userId: user._id.toString(),
    username: user.username,
    subscription: user.subscription,
  };

  const accessToken = jwt.sign(payload, ENV.JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_EXPIRY,
  });
  const refreshToken = jwt.sign(payload, ENV.JWT_REFRESH_SECRET, {
    expiresIn: REFRESH_TOKEN_EXPIRY,
  });

  return { accessToken, refreshToken };
}

export async function register(
  username: string,
  email: string,
  password: string,
  displayName: string,
  country: string = "IN",
): Promise<{ user: IUser; tokens: TokenPair }> {
  const existingUser = await UserModel.findOne({
    $or: [{ email }, { username }],
  });
  if (existingUser) {
    throw new Error("User with this email or username already exists");
  }

  // Pre-hash the password via a model instance so the pre-save hook runs,
  // then persist once with the refresh token already set.
  const user = new UserModel({
    username,
    email,
    password,
    displayName,
    country,
  });
  const tokens = generateTokens(user);
  user.refreshToken = tokens.refreshToken;
  await user.save();

  return { user, tokens };
}

export async function login(
  emailOrUsername: string,
  password: string,
): Promise<{ user: IUser; tokens: TokenPair }> {
  const user = await UserModel.findOne({
    $or: [{ email: emailOrUsername }, { username: emailOrUsername }],
  }).select("+password");

  if (!user) {
    throw new Error("Invalid credentials");
  }

  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    throw new Error("Invalid credentials");
  }

  const tokens = generateTokens(user);
  user.refreshToken = tokens.refreshToken;
  await user.save();

  return { user, tokens };
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<TokenPair> {
  try {
    const decoded = jwt.verify(
      refreshToken,
      ENV.JWT_REFRESH_SECRET,
    ) as JwtPayload;
    const user = await UserModel.findById(decoded.userId).select(
      "+refreshToken",
    );

    if (!user || user.refreshToken !== refreshToken) {
      throw new Error("Invalid refresh token");
    }

    const tokens = generateTokens(user);
    user.refreshToken = tokens.refreshToken;
    await user.save();

    return tokens;
  } catch {
    throw new Error("Invalid refresh token");
  }
}

export async function logout(userId: string): Promise<void> {
  await UserModel.findByIdAndUpdate(userId, { refreshToken: null });
}

export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, ENV.JWT_SECRET) as JwtPayload;
}

export function generateGuestToken(): string {
  const guestId = `guest_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const payload: JwtPayload = {
    userId: guestId,
    username: "अतिथि",
    subscription: "free",
    isGuest: true,
  };
  return jwt.sign(payload, ENV.JWT_SECRET, { expiresIn: GUEST_TOKEN_EXPIRY });
}

export const AuthService = {
  register,
  login,
  refreshAccessToken,
  logout,
  verifyAccessToken,
  generateTokens,
  generateGuestToken,
};
