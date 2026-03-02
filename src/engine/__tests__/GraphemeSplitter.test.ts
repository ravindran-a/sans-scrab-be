import { splitAksharas, countAksharas, isValidAkshara, normalizeText } from '../GraphemeSplitter';

describe('GraphemeSplitter', () => {
  describe('splitAksharas', () => {
    it('should split simple consonant-vowel syllables', () => {
      const result = splitAksharas('कम');
      expect(result).toEqual(['क', 'म']);
    });

    it('should keep consonant + matra as one akṣara', () => {
      const result = splitAksharas('नदी');
      expect(result).toEqual(['न', 'दी']);
    });

    it('should handle conjuncts with virama', () => {
      // क्र = क + virama + र
      const conjunct = 'क' + '\u094D' + 'र';
      const result = splitAksharas(conjunct);
      expect(result.length).toBe(1);
      expect(result[0]).toBe(conjunct);
    });

    it('should handle conjunct + vowel sign', () => {
      // क्री = क + virama + र + ी
      const text = 'क' + '\u094D' + 'र' + '\u0940';
      const result = splitAksharas(text);
      expect(result.length).toBe(1);
    });

    it('should handle independent vowels as separate aksharas', () => {
      const result = splitAksharas('अग्नि');
      expect(result[0]).toBe('अ');
      expect(result.length).toBe(2); // अ, ग्नि
    });

    it('should handle anusvara', () => {
      const result = splitAksharas('सिंह');
      // सिं = स + ि + ं, ह
      expect(result.length).toBe(2);
      expect(result[0]).toContain('ं');
    });

    it('should handle visarga', () => {
      const result = splitAksharas('दुःख');
      expect(result.length).toBe(2);
    });

    it('should handle multi-consonant conjuncts', () => {
      // स्त्र = स + virama + त + virama + र
      const text = 'वस्त्र';
      const result = splitAksharas(text);
      // व, स्त्र
      expect(result.length).toBe(2);
    });

    it('should normalize NFC', () => {
      const nfd = 'क'.normalize('NFD');
      const result = splitAksharas(nfd);
      expect(result.every(a => a === a.normalize('NFC'))).toBe(true);
    });

    it('should handle empty string', () => {
      expect(splitAksharas('')).toEqual([]);
    });

    it('should handle a full word: धर्म', () => {
      const result = splitAksharas('धर्म');
      expect(result.length).toBe(2); // ध, र्म
    });

    it('should handle a full word: ज्ञान', () => {
      const result = splitAksharas('ज्ञान');
      // ज्ञा, न
      expect(result.length).toBe(2);
    });
  });

  describe('countAksharas', () => {
    it('should count aksharas in a word', () => {
      expect(countAksharas('धर्म')).toBe(2);
      expect(countAksharas('जल')).toBe(2);
    });
  });

  describe('isValidAkshara', () => {
    it('should validate a single consonant', () => {
      expect(isValidAkshara('क')).toBe(true);
    });

    it('should validate consonant + vowel sign', () => {
      expect(isValidAkshara('की')).toBe(true);
    });

    it('should validate conjunct', () => {
      expect(isValidAkshara('क्र')).toBe(true);
    });

    it('should reject multiple aksharas', () => {
      expect(isValidAkshara('कम')).toBe(false);
    });

    it('should reject empty string', () => {
      expect(isValidAkshara('')).toBe(false);
    });
  });

  describe('normalizeText', () => {
    it('should return NFC-normalized text', () => {
      const text = 'धर्म';
      expect(normalizeText(text)).toBe(text.normalize('NFC'));
    });
  });
});
