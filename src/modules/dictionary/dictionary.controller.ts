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

export const dictionaryRouter = router;
