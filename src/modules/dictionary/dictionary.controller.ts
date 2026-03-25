import { Request, Response, Router } from "express";
import { DictionaryService } from "./dictionary.service";

const router = Router();

router.get("/lookup/:word", (req: Request, res: Response) => {
  const word = decodeURIComponent(req.params.word).normalize("NFC");
  const entry = DictionaryService.lookupWord(word);
  if (!entry) {
    return res
      .status(404)
      .json({ valid: false, message: "Word not found in dictionary" });
  }
  return res.json({ valid: true, entry });
});

router.get("/validate/:word", (req: Request, res: Response) => {
  const word = decodeURIComponent(req.params.word).normalize("NFC");
  const valid = DictionaryService.isValidWord(word);
  return res.json({ valid });
});

router.get("/stats", (_req: Request, res: Response) => {
  return res.json({ count: DictionaryService.getWordCount() });
});

router.get("/words", (req: Request, res: Response) => {
  const search =
    typeof req.query.search === "string" ? req.query.search.trim() : "";
  const difficulty = req.query.difficulty
    ? Number(req.query.difficulty)
    : undefined;
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));

  let words = DictionaryService.getAllEntries();

  if (difficulty && difficulty >= 1 && difficulty <= 5) {
    words = words.filter((e) => e.difficulty <= difficulty);
  }

  if (search) {
    const normalized = search.normalize("NFC").toLowerCase();
    words = words.filter(
      (e) =>
        e.word.toLowerCase().includes(normalized) ||
        e.meaning.en.toLowerCase().includes(normalized) ||
        e.meaning.sa.includes(normalized),
    );
  }

  const total = words.length;
  const totalPages = Math.ceil(total / limit);
  const offset = (page - 1) * limit;
  const paginated = words.slice(offset, offset + limit);

  return res.json({ words: paginated, total, page, totalPages, limit });
});

export const dictionaryRouter = router;
