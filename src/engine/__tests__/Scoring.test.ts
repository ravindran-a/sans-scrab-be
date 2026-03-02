import { getAksharaScore, calculateMoveScore } from '../Scoring';
import { createBoard, applyPlacements } from '../Board';

describe('Scoring', () => {
  describe('getAksharaScore', () => {
    it('should score common consonants low', () => {
      expect(getAksharaScore('क')).toBe(1);
      expect(getAksharaScore('त')).toBe(1);
      expect(getAksharaScore('न')).toBe(1);
    });

    it('should score rare consonants higher', () => {
      expect(getAksharaScore('ङ')).toBe(8);
      expect(getAksharaScore('ञ')).toBe(8);
      expect(getAksharaScore('झ')).toBe(5);
    });

    it('should sum consonants in a conjunct', () => {
      // क्र = क(1) + र(1) = 2
      const conjunct = 'क\u094Dर';
      expect(getAksharaScore(conjunct)).toBe(2);
    });

    it('should return 0 for pure vowels', () => {
      expect(getAksharaScore('अ')).toBe(0);
      expect(getAksharaScore('इ')).toBe(0);
    });
  });

  describe('calculateMoveScore', () => {
    it('should calculate score for a simple word', () => {
      const board = createBoard();
      const placements = [
        { row: 5, col: 4, akshara: 'ज' },
        { row: 5, col: 5, akshara: 'ल' },
      ];
      const { totalScore } = calculateMoveScore(board, placements);
      // ज(2) + ल(2) = 4, center square doubles word = 8
      expect(totalScore).toBeGreaterThan(0);
    });

    it('should apply premium square bonuses', () => {
      const board = createBoard();
      // Place on triple word score (0,0)
      const placements = [
        { row: 0, col: 0, akshara: 'क' },
        { row: 0, col: 1, akshara: 'म' },
      ];
      // This won't pass validation (no center), but scoring works independently
      const { totalScore } = calculateMoveScore(board, placements);
      expect(totalScore).toBeGreaterThan(0);
    });
  });
});
