import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { getRedisClient, getRedisSubscriber } from '../config/redis';
import { AuthService } from '../modules/auth/auth.service';
import { GameService } from '../modules/game/game.service';
import { LeaderboardService } from '../modules/leaderboard/leaderboard.service';
import { AiPlayer } from '../modules/ai/AiPlayer';
import { RoomManager } from './room-manager';
import { SOCKET_EVENTS } from './events';
import { ENV } from '../config/env';
import { UserModel } from '../modules/auth/auth.model';

interface AuthenticatedSocket extends Socket {
  userId: string;
  username: string;
  subscription: string;
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

    // --- Room Management ---

    socket.on(SOCKET_EVENTS.CREATE_ROOM, async (data: { isPrivate?: boolean; turnTimer?: number }) => {
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
    });

    socket.on(SOCKET_EVENTS.JOIN_ROOM, async (data: { roomId: string }) => {
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
        }
      } catch (err: any) {
        socket.emit(SOCKET_EVENTS.ERROR, { message: err.message });
      }
    });

    socket.on(SOCKET_EVENTS.LEAVE_ROOM, async (data: { roomId: string }) => {
      try {
        const room = await RoomManager.leaveRoom(data.roomId, socket.userId);
        socket.leave(data.roomId);

        if (room) {
          io.to(data.roomId).emit(SOCKET_EVENTS.ROOM_LEFT, { room, userId: socket.userId });
        }
      } catch (err: any) {
        socket.emit(SOCKET_EVENTS.ERROR, { message: err.message });
      }
    });

    socket.on(SOCKET_EVENTS.ROOM_LIST, async () => {
      try {
        const rooms = await RoomManager.getPublicRooms();
        socket.emit(SOCKET_EVENTS.ROOM_LIST, { rooms });
      } catch (err: any) {
        socket.emit(SOCKET_EVENTS.ERROR, { message: err.message });
      }
    });

    // --- Matchmaking ---

    socket.on(SOCKET_EVENTS.FIND_MATCH, async () => {
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
        } else {
          await RoomManager.addToMatchmaking(socket.userId, socket.username, user.elo);
          socket.emit(SOCKET_EVENTS.FIND_MATCH, { status: 'searching' });
        }
      } catch (err: any) {
        socket.emit(SOCKET_EVENTS.ERROR, { message: err.message });
      }
    });

    socket.on(SOCKET_EVENTS.MATCH_CANCEL, async () => {
      await RoomManager.removeFromMatchmaking(socket.userId);
    });

    // --- Game Actions (Anti-cheat: client sends rack indices, not characters) ---

    socket.on(SOCKET_EVENTS.GAME_MOVE, async (data: {
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
            await handleGameOver(io, game);
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
    });

    socket.on(SOCKET_EVENTS.GAME_PASS, async (data: { gameId: string }) => {
      try {
        const game = await GameService.passTurn(data.gameId, socket.userId);
        const roomId = game.roomId;
        if (roomId) {
          broadcastGameState(io, game, roomId);
        } else {
          socket.emit(SOCKET_EVENTS.GAME_STATE, {
            game: sanitizeGameForPlayer(game, socket.userId),
          });
        }
      } catch (err: any) {
        socket.emit(SOCKET_EVENTS.ERROR, { message: err.message });
      }
    });

    socket.on(SOCKET_EVENTS.GAME_EXCHANGE, async (data: { gameId: string; rackIndices: number[] }) => {
      try {
        const game = await GameService.exchangeTiles(data.gameId, socket.userId, data.rackIndices);
        socket.emit(SOCKET_EVENTS.GAME_STATE, {
          game: sanitizeGameForPlayer(game, socket.userId),
        });
      } catch (err: any) {
        socket.emit(SOCKET_EVENTS.ERROR, { message: err.message });
      }
    });

    socket.on(SOCKET_EVENTS.GAME_ABANDON, async (data: { gameId: string }) => {
      try {
        const game = await GameService.abandonGame(data.gameId, socket.userId);
        if (game.roomId) {
          io.to(game.roomId).emit(SOCKET_EVENTS.GAME_OVER, {
            game: sanitizeGameForPlayer(game, socket.userId),
            reason: 'abandoned',
            winner: game.winner,
          });
          await RoomManager.deleteRoom(game.roomId);
        }
      } catch (err: any) {
        socket.emit(SOCKET_EVENTS.ERROR, { message: err.message });
      }
    });

    // --- Disconnect ---

    socket.on(SOCKET_EVENTS.DISCONNECT, async () => {
      console.log(`[Socket] ${socket.username} disconnected`);
      await RoomManager.removeFromMatchmaking(socket.userId);
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
    await RoomManager.deleteRoom(game.roomId);
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
