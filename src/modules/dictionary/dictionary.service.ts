import { normalizeText, splitAksharas } from "../../engine/GraphemeSplitter";
import {
  buildAksharaDistribution,
  buildSortedWordAksharas,
} from "../../engine/SanskritEngine";
import { DictionaryModel, IDictionaryEntry } from "./dictionary.model";

/**
 * In-memory dictionary for fast lookups.
 * Loaded at server startup. Designed so DAWG can replace this later.
 */
let wordSet: Set<string> = new Set();
let wordList: string[] = [];
let wordMap: Map<string, IDictionaryEntry> = new Map();
const difficultyCache: Map<number, string[]> = new Map();

/**
 * Word → akshara[] index for akshara mode AI and formability checks.
 * Maps normalized word to its akshara breakdown.
 */
let wordAksharaIndex: Map<string, string[][]> = new Map();

export async function loadDictionary(): Promise<void> {
  const entries = await DictionaryModel.find({}).lean<IDictionaryEntry[]>();
  wordSet = new Set();
  wordList = [];
  wordMap = new Map();

  for (const entry of entries) {
    const normalized = normalizeText(entry.word);
    wordSet.add(normalized);
    wordList.push(normalized);
    wordMap.set(normalized, entry as IDictionaryEntry);
  }

  // Pre-cache word lists by difficulty (1-5)
  difficultyCache.clear();
  for (let d = 1; d <= 5; d++) {
    difficultyCache.set(
      d,
      wordList.filter((w) => {
        const entry = wordMap.get(w);
        return entry && entry.difficulty <= d;
      }),
    );
  }

  // Build word → aksharas index for akshara mode
  wordAksharaIndex = new Map();
  for (const word of wordList) {
    const aksharas = splitAksharas(word);
    if (aksharas.length >= 2) {
      if (!wordAksharaIndex.has(word)) {
        wordAksharaIndex.set(word, []);
      }
      wordAksharaIndex.get(word)!.push(aksharas);
    }
  }

  // Build akshara frequency distribution for tile bag generation
  buildAksharaDistribution(wordList);
  buildSortedWordAksharas(wordAksharaIndex);

  console.log(`[Dictionary] Loaded ${wordSet.size} words into memory`);
  console.log(
    `[Dictionary] Akshara index: ${wordAksharaIndex.size} words with 2+ aksharas`,
  );
}

export function isValidWord(word: string): boolean {
  return wordSet.has(normalizeText(word));
}

export function lookupWord(word: string): IDictionaryEntry | undefined {
  return wordMap.get(normalizeText(word));
}

export function getWordCount(): number {
  return wordSet.size;
}

export function getAllWords(): string[] {
  return wordList;
}

export function getAllEntries(): {
  word: string;
  root: string;
  meaning: { en: string; sa: string };
  grammar: { type: string; derivation: string };
  difficulty: number;
}[] {
  return Array.from(wordMap.values()).map((e) => ({
    word: e.word,
    root: e.root,
    meaning: e.meaning,
    grammar: e.grammar,
    difficulty: e.difficulty,
  }));
}

export function getWordsByDifficulty(difficulty: number): string[] {
  const cached = difficultyCache.get(difficulty);
  if (cached) return cached;
  return wordList.filter((w) => {
    const entry = wordMap.get(w);
    return entry && entry.difficulty <= difficulty;
  });
}

export function getRandomWord(maxDifficulty: number = 5): string | null {
  const filtered = getWordsByDifficulty(maxDifficulty);
  if (filtered.length === 0) return null;
  return filtered[Math.floor(Math.random() * filtered.length)];
}

export function getWordAksharaIndex(): Map<string, string[][]> {
  return wordAksharaIndex;
}

export const DictionaryService = {
  loadDictionary,
  isValidWord,
  lookupWord,
  getWordCount,
  getAllWords,
  getAllEntries,
  getWordsByDifficulty,
  getRandomWord,
  getWordAksharaIndex,
};
