/**
 * Sanskrit Grapheme Splitter
 *
 * Splits Devanagari text into Akṣaras (syllabic units).
 * Respects virama (halant) conjuncts: consecutive consonants joined by virama
 * form a single akṣara with the following vowel.
 *
 * Unicode ranges used:
 * - Consonants: \u0915-\u0939 (क-ह)
 * - Independent vowels: \u0904-\u0914 (अ-औ) + \u0960-\u0961 (ॠ-ॡ)
 * - Dependent vowel signs (matras): \u093E-\u094C, \u0962-\u0963
 * - Virama (halant): \u094D
 * - Anusvara: \u0902 (ं)
 * - Visarga: \u0903 (ः)
 * - Chandrabindu: \u0901 (ँ)
 * - Nukta: \u093C (़)
 */

const VIRAMA = '\u094D';
const NUKTA = '\u093C';

function isConsonant(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return code >= 0x0915 && code <= 0x0939;
}

function isIndependentVowel(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (code >= 0x0904 && code <= 0x0914) || (code >= 0x0960 && code <= 0x0961);
}

function isDependentVowelSign(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (code >= 0x093E && code <= 0x094C) || (code >= 0x0962 && code <= 0x0963);
}

function isModifier(ch: string): boolean {
  const code = ch.charCodeAt(0);
  // Chandrabindu, Anusvara, Visarga
  return code === 0x0901 || code === 0x0902 || code === 0x0903;
}

function isDevanagari(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return code >= 0x0900 && code <= 0x097F;
}

/**
 * Split NFC-normalized Devanagari text into Akṣaras.
 * Each akṣara is a string representing one syllabic unit.
 */
export function splitAksharas(text: string): string[] {
  const normalized = text.normalize('NFC');
  const aksharas: string[] = [];
  let current = '';
  const chars = Array.from(normalized);

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];

    if (!isDevanagari(ch) && ch !== VIRAMA) {
      // Non-Devanagari character: flush current and push as separate token
      if (current) {
        aksharas.push(current);
        current = '';
      }
      aksharas.push(ch);
      continue;
    }

    if (isIndependentVowel(ch)) {
      // Independent vowel starts a new akṣara
      if (current) {
        aksharas.push(current);
      }
      current = ch;
      continue;
    }

    if (isConsonant(ch)) {
      // Check if previous char is virama — if so, this consonant is part of a conjunct
      if (current && current.endsWith(VIRAMA)) {
        current += ch;
      } else {
        // Start new akṣara
        if (current) {
          aksharas.push(current);
        }
        current = ch;
      }
      continue;
    }

    if (ch === VIRAMA) {
      current += ch;
      continue;
    }

    if (ch === NUKTA) {
      current += ch;
      continue;
    }

    if (isDependentVowelSign(ch)) {
      current += ch;
      continue;
    }

    if (isModifier(ch)) {
      current += ch;
      continue;
    }

    // Any other Devanagari character
    current += ch;
  }

  if (current) {
    aksharas.push(current);
  }

  return aksharas;
}

/**
 * Count akṣaras in a word (for scoring, validation).
 */
export function countAksharas(text: string): number {
  return splitAksharas(text).filter(a => isDevanagari(a.charAt(0))).length;
}

/**
 * Check if a string is a single valid akṣara.
 */
export function isValidAkshara(text: string): boolean {
  const normalized = text.normalize('NFC');
  const aksharas = splitAksharas(normalized);
  return aksharas.length === 1 && isDevanagari(aksharas[0].charAt(0));
}

/**
 * Normalize text for dictionary lookups and comparisons.
 */
export function normalizeText(text: string): string {
  return text.normalize('NFC');
}

export const GraphemeSplitter = {
  splitAksharas,
  countAksharas,
  isValidAkshara,
  normalizeText,
  isConsonant,
  isIndependentVowel,
  isDependentVowelSign,
  isModifier,
};
