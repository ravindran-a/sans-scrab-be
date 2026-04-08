/**
 * Akshara Mode Game Flow Tests — E2E simulation of all game modes in akshara style.
 * Tests solo akshara, AI akshara, multiplayer akshara: creation, moves, passes, exchanges,
 * anti-cheat, scoring, game end conditions, smart draw, and rack-size bonus.
 */
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
import { normalizeText, splitAksharas } from "../GraphemeSplitter";
import {
  AKSHARA_RACK_SIZE,
  buildAksharaDistribution,
  canFormAnyWord,
  createAksharaTileBag,
  drawFromBag,
  getAksharaTileCounts,
  shuffleArray,
} from "../SanskritEngine";
import { calculateMoveScore, getAksharaScore } from "../Scoring";
import { AiPlayer } from "../../modules/ai/AiPlayer";

// ─── Sample dictionary for akshara mode tests ───
const SAMPLE_WORDS = [
  "देव",
  "नदी",
  "गुण",
  "वन",
  "जल",
  "धर्म",
  "कर्म",
  "सागर",
  "नगर",
  "मनस",
  "फल",
  "बल",
  "रस",
  "तप",
  "गज",
  "दम",
  "कमल",
  "सुख",
  "दुःख",
  "पुर",
  "मत",
  "गत",
  "हर",
  "वर",
  "नर",
  "पद",
  "मद",
  "रज",
  "तम",
  "सर",
];

// ─── Game simulation helpers (akshara mode) ───

interface AksharaGameState {
  board: BoardState;
  players: {
    userId: string;
    username: string;
    rack: string[]; // pre-formed aksharas
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
  gameStyle: "akshara";
  winner: string | null;
}

/** Create a fresh akshara mode game state. */
function createAksharaGameState(
  mode: "single" | "ai" | "multiplayer",
): AksharaGameState {
  const board = createBoard();
  const tileBag = createAksharaTileBag();

  const draw1 = drawFromBag(tileBag, AKSHARA_RACK_SIZE);
  const players: AksharaGameState["players"] = [
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
    const draw2 = drawFromBag(bag, AKSHARA_RACK_SIZE);
    players.push({
      userId: "ai",
      username: "AI-Akshara",
      rack: draw2.drawn,
      score: 0,
      connected: true,
    });
    bag = draw2.remaining;
  } else if (mode === "multiplayer") {
    const draw2 = drawFromBag(bag, AKSHARA_RACK_SIZE);
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
    gameStyle: "akshara",
    winner: null,
  };
}

/** Akshara mode anti-cheat: placed aksharas must exactly match rack tiles. */
function validateAksharaRack(
  rack: string[],
  rackIndices: number[],
  placements: TilePlacement[],
): { valid: boolean; error?: string } {
  // Check bounds
  for (const idx of rackIndices) {
    if (idx < 0 || idx >= rack.length) {
      return { valid: false, error: "Invalid rack index" };
    }
  }

  // Check duplicates in indices
  const uniqueIndices = new Set(rackIndices);
  if (uniqueIndices.size !== rackIndices.length) {
    return { valid: false, error: "Duplicate rack indices" };
  }

  // Akshara mode: each placement must exactly match the rack tile
  if (placements.length !== rackIndices.length) {
    return {
      valid: false,
      error: "Placement count must match rack indices count",
    };
  }

  const placedAksharas = placements.map((p) => p.akshara).sort();
  const rackAksharas = rackIndices.map((i) => rack[i]).sort();

  if (
    placedAksharas.length !== rackAksharas.length ||
    placedAksharas.some((a, i) => a !== rackAksharas[i])
  ) {
    return {
      valid: false,
      error: "Placed aksharas do not match selected rack tiles",
    };
  }

  return { valid: true };
}

/** Simulate makeMove for akshara mode. */
function makeAksharaMove(
  game: AksharaGameState,
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

  // Akshara anti-cheat
  const rackCheck = validateAksharaRack(player.rack, rackIndices, placements);
  if (!rackCheck.valid) return { error: rackCheck.error };

  // Validate placement on board
  const validation = validatePlacement(game.board, placements);
  if (!validation.valid) return { error: validation.error };

  // Extract words
  const words = extractWords(game.board, placements);
  if (words.length === 0) return { error: "No words formed" };

  // Calculate score with akshara rack size
  const { totalScore, wordScores } = calculateMoveScore(
    game.board,
    placements,
    AKSHARA_RACK_SIZE,
  );

  // Apply placements to board
  game.board = applyPlacements(game.board, placements, game.moves.length);

  // Remove used tiles and refill
  const sortedIndices = [...rackIndices].sort((a, b) => b - a);
  for (const idx of sortedIndices) player.rack.splice(idx, 1);
  const needed = AKSHARA_RACK_SIZE - player.rack.length;
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

/** Simulate passTurn for akshara mode. */
function aksharaPassTurn(
  game: AksharaGameState,
  userId: string,
): { error?: string } {
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

  const lastTwo = game.moves.slice(-2);
  if (
    lastTwo.length === 2 &&
    lastTwo.every((m) => m.placements.length === 0)
  ) {
    const isSoloMode = game.players.length === 1;
    const differentPlayers = lastTwo[0].playerId !== lastTwo[1].playerId;
    if (isSoloMode || differentPlayers) {
      game.status = "finished";
      determineWinner(game);
    }
  }
  return {};
}

/** Simulate exchangeTiles for akshara mode. */
function aksharaExchangeTiles(
  game: AksharaGameState,
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

function determineWinner(game: AksharaGameState) {
  const sorted = [...game.players].sort((a, b) => b.score - a.score);
  if (sorted.length >= 2 && sorted[0].score === sorted[1].score) {
    const lastMovePlayer =
      game.moves.length > 0
        ? game.moves[game.moves.length - 1].playerId
        : null;
    game.winner =
      sorted.find((p) => p.userId !== lastMovePlayer)?.userId ||
      sorted[0].userId;
  } else {
    game.winner = sorted[0].userId;
  }
}

/** Sanitize game for a player (hides opponent rack). */
function sanitizeForPlayer(game: AksharaGameState, userId: string) {
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

describe("Akshara Mode Game Flow", () => {
  beforeAll(() => {
    buildAksharaDistribution(SAMPLE_WORDS);
  });

  // ─── Solo Akshara ───

  describe("Solo Akshara Mode", () => {
    it("should create a valid solo akshara game state", () => {
      const game = createAksharaGameState("single");
      expect(game.players.length).toBe(1);
      expect(game.players[0].rack.length).toBe(AKSHARA_RACK_SIZE);
      expect(game.status).toBe("active");
      expect(game.mode).toBe("single");
      expect(game.gameStyle).toBe("akshara");
      expect(isBoardEmpty(game.board)).toBe(true);
    });

    it("should have rack size of 8 (not 15 like classic)", () => {
      const game = createAksharaGameState("single");
      expect(game.players[0].rack.length).toBe(8);
      expect(AKSHARA_RACK_SIZE).toBe(8);
    });

    it("should have pre-formed aksharas in rack (not raw consonants)", () => {
      const game = createAksharaGameState("single");
      const tileCounts = getAksharaTileCounts();
      for (const akshara of game.players[0].rack) {
        expect(tileCounts.has(akshara)).toBe(true);
      }
    });

    it("should allow placing a pre-formed akshara on center", () => {
      const game = createAksharaGameState("single");
      const tileToPlace = game.players[0].rack[0];

      const result = makeAksharaMove(
        game,
        "player1",
        [{ row: CENTER, col: CENTER, akshara: tileToPlace }],
        [0],
      );

      expect(result.error).toBeUndefined();
      expect(result.moveScore).toBeGreaterThanOrEqual(0);
      expect(game.board[CENTER][CENTER].akshara).toBe(tileToPlace);
      expect(game.currentTurn).toBe(1);
    });

    it("should allow placing two aksharas as a word", () => {
      const game = createAksharaGameState("single");
      const rack = game.players[0].rack;

      const result = makeAksharaMove(
        game,
        "player1",
        [
          { row: CENTER, col: CENTER, akshara: rack[0] },
          { row: CENTER, col: CENTER + 1, akshara: rack[1] },
        ],
        [0, 1],
      );

      expect(result.error).toBeUndefined();
      expect(result.moveScore).toBeGreaterThan(0);
      expect(game.currentTurn).toBe(1);
    });

    it("should refill rack to 8 after placing tiles", () => {
      const game = createAksharaGameState("single");
      const rack = game.players[0].rack;

      makeAksharaMove(
        game,
        "player1",
        [{ row: CENTER, col: CENTER, akshara: rack[0] }],
        [0],
      );

      expect(game.players[0].rack.length).toBe(AKSHARA_RACK_SIZE);
    });

    it("should reject placement not covering center on first move", () => {
      const game = createAksharaGameState("single");
      const rack = game.players[0].rack;

      const result = makeAksharaMove(
        game,
        "player1",
        [{ row: 0, col: 0, akshara: rack[0] }],
        [0],
      );
      expect(result.error).toContain("center");
    });

    it("should reject akshara not matching rack (anti-cheat)", () => {
      const game = createAksharaGameState("single");

      // Place an akshara that's not in the rack
      const result = makeAksharaMove(
        game,
        "player1",
        [{ row: CENTER, col: CENTER, akshara: "zzz_fake" }],
        [0],
      );
      expect(result.error).toContain("do not match");
    });

    it("should reject duplicate rack indices", () => {
      const game = createAksharaGameState("single");
      const rack = game.players[0].rack;

      const result = makeAksharaMove(
        game,
        "player1",
        [
          { row: CENTER, col: CENTER, akshara: rack[0] },
          { row: CENTER, col: CENTER + 1, akshara: rack[0] },
        ],
        [0, 0], // duplicate index
      );
      expect(result.error).toContain("Duplicate");
    });

    it("should play multiple consecutive turns in solo", () => {
      const game = createAksharaGameState("single");
      let rack = game.players[0].rack;

      // Turn 1
      makeAksharaMove(
        game,
        "player1",
        [
          { row: CENTER, col: CENTER, akshara: rack[0] },
          { row: CENTER, col: CENTER + 1, akshara: rack[1] },
        ],
        [0, 1],
      );
      expect(game.currentTurn).toBe(1);
      expect(game.currentTurn % game.players.length).toBe(0); // always player's turn in solo

      // Turn 2: extend
      rack = game.players[0].rack;
      const res = makeAksharaMove(
        game,
        "player1",
        [{ row: CENTER, col: CENTER + 2, akshara: rack[0] }],
        [0],
      );

      if (!res.error) {
        expect(game.currentTurn).toBe(2);
        expect(game.moves.length).toBe(2);
      }
    });

    it("should end game on two consecutive passes in solo", () => {
      const game = createAksharaGameState("single");

      aksharaPassTurn(game, "player1");
      expect(game.status).toBe("active");

      aksharaPassTurn(game, "player1");
      expect(game.status).toBe("finished");
      expect(game.winner).toBe("player1");
    });

    it("should NOT end game on one pass followed by a move", () => {
      const game = createAksharaGameState("single");
      const rack = game.players[0].rack;

      aksharaPassTurn(game, "player1");
      expect(game.status).toBe("active");

      makeAksharaMove(
        game,
        "player1",
        [{ row: CENTER, col: CENTER, akshara: rack[0] }],
        [0],
      );
      expect(game.status).toBe("active");

      aksharaPassTurn(game, "player1");
      expect(game.status).toBe("active"); // only 1 consecutive pass
    });

    it("should allow tile exchange in akshara mode", () => {
      const game = createAksharaGameState("single");
      const bagSizeBefore = game.tileBag.length;

      aksharaExchangeTiles(game, "player1", [0, 1, 2]);

      expect(game.players[0].rack.length).toBe(AKSHARA_RACK_SIZE);
      expect(game.currentTurn).toBe(1);
      expect(game.tileBag.length).toBe(bagSizeBefore); // returned 3, drew 3
    });

    it("should reject exchange with insufficient bag tiles", () => {
      const game = createAksharaGameState("single");
      game.tileBag = ["न"]; // only 1 tile

      const result = aksharaExchangeTiles(game, "player1", [0, 1, 2]);
      expect(result.error).toContain("Not enough tiles");
    });

    it("should accumulate scores across turns", () => {
      const game = createAksharaGameState("single");
      let rack = game.players[0].rack;

      const move1 = makeAksharaMove(
        game,
        "player1",
        [
          { row: CENTER, col: CENTER, akshara: rack[0] },
          { row: CENTER, col: CENTER + 1, akshara: rack[1] },
        ],
        [0, 1],
      );

      const scoreAfter1 = game.players[0].score;
      expect(scoreAfter1).toBe(move1.moveScore!);

      rack = game.players[0].rack;
      const move2 = makeAksharaMove(
        game,
        "player1",
        [{ row: CENTER, col: CENTER + 2, akshara: rack[0] }],
        [0],
      );

      if (!move2.error) {
        expect(game.players[0].score).toBe(scoreAfter1 + move2.moveScore!);
      }
    });

    it("should end game when bag empty and rack empty", () => {
      const game = createAksharaGameState("single");
      game.tileBag = [];
      game.players[0].rack = ["न"];

      makeAksharaMove(
        game,
        "player1",
        [{ row: CENTER, col: CENTER, akshara: "न" }],
        [0],
      );

      expect(game.status).toBe("finished");
      expect(game.winner).toBe("player1");
    });
  });

  // ─── AI Akshara ───

  describe("AI Akshara Mode", () => {
    it("should create a valid AI akshara game state", () => {
      const game = createAksharaGameState("ai");
      expect(game.players.length).toBe(2);
      expect(game.players[0].userId).toBe("player1");
      expect(game.players[1].userId).toBe("ai");
      expect(game.players[0].rack.length).toBe(AKSHARA_RACK_SIZE);
      expect(game.players[1].rack.length).toBe(AKSHARA_RACK_SIZE);
      expect(game.mode).toBe("ai");
      expect(game.gameStyle).toBe("akshara");
    });

    it("should have pre-formed aksharas in both racks", () => {
      const game = createAksharaGameState("ai");
      const tileCounts = getAksharaTileCounts();
      for (const akshara of game.players[0].rack) {
        expect(tileCounts.has(akshara)).toBe(true);
      }
      for (const akshara of game.players[1].rack) {
        expect(tileCounts.has(akshara)).toBe(true);
      }
    });

    it("should alternate turns between player and AI", () => {
      const game = createAksharaGameState("ai");
      const rack = game.players[0].rack;

      // Turn 0: player
      expect(game.currentTurn % 2).toBe(0);

      makeAksharaMove(
        game,
        "player1",
        [
          { row: CENTER, col: CENTER, akshara: rack[0] },
          { row: CENTER, col: CENTER + 1, akshara: rack[1] },
        ],
        [0, 1],
      );

      // Turn 1: AI
      expect(game.currentTurn % 2).toBe(1);

      // Player can't move again
      const newRack = game.players[0].rack;
      const badMove = makeAksharaMove(
        game,
        "player1",
        [{ row: CENTER, col: CENTER + 2, akshara: newRack[0] }],
        [0],
      );
      expect(badMove.error).toContain("Not your turn");
    });

    it("should allow AI to place pre-formed aksharas", () => {
      const game = createAksharaGameState("ai");
      const pRack = game.players[0].rack;

      // Player moves first
      makeAksharaMove(
        game,
        "player1",
        [{ row: CENTER, col: CENTER, akshara: pRack[0] }],
        [0],
      );

      // AI places from its rack
      const aiRack = game.players[1].rack;
      const result = makeAksharaMove(
        game,
        "ai",
        [{ row: CENTER, col: CENTER + 1, akshara: aiRack[0] }],
        [0],
      );

      expect(result.error).toBeUndefined();
      expect(game.currentTurn).toBe(2);
    });

    it("should allow AI to pass", () => {
      const game = createAksharaGameState("ai");
      const rack = game.players[0].rack;

      makeAksharaMove(
        game,
        "player1",
        [{ row: CENTER, col: CENTER, akshara: rack[0] }],
        [0],
      );

      const result = aksharaPassTurn(game, "ai");
      expect(result.error).toBeUndefined();
      expect(game.currentTurn).toBe(2);
      expect(game.currentTurn % 2).toBe(0); // back to player
    });

    it("should end game on consecutive passes from different players", () => {
      const game = createAksharaGameState("ai");

      aksharaPassTurn(game, "player1");
      expect(game.status).toBe("active");

      aksharaPassTurn(game, "ai");
      expect(game.status).toBe("finished");
    });

    it("should NOT end game on two passes from same player in AI mode", () => {
      const game = createAksharaGameState("ai");

      // Player passes
      aksharaPassTurn(game, "player1");

      // AI makes a move
      const aiRack = game.players[1].rack;
      makeAksharaMove(
        game,
        "ai",
        [{ row: CENTER, col: CENTER, akshara: aiRack[0] }],
        [0],
      );

      // Player passes again — last two: AI move + player pass, not both passes
      aksharaPassTurn(game, "player1");
      expect(game.status).toBe("active");
    });

    it("should correctly determine winner by score", () => {
      const game = createAksharaGameState("ai");
      game.players[0].score = 42;
      game.players[1].score = 28;
      game.status = "finished";
      determineWinner(game);
      expect(game.winner).toBe("player1");
    });

    it("should break ties in favor of player who did NOT play last", () => {
      const game = createAksharaGameState("ai");
      game.players[0].score = 30;
      game.players[1].score = 30;
      game.moves = [
        { playerId: "player1", placements: [], wordsFormed: [], score: 0 },
        { playerId: "ai", placements: [], wordsFormed: [], score: 0 },
      ];
      game.status = "finished";
      determineWinner(game);
      expect(game.winner).toBe("player1"); // AI played last
    });

    it("should handle AI exchange tiles in akshara mode", () => {
      const game = createAksharaGameState("ai");

      aksharaPassTurn(game, "player1");

      const result = aksharaExchangeTiles(game, "ai", [0, 1]);
      expect(result.error).toBeUndefined();
      expect(game.players[1].rack.length).toBe(AKSHARA_RACK_SIZE);
      expect(game.currentTurn).toBe(2);
    });

    it("should sanitize AI akshara game — AI rack visible", () => {
      const game = createAksharaGameState("ai");
      const p1View = sanitizeForPlayer(game, "player1");
      expect(p1View.players[1].rack).toBeDefined(); // AI rack is visible
    });

    it("AI player should be constructable in akshara mode", () => {
      const ai = new AiPlayer(1, true);
      expect(ai).toBeDefined();

      const ai2 = new AiPlayer(2, true);
      expect(ai2).toBeDefined();

      const ai3 = new AiPlayer(3, true);
      expect(ai3).toBeDefined();
    });

    it("AI should return null with empty rack in akshara mode", async () => {
      const board = createBoard();
      const ai = new AiPlayer(1, true);
      const move = await ai.findMove(board, []);
      expect(move).toBeNull();
    });

    it("should simulate player move then AI pass cycle", () => {
      const game = createAksharaGameState("ai");
      const rack = game.players[0].rack;

      // Player places
      makeAksharaMove(
        game,
        "player1",
        [
          { row: CENTER, col: CENTER, akshara: rack[0] },
          { row: CENTER, col: CENTER + 1, akshara: rack[1] },
        ],
        [0, 1],
      );

      // AI passes
      aksharaPassTurn(game, "ai");
      expect(game.currentTurn).toBe(2);

      // Player extends
      const newRack = game.players[0].rack;
      const res = makeAksharaMove(
        game,
        "player1",
        [{ row: CENTER, col: CENTER + 2, akshara: newRack[0] }],
        [0],
      );

      if (!res.error) {
        expect(game.currentTurn).toBe(3);
        expect(game.currentTurn % 2).toBe(1); // AI's turn
      }
    });

    it("should end AI game when bag and rack empty", () => {
      const game = createAksharaGameState("ai");
      game.tileBag = [];
      game.players[0].rack = ["र"];

      makeAksharaMove(
        game,
        "player1",
        [{ row: CENTER, col: CENTER, akshara: "र" }],
        [0],
      );

      expect(game.status).toBe("finished");
      expect(game.players[0].rack.length).toBe(0);
    });
  });

  // ─── Multiplayer Akshara ───

  describe("Multiplayer Akshara Mode", () => {
    it("should create a valid multiplayer akshara game state", () => {
      const game = createAksharaGameState("multiplayer");
      expect(game.players.length).toBe(2);
      expect(game.players[0].userId).toBe("player1");
      expect(game.players[1].userId).toBe("player2");
      expect(game.players[0].rack.length).toBe(AKSHARA_RACK_SIZE);
      expect(game.players[1].rack.length).toBe(AKSHARA_RACK_SIZE);
      expect(game.mode).toBe("multiplayer");
      expect(game.gameStyle).toBe("akshara");
    });

    it("should enforce turn order: player1 first", () => {
      const game = createAksharaGameState("multiplayer");
      const p2Rack = game.players[1].rack;

      const result = makeAksharaMove(
        game,
        "player2",
        [{ row: CENTER, col: CENTER, akshara: p2Rack[0] }],
        [0],
      );
      expect(result.error).toContain("Not your turn");
    });

    it("should alternate turns between two players", () => {
      const game = createAksharaGameState("multiplayer");
      const p1Rack = game.players[0].rack;

      // P1 turn 0
      makeAksharaMove(
        game,
        "player1",
        [
          { row: CENTER, col: CENTER, akshara: p1Rack[0] },
          { row: CENTER, col: CENTER + 1, akshara: p1Rack[1] },
        ],
        [0, 1],
      );
      expect(game.currentTurn).toBe(1);

      // P2 turn 1
      const p2Rack = game.players[1].rack;
      const result = makeAksharaMove(
        game,
        "player2",
        [{ row: CENTER + 1, col: CENTER, akshara: p2Rack[0] }],
        [0],
      );
      expect(result.error).toBeUndefined();
      expect(game.currentTurn).toBe(2);
      expect(game.currentTurn % 2).toBe(0); // P1's turn again
    });

    it("should end game on consecutive passes from both players", () => {
      const game = createAksharaGameState("multiplayer");

      aksharaPassTurn(game, "player1");
      expect(game.status).toBe("active");

      aksharaPassTurn(game, "player2");
      expect(game.status).toBe("finished");
    });

    it("should NOT end game on non-consecutive passes", () => {
      const game = createAksharaGameState("multiplayer");

      // P1 passes
      aksharaPassTurn(game, "player1");

      // P2 plays
      const p2Rack = game.players[1].rack;
      makeAksharaMove(
        game,
        "player2",
        [{ row: CENTER, col: CENTER, akshara: p2Rack[0] }],
        [0],
      );

      // P1 passes again — last two: [P2 move, P1 pass] → not both passes
      aksharaPassTurn(game, "player1");
      expect(game.status).toBe("active");
    });

    it("should sanitize — hide opponent rack in multiplayer akshara", () => {
      const game = createAksharaGameState("multiplayer");

      const p1View = sanitizeForPlayer(game, "player1");
      const p2View = sanitizeForPlayer(game, "player2");

      // P1 sees own rack but not P2's
      expect(p1View.players[0].rack).toBeDefined();
      expect(p1View.players[0].rack!.length).toBe(AKSHARA_RACK_SIZE);
      expect(p1View.players[1].rack).toBeUndefined();
      expect((p1View.players[1] as any).rackCount).toBe(AKSHARA_RACK_SIZE);

      // P2 sees own rack but not P1's
      expect(p2View.players[1].rack).toBeDefined();
      expect(p2View.players[0].rack).toBeUndefined();

      // Neither sees tile bag
      expect(p1View.tileBag).toBeUndefined();
      expect((p1View as any).tileBagCount).toBeDefined();
    });

    it("should track scores independently in multiplayer akshara", () => {
      const game = createAksharaGameState("multiplayer");

      // P1 places
      const p1Rack = game.players[0].rack;
      const move1 = makeAksharaMove(
        game,
        "player1",
        [
          { row: CENTER, col: CENTER, akshara: p1Rack[0] },
          { row: CENTER, col: CENTER + 1, akshara: p1Rack[1] },
        ],
        [0, 1],
      );

      const p1ScoreAfter = game.players[0].score;
      expect(p1ScoreAfter).toBe(move1.moveScore!);
      expect(game.players[1].score).toBe(0);

      // P2 places
      const p2Rack = game.players[1].rack;
      const move2 = makeAksharaMove(
        game,
        "player2",
        [{ row: CENTER + 1, col: CENTER, akshara: p2Rack[0] }],
        [0],
      );

      if (!move2.error) {
        expect(game.players[1].score).toBe(move2.moveScore!);
        expect(game.players[0].score).toBe(p1ScoreAfter); // unchanged
      }
    });

    it("should handle both players exchanging tiles in sequence", () => {
      const game = createAksharaGameState("multiplayer");

      aksharaExchangeTiles(game, "player1", [0, 1]);
      expect(game.currentTurn).toBe(1);
      expect(game.players[0].rack.length).toBe(AKSHARA_RACK_SIZE);

      aksharaExchangeTiles(game, "player2", [2, 3]);
      expect(game.currentTurn).toBe(2);
      expect(game.players[1].rack.length).toBe(AKSHARA_RACK_SIZE);
    });

    it("should record move history for both players", () => {
      const game = createAksharaGameState("multiplayer");
      const p1Rack = game.players[0].rack;

      makeAksharaMove(
        game,
        "player1",
        [{ row: CENTER, col: CENTER, akshara: p1Rack[0] }],
        [0],
      );

      aksharaPassTurn(game, "player2");

      expect(game.moves.length).toBe(2);
      expect(game.moves[0].playerId).toBe("player1");
      expect(game.moves[0].placements.length).toBe(1);
      expect(game.moves[1].playerId).toBe("player2");
      expect(game.moves[1].placements.length).toBe(0);
    });

    it("should correctly determine winner in multiplayer akshara", () => {
      const game = createAksharaGameState("multiplayer");
      game.players[0].score = 65;
      game.players[1].score = 45;
      determineWinner(game);
      expect(game.winner).toBe("player1");
    });

    it("should handle multiplayer akshara tiebreak", () => {
      const game = createAksharaGameState("multiplayer");
      game.players[0].score = 40;
      game.players[1].score = 40;
      game.moves = [
        { playerId: "player1", placements: [], wordsFormed: [], score: 0 },
        { playerId: "player2", placements: [], wordsFormed: [], score: 0 },
      ];
      determineWinner(game);
      expect(game.winner).toBe("player1"); // P2 played last
    });

    it("should handle player disconnect state", () => {
      const game = createAksharaGameState("multiplayer");
      game.players[1].connected = false;

      expect(game.status).toBe("active");
      const rack = game.players[0].rack;
      const result = makeAksharaMove(
        game,
        "player1",
        [{ row: CENTER, col: CENTER, akshara: rack[0] }],
        [0],
      );
      expect(result.error).toBeUndefined();
    });
  });

  // ─── Akshara-Specific Anti-Cheat ───

  describe("Akshara Anti-Cheat (direct tile matching)", () => {
    it("should pass when placed aksharas exactly match rack tiles", () => {
      const rack = ["दे", "व", "न", "ग", "र", "म", "स", "ज"];
      const placements: TilePlacement[] = [
        { row: CENTER, col: CENTER, akshara: "दे" },
        { row: CENTER, col: CENTER + 1, akshara: "व" },
      ];
      const result = validateAksharaRack(rack, [0, 1], placements);
      expect(result.valid).toBe(true);
    });

    it("should fail when placed akshara does not match rack tile at index", () => {
      const rack = ["दे", "व", "न", "ग", "र", "म", "स", "ज"];
      const placements: TilePlacement[] = [
        { row: CENTER, col: CENTER, akshara: "न" }, // rack[0] is "दे", not "न"
      ];
      const result = validateAksharaRack(rack, [0], placements);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("do not match");
    });

    it("should fail with out-of-bounds rack index", () => {
      const rack = ["दे", "व", "न"];
      const placements: TilePlacement[] = [
        { row: CENTER, col: CENTER, akshara: "दे" },
      ];
      const result = validateAksharaRack(rack, [10], placements);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Invalid rack index");
    });

    it("should fail with duplicate rack indices", () => {
      const rack = ["दे", "व", "न"];
      const placements: TilePlacement[] = [
        { row: CENTER, col: CENTER, akshara: "दे" },
        { row: CENTER, col: CENTER + 1, akshara: "दे" },
      ];
      const result = validateAksharaRack(rack, [0, 0], placements);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Duplicate");
    });

    it("should fail when placement count mismatches rack indices count", () => {
      const rack = ["दे", "व", "न"];
      const placements: TilePlacement[] = [
        { row: CENTER, col: CENTER, akshara: "दे" },
      ];
      const result = validateAksharaRack(rack, [0, 1], placements);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("count");
    });

    it("should handle duplicate aksharas in rack correctly", () => {
      const rack = ["दे", "दे", "व", "न", "ग", "र", "म", "स"];
      const placements: TilePlacement[] = [
        { row: CENTER, col: CENTER, akshara: "दे" },
        { row: CENTER, col: CENTER + 1, akshara: "दे" },
      ];
      const result = validateAksharaRack(rack, [0, 1], placements);
      expect(result.valid).toBe(true);
    });
  });

  // ─── Akshara Scoring with Rack-Size Bonus ───

  describe("Akshara Scoring (rack-size bonus)", () => {
    it("should trigger all-tiles bonus when placing 8 tiles", () => {
      const board = createBoard();
      const placements: TilePlacement[] = [];
      for (let i = 0; i < 8; i++) {
        placements.push({ row: CENTER, col: CENTER - 3 + i, akshara: "क" });
      }

      const { totalScore: with8 } = calculateMoveScore(
        board,
        placements,
        AKSHARA_RACK_SIZE,
      );
      const { totalScore: with15 } = calculateMoveScore(board, placements, 15);
      // 8 placements >= AKSHARA_RACK_SIZE (8) → bonus (+15)
      // 8 placements < 15 → no bonus
      expect(with8).toBe(with15 + 15);
    });

    it("should NOT trigger bonus when placing fewer than 8 tiles", () => {
      const board = createBoard();
      const placements: TilePlacement[] = [
        { row: CENTER, col: CENTER, akshara: "दे" },
        { row: CENTER, col: CENTER + 1, akshara: "व" },
      ];

      const { totalScore: with8 } = calculateMoveScore(
        board,
        placements,
        AKSHARA_RACK_SIZE,
      );
      const { totalScore: with15 } = calculateMoveScore(board, placements, 15);
      expect(with8).toBe(with15); // same, no bonus
    });

    it("should score pre-formed conjuncts correctly", () => {
      // "र्म" = र(1) + म(1) = 2 points
      expect(getAksharaScore("र्म")).toBe(2);
      // "क्ष" = क(1) + ष(3) = 4 points
      expect(getAksharaScore("क्ष")).toBe(4);
    });
  });

  // ─── Akshara Tile Bag Properties ───

  describe("Akshara Tile Bag", () => {
    it("should draw two full racks without exhausting bag", () => {
      const bag = createAksharaTileBag();
      const { drawn: rack1, remaining: r1 } = drawFromBag(
        bag,
        AKSHARA_RACK_SIZE,
      );
      const { drawn: rack2, remaining: r2 } = drawFromBag(
        r1,
        AKSHARA_RACK_SIZE,
      );
      expect(rack1.length).toBe(AKSHARA_RACK_SIZE);
      expect(rack2.length).toBe(AKSHARA_RACK_SIZE);
      expect(r2.length).toBe(bag.length - 2 * AKSHARA_RACK_SIZE);
    });

    it("should have enough tiles for a full multiplayer game", () => {
      const bag = createAksharaTileBag();
      // At minimum: 2 racks of 8 = 16 tiles needed at start
      expect(bag.length).toBeGreaterThan(16);
    });

    it("should contain only aksharas from the distribution", () => {
      const bag = createAksharaTileBag();
      const tileCounts = getAksharaTileCounts();
      for (const akshara of bag) {
        expect(tileCounts.has(akshara)).toBe(true);
      }
    });
  });

  // ─── canFormAnyWord (Smart Draw validation) ───

  describe("Smart Draw — canFormAnyWord", () => {
    it("should return true when rack can form a word", () => {
      const wordIndex = new Map<string, string[][]>();
      for (const word of SAMPLE_WORDS) {
        const aksharas = splitAksharas(normalizeText(word));
        if (aksharas.length >= 2) {
          wordIndex.set(word, [aksharas]);
        }
      }

      // "ज" + "ल" can form "जल"
      const rack = ["ज", "ल", "क", "म", "प", "स", "न", "द"];
      expect(canFormAnyWord(rack, wordIndex)).toBe(true);
    });

    it("should return false when no word can be formed", () => {
      const wordIndex = new Map<string, string[][]>();
      for (const word of SAMPLE_WORDS) {
        const aksharas = splitAksharas(normalizeText(word));
        if (aksharas.length >= 2) {
          wordIndex.set(word, [aksharas]);
        }
      }

      const rack = ["क्री", "ज्ञा", "श्री", "ध्या", "भ्रा", "त्रा", "प्रा", "क्ला"];
      expect(canFormAnyWord(rack, wordIndex)).toBe(false);
    });

    it("should handle empty rack", () => {
      const wordIndex = new Map<string, string[][]>();
      wordIndex.set("जल", [["ज", "ल"]]);
      expect(canFormAnyWord([], wordIndex)).toBe(false);
    });

    it("should handle empty dictionary", () => {
      const wordIndex = new Map<string, string[][]>();
      const rack = ["ज", "ल", "क", "म", "प", "स", "न", "द"];
      expect(canFormAnyWord(rack, wordIndex)).toBe(false);
    });
  });

  // ─── Full Multi-Turn Simulations (Akshara) ───

  describe("Full Multi-Turn Simulations (Akshara)", () => {
    it("solo akshara: should play multiple turns building a grid", () => {
      const game = createAksharaGameState("single");
      let turns = 0;

      // Turn 1: place 2 aksharas at center
      let rack = game.players[0].rack;
      let res = makeAksharaMove(
        game,
        "player1",
        [
          { row: CENTER, col: CENTER, akshara: rack[0] },
          { row: CENTER, col: CENTER + 1, akshara: rack[1] },
        ],
        [0, 1],
      );
      if (!res.error) turns++;

      // Extend downward from center for more turns
      for (let t = 0; t < 4; t++) {
        rack = game.players[0].rack;
        if (rack.length === 0) break;

        const targetRow = CENTER + 1 + t;
        if (targetRow >= BOARD_SIZE) break;
        if (game.board[targetRow][CENTER].akshara !== null) continue;

        const hasAdjacent =
          targetRow > 0 &&
          game.board[targetRow - 1][CENTER].akshara !== null;
        if (!hasAdjacent) continue;

        res = makeAksharaMove(
          game,
          "player1",
          [{ row: targetRow, col: CENTER, akshara: rack[0] }],
          [0],
        );
        if (!res.error) turns++;
      }

      expect(turns).toBeGreaterThanOrEqual(2);
      expect(game.players[0].score).toBeGreaterThan(0);
    });

    it("multiplayer akshara: should play alternating turns", () => {
      const game = createAksharaGameState("multiplayer");

      // P1 at center
      const p1Rack = game.players[0].rack;
      makeAksharaMove(
        game,
        "player1",
        [
          { row: CENTER, col: CENTER, akshara: p1Rack[0] },
          { row: CENTER, col: CENTER + 1, akshara: p1Rack[1] },
        ],
        [0, 1],
      );

      // P2 extends
      const p2Rack = game.players[1].rack;
      makeAksharaMove(
        game,
        "player2",
        [{ row: CENTER + 1, col: CENTER, akshara: p2Rack[0] }],
        [0],
      );

      // More turns
      for (let t = 2; t < 6; t++) {
        const isP1 = t % 2 === 0;
        const userId = isP1 ? "player1" : "player2";
        const pIdx = isP1 ? 0 : 1;
        const pRack = game.players[pIdx].rack;
        if (pRack.length === 0) break;

        const targetRow = CENTER + 2 + Math.floor(t / 2);
        if (targetRow >= BOARD_SIZE) break;
        if (game.board[targetRow][CENTER].akshara !== null) {
          aksharaPassTurn(game, userId);
          continue;
        }

        const hasAdj =
          targetRow > 0 &&
          game.board[targetRow - 1][CENTER].akshara !== null;
        if (!hasAdj) {
          aksharaPassTurn(game, userId);
          continue;
        }

        const res = makeAksharaMove(
          game,
          userId,
          [{ row: targetRow, col: CENTER, akshara: pRack[0] }],
          [0],
        );
        if (res.error) aksharaPassTurn(game, userId);
      }

      expect(game.moves.length).toBeGreaterThanOrEqual(4);
      expect(game.currentTurn).toBeGreaterThanOrEqual(4);
    });

    it("AI akshara: full game ending with consecutive passes", () => {
      const game = createAksharaGameState("ai");

      aksharaPassTurn(game, "player1");
      expect(game.status).toBe("active");

      aksharaPassTurn(game, "ai");
      expect(game.status).toBe("finished");
      expect(game.winner).toBeDefined();
    });
  });
});
