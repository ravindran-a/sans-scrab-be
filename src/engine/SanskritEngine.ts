import {
  applyPlacements,
  BOARD_SIZE,
  CENTER,
  createBoard,
  extractWords,
  validatePlacement,
} from "./Board";
import {
  countAksharas,
  isValidAkshara,
  normalizeText,
  splitAksharas,
} from "./GraphemeSplitter";
import { calculateMoveScore, getAksharaScore } from "./Scoring";

/**
 * All Sanskrit consonants (vyañjana) used in the game.
 */
export const CONSONANTS = [
  "क",
  "ख",
  "ग",
  "घ",
  "ङ",
  "च",
  "छ",
  "ज",
  "झ",
  "ञ",
  "ट",
  "ठ",
  "ड",
  "ढ",
  "ण",
  "त",
  "थ",
  "द",
  "ध",
  "न",
  "प",
  "फ",
  "ब",
  "भ",
  "म",
  "य",
  "र",
  "ल",
  "व",
  "श",
  "ष",
  "स",
  "ह",
];

/**
 * All Sanskrit vowels (svara) — these are infinite in the game.
 */
export const VOWELS = [
  "अ",
  "आ",
  "इ",
  "ई",
  "उ",
  "ऊ",
  "ऋ",
  "ॠ",
  "ए",
  "ऐ",
  "ओ",
  "औ",
];

/**
 * Dependent vowel signs (mātrā) for constructing akṣaras.
 */
export const VOWEL_SIGNS: Record<string, string> = {
  अ: "", // Inherent, no sign
  आ: "\u093E", // ा
  इ: "\u093F", // ि
  ई: "\u0940", // ी
  उ: "\u0941", // ु
  ऊ: "\u0942", // ू
  ऋ: "\u0943", // ृ
  ॠ: "\u0944", // ॄ
  ए: "\u0947", // े
  ऐ: "\u0948", // ै
  ओ: "\u094B", // ो
  औ: "\u094C", // ौ
};

export const VIRAMA = "\u094D";
export const ANUSVARA = "\u0902";
export const VISARGA = "\u0903";

export const RACK_SIZE = 15;
export const AKSHARA_RACK_SIZE = 8;

/**
 * Consonant distribution in tile bag — weighted by Sanskrit frequency.
 */
const CONSONANT_DISTRIBUTION: Record<string, number> = {
  क: 6,
  ख: 3,
  ग: 4,
  घ: 2,
  ङ: 1,
  च: 4,
  छ: 2,
  ज: 3,
  झ: 1,
  ञ: 1,
  ट: 3,
  ठ: 2,
  ड: 3,
  ढ: 1,
  ण: 2,
  त: 6,
  थ: 3,
  द: 4,
  ध: 3,
  न: 5,
  प: 5,
  फ: 2,
  ब: 3,
  भ: 3,
  म: 5,
  य: 4,
  र: 5,
  ल: 3,
  व: 4,
  श: 3,
  ष: 2,
  स: 5,
  ह: 3,
};

/**
 * Create the tile bag — array of consonants.
 */
export function createTileBag(): string[] {
  const bag: string[] = [];
  for (const [consonant, count] of Object.entries(CONSONANT_DISTRIBUTION)) {
    for (let i = 0; i < count; i++) {
      bag.push(consonant);
    }
  }
  return shuffleArray(bag);
}

/**
 * Fisher-Yates shuffle.
 */
export function shuffleArray<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Draw consonants from tile bag.
 */
export function drawFromBag(
  bag: string[],
  count: number,
): { drawn: string[]; remaining: string[] } {
  const drawn = bag.slice(0, Math.min(count, bag.length));
  const remaining = bag.slice(drawn.length);
  return { drawn, remaining };
}

/**
 * Construct an akṣara from consonants and a vowel.
 * E.g., ['क', 'र'] + 'ई' => 'क्री'
 * Pass vowel = '्' (VIRAMA) to build a halant-ending consonant (e.g., त्, द्)
 */
export function constructAkshara(
  consonants: string[],
  vowel: string = "अ",
): string {
  if (consonants.length === 0) {
    // Independent vowel (virama alone is not valid)
    if (vowel === VIRAMA) return "";
    return vowel;
  }

  let result = "";
  for (let i = 0; i < consonants.length; i++) {
    result += consonants[i];
    if (i < consonants.length - 1) {
      result += VIRAMA;
    }
  }

  // Halant-ending: consonant(s) + virama, no vowel applied
  if (vowel === VIRAMA) {
    result += VIRAMA;
    return result.normalize("NFC");
  }

  // Apply vowel sign
  const sign = VOWEL_SIGNS[vowel];
  if (sign !== undefined && sign !== "") {
    result += sign;
  }
  // If vowel is 'अ', inherent vowel — no sign needed

  return result.normalize("NFC");
}

// ─── Akshara Mode Tile Bag ──────────────────────────────────────────

/**
 * Akshara distribution built from dictionary at startup.
 * Maps each akshara string to its frequency count across all dictionary words.
 */
let aksharaDistribution: Map<string, number> = new Map();
let aksharaTileCounts: Map<string, number> = new Map();

/**
 * Build akshara frequency distribution from a list of dictionary words.
 * Call once at server startup after dictionary is loaded.
 */
export function buildAksharaDistribution(words: string[]): void {
  const freq = new Map<string, number>();
  for (const word of words) {
    const aksharas = splitAksharas(normalizeText(word));
    for (const a of aksharas) {
      freq.set(a, (freq.get(a) || 0) + 1);
    }
  }
  aksharaDistribution = freq;

  // Build tile counts: scale frequencies to a bag of ~200 tiles
  // Only include aksharas appearing in 3+ words (filter ultra-rare)
  const TARGET_BAG_SIZE = 200;
  const filtered = new Map<string, number>();
  let totalFreq = 0;
  for (const [a, count] of freq) {
    if (count >= 3) {
      filtered.set(a, count);
      totalFreq += count;
    }
  }

  const tileCounts = new Map<string, number>();
  for (const [a, count] of filtered) {
    // Scale: at least 1 tile, proportional to frequency
    const tiles = Math.max(1, Math.round((count / totalFreq) * TARGET_BAG_SIZE));
    tileCounts.set(a, tiles);
  }
  aksharaTileCounts = tileCounts;
}

/**
 * Get the akshara distribution (for testing/inspection).
 */
export function getAksharaDistribution(): Map<string, number> {
  return aksharaDistribution;
}

/**
 * Get akshara tile counts (for testing/inspection).
 */
export function getAksharaTileCounts(): Map<string, number> {
  return aksharaTileCounts;
}

/**
 * Create tile bag for akshara mode — pre-formed akshara tiles.
 * Must call buildAksharaDistribution() first.
 */
export function createAksharaTileBag(): string[] {
  const bag: string[] = [];
  for (const [akshara, count] of aksharaTileCounts) {
    for (let i = 0; i < count; i++) {
      bag.push(akshara);
    }
  }
  return shuffleArray(bag);
}

/**
 * Pre-sorted word-akshara list for fast formability checks.
 * Sorted by akshara count ascending (short words first).
 */
let sortedWordAksharas: string[][] = [];

/**
 * Build the sorted word-akshara list. Called after dictionary loads.
 */
export function buildSortedWordAksharas(
  wordAksharaIndex: Map<string, string[][]>,
): void {
  sortedWordAksharas = [];
  for (const [, aksharasList] of wordAksharaIndex) {
    for (const aksharas of aksharasList) {
      sortedWordAksharas.push(aksharas);
    }
  }
  sortedWordAksharas.sort((a, b) => a.length - b.length);
}

/**
 * Check if a rack of aksharas can form at least one valid word.
 * Uses pre-sorted list so short words (2-akshara) are checked first for early exit.
 */
export function canFormAnyWord(
  rack: string[],
  wordAksharaIndex: Map<string, string[][]>,
): boolean {
  // Use sorted list for performance (short words first)
  const list =
    sortedWordAksharas.length > 0 ? sortedWordAksharas : getFallbackList(wordAksharaIndex);
  for (const wordAksharas of list) {
    if (wordAksharas.length > rack.length) break; // sorted, so all remaining are longer
    if (canFormFromRack(wordAksharas, rack)) return true;
  }
  return false;
}

function getFallbackList(
  wordAksharaIndex: Map<string, string[][]>,
): string[][] {
  const result: string[][] = [];
  for (const [, aksharasList] of wordAksharaIndex) {
    for (const aksharas of aksharasList) {
      result.push(aksharas);
    }
  }
  return result.sort((a, b) => a.length - b.length);
}

/**
 * Check if specific aksharas can be formed from a rack.
 */
function canFormFromRack(needed: string[], rack: string[]): boolean {
  const available = [...rack];
  for (const a of needed) {
    const idx = available.indexOf(a);
    if (idx === -1) return false;
    available[idx] = "";
  }
  return true;
}

/**
 * Validate that a rack contains the consonants needed for the placements.
 * Returns which rack indices were used.
 */
export function validateRackUsage(
  rack: string[],
  usedConsonants: string[],
): { valid: boolean; usedIndices: number[]; error?: string } {
  const available = [...rack];
  const usedIndices: number[] = [];

  for (const consonant of usedConsonants) {
    const idx = available.indexOf(consonant);
    if (idx === -1) {
      return {
        valid: false,
        usedIndices: [],
        error: `Consonant ${consonant} not in rack`,
      };
    }
    usedIndices.push(idx); // Use same index from available (mirrors rack positions)
    available[idx] = ""; // Mark as used so duplicates resolve to next occurrence
  }

  return { valid: true, usedIndices };
}

/**
 * The main SanskritEngine — stateless, deterministic, fully testable.
 */
export const SanskritEngine = {
  // Grapheme operations
  splitAksharas,
  countAksharas,
  isValidAkshara,
  normalizeText,

  // Board operations
  createBoard,
  validatePlacement,
  applyPlacements,
  extractWords,

  // Scoring
  calculateMoveScore,
  getAksharaScore,

  // Tile management
  createTileBag,
  drawFromBag,
  shuffleArray,

  // Akṣara construction
  constructAkshara,
  validateRackUsage,

  // Akshara mode
  buildAksharaDistribution,
  buildSortedWordAksharas,
  getAksharaDistribution,
  getAksharaTileCounts,
  createAksharaTileBag,
  canFormAnyWord,

  // Constants
  CONSONANTS,
  VOWELS,
  VOWEL_SIGNS,
  VIRAMA,
  ANUSVARA,
  VISARGA,
  RACK_SIZE,
  AKSHARA_RACK_SIZE,
  BOARD_SIZE,
  CENTER,
};
