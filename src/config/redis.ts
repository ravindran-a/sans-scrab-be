import { createClient } from "redis";
import { ENV } from "./env";

export type RedisClientType = ReturnType<typeof createClient>;

let redisClient: RedisClientType | null = null;
let redisSubscriber: RedisClientType | null = null;

export async function connectRedis(): Promise<void> {
  try {
    const client = createClient({
      username: "default",
      password: ENV.REDIS_PASSWORD,
      socket: {
        host: ENV.REDIS_HOST,
        port: ENV.REDIS_PORT,
        connectTimeout: 5000,
      },
    });

    client.on("error", () => {}); // Suppress during connect attempt

    await client.connect();

    const sub = client.duplicate();
    sub.on("error", () => {});
    await sub.connect();

    redisClient = client;
    redisSubscriber = sub;

    // Meaningful error handlers after successful connection
    redisClient.on("error", (err) =>
      console.error("[Redis] Client error:", err.message),
    );
    redisSubscriber.on("error", (err) =>
      console.error("[Redis] Subscriber error:", err.message),
    );

    console.log("[Redis] Connected");
  } catch {
    redisClient = null;
    redisSubscriber = null;
    console.warn("[Redis] Not available - using in-memory fallback");
  }
}

export function getRedisClient(): RedisClientType | null {
  return redisClient;
}

export function getRedisSubscriber(): RedisClientType | null {
  return redisSubscriber;
}
