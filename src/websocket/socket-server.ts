import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { getRedisClient, getRedisSubscriber } from '../config/redis';
import { AuthService } from '../modules/auth/auth.service';
import { GameService } from '../modules/game/game.service';
import { LeaderboardService } from '../modules/leaderboard/leaderboard.service';
import { RoomManager } from './room-manager';
import { SOCKET_EVENTS } from './events';
import { ENV } from '../config/env';
import { UserModel } from '../modules/auth/auth.model';
import { GameModel } from '../modules/game/game.model';

interface AuthenticatedSocket extends Socket {
  userId: string;
  username: string;
  subscription: string;
}

// --- Turn Timer Manager ---
const turnTimers = new Map<string, NodeJS.Timeout>();
const timerIntervals = new Map<string, NodeJS.Timeout>();
// Cache timer data in memory to avoid DB queries every 5s
const timerCache = new Map<string, { roomId: string; turnTimer: number; turnStartedAt: number }>();

function startTurnTimer(io: Server, gameId: string, turnTimer: number, turnStartedAt: Date) {
  clearTurnTimer(gameId);

  const startTime = new Date(turnStartedAt).getTime();
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const remaining = Math.max(0, turnTimer - elapsed);

  // Cache the timer data — no need to query DB every 5s for static values
  // We need the roomId, fetch it once
  GameModel.findById(gameId).select('roomId').then(game => {
    if (!game?.roomId) return;
    timerCache.set(gameId, { roomId: game.roomId, turnTimer, turnStartedAt: startTime });
  });

  // Broadcast remaining time every 5s using cached data
  const interval = setInterval(() => {
    const cached = timerCache.get(gameId);
    if (!cached) {
      clearTurnTimer(gameId);
      return;
    }
    const timeLeft = Math.max(0, cached.turnTimer - Math.floor((Date.now() - cached.turnStartedAt) / 1000));
    io.to(cached.roomId).emit(SOCKET_EVENTS.GAME_TIMER, { gameId, timeLeft });
  }, 5000);
  timerIntervals.set(gameId, interval);

  // Auto-pass when time runs out
  const timeout = setTimeout(async () => {
    clearInterval(interval);
    timerIntervals.delete(gameId);
    turnTimers.delete(gameId);

    try {
      const game = await GameModel.findById(gameId);
      if (!game || game.status !== 'active') return;

      const currentPlayerIdx = game.currentTurn % game.players.length;
      const currentPlayer = game.players[currentPlayerIdx];

      const updatedGame = await GameService.passTurn(gameId, currentPlayer.userId);

      if (updatedGame.roomId) {
        broadcastGameState(io, updatedGame, updatedGame.roomId);
        io.to(updatedGame.roomId).emit(SOCKET_EVENTS.GAME_TIMER, { gameId, timeLeft: 0, autoPass: true, player: currentPlayer.username });

        if (updatedGame.status === 'finished') {
          await handleGameOver(io, updatedGame);
        } else {
          startTurnTimer(io, gameId, updatedGame.turnTimer, updatedGame.turnStartedAt!);
        }
      }
    } catch (err) {
      console.error('[Timer] Auto-pass error:', err);
    }
  }, remaining * 1000);

  turnTimers.set(gameId, timeout);
}

function clearTurnTimer(gameId: string) {
  const timeout = turnTimers.get(gameId);
  if (timeout) { clearTimeout(timeout); turnTimers.delete(gameId); }
  const interval = timerIntervals.get(gameId);
  if (interval) { clearInterval(interval); timerIntervals.delete(gameId); }
  timerCache.delete(gameId);
}

// --- Socket Rate Limiter ---
const socketRateLimits = new Map<string, number[]>();
const RATE_LIMIT_WINDOW = 10000; // 10 seconds
const RATE_LIMIT_MAX = 30; // max 30 events per 10s

function checkRateLimit(socketId: string): boolean {
  const now = Date.now();
  const timestamps = socketRateLimits.get(socketId) || [];
  const recent = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW);
  recent.push(now);
  socketRateLimits.set(socketId, recent);
  return recent.length <= RATE_LIMIT_MAX;
}

export function initSocketServer(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: {
      origin: ENV.CORS_ORIGIN.split(',').map(o => o.trim()),
      methods: ['GET', 'POST'],
      credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // Redis adapter for horizontal scaling
  const redisClient = getRedisClient();
  const redisSub = getRedisSubscriber();
  if (redisClient && redisSub) {
    try {
      io.adapter(createAdapter(redisClient, redisSub));
      console.log('[Socket] Redis adapter attached');
    } catch {
      console.warn('[Socket] Redis adapter not available, using default adapter');
    }
  } else {
    console.log('[Socket] Using default in-memory adapter (no Redis)');
  }

  // Auth middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth.token || socket.handshake.query.token;
    if (!token) {
      return next(new Error('Authentication required'));
    }
    try {
      const decoded = AuthService.verifyAccessToken(token as string);
      (socket as AuthenticatedSocket).userId = decoded.userId;
      (socket as AuthenticatedSocket).username = decoded.username;
      (socket as AuthenticatedSocket).subscription = decoded.subscription;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on(SOCKET_EVENTS.CONNECTION, (rawSocket: Socket) => {
    const socket = rawSocket as AuthenticatedSocket;
    console.log(`[Socket] ${socket.username} connected`);

    // Rate limit wrapper
    const rateLimited = (handler: (...args: any[]) => Promise<void> | void) => {
      return (...args: any[]) => {
        if (!checkRateLimit(socket.id)) {
          socket.emit(SOCKET_EVENTS.ERROR, { message: 'Rate limit exceeded. Please slow down.' });
          return;
        }
        return handler(...args);
      };
    };

    // --- Room Management ---

    socket.on(SOCKET_EVENTS.CREATE_ROOM, rateLimited(async (data: { isPrivate?: boolean; turnTimer?: number }) => {
      try {
        const room = await RoomManager.createRoom(
          socket.userId,
          socket.username,
          data.isPrivate || false,
          data.turnTimer || 120
        );
        socket.join(room.id);
        socket.emit(SOCKET_EVENTS.ROOM_CREATED, { room });
      } catch (err: any) {
        socket.emit(SOCKET_EVENTS.ERROR, { message: err.message });
      }
    }));

    socket.on(SOCKET_EVENTS.JOIN_ROOM, rateLimited(async (data: { roomId: string }) => {
      try {
        const room = await RoomManager.joinRoom(data.roomId, socket.userId, socket.username);
        socket.join(room.id);
        io.to(room.id).emit(SOCKET_EVENTS.ROOM_JOINED, { room });

        // If room is full, start the game
        if (room.players.length >= room.maxPlayers) {
          const game = await GameService.createGame({
            mode: 'multiplayer',
            userId: room.players[0].userId,
            username: room.players[0].username,
            roomId: room.id,
            turnTimer: room.turnTimer,
          });

          // Join second player
          const joinedGame = await GameService.joinGame(
            game._id.toString(),
            room.players[1].userId,
            room.players[1].username
          );

          room.gameId = joinedGame._id.toString();
          room.status = 'playing';
          await RoomManager.updateRoom(room);

          io.to(room.id).emit(SOCKET_EVENTS.GAME_START, {
            gameId: joinedGame._id.toString(),
            room,
          });

          // Send personalized game states
          for (const player of room.players) {
            const sockets = await io.in(room.id).fetchSockets();
            for (const s of sockets) {
              const as = s as unknown as AuthenticatedSocket;
              if (as.userId === player.userId) {
                as.emit(SOCKET_EVENTS.GAME_STATE, {
                  game: sanitizeGameForPlayer(joinedGame, player.userId),
                });
              }
            }
          }

          // Start turn timer
          startTurnTimer(io, joinedGame._id.toString(), joinedGame.turnTimer, joinedGame.turnStartedAt!);
        }
      } catch (err: any) {
        socket.emit(SOCKET_EVENTS.ERROR, { message: err.message });
      }
    }));

    socket.on(SOCKET_EVENTS.LEAVE_ROOM, rateLimited(async (data: { roomId: string }) => {
      try {
        const room = await RoomManager.leaveRoom(data.roomId, socket.userId);
        socket.leave(data.roomId);

        if (room) {
          io.to(data.roomId).emit(SOCKET_EVENTS.ROOM_LEFT, { room, userId: socket.userId });
        }
      } catch (err: any) {
        socket.emit(SOCKET_EVENTS.ERROR, { message: err.message });
      }
    }));

    socket.on(SOCKET_EVENTS.ROOM_LIST, rateLimited(async () => {
      try {
        const rooms = await RoomManager.getPublicRooms();
        socket.emit(SOCKET_EVENTS.ROOM_LIST, { rooms });
      } catch (err: any) {
        socket.emit(SOCKET_EVENTS.ERROR, { message: err.message });
      }
    }));

    // --- Matchmaking ---

    socket.on(SOCKET_EVENTS.FIND_MATCH, rateLimited(async () => {
      try {
        const user = await UserModel.findById(socket.userId);
        if (!user) throw new Error('User not found');

        const opponent = await RoomManager.findMatch(socket.userId, user.elo);
        if (opponent) {
          // Create a room and game
          const room = await RoomManager.createRoom(socket.userId, socket.username, true);
          await RoomManager.joinRoom(room.id, opponent.userId, opponent.username);

          const game = await GameService.createGame({
            mode: 'multiplayer',
            userId: socket.userId,
            username: socket.username,
            roomId: room.id,
          });
          const joinedGame = await GameService.joinGame(
            game._id.toString(),
            opponent.userId,
            opponent.username
          );

          room.gameId = joinedGame._id.toString();
          room.status = 'playing';
          await RoomManager.updateRoom(room);

          socket.join(room.id);
          socket.emit(SOCKET_EVENTS.MATCH_FOUND, {
            gameId: joinedGame._id.toString(),
            room,
            opponent: { username: opponent.username },
          });

          // Notify opponent
          const opponentSockets = await io.fetchSockets();
          for (const s of opponentSockets) {
            const as = s as unknown as AuthenticatedSocket;
            if (as.userId === opponent.userId) {
              as.join(room.id);
              as.emit(SOCKET_EVENTS.MATCH_FOUND, {
                gameId: joinedGame._id.toString(),
                room,
                opponent: { username: socket.username },
              });
            }
          }

          // Start turn timer
          startTurnTimer(io, joinedGame._id.toString(), joinedGame.turnTimer, joinedGame.turnStartedAt!);
        } else {
          await RoomManager.addToMatchmaking(socket.userId, socket.username, user.elo);
          socket.emit(SOCKET_EVENTS.FIND_MATCH, { status: 'searching' });
        }
      } catch (err: any) {
        socket.emit(SOCKET_EVENTS.ERROR, { message: err.message });
      }
    }));

    socket.on(SOCKET_EVENTS.MATCH_CANCEL, rateLimited(async () => {
      await RoomManager.removeFromMatchmaking(socket.userId);
    }));

    // --- Game Actions ---

    socket.on(SOCKET_EVENTS.GAME_MOVE, rateLimited(async (data: {
      gameId: string;
      placements: { row: number; col: number; akshara: string }[];
      rackIndices: number[];
    }) => {
      try {
        const { game, moveScore, wordsFormed } = await GameService.makeMove({
          gameId: data.gameId,
          userId: socket.userId,
          placements: data.placements,
          rackIndices: data.rackIndices,
        });

        const roomId = game.roomId;
        if (roomId) {
          // Send personalized states to each player
          const sockets = await io.in(roomId).fetchSockets();
          for (const s of sockets) {
            const as = s as unknown as AuthenticatedSocket;
            as.emit(SOCKET_EVENTS.GAME_MOVE_RESULT, {
              game: sanitizeGameForPlayer(game, as.userId),
              moveScore,
              wordsFormed,
              movedBy: socket.username,
            });
          }

          // Check game over
          if (game.status === 'finished') {
            clearTurnTimer(data.gameId);
            await handleGameOver(io, game);
          } else {
            // Restart turn timer for next player
            startTurnTimer(io, data.gameId, game.turnTimer, game.turnStartedAt!);
          }
        } else {
          socket.emit(SOCKET_EVENTS.GAME_MOVE_RESULT, {
            game: sanitizeGameForPlayer(game, socket.userId),
            moveScore,
            wordsFormed,
          });
        }
      } catch (err: any) {
        socket.emit(SOCKET_EVENTS.ERROR, { message: err.message });
      }
    }));

    socket.on(SOCKET_EVENTS.GAME_PASS, rateLimited(async (data: { gameId: string }) => {
      try {
        const game = await GameService.passTurn(data.gameId, socket.userId);
        const roomId = game.roomId;
        if (roomId) {
          broadcastGameState(io, game, roomId);
          if (game.status === 'finished') {
            clearTurnTimer(data.gameId);
            await handleGameOver(io, game);
          } else {
            startTurnTimer(io, data.gameId, game.turnTimer, game.turnStartedAt!);
          }
        } else {
          socket.emit(SOCKET_EVENTS.GAME_STATE, {
            game: sanitizeGameForPlayer(game, socket.userId),
          });
        }
      } catch (err: any) {
        socket.emit(SOCKET_EVENTS.ERROR, { message: err.message });
      }
    }));

    socket.on(SOCKET_EVENTS.GAME_EXCHANGE, rateLimited(async (data: { gameId: string; rackIndices: number[] }) => {
      try {
        const game = await GameService.exchangeTiles(data.gameId, socket.userId, data.rackIndices);
        const roomId = game.roomId;
        if (roomId) {
          // Broadcast to all players (opponent sees updated turn/bag count)
          broadcastGameState(io, game, roomId);
          // Restart timer for next player
          startTurnTimer(io, data.gameId, game.turnTimer, game.turnStartedAt!);
        } else {
          socket.emit(SOCKET_EVENTS.GAME_STATE, {
            game: sanitizeGameForPlayer(game, socket.userId),
          });
        }
      } catch (err: any) {
        socket.emit(SOCKET_EVENTS.ERROR, { message: err.message });
      }
    }));

    socket.on(SOCKET_EVENTS.GAME_ABANDON, rateLimited(async (data: { gameId: string }) => {
      try {
        const game = await GameService.abandonGame(data.gameId, socket.userId);
        clearTurnTimer(data.gameId);
        if (game.roomId) {
          io.to(game.roomId).emit(SOCKET_EVENTS.GAME_OVER, {
            game: sanitizeGameForPlayer(game, socket.userId),
            reason: 'abandoned',
            winner: game.winner,
            abandonedBy: socket.username,
          });
          await handleGameOver(io, game);
          await RoomManager.deleteRoom(game.roomId);
        }
      } catch (err: any) {
        socket.emit(SOCKET_EVENTS.ERROR, { message: err.message });
      }
    }));

    // --- Chat ---

    socket.on(SOCKET_EVENTS.CHAT_MESSAGE, rateLimited(async (data: { roomId: string; message: string }) => {
      if (!data.message || data.message.length > 200) return;
      io.to(data.roomId).emit(SOCKET_EVENTS.CHAT_MESSAGE, {
        userId: socket.userId,
        username: socket.username,
        message: data.message.trim(),
        timestamp: Date.now(),
      });
    }));

    // --- Rematch ---

    socket.on(SOCKET_EVENTS.REMATCH_REQUEST, rateLimited(async (data: { roomId: string; gameId: string }) => {
      io.to(data.roomId).emit(SOCKET_EVENTS.REMATCH_REQUEST, {
        requestedBy: socket.userId,
        username: socket.username,
      });
    }));

    socket.on(SOCKET_EVENTS.REMATCH_ACCEPT, rateLimited(async (data: { roomId: string; oldGameId: string }) => {
      try {
        const oldRoom = await RoomManager.getRoom(data.roomId);
        if (!oldRoom || oldRoom.players.length < 2) {
          socket.emit(SOCKET_EVENTS.ERROR, { message: 'Room no longer valid' });
          return;
        }

        // Create a new game with the same players
        const game = await GameService.createGame({
          mode: 'multiplayer',
          userId: oldRoom.players[0].userId,
          username: oldRoom.players[0].username,
          roomId: data.roomId,
          turnTimer: oldRoom.turnTimer,
        });

        const joinedGame = await GameService.joinGame(
          game._id.toString(),
          oldRoom.players[1].userId,
          oldRoom.players[1].username
        );

        oldRoom.gameId = joinedGame._id.toString();
        oldRoom.status = 'playing';
        await RoomManager.updateRoom(oldRoom);

        io.to(data.roomId).emit(SOCKET_EVENTS.GAME_START, {
          gameId: joinedGame._id.toString(),
          room: oldRoom,
        });

        // Send personalized game states
        for (const player of oldRoom.players) {
          const sockets = await io.in(data.roomId).fetchSockets();
          for (const s of sockets) {
            const as = s as unknown as AuthenticatedSocket;
            if (as.userId === player.userId) {
              as.emit(SOCKET_EVENTS.GAME_STATE, {
                game: sanitizeGameForPlayer(joinedGame, player.userId),
              });
            }
          }
        }

        startTurnTimer(io, joinedGame._id.toString(), joinedGame.turnTimer, joinedGame.turnStartedAt!);
      } catch (err: any) {
        socket.emit(SOCKET_EVENTS.ERROR, { message: err.message });
      }
    }));

    // --- Reconnect ---

    socket.on(SOCKET_EVENTS.GAME_RECONNECT, rateLimited(async (data: { gameId: string }) => {
      try {
        const game = await GameService.getGame(data.gameId);
        if (!game) return;

        const player = game.players.find((p: any) => p.userId === socket.userId);
        if (player) {
          player.connected = true;
          await (game as any).save();

          // Rejoin room if exists
          if (game.roomId) {
            socket.join(game.roomId);
            // Notify opponent of reconnection
            io.to(game.roomId).emit(SOCKET_EVENTS.GAME_STATE, {
              game: sanitizeGameForPlayer(game, socket.userId),
              reconnected: socket.username,
            });
          }

          // Send current game state to reconnecting player
          socket.emit(SOCKET_EVENTS.GAME_STATE, {
            game: sanitizeGameForPlayer(game, socket.userId),
          });

          // Send current timer (multiplayer only — solo/AI don't have turn timers)
          if (game.mode === 'multiplayer' && game.status === 'active' && game.turnStartedAt) {
            const timeLeft = Math.max(0, game.turnTimer - Math.floor((Date.now() - new Date(game.turnStartedAt).getTime()) / 1000));
            socket.emit(SOCKET_EVENTS.GAME_TIMER, { gameId: data.gameId, timeLeft });
          }
        }
      } catch (err: any) {
        socket.emit(SOCKET_EVENTS.ERROR, { message: err.message });
      }
    }));

    // --- Disconnect ---

    socket.on(SOCKET_EVENTS.DISCONNECT, async () => {
      console.log(`[Socket] ${socket.username} disconnected`);
      await RoomManager.removeFromMatchmaking(socket.userId);
      socketRateLimits.delete(socket.id);

      // Find active games for this user and mark disconnected
      try {
        const activeGames = await GameModel.find({
          'players.userId': socket.userId,
          status: 'active',
        });

        for (const game of activeGames) {
          const player = game.players.find((p: any) => p.userId === socket.userId);
          if (player) {
            player.connected = false;
            await game.save();

            // Notify opponent via room
            if (game.roomId) {
              io.to(game.roomId).emit(SOCKET_EVENTS.GAME_STATE, {
                game: sanitizeGameForPlayer(game, ''),
                disconnected: socket.username,
              });
            }
          }
        }
      } catch (err) {
        console.error('[Socket] Disconnect cleanup error:', err);
      }
    });
  });

  return io;
}

async function broadcastGameState(io: Server, game: any, roomId: string) {
  const sockets = await io.in(roomId).fetchSockets();
  for (const s of sockets) {
    const as = s as unknown as AuthenticatedSocket;
    as.emit(SOCKET_EVENTS.GAME_STATE, {
      game: sanitizeGameForPlayer(game, as.userId),
    });
  }
}

async function handleGameOver(io: Server, game: any) {
  clearTurnTimer(game._id?.toString() || '');

  if (game.mode === 'multiplayer' && game.winner && game.winner !== 'ai') {
    const loserId = game.players.find((p: any) => p.userId !== game.winner)?.userId;
    if (loserId) {
      try {
        const { winnerChange, loserChange } = await LeaderboardService.updateElo(game.winner, loserId);
        game.eloChange = { [game.winner]: winnerChange, [loserId]: loserChange };
        await game.save();
      } catch (err) {
        console.error('[ELO] Update error:', err);
      }
    }
  }

  if (game.roomId) {
    io.to(game.roomId).emit(SOCKET_EVENTS.GAME_OVER, {
      winner: game.winner,
      players: game.players,
      eloChange: game.eloChange,
    });
    // Don't delete room immediately — allow rematch
  }
}

function sanitizeGameForPlayer(game: any, userId: string) {
  const obj = game.toObject ? game.toObject() : { ...game };
  obj.players = obj.players.map((p: any) => {
    if (p.userId !== userId && p.userId !== 'ai') {
      return { ...p, rack: undefined, rackCount: p.rack?.length || 0 };
    }
    return p;
  });
  obj.tileBagCount = obj.tileBag?.length || 0;
  delete obj.tileBag;
  return obj;
}
