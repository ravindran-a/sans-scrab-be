import {
  BOARD_SIZE,
  BoardState,
  extractWords,
  TilePlacement,
  validatePlacement,
} from "../../engine/Board";
import { normalizeText, splitAksharas } from "../../engine/GraphemeSplitter";
import { calculateMoveScore } from "../../engine/Scoring";
import { AKSHARA_RACK_SIZE, RACK_SIZE } from "../../engine/SanskritEngine";
import { DictionaryService } from "../dictionary/dictionary.service";

export interface AiMove {
  placements: TilePlacement[];
  rackIndices: number[];
  score: number;
  words: string[];
}

/**
 * AI Player — uses the same SanskritEngine as human players.
 * Three difficulty levels:
 * - Level 1: Random valid word
 * - Level 2: Score-maximizing heuristic
 * - Level 3: Minimax-lite (evaluates top moves by look-ahead)
 */
export class AiPlayer {
  private difficulty: number;
  private aksharaMode: boolean;

  constructor(difficulty: number = 1, aksharaMode: boolean = false) {
    this.difficulty = Math.min(Math.max(difficulty, 1), 3);
    this.aksharaMode = aksharaMode;
  }

  async findMove(board: BoardState, rack: string[]): Promise<AiMove | null> {
    // Add timeout protection for expensive AI calculations
    const timeoutMs = this.difficulty >= 3 ? 10000 : 5000;
    let allMoves: AiMove[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      allMoves = await Promise.race([
        Promise.resolve(this.generateAllMoves(board, rack)),
        new Promise<AiMove[]>((_, reject) => {
          timer = setTimeout(() => reject(new Error("AI timeout")), timeoutMs);
        }),
      ]);
    } catch {
      // AI timed out — return null (will auto-pass)
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }

    if (allMoves.length === 0) return null;

    switch (this.difficulty) {
      case 1:
        return this.level1(allMoves);
      case 2:
        return this.level2(allMoves);
      case 3:
        return this.level3(allMoves, board);
      default:
        return this.level1(allMoves);
    }
  }

  /**
   * Level 1: Pick a random valid move.
   */
  private level1(moves: AiMove[]): AiMove {
    return moves[Math.floor(Math.random() * moves.length)];
  }

  /**
   * Level 2: Pick the highest-scoring move.
   */
  private level2(moves: AiMove[]): AiMove {
    return moves.reduce(
      (best, move) => (move.score > best.score ? move : best),
      moves[0],
    );
  }

  /**
   * Level 3: Minimax-lite — pick from top 5 moves with position evaluation.
   */
  private level3(moves: AiMove[], board: BoardState): AiMove {
    // Sort by score descending
    const sorted = [...moves].sort((a, b) => b.score - a.score);
    const topN = sorted.slice(0, Math.min(5, sorted.length));

    // Evaluate each move by score + positional advantage
    let bestMove = topN[0];
    let bestEval = -Infinity;

    for (const move of topN) {
      const eval_ = this.evaluatePosition(move, board);
      if (eval_ > bestEval) {
        bestEval = eval_;
        bestMove = move;
      }
    }

    return bestMove;
  }

  /**
   * Position evaluation heuristic.
   * Considers: score, center proximity, premium square control, board openness.
   */
  private evaluatePosition(move: AiMove, _board: BoardState): number {
    let eval_ = move.score;

    const center = Math.floor(BOARD_SIZE / 2);
    for (const p of move.placements) {
      // Bonus for central positions
      const dist = Math.abs(p.row - center) + Math.abs(p.col - center);
      eval_ += Math.max(0, 5 - dist);

      // Penalty for opening triple word lines to opponent
      if (
        p.row === 0 ||
        p.row === BOARD_SIZE - 1 ||
        p.col === 0 ||
        p.col === BOARD_SIZE - 1
      ) {
        eval_ -= 3;
      }
    }

    return eval_;
  }

  /**
   * Generate all valid moves the AI can make with its current rack.
   * Tries to place dictionary words on the board.
   */
  private generateAllMoves(board: BoardState, rack: string[]): AiMove[] {
    const moves: AiMove[] = [];
    const allWords = DictionaryService.getWordsByDifficulty(
      this.difficulty <= 1 ? 2 : 5,
    );
    const isEmpty = this.isBoardEmpty(board);

    for (const word of allWords) {
      const aksharas = splitAksharas(normalizeText(word));
      if (aksharas.length === 0 || aksharas.length > BOARD_SIZE) continue;

      // Check if we can form these akṣaras with our rack + free vowels
      const rackUsage = this.canFormWord(aksharas, rack);
      if (!rackUsage) continue;

      // Try placing at every valid position
      const positions = this.getPlacementPositions(board, aksharas, isEmpty);
      for (const placements of positions) {
        const validation = validatePlacement(board, placements);
        if (!validation.valid) continue;

        // Verify all formed words are valid
        const formedWords = extractWords(board, placements);
        const allValid = formedWords.every((fw) =>
          DictionaryService.isValidWord(normalizeText(fw.word)),
        );
        if (!allValid) continue;

        const { totalScore, wordScores } = calculateMoveScore(
          board,
          placements,
          this.aksharaMode ? AKSHARA_RACK_SIZE : RACK_SIZE,
        );

        moves.push({
          placements,
          rackIndices: rackUsage.indices,
          score: totalScore,
          words: wordScores.map((ws) => ws.word),
        });
      }
    }

    return moves;
  }

  /**
   * Check if the given aksharas can be formed from the rack.
   * Classic mode: matches consonants (vowels are free).
   * Akshara mode: matches whole aksharas directly.
   * Returns rack indices used, or null if not possible.
   */
  private canFormWord(
    aksharas: string[],
    rack: string[],
  ): { indices: number[] } | null {
    const availableRack = rack.map((c, i) => ({
      char: c,
      index: i,
      used: false,
    }));
    const usedIndices: number[] = [];

    if (this.aksharaMode) {
      // Akshara mode: each word akshara must match a rack tile exactly
      for (const akshara of aksharas) {
        const found = availableRack.find(
          (r) => r.char === akshara && !r.used,
        );
        if (!found) return null;
        found.used = true;
        usedIndices.push(found.index);
      }
    } else {
      // Classic mode: extract consonants from aksharas and match against rack
      for (const akshara of aksharas) {
        const consonantsNeeded: string[] = [];
        for (const ch of Array.from(akshara.normalize("NFC"))) {
          const code = ch.charCodeAt(0);
          if (code >= 0x0915 && code <= 0x0939) {
            consonantsNeeded.push(ch);
          }
        }

        for (const consonant of consonantsNeeded) {
          const found = availableRack.find(
            (r) => r.char === consonant && !r.used,
          );
          if (!found) return null;
          found.used = true;
          usedIndices.push(found.index);
        }
      }
    }

    return { indices: usedIndices };
  }

  /**
   * Generate possible placement positions for a word on the board.
   */
  private getPlacementPositions(
    board: BoardState,
    aksharas: string[],
    isEmpty: boolean,
  ): TilePlacement[][] {
    const results: TilePlacement[][] = [];
    const center = Math.floor(BOARD_SIZE / 2);

    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        // Try horizontal
        if (col + aksharas.length <= BOARD_SIZE) {
          const placements: TilePlacement[] = [];
          let valid = true;

          for (let i = 0; i < aksharas.length; i++) {
            if (board[row][col + i].akshara !== null) {
              // Cell occupied — check if it matches
              if (board[row][col + i].akshara !== aksharas[i]) {
                valid = false;
                break;
              }
              // Don't include pre-existing tiles in placements
            } else {
              placements.push({ row, col: col + i, akshara: aksharas[i] });
            }
          }

          if (valid && placements.length > 0) {
            if (isEmpty) {
              // Must cover center
              const coversCenter =
                placements.some((p) => p.row === center && p.col === center) ||
                (row === center &&
                  col <= center &&
                  col + aksharas.length > center);
              if (coversCenter) results.push(placements);
            } else {
              results.push(placements);
            }
          }
        }

        // Try vertical
        if (row + aksharas.length <= BOARD_SIZE) {
          const placements: TilePlacement[] = [];
          let valid = true;

          for (let i = 0; i < aksharas.length; i++) {
            if (board[row + i][col].akshara !== null) {
              if (board[row + i][col].akshara !== aksharas[i]) {
                valid = false;
                break;
              }
            } else {
              placements.push({ row: row + i, col, akshara: aksharas[i] });
            }
          }

          if (valid && placements.length > 0) {
            if (isEmpty) {
              const coversCenter =
                placements.some((p) => p.row === center && p.col === center) ||
                (col === center &&
                  row <= center &&
                  row + aksharas.length > center);
              if (coversCenter) results.push(placements);
            } else {
              results.push(placements);
            }
          }
        }
      }
    }

    return results;
  }

  private isBoardEmpty(board: BoardState): boolean {
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (board[r][c].akshara !== null) return false;
      }
    }
    return true;
  }
}
