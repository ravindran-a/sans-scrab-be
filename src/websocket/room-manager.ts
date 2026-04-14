import { v4 as uuidv4 } from "uuid";
import { getRedisClient } from "../config/redis";

export interface RoomInfo {
  id: string;
  hostId: string;
  hostName: string;
  players: { userId: string; username: string }[];
  maxPlayers: number;
  isPrivate: boolean;
  gameId?: string;
  status: "waiting" | "playing" | "finished";
  turnTimer: number;
  createdAt: number;
}

const ROOM_PREFIX = "room:";
const ROOM_LIST_KEY = "rooms:public";
const MATCHMAKING_QUEUE = "matchmaking:queue";
const MATCHMAKING_USER_PREFIX = "matchmaking:user:";
const MATCHMAKING_ENTRY_TTL = 300; // 5 min — crash-safe auto-expiry
const ROOM_TTL = 7200; // 2h

// In-memory fallback when Redis is unavailable
const memoryRooms = new Map<string, RoomInfo>();
const memoryMatchQueue: {
  userId: string;
  username: string;
  elo: number;
  timestamp: number;
}[] = [];

async function createRoom(
  hostId: string,
  hostName: string,
  isPrivate: boolean = false,
  turnTimer: number = 120,
): Promise<RoomInfo> {
  const redis = getRedisClient();
  const id = uuidv4().slice(0, 8).toUpperCase();

  const room: RoomInfo = {
    id,
    hostId,
    hostName,
    players: [{ userId: hostId, username: hostName }],
    maxPlayers: 2,
    isPrivate,
    status: "waiting",
    turnTimer,
    createdAt: Date.now(),
  };

  if (redis) {
    await redis.set(`${ROOM_PREFIX}${id}`, JSON.stringify(room), {
      EX: ROOM_TTL,
    });
    if (!isPrivate) {
      await redis.sAdd(ROOM_LIST_KEY, id);
    }
  } else {
    memoryRooms.set(id, room);
  }

  return room;
}

async function getRoom(roomId: string): Promise<RoomInfo | null> {
  const redis = getRedisClient();
  if (redis) {
    const data = await redis.get(`${ROOM_PREFIX}${roomId}`);
    return data ? JSON.parse(data) : null;
  }
  return memoryRooms.get(roomId) || null;
}

async function joinRoom(
  roomId: string,
  userId: string,
  username: string,
): Promise<RoomInfo> {
  const room = await getRoom(roomId);
  if (!room) throw new Error("Room not found");
  if (room.status !== "waiting")
    throw new Error("Room is not accepting players");
  if (room.players.length >= room.maxPlayers) throw new Error("Room is full");
  if (room.players.some((p) => p.userId === userId))
    throw new Error("Already in room");

  room.players.push({ userId, username });
  await updateRoom(room);
  return room;
}

async function leaveRoom(
  roomId: string,
  userId: string,
): Promise<RoomInfo | null> {
  const room = await getRoom(roomId);
  if (!room) return null;

  room.players = room.players.filter((p) => p.userId !== userId);

  if (room.players.length === 0) {
    await deleteRoom(roomId);
    return null;
  }

  await updateRoom(room);
  return room;
}

async function updateRoom(room: RoomInfo): Promise<void> {
  const redis = getRedisClient();
  if (redis) {
    // Reset TTL to 2 hours on every update (covers rematch, game start, etc.)
    await redis.set(`${ROOM_PREFIX}${room.id}`, JSON.stringify(room), {
      EX: ROOM_TTL,
    });
    // A public room that has left the "waiting" state should not appear in
    // the public listing. Remove lazily on every update.
    if (room.status !== "waiting" || room.isPrivate) {
      await redis.sRem(ROOM_LIST_KEY, room.id);
    }
  } else {
    memoryRooms.set(room.id, room);
  }
}

async function getPublicRooms(): Promise<RoomInfo[]> {
  const redis = getRedisClient();
  if (redis) {
    const roomIds = await redis.sMembers(ROOM_LIST_KEY);
    const rooms: RoomInfo[] = [];
    const stale: string[] = [];
    for (const id of roomIds) {
      const room = await getRoom(id);
      if (room && room.status === "waiting" && !room.isPrivate) {
        rooms.push(room);
      } else {
        stale.push(id);
      }
    }
    if (stale.length > 0) await redis.sRem(ROOM_LIST_KEY, stale);
    return rooms;
  }
  return Array.from(memoryRooms.values()).filter(
    (r) => !r.isPrivate && r.status === "waiting",
  );
}

async function deleteRoom(roomId: string): Promise<void> {
  const redis = getRedisClient();
  if (redis) {
    await redis.del(`${ROOM_PREFIX}${roomId}`);
    await redis.sRem(ROOM_LIST_KEY, roomId);
  } else {
    memoryRooms.delete(roomId);
  }
}

/**
 * Matchmaking layout (Redis):
 *   matchmaking:queue            ZSET  member=userId, score=elo
 *   matchmaking:user:<userId>    STRING JSON(username, elo, timestamp)  TTL=5m
 *
 * Using userId as the ZSET member makes ZREM atomic and idempotent — two
 * processes competing for the same candidate cannot both succeed. Per-user
 * metadata keys carry a TTL so crashed processes don't leak queue entries.
 */
async function addToMatchmaking(
  userId: string,
  username: string,
  elo: number,
): Promise<void> {
  const redis = getRedisClient();
  if (redis) {
    await redis.set(
      `${MATCHMAKING_USER_PREFIX}${userId}`,
      JSON.stringify({ username, elo, timestamp: Date.now() }),
      { EX: MATCHMAKING_ENTRY_TTL },
    );
    await redis.zAdd(MATCHMAKING_QUEUE, { score: elo, value: userId });
  } else {
    const existingIdx = memoryMatchQueue.findIndex((c) => c.userId === userId);
    if (existingIdx !== -1) memoryMatchQueue.splice(existingIdx, 1);
    memoryMatchQueue.push({ userId, username, elo, timestamp: Date.now() });
  }
}

async function findMatch(
  userId: string,
  elo: number,
): Promise<{ userId: string; username: string } | null> {
  const redis = getRedisClient();
  if (redis) {
    const candidates = await redis.zRangeByScore(
      MATCHMAKING_QUEUE,
      elo - 200,
      elo + 200,
    );
    for (const candidateId of candidates) {
      if (candidateId === userId) continue;
      // Atomic claim: ZREM returns 1 iff this caller was the one to remove it.
      const removed = await redis.zRem(MATCHMAKING_QUEUE, candidateId);
      if (removed === 0) continue; // another process got here first
      const metaRaw = await redis.get(
        `${MATCHMAKING_USER_PREFIX}${candidateId}`,
      );
      await redis.del(`${MATCHMAKING_USER_PREFIX}${candidateId}`);
      if (!metaRaw) continue; // metadata TTL expired — candidate is stale
      const meta = JSON.parse(metaRaw) as { username: string };
      return { userId: candidateId, username: meta.username };
    }
    return null;
  }
  const idx = memoryMatchQueue.findIndex(
    (c) => c.userId !== userId && Math.abs(c.elo - elo) <= 200,
  );
  if (idx !== -1) {
    const match = memoryMatchQueue.splice(idx, 1)[0];
    return { userId: match.userId, username: match.username };
  }
  return null;
}

async function removeFromMatchmaking(userId: string): Promise<void> {
  const redis = getRedisClient();
  if (redis) {
    await redis.zRem(MATCHMAKING_QUEUE, userId);
    await redis.del(`${MATCHMAKING_USER_PREFIX}${userId}`);
  } else {
    const idx = memoryMatchQueue.findIndex((c) => c.userId === userId);
    if (idx !== -1) memoryMatchQueue.splice(idx, 1);
  }
}

export const RoomManager = {
  createRoom,
  getRoom,
  joinRoom,
  leaveRoom,
  updateRoom,
  getPublicRooms,
  deleteRoom,
  addToMatchmaking,
  findMatch,
  removeFromMatchmaking,
};
