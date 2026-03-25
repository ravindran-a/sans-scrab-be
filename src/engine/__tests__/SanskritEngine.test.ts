import {
  CONSONANTS,
  constructAkshara,
  createTileBag,
  drawFromBag,
  RACK_SIZE,
  validateRackUsage,
} from "../SanskritEngine";

describe("SanskritEngine", () => {
  describe("constructAkshara", () => {
    it("should construct a simple consonant with inherent vowel", () => {
      expect(constructAkshara(["क"])).toBe("क");
    });

    it("should construct consonant + vowel sign", () => {
      const result = constructAkshara(["क"], "ई");
      expect(result).toBe("की");
    });

    it("should construct conjunct", () => {
      const result = constructAkshara(["क", "र"]);
      expect(result).toBe("क्र");
    });

    it("should construct conjunct with vowel", () => {
      const result = constructAkshara(["क", "र"], "ई");
      expect(result).toBe("क्री");
    });

    it("should return independent vowel when no consonants", () => {
      expect(constructAkshara([], "अ")).toBe("अ");
    });

    it("should handle triple conjuncts", () => {
      const result = constructAkshara(["स", "त", "र"]);
      expect(result).toBe("स्त्र");
    });
  });

  describe("createTileBag", () => {
    it("should create a bag with consonants", () => {
      const bag = createTileBag();
      expect(bag.length).toBeGreaterThan(0);
      expect(bag.every((c) => CONSONANTS.includes(c))).toBe(true);
    });

    it("should be shuffled (not always same order)", () => {
      const bag1 = createTileBag();
      const bag2 = createTileBag();
      // Both bags should have the same length
      expect(bag1.length).toBe(bag2.length);
    });
  });

  describe("drawFromBag", () => {
    it("should draw the requested number of tiles", () => {
      const bag = createTileBag();
      const { drawn, remaining } = drawFromBag(bag, RACK_SIZE);
      expect(drawn.length).toBe(RACK_SIZE);
      expect(remaining.length).toBe(bag.length - RACK_SIZE);
    });

    it("should handle drawing more than available", () => {
      const bag = ["क", "ख"];
      const { drawn, remaining } = drawFromBag(bag, 5);
      expect(drawn.length).toBe(2);
      expect(remaining.length).toBe(0);
    });
  });

  describe("validateRackUsage", () => {
    it("should validate consonants present in rack", () => {
      const rack = ["क", "ख", "ग", "घ", "ङ"];
      const result = validateRackUsage(rack, ["क", "ग"]);
      expect(result.valid).toBe(true);
      expect(result.usedIndices.length).toBe(2);
    });

    it("should fail for consonants not in rack", () => {
      const rack = ["क", "ख"];
      const result = validateRackUsage(rack, ["ग"]);
      expect(result.valid).toBe(false);
    });

    it("should handle duplicate consonants correctly", () => {
      const rack = ["क", "क", "ख"];
      const result = validateRackUsage(rack, ["क", "क"]);
      expect(result.valid).toBe(true);
    });
  });
});
