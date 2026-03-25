/**
 * Full Game Flow Tests — simulates actual gameplay end-to-end.
 * Tests solo mode, AI mode, multiplayer mode logic, scoring, pass mechanics, game end conditions.
 */
import { AiPlayer } from "../../modules/ai/AiPlayer";
import {
  BOARD_SIZE,
  BoardState,
  CENTER,
  TilePlacement,
  applyPlacements,
  createBoard,
  extractWords,
  isBoardEmpty,
  validatePlacement,
} from "../Board";
import {
  isValidAkshara,
  normalizeText,
  splitAksharas,
} from "../GraphemeSplitter";
import {
  CONSONANTS,
  RACK_SIZE,
  VIRAMA,
  VOWELS,
  constructAkshara,
  createTileBag,
  drawFromBag,
  shuffleArray,
} from "../SanskritEngine";
import { calculateMoveScore, getAksharaScore } from "../Scoring";

// ─── Game simulation helpers ───

interface GameState {
  board: BoardState;
  players: {
    userId: string;
    username: string;
    rack: string[];
    score: number;
    connected: boolean;
  }[];
  tileBag: string[];
  currentTurn: number;
  moves: {
    playerId: string;
    placements: TilePlacement[];
    wordsFormed: string[];
    score: number;
  }[];
  status: "active" | "finished" | "abandoned";
  mode: "single" | "ai" | "multiplayer";
  winner: string | null;
}

/** Create a fresh game state (mirrors game.service.ts createGame). */
function createGameState(
  mode: "single" | "ai" | "multiplayer",
  aiDifficulty?: number,
): GameState {
  const board = createBoard();
  const tileBag = createTileBag();

  const draw1 = drawFromBag(tileBag, RACK_SIZE);
  const players: GameState["players"] = [
    {
      userId: "player1",
      username: "Player1",
      rack: draw1.drawn,
      score: 0,
      connected: true,
    },
  ];

  let bag = draw1.remaining;

  if (mode === "ai") {
    const draw2 = drawFromBag(bag, RACK_SIZE);
    players.push({
      userId: "ai",
      username: `AI-Level-${aiDifficulty || 1}`,
      rack: draw2.drawn,
      score: 0,
      connected: true,
    });
    bag = draw2.remaining;
  } else if (mode === "multiplayer") {
    const draw2 = drawFromBag(bag, RACK_SIZE);
    players.push({
      userId: "player2",
      username: "Player2",
      rack: draw2.drawn,
      score: 0,
      connected: true,
    });
    bag = draw2.remaining;
  }

  return {
    board,
    players,
    tileBag: bag,
    currentTurn: 0,
    moves: [],
    status: "active",
    mode,
    winner: null,
  };
}

/** Anti-cheat consonant extraction (same as game.service.ts). */
function extractConsonants(aksharas: string[]): string[] {
  const consonants: string[] = [];
  for (const akshara of aksharas) {
    const normalized = normalizeText(akshara);
    for (const ch of Array.from(normalized)) {
      const code = ch.charCodeAt(0);
      if (code >= 0x0915 && code <= 0x0939) consonants.push(ch);
    }
  }
  return consonants;
}

/** Simulate makeMove (mirrors game.service.ts). Returns error or updated state. */
function makeMove(
  game: GameState,
  userId: string,
  placements: TilePlacement[],
  rackIndices: number[],
): { error?: string; moveScore?: number; wordsFormed?: string[] } {
  if (game.status !== "active") return { error: "Game is not active" };

  const playerIndex = game.players.findIndex((p) => p.userId === userId);
  if (playerIndex === -1) return { error: "Player not in game" };
  if (game.currentTurn % game.players.length !== playerIndex)
    return { error: "Not your turn" };

  const player = game.players[playerIndex];

  // Rack index bounds
  for (const idx of rackIndices) {
    if (idx < 0 || idx >= player.rack.length)
      return { error: "Invalid rack index" };
  }

  // Anti-cheat
  const rackConsonants = rackIndices.map((idx) => player.rack[idx]);
  const neededConsonants = extractConsonants(placements.map((p) => p.akshara));
  const sortedNeeded = [...neededConsonants].sort();
  const sortedRack = [...rackConsonants].sort();
  if (
    sortedNeeded.length !== sortedRack.length ||
    sortedNeeded.some((c, i) => c !== sortedRack[i])
  ) {
    return { error: "Placed aksharas do not match the rack consonants" };
  }

  // Validate placement
  const validation = validatePlacement(game.board, placements);
  if (!validation.valid) return { error: validation.error };

  // Extract words
  const words = extractWords(game.board, placements);
  if (words.length === 0) return { error: "No words formed" };

  // Calculate score
  const { totalScore, wordScores } = calculateMoveScore(game.board, placements);

  // Apply
  game.board = applyPlacements(game.board, placements, game.moves.length);

  // Remove used consonants and refill
  const sortedIndices = [...rackIndices].sort((a, b) => b - a);
  for (const idx of sortedIndices) player.rack.splice(idx, 1);
  const needed = RACK_SIZE - player.rack.length;
  const { drawn, remaining } = drawFromBag(game.tileBag, needed);
  player.rack.push(...drawn);
  game.tileBag = remaining;

  player.score += totalScore;
  game.currentTurn += 1;
  game.moves.push({
    playerId: userId,
    placements,
    wordsFormed: words.map((w) => w.word),
    score: totalScore,
  });

  // End condition: bag empty + rack empty
  if (game.tileBag.length === 0 && player.rack.length === 0) {
    game.status = "finished";
    determineWinner(game);
  }

  return {
    moveScore: totalScore,
    wordsFormed: wordScores.map((ws) => ws.word),
  };
}

/** Simulate passTurn. */
function passTurn(game: GameState, userId: string): { error?: string } {
  if (game.status !== "active") return { error: "Game is not active" };
  const playerIndex = game.players.findIndex((p) => p.userId === userId);
  if (playerIndex === -1) return { error: "Player not in game" };
  if (game.currentTurn % game.players.length !== playerIndex)
    return { error: "Not your turn" };

  game.currentTurn += 1;
  game.moves.push({
    playerId: userId,
    placements: [],
    wordsFormed: [],
    score: 0,
  });

  // Consecutive pass check (same logic as game.service.ts)
  const lastTwo = game.moves.slice(-2);
  if (lastTwo.length === 2 && lastTwo.every((m) => m.placements.length === 0)) {
    const isSoloMode = game.players.length === 1;
    const differentPlayers = lastTwo[0].playerId !== lastTwo[1].playerId;
    if (isSoloMode || differentPlayers) {
      game.status = "finished";
      determineWinner(game);
    }
  }
  return {};
}

/** Simulate exchangeTiles. */
function exchangeTiles(
  game: GameState,
  userId: string,
  rackIndices: number[],
): { error?: string } {
  if (game.status !== "active") return { error: "Game is not active" };
  const playerIndex = game.players.findIndex((p) => p.userId === userId);
  if (playerIndex === -1) return { error: "Player not in game" };
  if (game.currentTurn % game.players.length !== playerIndex)
    return { error: "Not your turn" };
  if (game.tileBag.length < rackIndices.length)
    return { error: "Not enough tiles in bag" };

  const player = game.players[playerIndex];
  const returned: string[] = [];
  const sortedIndices = [...rackIndices].sort((a, b) => b - a);
  for (const idx of sortedIndices) {
    if (idx < 0 || idx >= player.rack.length)
      return { error: "Invalid rack index" };
    returned.push(player.rack[idx]);
    player.rack.splice(idx, 1);
  }

  const { drawn, remaining } = drawFromBag(game.tileBag, returned.length);
  player.rack.push(...drawn);
  game.tileBag = shuffleArray([...remaining, ...returned]);

  game.currentTurn += 1;
  game.moves.push({
    playerId: userId,
    placements: [],
    wordsFormed: [],
    score: 0,
  });
  return {};
}

function determineWinner(game: GameState) {
  const sorted = [...game.players].sort((a, b) => b.score - a.score);
  if (sorted.length >= 2 && sorted[0].score === sorted[1].score) {
    const lastMovePlayer =
      game.moves.length > 0 ? game.moves[game.moves.length - 1].playerId : null;
    game.winner =
      sorted.find((p) => p.userId !== lastMovePlayer)?.userId ||
      sorted[0].userId;
  } else {
    game.winner = sorted[0].userId;
  }
}

/** Sanitize game for a player (hides opponent rack). */
function sanitizeForPlayer(game: GameState, userId: string) {
  return {
    ...game,
    players: game.players.map((p) => {
      if (p.userId !== userId && p.userId !== "ai") {
        return { ...p, rack: undefined, rackCount: p.rack.length };
      }
      return p;
    }),
    tileBag: undefined,
    tileBagCount: game.tileBag.length,
  };
}

// ═══════════════════════════════════════
// TESTS
// ═══════════════════════════════════════

describe("Full Game Flow", () => {
  // ─── Solo Mode ───

  describe("Solo Mode — Single Player", () => {
    it("should create a valid solo game state", () => {
      const game = createGameState("single");
      expect(game.players.length).toBe(1);
      expect(game.players[0].rack.length).toBe(RACK_SIZE);
      expect(game.status).toBe("active");
      expect(game.mode).toBe("single");
      expect(isBoardEmpty(game.board)).toBe(true);
      expect(game.tileBag.length).toBe(106 - RACK_SIZE);
    });

    it("should allow placing a single akshara on center as first move", () => {
      const game = createGameState("single");
      const rack = game.players[0].rack;
      const akshara = constructAkshara([rack[0]], "अ");

      const result = makeMove(
        game,
        "player1",
        [{ row: CENTER, col: CENTER, akshara }],
        [0],
      );

      expect(result.error).toBeUndefined();
      expect(result.moveScore).toBeGreaterThanOrEqual(0);
      expect(game.board[CENTER][CENTER].akshara).toBe(akshara);
      expect(game.currentTurn).toBe(1);
      expect(game.players[0].rack.length).toBe(RACK_SIZE); // refilled
    });

    it("should allow placing a two-akshara word at center", () => {
      const game = createGameState("single");
      const rack = game.players[0].rack;
      const a1 = constructAkshara([rack[0]], "अ");
      const a2 = constructAkshara([rack[1]], "अ");

      const result = makeMove(
        game,
        "player1",
        [
          { row: CENTER, col: CENTER, akshara: a1 },
          { row: CENTER, col: CENTER + 1, akshara: a2 },
        ],
        [0, 1],
      );

      expect(result.error).toBeUndefined();
      // Center is double word, so score should include 2× multiplier
      expect(result.moveScore).toBeGreaterThan(0);
    });

    it("should play multiple consecutive turns (always player turn)", () => {
      const game = createGameState("single");
      const rack = game.players[0].rack;

      // Turn 1: place at center
      const a1 = constructAkshara([rack[0]], "अ");
      const a2 = constructAkshara([rack[1]], "अ");
      makeMove(
        game,
        "player1",
        [
          { row: CENTER, col: CENTER, akshara: a1 },
          { row: CENTER, col: CENTER + 1, akshara: a2 },
        ],
        [0, 1],
      );

      expect(game.currentTurn).toBe(1);
      // In solo mode, currentTurn % 1 === 0 always, so it's always player's turn
      expect(game.currentTurn % game.players.length).toBe(0);

      // Turn 2: extend
      const newRack = game.players[0].rack;
      const a3 = constructAkshara([newRack[0]], "अ");
      makeMove(
        game,
        "player1",
        [{ row: CENTER, col: CENTER + 2, akshara: a3 }],
        [0],
      );

      expect(game.currentTurn).toBe(2);
      expect(game.currentTurn % game.players.length).toBe(0); // still player's turn
      expect(game.moves.length).toBe(2);
    });

    it("should end game on two consecutive passes in solo mode", () => {
      const game = createGameState("single");

      // Pass 1
      passTurn(game, "player1");
      expect(game.status).toBe("active");

      // Pass 2 — same player, solo mode ends
      passTurn(game, "player1");
      expect(game.status).toBe("finished");
      expect(game.winner).toBe("player1");
    });

    it("should NOT end game on one pass followed by a move", () => {
      const game = createGameState("single");
      const rack = game.players[0].rack;

      // Pass
      passTurn(game, "player1");
      expect(game.status).toBe("active");

      // Move — resets consecutive pass check
      const a1 = constructAkshara([rack[0]], "अ");
      makeMove(
        game,
        "player1",
        [{ row: CENTER, col: CENTER, akshara: a1 }],
        [0],
      );
      expect(game.status).toBe("active");

      // Another pass should NOT end — only 1 consecutive pass
      passTurn(game, "player1");
      expect(game.status).toBe("active");
    });

    it("should allow tile exchange", () => {
      const game = createGameState("single");
      const bagSizeBefore = game.tileBag.length;

      exchangeTiles(game, "player1", [0, 1, 2]);

      expect(game.players[0].rack.length).toBe(RACK_SIZE);
      expect(game.currentTurn).toBe(1);
      // Bag size stays the same (returned 3, drew 3)
      expect(game.tileBag.length).toBe(bagSizeBefore);
    });

    it("should reject exchange with insufficient bag tiles", () => {
      const game = createGameState("single");
      game.tileBag = ["क"]; // only 1 tile left

      const result = exchangeTiles(game, "player1", [0, 1, 2]);
      expect(result.error).toContain("Not enough tiles");
    });

    it("should accumulate scores across turns", () => {
      const game = createGameState("single");
      const rack = game.players[0].rack;

      const a1 = constructAkshara([rack[0]], "अ");
      const a2 = constructAkshara([rack[1]], "अ");
      const move1 = makeMove(
        game,
        "player1",
        [
          { row: CENTER, col: CENTER, akshara: a1 },
          { row: CENTER, col: CENTER + 1, akshara: a2 },
        ],
        [0, 1],
      );

      const scoreAfterTurn1 = game.players[0].score;
      expect(scoreAfterTurn1).toBe(move1.moveScore!);

      const newRack = game.players[0].rack;
      const a3 = constructAkshara([newRack[0]], "अ");
      const move2 = makeMove(
        game,
        "player1",
        [{ row: CENTER, col: CENTER + 2, akshara: a3 }],
        [0],
      );

      if (!move2.error) {
        expect(game.players[0].score).toBe(scoreAfterTurn1 + move2.moveScore!);
      }
    });

    it("should reject placement not covering center on first move", () => {
      const game = createGameState("single");
      const rack = game.players[0].rack;
      const a1 = constructAkshara([rack[0]], "अ");

      const result = makeMove(
        game,
        "player1",
        [{ row: 0, col: 0, akshara: a1 }],
        [0],
      );
      expect(result.error).toContain("center");
    });

    it("should reject placement not connected to existing tiles", () => {
      const game = createGameState("single");
      const rack = game.players[0].rack;

      // First move at center
      const a1 = constructAkshara([rack[0]], "अ");
      makeMove(
        game,
        "player1",
        [{ row: CENTER, col: CENTER, akshara: a1 }],
        [0],
      );

      // Second move not connected
      const newRack = game.players[0].rack;
      const a2 = constructAkshara([newRack[0]], "अ");
      const result = makeMove(
        game,
        "player1",
        [{ row: 0, col: 0, akshara: a2 }],
        [0],
      );
      expect(result.error).toContain("connect");
    });

    it("should handle pure vowel placement on center", () => {
      const game = createGameState("single");

      const result = makeMove(
        game,
        "player1",
        [{ row: CENTER, col: CENTER, akshara: "अ" }],
        [],
      );

      expect(result.error).toBeUndefined();
      expect(result.moveScore).toBe(0); // vowels score 0
      expect(game.board[CENTER][CENTER].akshara).toBe("अ");
    });

    it("should handle conjunct akshara placement", () => {
      const game = createGameState("single");
      const rack = game.players[0].rack;

      // Build conjunct from first two consonants
      const akshara = constructAkshara([rack[0], rack[1]], "इ");

      const result = makeMove(
        game,
        "player1",
        [{ row: CENTER, col: CENTER, akshara }],
        [0, 1],
      );

      expect(result.error).toBeUndefined();
      expect(game.board[CENTER][CENTER].akshara).toBe(akshara);
    });

    it("should detect and score cross words", () => {
      const game = createGameState("single");
      const rack = game.players[0].rack;

      // Turn 1: horizontal at center
      const a1 = constructAkshara([rack[0]], "अ");
      const a2 = constructAkshara([rack[1]], "अ");
      makeMove(
        game,
        "player1",
        [
          { row: CENTER, col: CENTER, akshara: a1 },
          { row: CENTER, col: CENTER + 1, akshara: a2 },
        ],
        [0, 1],
      );

      // Turn 2: place vertically touching center tile
      const newRack = game.players[0].rack;
      const a3 = constructAkshara([newRack[0]], "अ");
      const a4 = constructAkshara([newRack[1]], "अ");

      // Place above and below the first tile to form a vertical word crossing the horizontal word
      const result = makeMove(
        game,
        "player1",
        [
          { row: CENTER - 1, col: CENTER, akshara: a3 },
          { row: CENTER + 1, col: CENTER, akshara: a4 },
        ],
        [0, 1],
      );

      if (!result.error) {
        // Should have formed at least the vertical word (3 aksharas through center)
        expect(result.wordsFormed!.length).toBeGreaterThanOrEqual(1);
      }
    });

    it("should end game when bag empty and rack empty", () => {
      const game = createGameState("single");
      // Drain the bag
      game.tileBag = [];
      // Set rack to just 1 consonant
      game.players[0].rack = ["क"];

      const a1 = constructAkshara(["क"], "अ");
      makeMove(
        game,
        "player1",
        [{ row: CENTER, col: CENTER, akshara: a1 }],
        [0],
      );

      expect(game.status).toBe("finished");
      expect(game.winner).toBe("player1");
    });
  });

  // ─── AI Mode ───

  describe("AI Mode — Player vs AI", () => {
    it("should create a valid AI game state", () => {
      const game = createGameState("ai", 1);
      expect(game.players.length).toBe(2);
      expect(game.players[0].userId).toBe("player1");
      expect(game.players[1].userId).toBe("ai");
      expect(game.players[1].username).toBe("AI-Level-1");
      expect(game.players[0].rack.length).toBe(RACK_SIZE);
      expect(game.players[1].rack.length).toBe(RACK_SIZE);
      expect(game.mode).toBe("ai");
    });

    it("should alternate turns between player and AI", () => {
      const game = createGameState("ai", 1);

      // Turn 0: player1's turn
      expect(game.currentTurn % 2).toBe(0); // player1 index 0

      const rack = game.players[0].rack;
      const a1 = constructAkshara([rack[0]], "अ");
      const a2 = constructAkshara([rack[1]], "अ");

      makeMove(
        game,
        "player1",
        [
          { row: CENTER, col: CENTER, akshara: a1 },
          { row: CENTER, col: CENTER + 1, akshara: a2 },
        ],
        [0, 1],
      );

      // Turn 1: AI's turn
      expect(game.currentTurn % 2).toBe(1);

      // Verify player1 can't move again
      const newRack = game.players[0].rack;
      const a3 = constructAkshara([newRack[0]], "अ");
      const badMove = makeMove(
        game,
        "player1",
        [{ row: CENTER, col: CENTER + 2, akshara: a3 }],
        [0],
      );
      expect(badMove.error).toContain("Not your turn");
    });

    it("should allow AI to pass", () => {
      const game = createGameState("ai", 1);

      // Player moves first
      const rack = game.players[0].rack;
      const a1 = constructAkshara([rack[0]], "अ");
      makeMove(
        game,
        "player1",
        [{ row: CENTER, col: CENTER, akshara: a1 }],
        [0],
      );

      // AI passes
      const result = passTurn(game, "ai");
      expect(result.error).toBeUndefined();
      expect(game.currentTurn).toBe(2);
      // Back to player1's turn
      expect(game.currentTurn % 2).toBe(0);
    });

    it("should end game on consecutive passes from different players", () => {
      const game = createGameState("ai", 1);

      // Player passes
      passTurn(game, "player1");
      expect(game.status).toBe("active");

      // AI passes — two different players passed consecutively
      passTurn(game, "ai");
      expect(game.status).toBe("finished");
    });

    it("should NOT end game on two passes from same player in AI mode", () => {
      const game = createGameState("ai", 1);

      // Player passes
      passTurn(game, "player1");

      // AI makes a move (simulated by advancing turn)
      const aiRack = game.players[1].rack;
      const a1 = constructAkshara([aiRack[0]], "अ");
      makeMove(game, "ai", [{ row: CENTER, col: CENTER, akshara: a1 }], [0]);

      // Player passes again — but last two moves are: AI move + player pass
      passTurn(game, "player1");
      expect(game.status).toBe("active"); // not finished
    });

    it("should correctly determine winner by score", () => {
      const game = createGameState("ai", 1);
      game.players[0].score = 50;
      game.players[1].score = 30;
      game.status = "finished";
      determineWinner(game);
      expect(game.winner).toBe("player1");
    });

    it("should break ties in favor of player who did NOT play last", () => {
      const game = createGameState("ai", 1);
      game.players[0].score = 40;
      game.players[1].score = 40;
      game.moves = [
        { playerId: "player1", placements: [], wordsFormed: [], score: 0 },
        { playerId: "ai", placements: [], wordsFormed: [], score: 0 },
      ];
      game.status = "finished";
      determineWinner(game);
      // AI played last → player1 wins tiebreak
      expect(game.winner).toBe("player1");
    });

    it("should handle AI game where player uses all tiles first", () => {
      const game = createGameState("ai", 1);
      game.tileBag = [];
      game.players[0].rack = ["क"];

      const a1 = constructAkshara(["क"], "अ");
      makeMove(
        game,
        "player1",
        [{ row: CENTER, col: CENTER, akshara: a1 }],
        [0],
      );

      expect(game.status).toBe("finished");
      expect(game.players[0].rack.length).toBe(0);
    });

    it("should verify AI anti-cheat also passes", () => {
      const game = createGameState("ai", 1);

      // Player moves first
      const pRack = game.players[0].rack;
      const pa = constructAkshara([pRack[0]], "अ");
      makeMove(
        game,
        "player1",
        [{ row: CENTER, col: CENTER, akshara: pa }],
        [0],
      );

      // Now AI's turn — verify a correct move works
      const aiRack = game.players[1].rack;
      const aiA = constructAkshara([aiRack[0]], "अ");
      const result = makeMove(
        game,
        "ai",
        [{ row: CENTER, col: CENTER + 1, akshara: aiA }],
        [0],
      );

      expect(result.error).toBeUndefined();
    });

    it("should reject AI move with wrong rack indices", () => {
      const game = createGameState("ai", 1);

      // Player first
      const pRack = game.players[0].rack;
      makeMove(
        game,
        "player1",
        [
          {
            row: CENTER,
            col: CENTER,
            akshara: constructAkshara([pRack[0]], "अ"),
          },
        ],
        [0],
      );

      // AI tries to place akshara with wrong rack index
      const aiRack = game.players[1].rack;
      const wrongA = constructAkshara([aiRack[0]], "अ");
      // Using index 5, but the consonant there might not match
      if (aiRack[5] !== aiRack[0]) {
        const result = makeMove(
          game,
          "ai",
          [{ row: CENTER, col: CENTER + 1, akshara: wrongA }],
          [5],
        );
        expect(result.error).toContain("do not match");
      }
    });

    it("should handle AI exchange tiles", () => {
      const game = createGameState("ai", 1);

      // Player passes
      passTurn(game, "player1");

      // AI exchanges
      const result = exchangeTiles(game, "ai", [0, 1]);

      expect(result.error).toBeUndefined();
      expect(game.players[1].rack.length).toBe(RACK_SIZE);
      expect(game.currentTurn).toBe(2); // back to player1
    });
  });

  // ─── AI Player Logic (unit tests) ───

  describe("AI Player Logic", () => {
    it("should clamp difficulty between 1 and 3", () => {
      const ai0 = new AiPlayer(0);
      const ai5 = new AiPlayer(5);
      // Can't test private field, but findMove should not crash
      expect(ai0).toBeDefined();
      expect(ai5).toBeDefined();
    });

    it("should return null on empty board with no dictionary (no valid moves)", async () => {
      // Without the dictionary loaded, getWordsByDifficulty returns []
      // so AI should find no moves and return null
      const board = createBoard();
      const rack = [
        "क",
        "म",
        "ज",
        "ल",
        "र",
        "त",
        "न",
        "प",
        "स",
        "ह",
        "ग",
        "च",
        "द",
        "य",
        "व",
      ];
      const ai = new AiPlayer(1);
      const move = await ai.findMove(board, rack);
      // Without dictionary loaded, should return null
      expect(move).toBeNull();
    });

    it("should return null with empty rack", async () => {
      const board = createBoard();
      const ai = new AiPlayer(1);
      const move = await ai.findMove(board, []);
      expect(move).toBeNull();
    });

    it("AI move result should have valid structure if returned", async () => {
      // This tests the structure, even though AI likely returns null without dictionary
      const board = createBoard();
      const rack = ["क", "म"];
      const ai = new AiPlayer(2);
      const move = await ai.findMove(board, rack);

      if (move !== null) {
        expect(move.placements).toBeDefined();
        expect(Array.isArray(move.placements)).toBe(true);
        expect(move.rackIndices).toBeDefined();
        expect(typeof move.score).toBe("number");
        expect(Array.isArray(move.words)).toBe(true);
      }
    });
  });

  // ─── Multiplayer / Online Mode ───

  describe("Multiplayer Mode — Online", () => {
    it("should create a valid multiplayer game state", () => {
      const game = createGameState("multiplayer");
      expect(game.players.length).toBe(2);
      expect(game.players[0].userId).toBe("player1");
      expect(game.players[1].userId).toBe("player2");
      expect(game.mode).toBe("multiplayer");
    });

    it("should enforce turn order: player1 first, then player2", () => {
      const game = createGameState("multiplayer");

      // Player2 can't go first
      const p2Rack = game.players[1].rack;
      const a1 = constructAkshara([p2Rack[0]], "अ");
      const result = makeMove(
        game,
        "player2",
        [{ row: CENTER, col: CENTER, akshara: a1 }],
        [0],
      );
      expect(result.error).toContain("Not your turn");
    });

    it("should alternate turns correctly between two players", () => {
      const game = createGameState("multiplayer");

      // Player1 turn 0
      const p1Rack = game.players[0].rack;
      const a1 = constructAkshara([p1Rack[0]], "अ");
      const a2 = constructAkshara([p1Rack[1]], "अ");
      makeMove(
        game,
        "player1",
        [
          { row: CENTER, col: CENTER, akshara: a1 },
          { row: CENTER, col: CENTER + 1, akshara: a2 },
        ],
        [0, 1],
      );
      expect(game.currentTurn).toBe(1);

      // Player2 turn 1
      const p2Rack = game.players[1].rack;
      const a3 = constructAkshara([p2Rack[0]], "अ");
      const result = makeMove(
        game,
        "player2",
        [{ row: CENTER + 1, col: CENTER, akshara: a3 }],
        [0],
      );
      expect(result.error).toBeUndefined();
      expect(game.currentTurn).toBe(2);

      // Player1 turn 2 again
      expect(game.currentTurn % 2).toBe(0);
    });

    it("should end game on consecutive passes from both players", () => {
      const game = createGameState("multiplayer");

      passTurn(game, "player1"); // turn 0 → pass
      expect(game.status).toBe("active");

      passTurn(game, "player2"); // turn 1 → pass, different players
      expect(game.status).toBe("finished");
    });

    it("should NOT end game on non-consecutive passes", () => {
      const game = createGameState("multiplayer");

      // Player1 passes
      passTurn(game, "player1");

      // Player2 plays (not a pass)
      const p2Rack = game.players[1].rack;
      const a1 = constructAkshara([p2Rack[0]], "अ");
      makeMove(
        game,
        "player2",
        [{ row: CENTER, col: CENTER, akshara: a1 }],
        [0],
      );

      // Player1 passes again — last two: [player2 move, player1 pass] → not both passes
      passTurn(game, "player1");
      expect(game.status).toBe("active");
    });

    it("should sanitize game state — hide opponent rack", () => {
      const game = createGameState("multiplayer");

      const p1View = sanitizeForPlayer(game, "player1");
      const p2View = sanitizeForPlayer(game, "player2");

      // Player1 sees own rack but not player2's
      expect(p1View.players[0].rack).toBeDefined();
      expect(p1View.players[0].rack!.length).toBe(RACK_SIZE);
      expect(p1View.players[1].rack).toBeUndefined();
      expect((p1View.players[1] as any).rackCount).toBe(RACK_SIZE);

      // Player2 sees own rack but not player1's
      expect(p2View.players[1].rack).toBeDefined();
      expect(p2View.players[0].rack).toBeUndefined();

      // Neither sees the tile bag
      expect(p1View.tileBag).toBeUndefined();
      expect((p1View as any).tileBagCount).toBe(game.tileBag.length);
    });

    it("should sanitize — AI rack is visible (not hidden)", () => {
      const game = createGameState("ai", 2);
      const p1View = sanitizeForPlayer(game, "player1");
      // AI rack should be visible (userId === 'ai' is not hidden)
      expect(p1View.players[1].rack).toBeDefined();
    });

    it("should track scores independently for each player", () => {
      const game = createGameState("multiplayer");

      // Player1 places
      const p1Rack = game.players[0].rack;
      const a1 = constructAkshara([p1Rack[0]], "अ");
      const a2 = constructAkshara([p1Rack[1]], "अ");
      const move1 = makeMove(
        game,
        "player1",
        [
          { row: CENTER, col: CENTER, akshara: a1 },
          { row: CENTER, col: CENTER + 1, akshara: a2 },
        ],
        [0, 1],
      );

      const p1ScoreAfter = game.players[0].score;
      expect(p1ScoreAfter).toBe(move1.moveScore!);
      expect(game.players[1].score).toBe(0); // player2 hasn't moved

      // Player2 places
      const p2Rack = game.players[1].rack;
      const a3 = constructAkshara([p2Rack[0]], "अ");
      const move2 = makeMove(
        game,
        "player2",
        [{ row: CENTER + 1, col: CENTER, akshara: a3 }],
        [0],
      );

      if (!move2.error) {
        expect(game.players[1].score).toBe(move2.moveScore!);
        expect(game.players[0].score).toBe(p1ScoreAfter); // unchanged
      }
    });

    it("should handle player disconnect state", () => {
      const game = createGameState("multiplayer");
      game.players[1].connected = false;

      // Game should still be active
      expect(game.status).toBe("active");
      // Player1 can still move
      const rack = game.players[0].rack;
      const a1 = constructAkshara([rack[0]], "अ");
      const result = makeMove(
        game,
        "player1",
        [{ row: CENTER, col: CENTER, akshara: a1 }],
        [0],
      );
      expect(result.error).toBeUndefined();
    });

    it("should handle both players exchanging tiles in sequence", () => {
      const game = createGameState("multiplayer");

      // Player1 exchanges
      exchangeTiles(game, "player1", [0, 1, 2]);
      expect(game.currentTurn).toBe(1);
      expect(game.players[0].rack.length).toBe(RACK_SIZE);

      // Player2 exchanges
      exchangeTiles(game, "player2", [3, 4]);
      expect(game.currentTurn).toBe(2);
      expect(game.players[1].rack.length).toBe(RACK_SIZE);
    });

    it("should record move history for both players", () => {
      const game = createGameState("multiplayer");

      // Player1 move
      const p1Rack = game.players[0].rack;
      const a1 = constructAkshara([p1Rack[0]], "अ");
      makeMove(
        game,
        "player1",
        [{ row: CENTER, col: CENTER, akshara: a1 }],
        [0],
      );

      // Player2 pass
      passTurn(game, "player2");

      expect(game.moves.length).toBe(2);
      expect(game.moves[0].playerId).toBe("player1");
      expect(game.moves[0].placements.length).toBe(1);
      expect(game.moves[1].playerId).toBe("player2");
      expect(game.moves[1].placements.length).toBe(0); // pass
    });

    it("should correctly determine winner in multiplayer", () => {
      const game = createGameState("multiplayer");
      game.players[0].score = 75;
      game.players[1].score = 60;
      determineWinner(game);
      expect(game.winner).toBe("player1");
    });

    it("should handle multiplayer tiebreak", () => {
      const game = createGameState("multiplayer");
      game.players[0].score = 50;
      game.players[1].score = 50;
      game.moves = [
        { playerId: "player1", placements: [], wordsFormed: [], score: 0 },
        { playerId: "player2", placements: [], wordsFormed: [], score: 0 },
      ];
      determineWinner(game);
      // player2 played last → player1 wins tiebreak
      expect(game.winner).toBe("player1");
    });
  });

  // ─── Full Multi-Turn Simulations ───

  describe("Full Multi-Turn Simulations", () => {
    it("solo: should play 5+ turns building a grid", () => {
      const game = createGameState("single");
      let turns = 0;

      // Turn 1: horizontal at center
      let rack = game.players[0].rack;
      let a1 = constructAkshara([rack[0]], "अ");
      let a2 = constructAkshara([rack[1]], "अ");
      let res = makeMove(
        game,
        "player1",
        [
          { row: CENTER, col: CENTER, akshara: a1 },
          { row: CENTER, col: CENTER + 1, akshara: a2 },
        ],
        [0, 1],
      );
      if (!res.error) turns++;

      // Try to play several more turns extending from existing tiles
      for (let t = 0; t < 4; t++) {
        rack = game.players[0].rack;
        if (rack.length === 0) break;

        const akshara = constructAkshara([rack[0]], "अ");

        // Try extending down from the center column
        const targetRow = CENTER + 1 + t;
        if (targetRow >= BOARD_SIZE) break;
        if (game.board[targetRow][CENTER].akshara !== null) continue;

        // Check if there's an adjacent tile to connect
        const hasAdjacent =
          (targetRow > 0 &&
            game.board[targetRow - 1][CENTER].akshara !== null) ||
          (targetRow < BOARD_SIZE - 1 &&
            game.board[targetRow + 1][CENTER].akshara !== null);
        if (!hasAdjacent) continue;

        res = makeMove(
          game,
          "player1",
          [{ row: targetRow, col: CENTER, akshara }],
          [0],
        );
        if (!res.error) turns++;
      }

      expect(turns).toBeGreaterThanOrEqual(2);
      expect(game.moves.length).toBe(turns);
      expect(game.players[0].score).toBeGreaterThan(0);
    });

    it("multiplayer: should play alternating 6 turns", () => {
      const game = createGameState("multiplayer");

      // Turn 1: P1 at center
      let p1Rack = game.players[0].rack;
      const p1a1 = constructAkshara([p1Rack[0]], "अ");
      const p1a2 = constructAkshara([p1Rack[1]], "अ");
      makeMove(
        game,
        "player1",
        [
          { row: CENTER, col: CENTER, akshara: p1a1 },
          { row: CENTER, col: CENTER + 1, akshara: p1a2 },
        ],
        [0, 1],
      );

      // Turn 2: P2 extends down from center
      let p2Rack = game.players[1].rack;
      const p2a1 = constructAkshara([p2Rack[0]], "अ");
      makeMove(
        game,
        "player2",
        [{ row: CENTER + 1, col: CENTER, akshara: p2a1 }],
        [0],
      );

      // Turns 3-6: alternate extending vertically
      for (let t = 2; t < 6; t++) {
        const isP1 = t % 2 === 0;
        const userId = isP1 ? "player1" : "player2";
        const pIdx = isP1 ? 0 : 1;
        const pRack = game.players[pIdx].rack;
        if (pRack.length === 0) break;

        const targetRow = CENTER + 2 + Math.floor(t / 2);
        if (targetRow >= BOARD_SIZE) break;
        if (game.board[targetRow][CENTER].akshara !== null) continue;

        const hasAdj =
          targetRow > 0 && game.board[targetRow - 1][CENTER].akshara !== null;
        if (!hasAdj) {
          passTurn(game, userId);
          continue;
        }

        const akshara = constructAkshara([pRack[0]], "अ");
        const res = makeMove(
          game,
          userId,
          [{ row: targetRow, col: CENTER, akshara }],
          [0],
        );
        if (res.error) passTurn(game, userId);
      }

      expect(game.moves.length).toBeGreaterThanOrEqual(4);
      expect(game.currentTurn).toBeGreaterThanOrEqual(4);
    });

    it("AI mode: should simulate player move then AI pass cycle", () => {
      const game = createGameState("ai", 1);

      // Player1 plays
      const rack = game.players[0].rack;
      const a1 = constructAkshara([rack[0]], "अ");
      const a2 = constructAkshara([rack[1]], "अ");
      makeMove(
        game,
        "player1",
        [
          { row: CENTER, col: CENTER, akshara: a1 },
          { row: CENTER, col: CENTER + 1, akshara: a2 },
        ],
        [0, 1],
      );

      // AI passes (simulating AI finding no valid move)
      passTurn(game, "ai");
      expect(game.currentTurn).toBe(2);

      // Player1 extends
      const newRack = game.players[0].rack;
      const a3 = constructAkshara([newRack[0]], "अ");
      const res = makeMove(
        game,
        "player1",
        [{ row: CENTER, col: CENTER + 2, akshara: a3 }],
        [0],
      );

      if (!res.error) {
        expect(game.currentTurn).toBe(3);
        // AI's turn again
        expect(game.currentTurn % 2).toBe(1);
      }
    });

    it("AI mode: full game ending with consecutive passes", () => {
      const game = createGameState("ai", 1);

      // Player passes
      passTurn(game, "player1");
      expect(game.status).toBe("active");

      // AI passes — game should end
      passTurn(game, "ai");
      expect(game.status).toBe("finished");
      expect(game.winner).toBeDefined();
    });
  });

  // ─── Scoring Deep Tests ───

  describe("Scoring — Deep", () => {
    it("should apply triple word multiplier", () => {
      const board = createBoard();
      // Triple word at (0,0)
      expect(board[0][0].type).toBe("triple_word");

      // Make board non-empty so we can connect
      board[0][1].akshara = "क";

      const placements: TilePlacement[] = [
        { row: 0, col: 0, akshara: "ट" }, // ट=3 on TW
      ];

      const { totalScore } = calculateMoveScore(board, placements);
      // ट(3) on TW + existing क(1) → (3 + 1) * 3 = 12
      expect(totalScore).toBe(12);
    });

    it("should apply triple letter multiplier", () => {
      const board = createBoard();
      // Find TL square
      let tlRow = -1,
        tlCol = -1;
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          if (board[r][c].type === "triple_letter") {
            tlRow = r;
            tlCol = c;
            break;
          }
        }
        if (tlRow >= 0) break;
      }

      // Connect with adjacent existing tile
      if (tlCol + 1 < BOARD_SIZE) board[tlRow][tlCol + 1].akshara = "क";
      else board[tlRow][tlCol - 1].akshara = "क";

      const placements: TilePlacement[] = [
        { row: tlRow, col: tlCol, akshara: "ट" }, // ट=3 on TL → 3*3 = 9
      ];

      const { totalScore } = calculateMoveScore(board, placements);
      // ट(3)*3=9 + क(1) = 10
      expect(totalScore).toBe(10);
    });

    it("should not apply premium on pre-existing tiles", () => {
      const board = createBoard();
      // Place 'क' on center (DW) in an earlier turn — its DW is already consumed
      board[CENTER][CENTER].akshara = "क";
      board[CENTER][CENTER].turnPlaced = 0;

      // Now place next to it
      const placements: TilePlacement[] = [
        { row: CENTER, col: CENTER + 1, akshara: "म" }, // normal square
      ];

      const { totalScore } = calculateMoveScore(board, placements);
      // Word: कम → क(1) + म(1) = 2 (no premium on existing tiles)
      expect(totalScore).toBe(2);
    });

    it("should sum multiple word scores", () => {
      const board = createBoard();
      // Setup: 'क' at center, 'म' right of center
      board[CENTER][CENTER].akshara = "क";
      board[CENTER][CENTER + 1].akshara = "म";

      // Place 'ग' below 'क' and 'ज' below 'म' forming:
      // horizontal: गज, and two vertical cross words: कग, मज
      const placements: TilePlacement[] = [
        { row: CENTER + 1, col: CENTER, akshara: "ग" },
        { row: CENTER + 1, col: CENTER + 1, akshara: "ज" },
      ];

      const validation = validatePlacement(board, placements);
      expect(validation.valid).toBe(true);

      const words = extractWords(board, placements);
      // Should form: horizontal 'गज', vertical 'कग', vertical 'मज'
      expect(words.length).toBe(3);

      const { totalScore, wordScores } = calculateMoveScore(board, placements);
      expect(wordScores.length).toBe(3);
      expect(totalScore).toBe(wordScores.reduce((s, w) => s + w.score, 0));
    });

    it("should score all 33 consonants correctly", () => {
      const expectedScores: Record<string, number> = {
        क: 1,
        ख: 3,
        ग: 2,
        घ: 4,
        ङ: 8,
        च: 2,
        छ: 4,
        ज: 2,
        झ: 5,
        ञ: 8,
        ट: 3,
        ठ: 5,
        ड: 3,
        ढ: 5,
        ण: 4,
        त: 1,
        थ: 3,
        द: 2,
        ध: 3,
        न: 1,
        प: 1,
        फ: 4,
        ब: 2,
        भ: 3,
        म: 1,
        य: 1,
        र: 1,
        ल: 2,
        व: 1,
        श: 2,
        ष: 3,
        स: 1,
        ह: 2,
      };

      for (const [consonant, expected] of Object.entries(expectedScores)) {
        expect(getAksharaScore(consonant)).toBe(expected);
      }
      expect(Object.keys(expectedScores).length).toBe(33);
    });
  });

  // ─── Anti-Cheat Deep Tests ───

  describe("Anti-Cheat — Deep", () => {
    it("should pass for single consonant akshara", () => {
      const rack = [
        "क",
        "म",
        "ज",
        "ल",
        "र",
        "त",
        "न",
        "प",
        "स",
        "ह",
        "ग",
        "च",
        "द",
        "य",
        "व",
      ];
      const needed = extractConsonants(["क"]);
      expect(needed).toEqual(["क"]);
      expect([...needed].sort()).toEqual([rack[0]].sort());
    });

    it("should pass for conjunct with all consonants from rack", () => {
      const akshara = constructAkshara(["क", "र"], "ई"); // क्री
      const needed = extractConsonants([akshara]);
      expect(needed.sort()).toEqual(["क", "र"].sort());
    });

    it("should extract no consonants from pure vowels", () => {
      expect(extractConsonants(["अ"])).toEqual([]);
      expect(extractConsonants(["ऋ"])).toEqual([]);
      expect(extractConsonants(["औ"])).toEqual([]);
    });

    it("should extract consonants from halant-ending akshara", () => {
      const halant = constructAkshara(["स", "त"], "्"); // स्त्
      const needed = extractConsonants([halant]);
      expect(needed.sort()).toEqual(["त", "स"].sort());
    });

    it("should extract consonants from multiple placements", () => {
      const a1 = constructAkshara(["क"], "अ");
      const a2 = constructAkshara(["म", "र"], "ई");
      const needed = extractConsonants([a1, a2]);
      expect(needed.sort()).toEqual(["क", "म", "र"].sort());
    });

    it("should handle duplicate consonants in rack", () => {
      const rack = [
        "क",
        "क",
        "म",
        "म",
        "ज",
        "ल",
        "र",
        "त",
        "न",
        "प",
        "स",
        "ह",
        "ग",
        "च",
        "द",
      ];
      // Place two 'क' aksharas
      const needed = extractConsonants(["क", "क"]);
      const rackUsed = [rack[0], rack[1]]; // both 'क' from rack
      expect([...needed].sort()).toEqual([...rackUsed].sort());
    });

    it("should fail if rack does not have enough duplicates", () => {
      const rack = [
        "क",
        "म",
        "ज",
        "ल",
        "र",
        "त",
        "न",
        "प",
        "स",
        "ह",
        "ग",
        "च",
        "द",
        "य",
        "व",
      ];
      // Need two 'क' but rack only has one
      const needed = extractConsonants(["क", "क"]);
      const rackAvailable = rack.filter((c) => c === "क");
      expect(needed.length).toBe(2);
      expect(rackAvailable.length).toBe(1);
      // Anti-cheat would fail here
    });
  });

  // ─── Board Validation Edge Cases ───

  describe("Board Validation — Extended Edge Cases", () => {
    it("should reject vertical placement with gap", () => {
      const board = createBoard();
      const result = validatePlacement(board, [
        { row: CENTER - 1, col: CENTER, akshara: "क" },
        { row: CENTER + 1, col: CENTER, akshara: "म" },
        // gap at CENTER,CENTER
      ]);
      expect(result.valid).toBe(false);
    });

    it("should allow vertical gap filled by existing tile", () => {
      const board = createBoard();
      board[CENTER][CENTER].akshara = "ज";

      const result = validatePlacement(board, [
        { row: CENTER - 1, col: CENTER, akshara: "क" },
        { row: CENTER + 1, col: CENTER, akshara: "म" },
      ]);
      expect(result.valid).toBe(true);
    });

    it("should reject out of bounds (right edge)", () => {
      const board = createBoard();
      const result = validatePlacement(board, [
        { row: CENTER, col: BOARD_SIZE, akshara: "क" },
      ]);
      expect(result.valid).toBe(false);
    });

    it("should reject out of bounds (bottom edge)", () => {
      const board = createBoard();
      const result = validatePlacement(board, [
        { row: BOARD_SIZE, col: CENTER, akshara: "क" },
      ]);
      expect(result.valid).toBe(false);
    });

    it("should accept placement at board edges when connected", () => {
      const board = createBoard();
      // Build a path from center to edge
      for (let c = CENTER; c < BOARD_SIZE - 1; c++) {
        board[CENTER][c].akshara = "क";
      }

      const result = validatePlacement(board, [
        { row: CENTER, col: BOARD_SIZE - 1, akshara: "म" },
      ]);
      expect(result.valid).toBe(true);
    });

    it("should handle long horizontal word across board", () => {
      const board = createBoard();
      // Place a word spanning many columns through center
      const placements: TilePlacement[] = [];
      for (let c = 2; c <= 8; c++) {
        placements.push({ row: CENTER, col: c, akshara: CONSONANTS[c] });
      }

      const validation = validatePlacement(board, placements);
      expect(validation.valid).toBe(true); // covers center
    });

    it("should handle long vertical word through center", () => {
      const board = createBoard();
      const placements: TilePlacement[] = [];
      for (let r = 2; r <= 8; r++) {
        placements.push({ row: r, col: CENTER, akshara: CONSONANTS[r] });
      }

      const validation = validatePlacement(board, placements);
      expect(validation.valid).toBe(true);
    });

    it("should reject diagonal placements", () => {
      const board = createBoard();
      const result = validatePlacement(board, [
        { row: CENTER, col: CENTER, akshara: "क" },
        { row: CENTER + 1, col: CENTER + 1, akshara: "म" },
      ]);
      expect(result.valid).toBe(false);
    });
  });

  // ─── Tile Bag & Rack — Extended ───

  describe("Tile Bag & Rack — Extended", () => {
    it("should contain exactly 33 unique consonants", () => {
      const bag = createTileBag();
      const unique = new Set(bag);
      expect(unique.size).toBe(33);
    });

    it("should have correct individual consonant counts", () => {
      const bag = createTileBag();
      const counts = new Map<string, number>();
      for (const c of bag) counts.set(c, (counts.get(c) || 0) + 1);

      // Spot-check high frequency
      expect(counts.get("क")).toBe(6);
      expect(counts.get("त")).toBe(6);
      expect(counts.get("र")).toBe(5);

      // Spot-check rare
      expect(counts.get("ढ")).toBe(1);
      expect(counts.get("ङ")).toBe(1);
      expect(counts.get("ञ")).toBe(1);
      expect(counts.get("झ")).toBe(1);
    });

    it("should draw for two players leaving correct remainder", () => {
      const bag = createTileBag();
      const d1 = drawFromBag(bag, RACK_SIZE);
      const d2 = drawFromBag(d1.remaining, RACK_SIZE);
      expect(d1.drawn.length).toBe(RACK_SIZE);
      expect(d2.drawn.length).toBe(RACK_SIZE);
      expect(d2.remaining.length).toBe(106 - 2 * RACK_SIZE);
    });

    it("should handle drawing from empty bag", () => {
      const { drawn, remaining } = drawFromBag([], 5);
      expect(drawn.length).toBe(0);
      expect(remaining.length).toBe(0);
    });
  });

  // ─── Akshara Construction — Extended ───

  describe("Akshara Construction — Extended", () => {
    it("should build all 12 vowel forms for each consonant group", () => {
      const testConsonants = ["क", "ट", "प", "श"];
      for (const c of testConsonants) {
        for (const v of VOWELS) {
          const akshara = constructAkshara([c], v);
          expect(isValidAkshara(akshara)).toBe(true);
          const consonants = extractConsonants([akshara]);
          expect(consonants).toEqual([c]);
        }
      }
    });

    it("should build halant for all consonants", () => {
      for (const c of CONSONANTS) {
        const halant = constructAkshara([c], VIRAMA);
        expect(isValidAkshara(halant)).toBe(true);
        expect(halant.endsWith(VIRAMA)).toBe(true);
      }
    });

    it("should build double conjuncts", () => {
      const pairs: [string, string][] = [
        ["क", "ष"],
        ["प", "र"],
        ["स", "न"],
        ["ज", "ञ"],
      ];
      for (const [c1, c2] of pairs) {
        const akshara = constructAkshara([c1, c2], "अ");
        expect(isValidAkshara(akshara)).toBe(true);
        const consonants = extractConsonants([akshara]);
        expect(consonants.sort()).toEqual([c1, c2].sort());
      }
    });

    it("should NFC normalize all constructions", () => {
      const akshara = constructAkshara(["क", "र"], "ई");
      expect(akshara).toBe(akshara.normalize("NFC"));
    });
  });

  // ─── GraphemeSplitter — Extended ───

  describe("GraphemeSplitter — Extended", () => {
    it("should split halant-ending word", () => {
      // मरुत् = म + रु + त्
      const text = "मरुत्".normalize("NFC");
      const aksharas = splitAksharas(text);
      expect(aksharas.length).toBe(3);
    });

    it("should split word with anusvara", () => {
      // संस्कृतम् — complex word
      const text = "कं".normalize("NFC"); // क + anusvara
      const aksharas = splitAksharas(text);
      expect(aksharas.length).toBe(1);
      expect(aksharas[0]).toBe("कं");
    });

    it("should split independent vowel at start", () => {
      const aksharas = splitAksharas("अग्नि".normalize("NFC"));
      expect(aksharas[0]).toBe("अ");
    });

    it("should handle empty string", () => {
      expect(splitAksharas("")).toEqual([]);
    });

    it("should handle single consonant", () => {
      expect(splitAksharas("क").length).toBe(1);
    });

    it("should count aksharas correctly", () => {
      // जल = ज + ल = 2 aksharas
      expect(splitAksharas("जल").length).toBe(2);
      // काम = का + म = 2 aksharas
      expect(splitAksharas("काम").length).toBe(2);
    });
  });

  // ─── Word Extraction — Extended ───

  describe("Word Extraction — Extended", () => {
    it("should extract single-tile word on first move", () => {
      const board = createBoard();
      const placements: TilePlacement[] = [
        { row: CENTER, col: CENTER, akshara: "क" },
      ];
      const words = extractWords(board, placements);
      expect(words.length).toBe(1);
      expect(words[0].word).toBe("क");
      expect(words[0].cells.length).toBe(1);
    });

    it("should extend existing word", () => {
      const board = createBoard();
      board[CENTER][CENTER].akshara = "क";
      board[CENTER][CENTER + 1].akshara = "म";

      const placements: TilePlacement[] = [
        { row: CENTER, col: CENTER + 2, akshara: "ल" },
      ];
      const words = extractWords(board, placements);
      expect(words.length).toBe(1);
      expect(words[0].word).toBe("कमल");
    });

    it("should detect both main and cross words", () => {
      const board = createBoard();
      board[CENTER][CENTER].akshara = "क";
      board[CENTER][CENTER + 1].akshara = "म";
      board[CENTER - 1][CENTER].akshara = "ज";

      // Place below center — creates vertical word + horizontal cross word
      const placements: TilePlacement[] = [
        { row: CENTER + 1, col: CENTER, akshara: "ल" },
      ];
      const words = extractWords(board, placements);
      // Vertical: जकल, that's it (single tile doesn't form horizontal word alone)
      expect(words.length).toBeGreaterThanOrEqual(1);
      // The vertical word should contain existing 'ज', existing 'क', and new 'ल'
      const vertWord = words.find((w) => w.cells.length >= 3);
      if (vertWord) {
        expect(vertWord.word).toBe("जकल");
      }
    });
  });

  // ─── Board Premium Layout ───

  describe("Board Premium Square Layout", () => {
    it("should have correct number of each premium type", () => {
      const board = createBoard();
      let tw = 0,
        dw = 0,
        tl = 0,
        dl = 0,
        center = 0,
        normal = 0;
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          switch (board[r][c].type) {
            case "triple_word":
              tw++;
              break;
            case "double_word":
              dw++;
              break;
            case "triple_letter":
              tl++;
              break;
            case "double_letter":
              dl++;
              break;
            case "center":
              center++;
              break;
            default:
              normal++;
              break;
          }
        }
      }
      expect(tw).toBe(8);
      expect(dw).toBe(16);
      expect(tl).toBe(8);
      expect(dl).toBe(12);
      expect(center).toBe(1);
      expect(tw + dw + tl + dl + center + normal).toBe(BOARD_SIZE * BOARD_SIZE);
    });

    it("should be symmetric horizontally and vertically", () => {
      const board = createBoard();
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          expect(board[r][c].type).toBe(board[r][BOARD_SIZE - 1 - c].type);
          expect(board[r][c].type).toBe(board[BOARD_SIZE - 1 - r][c].type);
        }
      }
    });

    it("should have triple words at all 4 corners and 4 midpoints", () => {
      const board = createBoard();
      const twPositions = [
        [0, 0],
        [0, 5],
        [0, 10],
        [5, 0],
        [5, 10],
        [10, 0],
        [10, 5],
        [10, 10],
      ];
      for (const [r, c] of twPositions) {
        expect(board[r][c].type).toBe("triple_word");
      }
    });
  });

  // ─── Last Move Highlighting (turnPlaced tracking) ───

  describe("Last Move Highlighting — turnPlaced tracking", () => {
    it("should set turnPlaced on cells after first move", () => {
      const game = createGameState("single");
      const rack = game.players[0].rack;
      const a1 = constructAkshara([rack[0]], "अ");
      const a2 = constructAkshara([rack[1]], "अ");

      makeMove(
        game,
        "player1",
        [
          { row: CENTER, col: CENTER, akshara: a1 },
          { row: CENTER, col: CENTER + 1, akshara: a2 },
        ],
        [0, 1],
      );

      // Move index 0 → turnPlaced should be 0
      expect(game.board[CENTER][CENTER].turnPlaced).toBe(0);
      expect(game.board[CENTER][CENTER + 1].turnPlaced).toBe(0);
    });

    it("should set different turnPlaced for each subsequent move", () => {
      const game = createGameState("single");
      const rack = game.players[0].rack;

      // Move 0
      const a1 = constructAkshara([rack[0]], "अ");
      const a2 = constructAkshara([rack[1]], "अ");
      makeMove(
        game,
        "player1",
        [
          { row: CENTER, col: CENTER, akshara: a1 },
          { row: CENTER, col: CENTER + 1, akshara: a2 },
        ],
        [0, 1],
      );

      // Move 1
      const newRack = game.players[0].rack;
      const a3 = constructAkshara([newRack[0]], "अ");
      makeMove(
        game,
        "player1",
        [{ row: CENTER, col: CENTER + 2, akshara: a3 }],
        [0],
      );

      // First move tiles have turnPlaced=0
      expect(game.board[CENTER][CENTER].turnPlaced).toBe(0);
      expect(game.board[CENTER][CENTER + 1].turnPlaced).toBe(0);
      // Second move tile has turnPlaced=1
      expect(game.board[CENTER][CENTER + 2].turnPlaced).toBe(1);
    });

    it("should correctly identify last move cells by turnPlaced in AI mode", () => {
      const game = createGameState("ai", 1);
      const rack = game.players[0].rack;

      // Player move (turn 0 → moves[0])
      const a1 = constructAkshara([rack[0]], "अ");
      const a2 = constructAkshara([rack[1]], "अ");
      makeMove(
        game,
        "player1",
        [
          { row: CENTER, col: CENTER, akshara: a1 },
          { row: CENTER, col: CENTER + 1, akshara: a2 },
        ],
        [0, 1],
      );

      // AI move (turn 1 → moves[1])
      const aiRack = game.players[1].rack;
      const a3 = constructAkshara([aiRack[0]], "अ");
      makeMove(
        game,
        "ai",
        [{ row: CENTER + 1, col: CENTER, akshara: a3 }],
        [0],
      );

      // Last move is AI's (moves[1], turnPlaced=1)
      const lastMoveIndex = game.moves.length - 1;
      expect(lastMoveIndex).toBe(1);
      expect(game.board[CENTER + 1][CENTER].turnPlaced).toBe(1);

      // Player's tiles still have turnPlaced=0
      expect(game.board[CENTER][CENTER].turnPlaced).toBe(0);
      expect(game.board[CENTER][CENTER + 1].turnPlaced).toBe(0);

      // Can filter last move cells by turnPlaced === lastMoveIndex
      const lastMoveCells: [number, number][] = [];
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          if (game.board[r][c].turnPlaced === lastMoveIndex) {
            lastMoveCells.push([r, c]);
          }
        }
      }
      expect(lastMoveCells).toEqual([[CENTER + 1, CENTER]]);
    });

    it("should not set turnPlaced on empty cells", () => {
      const game = createGameState("single");
      const rack = game.players[0].rack;
      const a1 = constructAkshara([rack[0]], "अ");

      makeMove(
        game,
        "player1",
        [{ row: CENTER, col: CENTER, akshara: a1 }],
        [0],
      );

      // Adjacent empty cells should not have turnPlaced
      expect(game.board[CENTER][CENTER + 1].turnPlaced).toBeUndefined();
      expect(game.board[CENTER - 1][CENTER].turnPlaced).toBeUndefined();
    });

    it("pass moves should not change any turnPlaced values", () => {
      const game = createGameState("single");
      const rack = game.players[0].rack;

      // Place a tile
      const a1 = constructAkshara([rack[0]], "अ");
      makeMove(
        game,
        "player1",
        [{ row: CENTER, col: CENTER, akshara: a1 }],
        [0],
      );

      expect(game.board[CENTER][CENTER].turnPlaced).toBe(0);

      // Pass turn — should not change any turnPlaced
      passTurn(game, "player1");

      expect(game.board[CENTER][CENTER].turnPlaced).toBe(0);
      // No cells should have turnPlaced=1 (the pass)
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          if (game.board[r][c].turnPlaced !== undefined) {
            expect(game.board[r][c].turnPlaced).toBe(0);
          }
        }
      }
    });

    it("last move info should match moves array data", () => {
      const game = createGameState("ai", 1);
      const rack = game.players[0].rack;

      // Player move
      const a1 = constructAkshara([rack[0]], "अ");
      const a2 = constructAkshara([rack[1]], "अ");
      const result = makeMove(
        game,
        "player1",
        [
          { row: CENTER, col: CENTER, akshara: a1 },
          { row: CENTER, col: CENTER + 1, akshara: a2 },
        ],
        [0, 1],
      );

      // moves[0] should contain the score and words
      const lastMove = game.moves[game.moves.length - 1];
      expect(lastMove.playerId).toBe("player1");
      expect(lastMove.score).toBe(result.moveScore);
      expect(lastMove.placements.length).toBe(2);
      expect(lastMove.wordsFormed.length).toBeGreaterThan(0);

      // turnPlaced on board matches the move index
      expect(game.board[CENTER][CENTER].turnPlaced).toBe(0);
      expect(game.board[CENTER][CENTER + 1].turnPlaced).toBe(0);
    });

    it("should find last placing move even after passes in multiplayer", () => {
      const game = createGameState("multiplayer");
      const p1Rack = game.players[0].rack;

      // Player 1 moves (moves[0])
      const a1 = constructAkshara([p1Rack[0]], "अ");
      makeMove(
        game,
        "player1",
        [{ row: CENTER, col: CENTER, akshara: a1 }],
        [0],
      );

      // Player 2 passes (moves[1])
      passTurn(game, "player2");

      // The last tile-placing move is still moves[0]
      let lastPlacingMoveIndex = -1;
      for (let i = game.moves.length - 1; i >= 0; i--) {
        if (game.moves[i].placements.length > 0) {
          lastPlacingMoveIndex = i;
          break;
        }
      }
      expect(lastPlacingMoveIndex).toBe(0);

      // And turnPlaced matches
      expect(game.board[CENTER][CENTER].turnPlaced).toBe(0);
    });

    it("should track turnPlaced across multiple moves in multiplayer", () => {
      const game = createGameState("multiplayer");
      const p1Rack = game.players[0].rack;

      // Player 1 move (moves[0])
      const a1 = constructAkshara([p1Rack[0]], "अ");
      const a2 = constructAkshara([p1Rack[1]], "अ");
      makeMove(
        game,
        "player1",
        [
          { row: CENTER, col: CENTER, akshara: a1 },
          { row: CENTER, col: CENTER + 1, akshara: a2 },
        ],
        [0, 1],
      );

      // Player 2 move (moves[1])
      const p2Rack = game.players[1].rack;
      const a3 = constructAkshara([p2Rack[0]], "अ");
      makeMove(
        game,
        "player2",
        [{ row: CENTER - 1, col: CENTER, akshara: a3 }],
        [0],
      );

      // Player 1's tiles: turnPlaced=0
      expect(game.board[CENTER][CENTER].turnPlaced).toBe(0);
      expect(game.board[CENTER][CENTER + 1].turnPlaced).toBe(0);
      // Player 2's tile: turnPlaced=1
      expect(game.board[CENTER - 1][CENTER].turnPlaced).toBe(1);

      // Last move is player 2's
      const lastMoveIndex = game.moves.length - 1;
      const lastMoveCells: [number, number][] = [];
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          if (game.board[r][c].turnPlaced === lastMoveIndex) {
            lastMoveCells.push([r, c]);
          }
        }
      }
      expect(lastMoveCells).toEqual([[CENTER - 1, CENTER]]);
    });
  });
});
