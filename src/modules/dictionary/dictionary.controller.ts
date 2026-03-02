import { Router, Request, Response } from 'express';
import { DictionaryService } from './dictionary.service';

const router = Router();

router.get('/lookup/:word', (req: Request, res: Response) => {
  const word = decodeURIComponent(req.params.word).normalize('NFC');
  const entry = DictionaryService.lookupWord(word);
  if (!entry) {
    return res.status(404).json({ valid: false, message: 'Word not found in dictionary' });
  }
  return res.json({ valid: true, entry });
});

router.get('/validate/:word', (req: Request, res: Response) => {
  const word = decodeURIComponent(req.params.word).normalize('NFC');
  const valid = DictionaryService.isValidWord(word);
  return res.json({ valid });
});

router.get('/stats', (_req: Request, res: Response) => {
  return res.json({ count: DictionaryService.getWordCount() });
});

router.get('/words', (req: Request, res: Response) => {
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  const difficulty = req.query.difficulty ? Number(req.query.difficulty) : undefined;

  let words = DictionaryService.getAllEntries();

  if (difficulty && difficulty >= 1 && difficulty <= 5) {
    words = words.filter(e => e.difficulty <= difficulty);
  }

  if (search) {
    const normalized = search.normalize('NFC').toLowerCase();
    words = words.filter(e =>
      e.word.toLowerCase().includes(normalized) ||
      e.meaning.en.toLowerCase().includes(normalized) ||
      e.meaning.sa.includes(normalized)
    );
  }

  return res.json({ words, total: words.length });
});

export const dictionaryRouter = router;
