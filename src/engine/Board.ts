import { splitAksharas, isValidAkshara, normalizeText } from './GraphemeSplitter';

export const BOARD_SIZE = 11;
export const CENTER = Math.floor(BOARD_SIZE / 2); // 5

export type CellType = 'normal' | 'double_letter' | 'triple_letter' | 'double_word' | 'triple_word' | 'center';

export interface Cell {
  row: number;
  col: number;
  akshara: string | null;
  type: CellType;
  turnPlaced?: number;
}

export type BoardState = Cell[][];

/**
 * Premium square layout for 11x11 board.
 * Symmetric pattern inspired by classic Scrabble but adapted for smaller board.
 */
function getCellType(row: number, col: number): CellType {
  if (row === CENTER && col === CENTER) return 'center';

  // Triple word scores — corners and mid-edges
  const tripleWord: [number, number][] = [
    [0, 0], [0, 5], [0, 10],
    [5, 0], [5, 10],
    [10, 0], [10, 5], [10, 10],
  ];
  if (tripleWord.some(([r, c]) => r === row && c === col)) return 'triple_word';

  // Double word scores — diagonal pattern
  const doubleWord: [number, number][] = [
    [1, 1], [1, 9],
    [2, 2], [2, 8],
    [3, 3], [3, 7],
    [4, 4], [4, 6],
    [6, 4], [6, 6],
    [7, 3], [7, 7],
    [8, 2], [8, 8],
    [9, 1], [9, 9],
  ];
  if (doubleWord.some(([r, c]) => r === row && c === col)) return 'double_word';

  // Triple letter scores
  const tripleLetter: [number, number][] = [
    [0, 3], [0, 7],
    [3, 0], [3, 10],
    [7, 0], [7, 10],
    [10, 3], [10, 7],
  ];
  if (tripleLetter.some(([r, c]) => r === row && c === col)) return 'triple_letter';

  // Double letter scores
  const doubleLetter: [number, number][] = [
    [1, 5], [5, 1],
    [5, 9], [9, 5],
    [2, 4], [2, 6],
    [4, 2], [4, 8],
    [6, 2], [6, 8],
    [8, 4], [8, 6],
  ];
  if (doubleLetter.some(([r, c]) => r === row && c === col)) return 'double_letter';

  return 'normal';
}

/**
 * Create a fresh 11x11 board.
 */
export function createBoard(): BoardState {
  const board: BoardState = [];
  for (let row = 0; row < BOARD_SIZE; row++) {
    board[row] = [];
    for (let col = 0; col < BOARD_SIZE; col++) {
      board[row][col] = {
        row,
        col,
        akshara: null,
        type: getCellType(row, col),
      };
    }
  }
  return board;
}

/**
 * Check if the board is empty (first move).
 */
export function isBoardEmpty(board: BoardState): boolean {
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if (board[row][col].akshara !== null) return false;
    }
  }
  return true;
}

export interface TilePlacement {
  row: number;
  col: number;
  akshara: string;
}

/**
 * Validate that placements are in a valid line (same row or same column),
 * contiguous (possibly with existing tiles filling gaps), and connected.
 */
export function validatePlacement(
  board: BoardState,
  placements: TilePlacement[]
): { valid: boolean; error?: string } {
  if (placements.length === 0) {
    return { valid: false, error: 'No tiles placed' };
  }

  // Validate each akṣara
  for (const p of placements) {
    const normalized = normalizeText(p.akshara);
    if (!isValidAkshara(normalized)) {
      return { valid: false, error: `Invalid akṣara: ${p.akshara}` };
    }
  }

  // Check bounds
  for (const p of placements) {
    if (p.row < 0 || p.row >= BOARD_SIZE || p.col < 0 || p.col >= BOARD_SIZE) {
      return { valid: false, error: `Out of bounds: (${p.row}, ${p.col})` };
    }
  }

  // Check cells are empty
  for (const p of placements) {
    if (board[p.row][p.col].akshara !== null) {
      return { valid: false, error: `Cell (${p.row}, ${p.col}) is already occupied` };
    }
  }

  // Check no duplicate positions
  const posSet = new Set(placements.map(p => `${p.row},${p.col}`));
  if (posSet.size !== placements.length) {
    return { valid: false, error: 'Duplicate positions' };
  }

  // Check all in same row or same column
  const allSameRow = placements.every(p => p.row === placements[0].row);
  const allSameCol = placements.every(p => p.col === placements[0].col);

  if (!allSameRow && !allSameCol) {
    return { valid: false, error: 'Tiles must be in a single row or column' };
  }

  // Check contiguity (including existing tiles)
  if (allSameRow) {
    const row = placements[0].row;
    const cols = placements.map(p => p.col).sort((a, b) => a - b);
    for (let c = cols[0]; c <= cols[cols.length - 1]; c++) {
      const isPlaced = placements.some(p => p.col === c);
      const isExisting = board[row][c].akshara !== null;
      if (!isPlaced && !isExisting) {
        return { valid: false, error: 'Tiles must be contiguous (gap detected)' };
      }
    }
  } else {
    const col = placements[0].col;
    const rows = placements.map(p => p.row).sort((a, b) => a - b);
    for (let r = rows[0]; r <= rows[rows.length - 1]; r++) {
      const isPlaced = placements.some(p => p.row === r);
      const isExisting = board[r] !== undefined && board[r][col].akshara !== null;
      if (!isPlaced && !isExisting) {
        return { valid: false, error: 'Tiles must be contiguous (gap detected)' };
      }
    }
  }

  // First move must cover center
  if (isBoardEmpty(board)) {
    const coversCenter = placements.some(p => p.row === CENTER && p.col === CENTER);
    if (!coversCenter) {
      return { valid: false, error: 'First word must cover the center square' };
    }
  } else {
    // Subsequent moves must connect to existing tiles
    const connectsToExisting = placements.some(p => {
      const neighbors = [
        [p.row - 1, p.col], [p.row + 1, p.col],
        [p.row, p.col - 1], [p.row, p.col + 1],
      ];
      return neighbors.some(([r, c]) =>
        r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE &&
        board[r][c].akshara !== null
      );
    });
    if (!connectsToExisting) {
      return { valid: false, error: 'Word must connect to existing tiles' };
    }
  }

  return { valid: true };
}

/**
 * Apply placements to board (mutates a copy).
 */
export function applyPlacements(board: BoardState, placements: TilePlacement[], turn: number): BoardState {
  const newBoard = board.map(row => row.map(cell => ({ ...cell })));
  for (const p of placements) {
    newBoard[p.row][p.col].akshara = normalizeText(p.akshara);
    newBoard[p.row][p.col].turnPlaced = turn;
  }
  return newBoard;
}

/**
 * Extract all words formed by the given placements.
 * Returns array of { word, cells } for each word formed.
 */
export function extractWords(
  board: BoardState,
  placements: TilePlacement[]
): { word: string; cells: Cell[] }[] {
  // Create a temporary board with placements applied
  const tempBoard = applyPlacements(board, placements, -1);
  const words: { word: string; cells: Cell[] }[] = [];
  const placementSet = new Set(placements.map(p => `${p.row},${p.col}`));

  // Determine direction
  const allSameRow = placements.every(p => p.row === placements[0].row);

  // Extract main word
  const mainWord = extractWordAt(tempBoard, placements[0].row, placements[0].col, allSameRow ? 'horizontal' : 'vertical');
  if (mainWord.cells.length > 1) {
    words.push(mainWord);
  }

  // Extract cross words for each placed tile
  const crossDir = allSameRow ? 'vertical' : 'horizontal';
  for (const p of placements) {
    const crossWord = extractWordAt(tempBoard, p.row, p.col, crossDir);
    if (crossWord.cells.length > 1) {
      words.push(crossWord);
    }
  }

  // Single tile on first move: treat the akshara itself as the word
  if (words.length === 0 && placements.length === 1) {
    const cell = tempBoard[placements[0].row][placements[0].col];
    words.push({ word: cell.akshara!, cells: [cell] });
  }

  return words;
}

function extractWordAt(
  board: BoardState,
  row: number,
  col: number,
  direction: 'horizontal' | 'vertical'
): { word: string; cells: Cell[] } {
  const cells: Cell[] = [];

  if (direction === 'horizontal') {
    // Find start
    let c = col;
    while (c > 0 && board[row][c - 1].akshara !== null) c--;
    // Collect
    while (c < BOARD_SIZE && board[row][c].akshara !== null) {
      cells.push(board[row][c]);
      c++;
    }
  } else {
    let r = row;
    while (r > 0 && board[r - 1][col].akshara !== null) r--;
    while (r < BOARD_SIZE && board[r][col].akshara !== null) {
      cells.push(board[r][col]);
      r++;
    }
  }

  const word = cells.map(c => c.akshara!).join('');
  return { word, cells };
}

export const Board = {
  BOARD_SIZE,
  CENTER,
  createBoard,
  isBoardEmpty,
  validatePlacement,
  applyPlacements,
  extractWords,
};
