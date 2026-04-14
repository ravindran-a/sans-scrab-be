import {
  BoardState,
  TilePlacement,
  applyPlacements,
  createBoard,
  extractWords,
  validatePlacement,
} from "../../engine/Board";
import { normalizeText } from "../../engine/GraphemeSplitter";
import {
  AKSHARA_RACK_SIZE,
  RACK_SIZE,
  SanskritEngine,
  canFormAnyWord,
  createAksharaTileBag,
  createTileBag,
  drawFromBag,
  shuffleArray,
} from "../../engine/SanskritEngine";
import { calculateMoveScore } from "../../engine/Scoring";
import { AiPlayer } from "../ai/AiPlayer";
import { DictionaryService } from "../dictionary/dictionary.service";
import {
  GameMode,
  GameModel,
  GameStyle,
  IGame,
  MoveRecord,
  PlayerState,
} from "./game.model";

export interface CreateGameOptions {
  mode: GameMode;
  userId: string;
  username: string;
  aiDifficulty?: number;
  turnTimer?: number;
  roomId?: string;
  isGuest?: boolean;
  gameStyle?: GameStyle;
}

export async function createGame(options: CreateGameOptions): Promise<IGame> {
  const board = createBoard();
  const gameStyle = options.gameStyle || "classic";
  const isAksharaMode = gameStyle === "akshara";
  const rackSize = isAksharaMode ? AKSHARA_RACK_SIZE : RACK_SIZE;
  const tileBag = isAksharaMode ? createAksharaTileBag() : createTileBag();

  // Draw initial rack for the player (smart draw for akshara mode)
  let { drawn: rack, remaining } = drawFromBag(tileBag, rackSize);
  if (isAksharaMode) {
    ({ rack, remaining } = smartDraw(rack, remaining, rackSize));
  }

  const players: PlayerState[] = [
    {
      userId: options.userId,
      username: options.username,
      rack,
      score: 0,
      connected: true,
    },
  ];

  let finalBag = remaining;

  // For AI mode, create AI player
  if (options.mode === "ai") {
    let { drawn: aiRack, remaining: afterAi } = drawFromBag(
      remaining,
      rackSize,
    );
    if (isAksharaMode) {
      ({ rack: aiRack, remaining: afterAi } = smartDraw(
        aiRack,
        afterAi,
        rackSize,
      ));
    }
    players.push({
      userId: "ai",
      username: `AI-Level-${options.aiDifficulty || 1}`,
      rack: aiRack,
      score: 0,
      connected: true,
    });
    finalBag = afterAi;
  }

  const game = await GameModel.create({
    mode: options.mode,
    status: options.mode === "multiplayer" ? "waiting" : "active",
    gameStyle,
    board,
    players,
    currentTurn: 0,
    tileBag: finalBag,
    moves: [],
    aiDifficulty: options.aiDifficulty,
    turnTimer: options.turnTimer || 120,
    turnStartedAt: new Date(),
    roomId: options.roomId,
    isGuest: options.isGuest || false,
  });

  return game;
}

/**
 * Recover a dead AI rack: return all current tiles to the bag and draw a
 * fresh rack. In akshara mode, retry up to 3 times until the new rack can
 * form at least one dictionary word. Used by triggerAiMove to break the
 * auto-pass loop when the AI's rack has no valid moves on the current board.
 */
export function recoverDeadAiRack(
  oldRack: string[],
  bag: string[],
  rackSize: number,
  isAksharaMode: boolean,
  wordIndex: Map<string, string[][]>,
): { rack: string[]; bag: string[] } {
  if (bag.length === 0) return { rack: oldRack, bag };
  const draw = drawFromBag(bag, rackSize);
  let refreshedRack = draw.drawn;
  let refreshedBag = shuffleArray([...draw.remaining, ...oldRack]);

  if (isAksharaMode) {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (canFormAnyWord(refreshedRack, wordIndex)) break;
      const reshuffled = shuffleArray([...refreshedRack, ...refreshedBag]);
      const redraw = drawFromBag(reshuffled, rackSize);
      refreshedRack = redraw.drawn;
      refreshedBag = redraw.remaining;
    }
  }

  return { rack: refreshedRack, bag: refreshedBag };
}

/**
 * Smart draw for akshara mode: ensure the rack can form at least one word.
 * Reshuffles up to 3 times before giving up (fallback to best draw).
 */
function smartDraw(
  rack: string[],
  remaining: string[],
  rackSize: number,
): { rack: string[]; remaining: string[] } {
  const wordIndex = DictionaryService.getWordAksharaIndex();
  for (let attempt = 0; attempt < 3; attempt++) {
    if (canFormAnyWord(rack, wordIndex)) {
      return { rack, remaining };
    }
    // Put rack back, reshuffle, redraw
    const fullBag = shuffleArray([...rack, ...remaining]);
    const redraw = drawFromBag(fullBag, rackSize);
    rack = redraw.drawn;
    remaining = redraw.remaining;
  }
  return { rack, remaining };
}

export async function joinGame(
  gameId: string,
  userId: string,
  username: string,
): Promise<IGame> {
  const game = await GameModel.findById(gameId);
  if (!game) throw new Error("Game not found");
  if (game.status !== "waiting")
    throw new Error("Game is not accepting players");
  if (game.players.length >= 2) throw new Error("Game is full");
  if (game.players.some((p) => p.userId === userId))
    throw new Error("Already in game");

  const isAksharaMode = game.gameStyle === "akshara";
  const rackSize = isAksharaMode ? AKSHARA_RACK_SIZE : RACK_SIZE;
  let { drawn: rack, remaining } = drawFromBag(game.tileBag, rackSize);
  if (isAksharaMode) {
    ({ rack, remaining } = smartDraw(rack, remaining, rackSize));
  }

  game.players.push({
    userId,
    username,
    rack,
    score: 0,
    connected: true,
  });
  game.tileBag = remaining;
  game.status = "active";
  game.turnStartedAt = new Date();

  await game.save();
  return game;
}

export interface MoveInput {
  gameId: string;
  userId: string;
  placements: TilePlacement[];
  rackIndices: number[];
}

export async function makeMove(input: MoveInput): Promise<{
  game: IGame;
  moveScore: number;
  wordsFormed: { word: string; score: number }[];
}> {
  // Optimistic locking: read current turn, validate, then atomic update
  const game = await GameModel.findById(input.gameId);
  if (!game) throw new Error("Game not found");
  if (game.status !== "active") throw new Error("Game is not active");
  const expectedTurn = game.currentTurn;

  const playerIndex = game.players.findIndex((p) => p.userId === input.userId);
  if (playerIndex === -1) throw new Error("Player not in game");
  if (game.currentTurn % game.players.length !== playerIndex) {
    throw new Error("Not your turn");
  }

  const player = game.players[playerIndex];
  const board = game.board as BoardState;
  const isAksharaMode = game.gameStyle === "akshara";
  const rackSize = isAksharaMode ? AKSHARA_RACK_SIZE : RACK_SIZE;

  // Anti-cheat: verify rack indices (bounds + no duplicates)
  const uniqueIndices = new Set(input.rackIndices);
  if (uniqueIndices.size !== input.rackIndices.length) {
    throw new Error("Duplicate rack indices");
  }
  for (const idx of input.rackIndices) {
    if (idx < 0 || idx >= player.rack.length) {
      throw new Error("Invalid rack index");
    }
  }

  if (isAksharaMode) {
    // Akshara mode: each placement akshara must exactly match the rack tile at its index
    const rackAksharas = input.rackIndices.map((idx) => player.rack[idx]);
    const placedAksharas = input.placements.map((p) =>
      normalizeText(p.akshara),
    );
    const sortedRack = [...rackAksharas].sort();
    const sortedPlaced = [...placedAksharas].sort();
    if (
      sortedRack.length !== sortedPlaced.length ||
      sortedRack.some((a, i) => a !== sortedPlaced[i])
    ) {
      throw new Error("Placed aksharas do not match the rack tiles");
    }
  } else {
    // Classic mode: verify aksharas can be formed from the rack consonants at given indices
    const rackConsonants = input.rackIndices.map((idx) => player.rack[idx]);
    const neededConsonants: string[] = [];
    for (const placement of input.placements) {
      const normalized = normalizeText(placement.akshara);
      for (const ch of Array.from(normalized)) {
        const code = ch.charCodeAt(0);
        if (code >= 0x0915 && code <= 0x0939) {
          neededConsonants.push(ch);
        }
      }
    }
    const sortedNeeded = [...neededConsonants].sort();
    const sortedRack = [...rackConsonants].sort();
    if (
      sortedNeeded.length !== sortedRack.length ||
      sortedNeeded.some((c, i) => c !== sortedRack[i])
    ) {
      throw new Error("Placed aksharas do not match the rack consonants");
    }
  }

  // Validate placements
  const validation = validatePlacement(board, input.placements);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  // Extract and validate words
  const words = extractWords(board, input.placements);
  for (const { word } of words) {
    const normalized = normalizeText(word);
    if (!DictionaryService.isValidWord(normalized)) {
      throw new Error(`Invalid word: ${word}`);
    }
  }

  // Calculate score
  const { totalScore, wordScores } = calculateMoveScore(
    board,
    input.placements,
    rackSize,
  );

  // Apply to board
  const newBoard = applyPlacements(board, input.placements, game.moves.length);

  // Remove used tiles from rack and refill
  const newRack = [...player.rack];
  const sortedIndices = [...input.rackIndices].sort((a, b) => b - a);
  for (const idx of sortedIndices) {
    newRack.splice(idx, 1);
  }

  const needed = rackSize - newRack.length;
  let { drawn, remaining } = drawFromBag(game.tileBag, needed);
  newRack.push(...drawn);

  // Smart draw for akshara mode: if full rack can't form any word,
  // only re-draw the NEW tiles (preserve tiles the player kept)
  if (isAksharaMode && remaining.length > 0) {
    const wordIndex = DictionaryService.getWordAksharaIndex();
    if (!canFormAnyWord(newRack, wordIndex)) {
      // Put only the newly drawn tiles back, reshuffle, redraw
      const keptTiles = newRack.slice(0, newRack.length - drawn.length);
      let newDrawn = drawn;
      let bag = remaining;
      for (let attempt = 0; attempt < 3; attempt++) {
        bag = shuffleArray([...newDrawn, ...bag]);
        const redraw = drawFromBag(bag, needed);
        newDrawn = redraw.drawn;
        bag = redraw.remaining;
        if (canFormAnyWord([...keptTiles, ...newDrawn], wordIndex)) break;
      }
      newRack.length = 0;
      newRack.push(...keptTiles, ...newDrawn);
      remaining = bag;
    }
  }

  // Update game state
  game.board = newBoard;
  game.players[playerIndex].rack = newRack;
  game.players[playerIndex].score += totalScore;
  game.tileBag = remaining;
  game.currentTurn += 1;
  game.turnStartedAt = new Date();

  const move: MoveRecord = {
    playerId: input.userId,
    placements: input.placements,
    wordsFormed: words.map((w) => w.word),
    score: totalScore,
    timestamp: new Date(),
  };
  game.moves.push(move);

  // Check end conditions
  if (game.tileBag.length === 0 && newRack.length === 0) {
    game.status = "finished";
    determineWinner(game);
  }

  // Optimistic locking with retry: ensure no concurrent move modified the turn.
  // Use $set to avoid shipping _id, __v, timestamps, and other immutable
  // fields that findOneAndUpdate would otherwise choke on with a full doc.
  const update = {
    $set: {
      board: game.board,
      players: game.players,
      currentTurn: game.currentTurn,
      tileBag: game.tileBag,
      moves: game.moves,
      turnStartedAt: game.turnStartedAt,
      status: game.status,
      winner: game.winner,
    },
  };
  let saved = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    saved = await GameModel.findOneAndUpdate(
      { _id: game._id, currentTurn: expectedTurn },
      update,
      { new: true },
    );
    if (saved) break;
    // Brief pause before retry
    if (attempt < 2)
      await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
  }
  if (!saved) {
    throw new Error(
      "Move conflict — another move was processed. Please refresh.",
    );
  }

  return { game: saved, moveScore: totalScore, wordsFormed: wordScores };
}

export async function passTurn(gameId: string, userId: string): Promise<IGame> {
  const game = await GameModel.findById(gameId);
  if (!game) throw new Error("Game not found");
  if (game.status !== "active") throw new Error("Game is not active");

  const playerIndex = game.players.findIndex((p) => p.userId === userId);
  if (playerIndex === -1) throw new Error("Player not in game");
  if (game.currentTurn % game.players.length !== playerIndex) {
    throw new Error("Not your turn");
  }

  game.currentTurn += 1;
  game.turnStartedAt = new Date();

  // Record the pass move first
  game.moves.push({
    playerId: userId,
    placements: [],
    wordsFormed: [],
    score: 0,
    timestamp: new Date(),
  });

  // Check if consecutive passes should end the game
  const lastTwo = game.moves.slice(-2);
  if (lastTwo.length === 2 && lastTwo.every((m) => m.placements.length === 0)) {
    // Solo mode: 2 consecutive passes by the same (only) player ends the game
    // Multiplayer/AI: 2 consecutive passes from different players ends the game
    const isSoloMode = game.players.length === 1;
    const differentPlayers = lastTwo[0].playerId !== lastTwo[1].playerId;
    if (isSoloMode || differentPlayers) {
      game.status = "finished";
      determineWinner(game);
    }
  }

  await game.save();
  return game;
}

export async function exchangeTiles(
  gameId: string,
  userId: string,
  rackIndices: number[],
): Promise<IGame> {
  const game = await GameModel.findById(gameId);
  if (!game) throw new Error("Game not found");
  if (game.status !== "active") throw new Error("Game is not active");

  const playerIndex = game.players.findIndex((p) => p.userId === userId);
  if (playerIndex === -1) throw new Error("Player not in game");
  if (game.currentTurn % game.players.length !== playerIndex) {
    throw new Error("Not your turn");
  }

  if (game.tileBag.length < rackIndices.length) {
    throw new Error("Not enough tiles in bag to exchange");
  }

  const isAksharaMode = game.gameStyle === "akshara";
  const rackSize = isAksharaMode ? AKSHARA_RACK_SIZE : RACK_SIZE;
  const player = game.players[playerIndex];
  const returned: string[] = [];
  const newRack = [...player.rack];

  const sortedIndices = [...rackIndices].sort((a, b) => b - a);
  for (const idx of sortedIndices) {
    if (idx < 0 || idx >= newRack.length) throw new Error("Invalid rack index");
    returned.push(newRack[idx]);
    newRack.splice(idx, 1);
  }

  const { drawn, remaining } = drawFromBag(game.tileBag, returned.length);
  newRack.push(...drawn);

  // Put returned tiles back and shuffle
  let newBag = SanskritEngine.shuffleArray([...remaining, ...returned]);

  // Smart draw for akshara mode: only redraw the new tiles if unplayable
  if (isAksharaMode) {
    const wordIndex = DictionaryService.getWordAksharaIndex();
    if (!canFormAnyWord(newRack, wordIndex)) {
      const keptTiles = newRack.slice(0, newRack.length - drawn.length);
      let newDrawn = drawn;
      let bag = newBag;
      for (let attempt = 0; attempt < 3; attempt++) {
        bag = shuffleArray([...newDrawn, ...bag]);
        const redraw = drawFromBag(bag, returned.length);
        newDrawn = redraw.drawn;
        bag = redraw.remaining;
        if (canFormAnyWord([...keptTiles, ...newDrawn], wordIndex)) break;
      }
      newRack.length = 0;
      newRack.push(...keptTiles, ...newDrawn);
      newBag = bag;
    }
  }

  game.players[playerIndex].rack = newRack;
  game.tileBag = newBag;
  game.currentTurn += 1;
  game.turnStartedAt = new Date();

  game.moves.push({
    playerId: userId,
    placements: [],
    wordsFormed: [],
    score: 0,
    timestamp: new Date(),
  });

  await game.save();
  return game;
}

/**
 * Preview a move: validate placements, check word validity, calculate score.
 * Does NOT commit the move. Used for real-time feedback.
 */
export async function previewMove(
  gameId: string,
  _userId: string,
  placements: TilePlacement[],
): Promise<{
  valid: boolean;
  totalScore: number;
  words: { word: string; score: number; valid: boolean }[];
  error?: string;
}> {
  const game = await GameModel.findById(gameId);
  if (!game)
    return { valid: false, totalScore: 0, words: [], error: "Game not found" };
  if (game.status !== "active")
    return { valid: false, totalScore: 0, words: [], error: "Game not active" };

  const board = game.board as BoardState;

  // Validate placement geometry
  const validation = validatePlacement(board, placements);
  if (!validation.valid) {
    return { valid: false, totalScore: 0, words: [], error: validation.error };
  }

  // Extract words and check validity
  extractWords(board, placements);
  const wordResults: { word: string; score: number; valid: boolean }[] = [];
  let allValid = true;

  // Calculate scores
  const isAksharaModePreview = game.gameStyle === "akshara";
  const previewRackSize = isAksharaModePreview ? AKSHARA_RACK_SIZE : RACK_SIZE;
  const { wordScores } = calculateMoveScore(board, placements, previewRackSize);

  for (const ws of wordScores) {
    const isValid = DictionaryService.isValidWord(normalizeText(ws.word));
    wordResults.push({ word: ws.word, score: ws.score, valid: isValid });
    if (!isValid) allValid = false;
  }

  const totalScore = allValid
    ? wordResults.reduce((sum, w) => sum + w.score, 0)
    : 0;

  return { valid: allValid, totalScore, words: wordResults };
}

function determineWinner(game: IGame): void {
  const sorted = [...game.players].sort((a, b) => b.score - a.score);
  if (sorted.length >= 2 && sorted[0].score === sorted[1].score) {
    // Tiebreaker: player who played last loses (the other wins)
    // This rewards the player who finished first or forced the end
    const lastMovePlayer =
      game.moves.length > 0 ? game.moves[game.moves.length - 1].playerId : null;
    game.winner =
      sorted.find((p) => p.userId !== lastMovePlayer)?.userId ||
      sorted[0].userId;
  } else {
    game.winner = sorted[0].userId;
  }
}

export async function getGame(gameId: string): Promise<IGame | null> {
  return GameModel.findById(gameId);
}

export async function getGamesByUser(userId: string): Promise<IGame[]> {
  // History view only needs summary fields. Exclude heavy arrays (board,
  // tileBag, moves) that the UI never renders here — they inflate the
  // payload by orders of magnitude.
  return GameModel.find({ "players.userId": userId })
    .sort({ createdAt: -1 })
    .limit(20)
    .select("-board -tileBag -moves");
}

export async function abandonGame(
  gameId: string,
  userId: string,
): Promise<IGame> {
  const game = await GameModel.findById(gameId);
  if (!game) throw new Error("Game not found");

  game.status = "abandoned";
  const otherPlayer = game.players.find((p) => p.userId !== userId);
  if (otherPlayer) {
    game.winner = otherPlayer.userId;
  }
  await game.save();
  return game;
}

/**
 * Trigger AI move after human plays in AI mode.
 * Returns updated game state after AI's turn.
 */
export async function triggerAiMove(gameId: string): Promise<IGame | null> {
  const game = await GameModel.findById(gameId);
  if (!game || game.status !== "active" || game.mode !== "ai") return null;

  const aiPlayerIdx = game.players.findIndex((p) => p.userId === "ai");
  if (aiPlayerIdx === -1) return null;
  if (game.currentTurn % game.players.length !== aiPlayerIdx) return null;

  const aiPlayer = game.players[aiPlayerIdx];
  const isAksharaMode = game.gameStyle === "akshara";
  const rackSize = isAksharaMode ? AKSHARA_RACK_SIZE : RACK_SIZE;
  const ai = new AiPlayer(game.aiDifficulty || 1, isAksharaMode);
  const board = game.board as BoardState;
  let move = await ai.findMove(board, aiPlayer.rack);

  // Recovery: if AI can't move and tiles remain, swap entire rack and retry
  // once before passing. Prevents the dead-rack auto-pass loop in both modes.
  if (!move && game.tileBag.length > 0) {
    const wordIndex = DictionaryService.getWordAksharaIndex();
    const recovered = recoverDeadAiRack(
      [...aiPlayer.rack],
      game.tileBag,
      rackSize,
      isAksharaMode,
      wordIndex,
    );
    game.players[aiPlayerIdx].rack = recovered.rack;
    game.tileBag = recovered.bag;
    await game.save();

    move = await ai.findMove(board, recovered.rack);
  }

  if (!move) {
    // AI can't make a move even after rack refresh — auto-pass
    return await passTurn(gameId, "ai");
  }

  // AI makes its move
  return (
    await makeMove({
      gameId,
      userId: "ai",
      placements: move.placements,
      rackIndices: move.rackIndices,
    })
  ).game;
}

export const GameService = {
  createGame,
  joinGame,
  makeMove,
  passTurn,
  exchangeTiles,
  previewMove,
  getGame,
  getGamesByUser,
  abandonGame,
  triggerAiMove,
};
