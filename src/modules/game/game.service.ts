import { GameModel, IGame, GameMode, PlayerState, MoveRecord } from './game.model';
import { SanskritEngine, RACK_SIZE, createTileBag, drawFromBag, constructAkshara } from '../../engine/SanskritEngine';
import { createBoard, BoardState, TilePlacement, validatePlacement, applyPlacements, extractWords } from '../../engine/Board';
import { calculateMoveScore } from '../../engine/Scoring';
import { DictionaryService } from '../dictionary/dictionary.service';
import { normalizeText } from '../../engine/GraphemeSplitter';

export interface CreateGameOptions {
  mode: GameMode;
  userId: string;
  username: string;
  aiDifficulty?: number;
  turnTimer?: number;
  roomId?: string;
}

export async function createGame(options: CreateGameOptions): Promise<IGame> {
  const board = createBoard();
  const tileBag = createTileBag();

  // Draw initial rack for the player
  const { drawn: rack, remaining } = drawFromBag(tileBag, RACK_SIZE);

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
  if (options.mode === 'ai') {
    const { drawn: aiRack, remaining: afterAi } = drawFromBag(remaining, RACK_SIZE);
    players.push({
      userId: 'ai',
      username: `AI-Level-${options.aiDifficulty || 1}`,
      rack: aiRack,
      score: 0,
      connected: true,
    });
    finalBag = afterAi;
  }

  const game = await GameModel.create({
    mode: options.mode,
    status: options.mode === 'multiplayer' ? 'waiting' : 'active',
    board,
    players,
    currentTurn: 0,
    tileBag: finalBag,
    moves: [],
    aiDifficulty: options.aiDifficulty,
    turnTimer: options.turnTimer || 120,
    turnStartedAt: new Date(),
    roomId: options.roomId,
  });

  return game;
}

export async function joinGame(gameId: string, userId: string, username: string): Promise<IGame> {
  const game = await GameModel.findById(gameId);
  if (!game) throw new Error('Game not found');
  if (game.status !== 'waiting') throw new Error('Game is not accepting players');
  if (game.players.length >= 2) throw new Error('Game is full');
  if (game.players.some(p => p.userId === userId)) throw new Error('Already in game');

  const { drawn: rack, remaining } = drawFromBag(game.tileBag, RACK_SIZE);

  game.players.push({
    userId,
    username,
    rack,
    score: 0,
    connected: true,
  });
  game.tileBag = remaining;
  game.status = 'active';
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
  const game = await GameModel.findById(input.gameId);
  if (!game) throw new Error('Game not found');
  if (game.status !== 'active') throw new Error('Game is not active');

  const playerIndex = game.players.findIndex(p => p.userId === input.userId);
  if (playerIndex === -1) throw new Error('Player not in game');
  if (game.currentTurn % game.players.length !== playerIndex) {
    throw new Error('Not your turn');
  }

  const player = game.players[playerIndex];
  const board = game.board as BoardState;

  // Anti-cheat: verify rack indices
  for (const idx of input.rackIndices) {
    if (idx < 0 || idx >= player.rack.length) {
      throw new Error('Invalid rack index');
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
  const { totalScore, wordScores } = calculateMoveScore(board, input.placements);

  // Apply to board
  const newBoard = applyPlacements(board, input.placements, game.moves.length);

  // Remove used consonants from rack and refill
  const newRack = [...player.rack];
  // Sort indices descending to remove from end first
  const sortedIndices = [...input.rackIndices].sort((a, b) => b - a);
  for (const idx of sortedIndices) {
    newRack.splice(idx, 1);
  }

  const needed = RACK_SIZE - newRack.length;
  const { drawn, remaining } = drawFromBag(game.tileBag, needed);
  newRack.push(...drawn);

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
    wordsFormed: words.map(w => w.word),
    score: totalScore,
    timestamp: new Date(),
  };
  game.moves.push(move);

  // Check end conditions
  if (game.tileBag.length === 0 && newRack.length === 0) {
    game.status = 'finished';
    determineWinner(game);
  }

  await game.save();

  return { game, moveScore: totalScore, wordsFormed: wordScores };
}

export async function passTurn(gameId: string, userId: string): Promise<IGame> {
  const game = await GameModel.findById(gameId);
  if (!game) throw new Error('Game not found');
  if (game.status !== 'active') throw new Error('Game is not active');

  const playerIndex = game.players.findIndex(p => p.userId === userId);
  if (playerIndex === -1) throw new Error('Player not in game');
  if (game.currentTurn % game.players.length !== playerIndex) {
    throw new Error('Not your turn');
  }

  game.currentTurn += 1;
  game.turnStartedAt = new Date();

  // Check if both players passed consecutively (game ends)
  const lastTwoMoves = game.moves.slice(-2);
  if (lastTwoMoves.length === 2 && lastTwoMoves.every(m => m.placements.length === 0)) {
    game.status = 'finished';
    determineWinner(game);
  }

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

export async function exchangeTiles(
  gameId: string,
  userId: string,
  rackIndices: number[]
): Promise<IGame> {
  const game = await GameModel.findById(gameId);
  if (!game) throw new Error('Game not found');
  if (game.status !== 'active') throw new Error('Game is not active');

  const playerIndex = game.players.findIndex(p => p.userId === userId);
  if (playerIndex === -1) throw new Error('Player not in game');
  if (game.currentTurn % game.players.length !== playerIndex) {
    throw new Error('Not your turn');
  }

  if (game.tileBag.length < rackIndices.length) {
    throw new Error('Not enough tiles in bag to exchange');
  }

  const player = game.players[playerIndex];
  const returned: string[] = [];
  const newRack = [...player.rack];

  const sortedIndices = [...rackIndices].sort((a, b) => b - a);
  for (const idx of sortedIndices) {
    if (idx < 0 || idx >= newRack.length) throw new Error('Invalid rack index');
    returned.push(newRack[idx]);
    newRack.splice(idx, 1);
  }

  const { drawn, remaining } = drawFromBag(game.tileBag, returned.length);
  newRack.push(...drawn);

  // Put returned tiles back and shuffle
  const newBag = SanskritEngine.shuffleArray([...remaining, ...returned]);

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

function determineWinner(game: IGame): void {
  let maxScore = -1;
  let winnerId = '';
  for (const player of game.players) {
    if (player.score > maxScore) {
      maxScore = player.score;
      winnerId = player.userId;
    }
  }
  game.winner = winnerId;
}

export async function getGame(gameId: string): Promise<IGame | null> {
  return GameModel.findById(gameId);
}

export async function getGamesByUser(userId: string): Promise<IGame[]> {
  return GameModel.find({ 'players.userId': userId }).sort({ createdAt: -1 }).limit(20);
}

export async function abandonGame(gameId: string, userId: string): Promise<IGame> {
  const game = await GameModel.findById(gameId);
  if (!game) throw new Error('Game not found');

  game.status = 'abandoned';
  const otherPlayer = game.players.find(p => p.userId !== userId);
  if (otherPlayer) {
    game.winner = otherPlayer.userId;
  }
  await game.save();
  return game;
}

export const GameService = {
  createGame,
  joinGame,
  makeMove,
  passTurn,
  exchangeTiles,
  getGame,
  getGamesByUser,
  abandonGame,
};
