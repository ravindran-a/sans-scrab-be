import { DictionaryModel, IDictionaryEntry } from './dictionary.model';
import { normalizeText } from '../../engine/GraphemeSplitter';

/**
 * In-memory dictionary for fast lookups.
 * Loaded at server startup. Designed so DAWG can replace this later.
 */
let wordSet: Set<string> = new Set();
let wordList: string[] = [];
let wordMap: Map<string, IDictionaryEntry> = new Map();

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

  console.log(`[Dictionary] Loaded ${wordSet.size} words into memory`);
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

export function getAllEntries(): { word: string; root: string; meaning: { en: string; sa: string }; grammar: { type: string; derivation: string }; difficulty: number }[] {
  return Array.from(wordMap.values()).map(e => ({
    word: e.word,
    root: e.root,
    meaning: e.meaning,
    grammar: e.grammar,
    difficulty: e.difficulty,
  }));
}

export function getWordsByDifficulty(difficulty: number): string[] {
  return wordList.filter(w => {
    const entry = wordMap.get(w);
    return entry && entry.difficulty <= difficulty;
  });
}

export function getRandomWord(maxDifficulty: number = 5): string | null {
  const filtered = getWordsByDifficulty(maxDifficulty);
  if (filtered.length === 0) return null;
  return filtered[Math.floor(Math.random() * filtered.length)];
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
};
