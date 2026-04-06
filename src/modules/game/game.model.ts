import mongoose, { Document, Schema } from "mongoose";

export type GameMode = "single" | "ai" | "multiplayer";
export type GameStatus = "waiting" | "active" | "finished" | "abandoned";

export interface PlayerState {
  userId: string;
  username: string;
  rack: string[];
  score: number;
  connected: boolean;
}

export interface MoveRecord {
  playerId: string;
  placements: { row: number; col: number; akshara: string }[];
  wordsFormed: string[];
  score: number;
  timestamp: Date;
}

export interface IGame extends Document {
  mode: GameMode;
  status: GameStatus;
  board: any;
  players: PlayerState[];
  currentTurn: number;
  tileBag: string[];
  moves: MoveRecord[];
  aiDifficulty?: number;
  turnTimer: number;
  turnStartedAt?: Date;
  roomId?: string;
  winner?: string;
  eloChange?: { [userId: string]: number };
  isGuest?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const GameSchema = new Schema<IGame>(
  {
    mode: {
      type: String,
      enum: ["single", "ai", "multiplayer"],
      required: true,
    },
    status: {
      type: String,
      enum: ["waiting", "active", "finished", "abandoned"],
      default: "waiting",
    },
    board: { type: Schema.Types.Mixed, required: true },
    players: [
      {
        userId: String,
        username: String,
        rack: [String],
        score: { type: Number, default: 0 },
        connected: { type: Boolean, default: true },
      },
    ],
    currentTurn: { type: Number, default: 0 },
    tileBag: [String],
    moves: [
      {
        playerId: String,
        placements: [{ row: Number, col: Number, akshara: String }],
        wordsFormed: [String],
        score: Number,
        timestamp: { type: Date, default: Date.now },
      },
    ],
    aiDifficulty: { type: Number, min: 1, max: 3 },
    turnTimer: { type: Number, default: 120 },
    turnStartedAt: { type: Date },
    roomId: { type: String, index: true },
    winner: { type: String },
    eloChange: { type: Schema.Types.Mixed },
    isGuest: { type: Boolean, default: false },
  },
  { timestamps: true },
);

GameSchema.index({ status: 1 });
GameSchema.index({ "players.userId": 1 });

export const GameModel = mongoose.model<IGame>("Game", GameSchema);
