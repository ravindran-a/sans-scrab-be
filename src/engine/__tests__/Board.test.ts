import {
  applyPlacements,
  BOARD_SIZE,
  CENTER,
  createBoard,
  extractWords,
  validatePlacement,
} from "../Board";

describe("Board", () => {
  describe("createBoard", () => {
    it("should create an 11x11 board", () => {
      const board = createBoard();
      expect(board.length).toBe(BOARD_SIZE);
      expect(board[0].length).toBe(BOARD_SIZE);
    });

    it("should have center cell type", () => {
      const board = createBoard();
      expect(board[CENTER][CENTER].type).toBe("center");
    });

    it("should have all cells empty", () => {
      const board = createBoard();
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          expect(board[r][c].akshara).toBeNull();
        }
      }
    });

    it("should have premium squares at corners", () => {
      const board = createBoard();
      expect(board[0][0].type).toBe("triple_word");
      expect(board[0][10].type).toBe("triple_word");
      expect(board[10][0].type).toBe("triple_word");
      expect(board[10][10].type).toBe("triple_word");
    });
  });

  describe("validatePlacement", () => {
    it("should require first word to cover center", () => {
      const board = createBoard();
      const result = validatePlacement(board, [
        { row: 0, col: 0, akshara: "क" },
        { row: 0, col: 1, akshara: "म" },
      ]);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("center");
    });

    it("should accept a valid first word covering center", () => {
      const board = createBoard();
      const result = validatePlacement(board, [
        { row: 5, col: 4, akshara: "ज" },
        { row: 5, col: 5, akshara: "ल" },
      ]);
      expect(result.valid).toBe(true);
    });

    it("should reject non-linear placements", () => {
      const board = createBoard();
      const result = validatePlacement(board, [
        { row: 5, col: 5, akshara: "क" },
        { row: 6, col: 6, akshara: "म" },
      ]);
      expect(result.valid).toBe(false);
    });

    it("should reject duplicate positions", () => {
      const board = createBoard();
      const result = validatePlacement(board, [
        { row: 5, col: 5, akshara: "क" },
        { row: 5, col: 5, akshara: "म" },
      ]);
      expect(result.valid).toBe(false);
    });

    it("should reject placement on occupied cell", () => {
      const board = createBoard();
      board[5][5].akshara = "क";
      const result = validatePlacement(board, [
        { row: 5, col: 5, akshara: "म" },
      ]);
      expect(result.valid).toBe(false);
    });

    it("should require connection to existing tiles after first move", () => {
      const board = createBoard();
      board[5][5].akshara = "क";
      const result = validatePlacement(board, [
        { row: 0, col: 0, akshara: "म" },
        { row: 0, col: 1, akshara: "न" },
      ]);
      expect(result.valid).toBe(false);
    });

    it("should accept tiles connecting to existing", () => {
      const board = createBoard();
      board[5][5].akshara = "क";
      const result = validatePlacement(board, [
        { row: 5, col: 6, akshara: "म" },
      ]);
      expect(result.valid).toBe(true);
    });
  });

  describe("applyPlacements", () => {
    it("should place aksharas on the board", () => {
      const board = createBoard();
      const newBoard = applyPlacements(
        board,
        [{ row: 5, col: 5, akshara: "क" }],
        0,
      );
      expect(newBoard[5][5].akshara).toBe("क");
      expect(newBoard[5][5].turnPlaced).toBe(0);
      // Original should be unchanged
      expect(board[5][5].akshara).toBeNull();
    });
  });

  describe("extractWords", () => {
    it("should extract a horizontal word", () => {
      const board = createBoard();
      const placements = [
        { row: 5, col: 4, akshara: "ज" },
        { row: 5, col: 5, akshara: "ल" },
      ];
      const words = extractWords(board, placements);
      expect(words.length).toBe(1);
      expect(words[0].word).toBe("जल");
    });

    it("should detect cross words", () => {
      const board = createBoard();
      board[5][5].akshara = "क";
      board[5][6].akshara = "म";

      const placements = [
        { row: 4, col: 5, akshara: "ज" },
        { row: 6, col: 5, akshara: "ल" },
      ];
      const words = extractWords(board, placements);
      // Should find vertical word ज-क-ल and possibly cross words
      expect(words.length).toBeGreaterThanOrEqual(1);
    });
  });
});
