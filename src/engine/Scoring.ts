import { BoardState, Cell, TilePlacement, extractWords, applyPlacements } from './Board';
import { normalizeText } from './GraphemeSplitter';

/**
 * Consonant scores based on frequency in Sanskrit.
 * Rarer consonants score higher.
 */
const CONSONANT_SCORES: Record<string, number> = {
  // Velars
  'क': 1, 'ख': 3, 'ग': 2, 'घ': 4, 'ङ': 8,
  // Palatals
  'च': 2, 'छ': 4, 'ज': 2, 'झ': 5, 'ञ': 8,
  // Retroflex
  'ट': 3, 'ठ': 5, 'ड': 3, 'ढ': 5, 'ण': 4,
  // Dental
  'त': 1, 'थ': 3, 'द': 2, 'ध': 3, 'न': 1,
  // Labial
  'प': 1, 'फ': 4, 'ब': 2, 'भ': 3, 'म': 1,
  // Semi-vowels
  'य': 1, 'र': 1, 'ल': 2, 'व': 1,
  // Sibilants & aspirate
  'श': 2, 'ष': 3, 'स': 1, 'ह': 2,
};

/**
 * Get the base score for a single akṣara.
 * Score = sum of consonant values in the akṣara.
 * Vowels are free (score 0).
 */
export function getAksharaScore(akshara: string): number {
  const normalized = normalizeText(akshara);
  let score = 0;
  for (const ch of Array.from(normalized)) {
    if (CONSONANT_SCORES[ch]) {
      score += CONSONANT_SCORES[ch];
    }
  }
  return score;
}

/**
 * Calculate the score for a single word on the board,
 * considering premium squares for newly placed tiles.
 */
export function scoreWord(
  cells: Cell[],
  newPlacements: Set<string>
): number {
  let wordScore = 0;
  let wordMultiplier = 1;

  for (const cell of cells) {
    const aksharaScore = getAksharaScore(cell.akshara!);
    const key = `${cell.row},${cell.col}`;
    const isNew = newPlacements.has(key);

    if (isNew) {
      switch (cell.type) {
        case 'double_letter':
          wordScore += aksharaScore * 2;
          break;
        case 'triple_letter':
          wordScore += aksharaScore * 3;
          break;
        case 'double_word':
        case 'center':
          wordScore += aksharaScore;
          wordMultiplier *= 2;
          break;
        case 'triple_word':
          wordScore += aksharaScore;
          wordMultiplier *= 3;
          break;
        default:
          wordScore += aksharaScore;
      }
    } else {
      wordScore += aksharaScore;
    }
  }

  return wordScore * wordMultiplier;
}

/**
 * Calculate the total score for a move (all words formed).
 * Bonus of 15 points if all 15 consonants are used in one turn.
 */
export function calculateMoveScore(
  board: BoardState,
  placements: TilePlacement[]
): { totalScore: number; wordScores: { word: string; score: number }[] } {
  const words = extractWords(board, placements);
  const newPlacements = new Set(placements.map(p => `${p.row},${p.col}`));

  // Use the board with placements applied for scoring
  const tempBoard = applyPlacements(board, placements, -1);
  const wordScores: { word: string; score: number }[] = [];

  for (const { word, cells } of words) {
    // Re-extract cells from tempBoard to get correct cell types
    const scoreCells = cells.map(c => tempBoard[c.row][c.col]);
    const score = scoreWord(scoreCells, newPlacements);
    wordScores.push({ word, score });
  }

  let totalScore = wordScores.reduce((sum, ws) => sum + ws.score, 0);

  // Bonus for using all 15 consonants
  if (placements.length >= 15) {
    totalScore += 15;
  }

  return { totalScore, wordScores };
}

export const Scoring = {
  getAksharaScore,
  scoreWord,
  calculateMoveScore,
  CONSONANT_SCORES,
};
