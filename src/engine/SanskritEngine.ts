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

  // Constants
  CONSONANTS,
  VOWELS,
  VOWEL_SIGNS,
  VIRAMA,
  ANUSVARA,
  VISARGA,
  RACK_SIZE,
  BOARD_SIZE,
  CENTER,
};
