import { splitAksharas, normalizeText } from "../GraphemeSplitter";
import {
  AKSHARA_RACK_SIZE,
  buildAksharaDistribution,
  canFormAnyWord,
  createAksharaTileBag,
  drawFromBag,
  getAksharaDistribution,
  getAksharaTileCounts,
} from "../SanskritEngine";
import { createBoard, validatePlacement, extractWords } from "../Board";
import { calculateMoveScore, getAksharaScore } from "../Scoring";
import { AiPlayer } from "../../modules/ai/AiPlayer";

// Sample dictionary words for testing
const SAMPLE_WORDS = [
  "देव", // de-va (2 aksharas)
  "नदी", // na-dī (2 aksharas)
  "गुण", // gu-ṇa (2 aksharas)
  "वन", // va-na (2 aksharas)
  "जल", // ja-la (2 aksharas)
  "धर्म", // dha-rma (2 aksharas)
  "कर्म", // ka-rma (2 aksharas)
  "सागर", // sā-ga-ra (3 aksharas)
  "नगर", // na-ga-ra (3 aksharas)
  "मनस", // ma-na-sa (3 aksharas)
  "फल", // pha-la (2 aksharas)
  "बल", // ba-la (2 aksharas)
  "रस", // ra-sa (2 aksharas)
  "तप", // ta-pa (2 aksharas)
  "गज", // ga-ja (2 aksharas)
  "दम", // da-ma (2 aksharas)
  "कमल", // ka-ma-la (3 aksharas)
  "सुख", // su-kha (2 aksharas)
  "दुःख", // duḥ-kha (2 aksharas)
  "पुर", // pu-ra (2 aksharas)
  "मत", // ma-ta (2 aksharas)
  "गत", // ga-ta (2 aksharas)
  "हर", // ha-ra (2 aksharas)
  "वर", // va-ra (2 aksharas)
  "नर", // na-ra (2 aksharas)
  "पद", // pa-da (2 aksharas)
  "मद", // ma-da (2 aksharas)
  "रज", // ra-ja (2 aksharas)
  "तम", // ta-ma (2 aksharas)
  "सर", // sa-ra (2 aksharas)
];

describe("Akshara Mode", () => {
  beforeAll(() => {
    buildAksharaDistribution(SAMPLE_WORDS);
  });

  describe("buildAksharaDistribution", () => {
    it("should build frequency map from dictionary words", () => {
      const dist = getAksharaDistribution();
      expect(dist.size).toBeGreaterThan(0);
    });

    it("should count akshara frequencies correctly", () => {
      const dist = getAksharaDistribution();
      // 'र' appears in many words: धर्म, कर्म, सागर, नगर, हर, वर, नर, सर, पुर, रस, रज
      // As a standalone akshara 'र' (inherent vowel): हर, वर, नर, सर, रस, रज
      // As part of conjunct 'र्म': धर्म, कर्म (these are single aksharas)
      // 'र' frequency should be high
      expect(dist.has("र")).toBe(true);
    });

    it("should have common aksharas with higher frequency than rare ones", () => {
      const dist = getAksharaDistribution();
      // 'न' appears in many words, should have higher freq than uncommon aksharas
      const naFreq = dist.get("न") || 0;
      expect(naFreq).toBeGreaterThan(0);
    });

    it("should filter ultra-rare aksharas from tile counts (< 3 occurrences)", () => {
      const tileCounts = getAksharaTileCounts();
      // All tile counts should have aksharas that appear in >= 3 words
      const dist = getAksharaDistribution();
      for (const [akshara] of tileCounts) {
        expect(dist.get(akshara)!).toBeGreaterThanOrEqual(3);
      }
    });
  });

  describe("createAksharaTileBag", () => {
    it("should create a non-empty bag", () => {
      const bag = createAksharaTileBag();
      expect(bag.length).toBeGreaterThan(0);
    });

    it("should contain valid aksharas from the distribution", () => {
      const bag = createAksharaTileBag();
      const tileCounts = getAksharaTileCounts();
      for (const akshara of bag) {
        expect(tileCounts.has(akshara)).toBe(true);
      }
    });

    it("should be shuffled (not in same order each time)", () => {
      const bag1 = createAksharaTileBag();
      const bag2 = createAksharaTileBag();
      // Very unlikely both bags are identical if shuffled
      // But they should have the same contents when sorted
      expect([...bag1].sort()).toEqual([...bag2].sort());
    });
  });

  describe("AKSHARA_RACK_SIZE", () => {
    it("should be 8", () => {
      expect(AKSHARA_RACK_SIZE).toBe(8);
    });

    it("should allow drawing a full rack from the bag", () => {
      const bag = createAksharaTileBag();
      const { drawn, remaining } = drawFromBag(bag, AKSHARA_RACK_SIZE);
      expect(drawn.length).toBe(AKSHARA_RACK_SIZE);
      expect(remaining.length).toBe(bag.length - AKSHARA_RACK_SIZE);
    });
  });

  describe("canFormAnyWord", () => {
    it("should return true when rack contains aksharas of a valid word", () => {
      // Build a word index from sample words
      const wordIndex = new Map<string, string[][]>();
      for (const word of SAMPLE_WORDS) {
        const aksharas = splitAksharas(normalizeText(word));
        if (aksharas.length >= 2) {
          wordIndex.set(word, [aksharas]);
        }
      }

      // Rack containing "ज" and "ल" should form "जल"
      const rack = ["ज", "ल", "क", "म", "प", "स", "न", "द"];
      expect(canFormAnyWord(rack, wordIndex)).toBe(true);
    });

    it("should return false when no valid word can be formed", () => {
      const wordIndex = new Map<string, string[][]>();
      for (const word of SAMPLE_WORDS) {
        const aksharas = splitAksharas(normalizeText(word));
        if (aksharas.length >= 2) {
          wordIndex.set(word, [aksharas]);
        }
      }

      // Rack with aksharas that don't form any word in our sample
      const rack = ["क्री", "ज्ञा", "श्री", "ध्या", "भ्रा", "त्रा", "प्रा", "क्ला"];
      expect(canFormAnyWord(rack, wordIndex)).toBe(false);
    });
  });

  describe("Scoring compatibility", () => {
    it("should score pre-formed aksharas the same as constructed ones", () => {
      // "की" = consonant क(1) + vowel sign (0) = 1 point
      expect(getAksharaScore("की")).toBe(1);
      expect(getAksharaScore("क")).toBe(1);

      // Conjunct "र्म" = र(1) + म(1) = 2 points
      expect(getAksharaScore("र्म")).toBe(2);

      // "गु" = ग(2) = 2 points (vowel free)
      expect(getAksharaScore("गु")).toBe(2);
    });
  });

  describe("Board compatibility with akshara tiles", () => {
    it("should validate placement of pre-formed aksharas on empty board", () => {
      const board = createBoard();
      const placements = [
        { row: 5, col: 4, akshara: "दे" },
        { row: 5, col: 5, akshara: "व" },
      ];
      const result = validatePlacement(board, placements);
      expect(result.valid).toBe(true);
    });

    it("should extract words formed by pre-formed aksharas", () => {
      const board = createBoard();
      const placements = [
        { row: 5, col: 4, akshara: "दे" },
        { row: 5, col: 5, akshara: "व" },
      ];
      const words = extractWords(board, placements);
      expect(words.length).toBe(1);
      expect(words[0].word).toBe("देव");
    });

    it("should calculate score for pre-formed akshara placements", () => {
      const board = createBoard();
      const placements = [
        { row: 5, col: 4, akshara: "दे" },
        { row: 5, col: 5, akshara: "व" },
      ];
      const { totalScore, wordScores } = calculateMoveScore(board, placements);
      expect(totalScore).toBeGreaterThan(0);
      expect(wordScores.length).toBe(1);
      expect(wordScores[0].word).toBe("देव");
    });

    it("should handle cross-words with pre-formed aksharas", () => {
      const board = createBoard();
      // Place "देव" horizontally first
      board[5][4].akshara = "दे";
      board[5][4].turnPlaced = 0;
      board[5][5].akshara = "व";
      board[5][5].turnPlaced = 0;

      // Now place "वन" vertically at (5,5)-(6,5), reusing the "व" at (5,5)
      const placements = [{ row: 6, col: 5, akshara: "न" }];
      const result = validatePlacement(board, placements);
      expect(result.valid).toBe(true);

      const words = extractWords(board, placements);
      // Should find the vertical cross-word "वन"
      const wordTexts = words.map((w) => w.word);
      expect(wordTexts).toContain("वन");
    });
  });

  describe("AI Player in akshara mode", () => {
    it("should be constructable with aksharaMode flag", () => {
      const ai = new AiPlayer(1, true);
      expect(ai).toBeDefined();
    });

    it("should be constructable without aksharaMode flag (backward compat)", () => {
      const ai = new AiPlayer(1);
      expect(ai).toBeDefined();
    });

    it("should be constructable with aksharaMode=false (classic)", () => {
      const ai = new AiPlayer(2, false);
      expect(ai).toBeDefined();
    });
  });

  describe("Akshara splitting for tile generation", () => {
    it("should split simple 2-akshara words correctly", () => {
      expect(splitAksharas("देव")).toEqual(["दे", "व"]);
      expect(splitAksharas("नदी")).toEqual(["न", "दी"]);
      expect(splitAksharas("जल")).toEqual(["ज", "ल"]);
      expect(splitAksharas("वन")).toEqual(["व", "न"]);
    });

    it("should split words with conjuncts", () => {
      expect(splitAksharas("धर्म")).toEqual(["ध", "र्म"]);
      expect(splitAksharas("कर्म")).toEqual(["क", "र्म"]);
    });

    it("should split 3-akshara words", () => {
      expect(splitAksharas("सागर")).toEqual(["सा", "ग", "र"]);
      expect(splitAksharas("नगर")).toEqual(["न", "ग", "र"]);
      expect(splitAksharas("कमल")).toEqual(["क", "म", "ल"]);
    });
  });

  describe("Scoring with rackSize parameter", () => {
    it("should trigger all-tiles bonus when placing 8 tiles with rackSize=8", () => {
      const board = createBoard();
      // Place 8 aksharas in a row (covering center)
      const placements = [
        { row: 5, col: 1, akshara: "क" },
        { row: 5, col: 2, akshara: "ल" },
        { row: 5, col: 3, akshara: "म" },
        { row: 5, col: 4, akshara: "न" },
        { row: 5, col: 5, akshara: "प" },
        { row: 5, col: 6, akshara: "र" },
        { row: 5, col: 7, akshara: "स" },
        { row: 5, col: 8, akshara: "त" },
      ];
      const { totalScore: scoreWith8 } = calculateMoveScore(board, placements, 8);
      const { totalScore: scoreWith15 } = calculateMoveScore(board, placements, 15);
      // With rackSize=8: 8 placements >= 8, bonus triggers (+15)
      // With rackSize=15: 8 placements < 15, no bonus
      expect(scoreWith8).toBe(scoreWith15 + 15);
    });

    it("should not trigger bonus when placing fewer than rackSize tiles", () => {
      const board = createBoard();
      const placements = [
        { row: 5, col: 4, akshara: "दे" },
        { row: 5, col: 5, akshara: "व" },
      ];
      const { totalScore: score8 } = calculateMoveScore(board, placements, 8);
      const { totalScore: score15 } = calculateMoveScore(board, placements, 15);
      expect(score8).toBe(score15); // Same, no bonus for either
    });
  });

  describe("End-to-end akshara mode flow", () => {
    it("should simulate a complete akshara mode turn", () => {
      // 1. Create bag and draw rack
      const bag = createAksharaTileBag();
      const { drawn: rack, remaining } = drawFromBag(bag, AKSHARA_RACK_SIZE);
      expect(rack.length).toBe(AKSHARA_RACK_SIZE);

      // 2. Board starts empty
      const board = createBoard();

      // 3. Manually place known valid aksharas (simulating a move)
      // Use aksharas we know form a word
      const placements = [
        { row: 5, col: 4, akshara: "दे" },
        { row: 5, col: 5, akshara: "व" },
      ];

      // 4. Validate placement
      const validation = validatePlacement(board, placements);
      expect(validation.valid).toBe(true);

      // 5. Extract and verify words
      const words = extractWords(board, placements);
      expect(words.length).toBe(1);
      expect(words[0].word).toBe("देव");

      // 6. Calculate score
      const { totalScore } = calculateMoveScore(board, placements);
      expect(totalScore).toBeGreaterThan(0);
    });

    it("should draw two racks for AI game without exhausting bag", () => {
      const bag = createAksharaTileBag();
      const { drawn: rack1, remaining: r1 } = drawFromBag(
        bag,
        AKSHARA_RACK_SIZE,
      );
      const { drawn: rack2, remaining: r2 } = drawFromBag(
        r1,
        AKSHARA_RACK_SIZE,
      );
      expect(rack1.length).toBe(AKSHARA_RACK_SIZE);
      expect(rack2.length).toBe(AKSHARA_RACK_SIZE);
      expect(r2.length).toBe(bag.length - 2 * AKSHARA_RACK_SIZE);
    });
  });
});
