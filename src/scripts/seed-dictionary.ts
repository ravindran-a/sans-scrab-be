import mongoose from 'mongoose';
import { ENV } from '../config/env';
import { DictionaryModel } from '../modules/dictionary/dictionary.model';

/**
 * Amarakośa-style seed data.
 * Prātipadika (base/stem) forms only — no inflected forms.
 * These are real Sanskrit words from classical literature.
 */
const SEED_WORDS = [
  // Nature & Elements (प्रकृति)
  { word: 'जल', root: 'जल्', meaning: { en: 'water', sa: 'जलम्' }, grammar: { type: 'नपुंसकलिङ्ग', derivation: 'जल् + अच्' }, difficulty: 1 },
  { word: 'अग्नि', root: 'अग्नि', meaning: { en: 'fire', sa: 'अग्निः' }, grammar: { type: 'पुंलिङ्ग', derivation: 'अङ्ग् + नि' }, difficulty: 1 },
  { word: 'वायु', root: 'वा', meaning: { en: 'wind', sa: 'वायुः' }, grammar: { type: 'पुंलिङ्ग', derivation: 'वा + यु' }, difficulty: 1 },
  { word: 'पृथिवी', root: 'पृथु', meaning: { en: 'earth', sa: 'पृथिवी' }, grammar: { type: 'स्त्रीलिङ्ग', derivation: 'पृथु + ङीप्' }, difficulty: 2 },
  { word: 'आकाश', root: 'काश्', meaning: { en: 'sky', sa: 'आकाशः' }, grammar: { type: 'पुंलिङ्ग', derivation: 'आ + काश् + अ' }, difficulty: 1 },
  { word: 'सूर्य', root: 'सृ', meaning: { en: 'sun', sa: 'सूर्यः' }, grammar: { type: 'पुंलिङ्ग', derivation: 'सृ + क्यप्' }, difficulty: 1 },
  { word: 'चन्द्र', root: 'चन्द्', meaning: { en: 'moon', sa: 'चन्द्रः' }, grammar: { type: 'पुंलिङ्ग', derivation: 'चन्द् + रन्' }, difficulty: 1 },
  { word: 'तारा', root: 'तॄ', meaning: { en: 'star', sa: 'तारा' }, grammar: { type: 'स्त्रीलिङ्ग', derivation: 'तॄ + अच्' }, difficulty: 1 },
  { word: 'मेघ', root: 'मिह्', meaning: { en: 'cloud', sa: 'मेघः' }, grammar: { type: 'पुंलिङ्ग', derivation: 'मिह् + घञ्' }, difficulty: 2 },
  { word: 'वर्ष', root: 'वृष्', meaning: { en: 'rain', sa: 'वर्षम्' }, grammar: { type: 'नपुंसकलिङ्ग', derivation: 'वृष् + घञ्' }, difficulty: 2 },
  { word: 'नदी', root: 'नद्', meaning: { en: 'river', sa: 'नदी' }, grammar: { type: 'स्त्रीलिङ्ग', derivation: 'नद् + ङीप्' }, difficulty: 1 },
  { word: 'समुद्र', root: 'समुद्र', meaning: { en: 'ocean', sa: 'समुद्रः' }, grammar: { type: 'पुंलिङ्ग', derivation: 'सम् + उद् + रा' }, difficulty: 2 },
  { word: 'पर्वत', root: 'पर्वत', meaning: { en: 'mountain', sa: 'पर्वतः' }, grammar: { type: 'पुंलिङ्ग', derivation: 'पर्व + अतच्' }, difficulty: 2 },
  { word: 'वन', root: 'वन', meaning: { en: 'forest', sa: 'वनम्' }, grammar: { type: 'नपुंसकलिङ्ग', derivation: 'वन्' }, difficulty: 1 },
  { word: 'भूमि', root: 'भू', meaning: { en: 'ground', sa: 'भूमिः' }, grammar: { type: 'स्त्रीलिङ्ग', derivation: 'भू + मि' }, difficulty: 1 },

  // Living beings (प्राणि)
  { word: 'नर', root: 'नृ', meaning: { en: 'man', sa: 'नरः' }, grammar: { type: 'पुंलिङ्ग', derivation: 'नृ + अच्' }, difficulty: 1 },
  { word: 'नारी', root: 'नृ', meaning: { en: 'woman', sa: 'नारी' }, grammar: { type: 'स्त्रीलिङ्ग', derivation: 'नृ + ङीप्' }, difficulty: 1 },
  { word: 'गज', root: 'गज्', meaning: { en: 'elephant', sa: 'गजः' }, grammar: { type: 'पुंलिङ्ग', derivation: 'गज् + अच्' }, difficulty: 1 },
  { word: 'सिंह', root: 'सिंह', meaning: { en: 'lion', sa: 'सिंहः' }, grammar: { type: 'पुंलिङ्ग', derivation: 'हिंस् + अच्' }, difficulty: 2 },
  { word: 'अश्व', root: 'अश्', meaning: { en: 'horse', sa: 'अश्वः' }, grammar: { type: 'पुंलिङ्ग', derivation: 'अश् + वन्' }, difficulty: 2 },
  { word: 'गौ', root: 'गम्', meaning: { en: 'cow', sa: 'गौः' }, grammar: { type: 'स्त्रीलिङ्ग', derivation: 'गम् + डौ' }, difficulty: 2 },
  { word: 'पक्षिन्', root: 'पक्ष', meaning: { en: 'bird', sa: 'पक्षी' }, grammar: { type: 'पुंलिङ्ग', derivation: 'पक्ष + इनि' }, difficulty: 3 },
  { word: 'मत्स्य', root: 'मत्स्य', meaning: { en: 'fish', sa: 'मत्स्यः' }, grammar: { type: 'पुंलिङ्ग', derivation: 'मद् + स्यन्' }, difficulty: 3 },
  { word: 'सर्प', root: 'सृप्', meaning: { en: 'snake', sa: 'सर्पः' }, grammar: { type: 'पुंलिङ्ग', derivation: 'सृप् + घञ्' }, difficulty: 2 },
  { word: 'वृक्ष', root: 'वृक्ष', meaning: { en: 'tree', sa: 'वृक्षः' }, grammar: { type: 'पुंलिङ्ग', derivation: 'वृ + क्षन्' }, difficulty: 2 },
  { word: 'पुष्प', root: 'पुष्', meaning: { en: 'flower', sa: 'पुष्पम्' }, grammar: { type: 'नपुंसकलिङ्ग', derivation: 'पुष् + पन्' }, difficulty: 2 },
  { word: 'फल', root: 'फल्', meaning: { en: 'fruit', sa: 'फलम्' }, grammar: { type: 'नपुंसकलिङ्ग', derivation: 'फल् + अच्' }, difficulty: 1 },
  { word: 'बीज', root: 'बीज', meaning: { en: 'seed', sa: 'बीजम्' }, grammar: { type: 'नपुंसकलिङ्ग', derivation: 'बीज' }, difficulty: 2 },
  { word: 'पत्र', root: 'पत्', meaning: { en: 'leaf', sa: 'पत्रम्' }, grammar: { type: 'नपुंसकलिङ्ग', derivation: 'पत् + रन्' }, difficulty: 1 },
  { word: 'मूल', root: 'मूल', meaning: { en: 'root', sa: 'मूलम्' }, grammar: { type: 'नपुंसकलिङ्ग', derivation: 'मूल' }, difficulty: 1 },

  // Body parts (शरीर)
  { word: 'शिर', root: 'शिर', meaning: { en: 'head', sa: 'शिरः' }, grammar: { type: 'नपुंसकलिङ्ग', derivation: 'शिर' }, difficulty: 2 },
  { word: 'नेत्र', root: 'नी', meaning: { en: 'eye', sa: 'नेत्रम्' }, grammar: { type: 'नपुंसकलिङ्ग', derivation: 'नी + ष्ट्रन्' }, difficulty: 2 },
  { word: 'कर्ण', root: 'कृ', meaning: { en: 'ear', sa: 'कर्णः' }, grammar: { type: 'पुंलिङ्ग', derivation: 'कृ + णक्' }, difficulty: 2 },
  { word: 'नासिका', root: 'नस्', meaning: { en: 'nose', sa: 'नासिका' }, grammar: { type: 'स्त्रीलिङ्ग', derivation: 'नस् + इकन्' }, difficulty: 3 },
  { word: 'मुख', root: 'मुख', meaning: { en: 'face', sa: 'मुखम्' }, grammar: { type: 'नपुंसकलिङ्ग', derivation: 'मुख' }, difficulty: 1 },
  { word: 'हस्त', root: 'हस्', meaning: { en: 'hand', sa: 'हस्तः' }, grammar: { type: 'पुंलिङ्ग', derivation: 'हस् + तन्' }, difficulty: 1 },
  { word: 'पाद', root: 'पद्', meaning: { en: 'foot', sa: 'पादः' }, grammar: { type: 'पुंलिङ्ग', derivation: 'पद् + घञ्' }, difficulty: 1 },
  { word: 'हृदय', root: 'हृद्', meaning: { en: 'heart', sa: 'हृदयम्' }, grammar: { type: 'नपुंसकलिङ्ग', derivation: 'हृद् + अयच्' }, difficulty: 2 },

  // Abstract & Qualities (गुण)
  { word: 'धर्म', root: 'धृ', meaning: { en: 'righteousness', sa: 'धर्मः' }, grammar: { type: 'पुंलिङ्ग', derivation: 'धृ + मन्' }, difficulty: 1 },
  { word: 'सत्य', root: 'अस्', meaning: { en: 'truth', sa: 'सत्यम्' }, grammar: { type: 'नपुंसकलिङ्ग', derivation: 'सत् + यत्' }, difficulty: 1 },
  { word: 'ज्ञान', root: 'ज्ञा', meaning: { en: 'knowledge', sa: 'ज्ञानम्' }, grammar: { type: 'नपुंसकलिङ्ग', derivation: 'ज्ञा + ल्युट्' }, difficulty: 2 },
  { word: 'विद्या', root: 'विद्', meaning: { en: 'learning', sa: 'विद्या' }, grammar: { type: 'स्त्रीलिङ्ग', derivation: 'विद् + यत्' }, difficulty: 1 },
  { word: 'शक्ति', root: 'शक्', meaning: { en: 'power', sa: 'शक्तिः' }, grammar: { type: 'स्त्रीलिङ्ग', derivation: 'शक् + क्तिन्' }, difficulty: 2 },
  { word: 'बल', root: 'बल्', meaning: { en: 'strength', sa: 'बलम्' }, grammar: { type: 'नपुंसकलिङ्ग', derivation: 'बल्' }, difficulty: 1 },
  { word: 'सुख', root: 'सुख', meaning: { en: 'happiness', sa: 'सुखम्' }, grammar: { type: 'नपुंसकलिङ्ग', derivation: 'सु + खन्' }, difficulty: 1 },
  { word: 'दुःख', root: 'दुःख', meaning: { en: 'suffering', sa: 'दुःखम्' }, grammar: { type: 'नपुंसकलिङ्ग', derivation: 'दुस् + खन्' }, difficulty: 2 },
  { word: 'प्रेम', root: 'प्री', meaning: { en: 'love', sa: 'प्रेम' }, grammar: { type: 'नपुंसकलिङ्ग', derivation: 'प्री + मन्' }, difficulty: 2 },
  { word: 'काल', root: 'कल्', meaning: { en: 'time', sa: 'कालः' }, grammar: { type: 'पुंलिङ्ग', derivation: 'कल् + घञ्' }, difficulty: 1 },
  { word: 'मृत्यु', root: 'मृ', meaning: { en: 'death', sa: 'मृत्युः' }, grammar: { type: 'पुंलिङ्ग', derivation: 'मृ + त्यु' }, difficulty: 2 },
  { word: 'जीवन', root: 'जीव्', meaning: { en: 'life', sa: 'जीवनम्' }, grammar: { type: 'नपुंसकलिङ्ग', derivation: 'जीव् + ल्युट्' }, difficulty: 1 },

  // Actions & Concepts (क्रिया)
  { word: 'कर्म', root: 'कृ', meaning: { en: 'action', sa: 'कर्म' }, grammar: { type: 'नपुंसकलिङ्ग', derivation: 'कृ + मन्' }, difficulty: 1 },
  { word: 'वाक्', root: 'वच्', meaning: { en: 'speech', sa: 'वाक्' }, grammar: { type: 'स्त्रीलिङ्ग', derivation: 'वच् + क्विप्' }, difficulty: 2 },
  { word: 'गति', root: 'गम्', meaning: { en: 'movement', sa: 'गतिः' }, grammar: { type: 'स्त्रीलिङ्ग', derivation: 'गम् + क्तिन्' }, difficulty: 2 },
  { word: 'दान', root: 'दा', meaning: { en: 'giving', sa: 'दानम्' }, grammar: { type: 'नपुंसकलिङ्ग', derivation: 'दा + ल्युट्' }, difficulty: 1 },
  { word: 'भक्ति', root: 'भज्', meaning: { en: 'devotion', sa: 'भक्तिः' }, grammar: { type: 'स्त्रीलिङ्ग', derivation: 'भज् + क्तिन्' }, difficulty: 2 },
  { word: 'मोक्ष', root: 'मुच्', meaning: { en: 'liberation', sa: 'मोक्षः' }, grammar: { type: 'पुंलिङ्ग', derivation: 'मुच् + घञ्' }, difficulty: 3 },
  { word: 'योग', root: 'युज्', meaning: { en: 'union', sa: 'योगः' }, grammar: { type: 'पुंलिङ्ग', derivation: 'युज् + घञ्' }, difficulty: 1 },
  { word: 'तप', root: 'तप्', meaning: { en: 'penance', sa: 'तपः' }, grammar: { type: 'नपुंसकलिङ्ग', derivation: 'तप् + अच्' }, difficulty: 2 },

  // People & Relations (सम्बन्ध)
  { word: 'राजन्', root: 'राज्', meaning: { en: 'king', sa: 'राजा' }, grammar: { type: 'पुंलिङ्ग', derivation: 'राज् + कनिन्' }, difficulty: 2 },
  { word: 'देव', root: 'दिव्', meaning: { en: 'god', sa: 'देवः' }, grammar: { type: 'पुंलिङ्ग', derivation: 'दिव् + अच्' }, difficulty: 1 },
  { word: 'गुरु', root: 'गृ', meaning: { en: 'teacher', sa: 'गुरुः' }, grammar: { type: 'पुंलिङ्ग', derivation: 'गृ + उण्' }, difficulty: 1 },
  { word: 'शिष्य', root: 'शिष्', meaning: { en: 'student', sa: 'शिष्यः' }, grammar: { type: 'पुंलिङ्ग', derivation: 'शिष् + यत्' }, difficulty: 2 },
  { word: 'मित्र', root: 'मित्र', meaning: { en: 'friend', sa: 'मित्रम्' }, grammar: { type: 'नपुंसकलिङ्ग', derivation: 'मित्र' }, difficulty: 1 },
  { word: 'शत्रु', root: 'शत्रु', meaning: { en: 'enemy', sa: 'शत्रुः' }, grammar: { type: 'पुंलिङ्ग', derivation: 'शत्र + उण्' }, difficulty: 2 },
  { word: 'पुत्र', root: 'पुत्र', meaning: { en: 'son', sa: 'पुत्रः' }, grammar: { type: 'पुंलिङ्ग', derivation: 'पुत्र' }, difficulty: 1 },
  { word: 'माता', root: 'मातृ', meaning: { en: 'mother', sa: 'माता' }, grammar: { type: 'स्त्रीलिङ्ग', derivation: 'मातृ' }, difficulty: 1 },
  { word: 'पिता', root: 'पितृ', meaning: { en: 'father', sa: 'पिता' }, grammar: { type: 'पुंलिङ्ग', derivation: 'पितृ' }, difficulty: 1 },

  // Objects & Places (वस्तु/स्थान)
  { word: 'गृह', root: 'गृह', meaning: { en: 'house', sa: 'गृहम्' }, grammar: { type: 'नपुंसकलिङ्ग', derivation: 'गृह' }, difficulty: 1 },
  { word: 'नगर', root: 'नगर', meaning: { en: 'city', sa: 'नगरम्' }, grammar: { type: 'नपुंसकलिङ्ग', derivation: 'नगर' }, difficulty: 1 },
  { word: 'मार्ग', root: 'मृग्', meaning: { en: 'path', sa: 'मार्गः' }, grammar: { type: 'पुंलिङ्ग', derivation: 'मृग् + घञ्' }, difficulty: 2 },
  { word: 'रथ', root: 'रथ', meaning: { en: 'chariot', sa: 'रथः' }, grammar: { type: 'पुंलिङ्ग', derivation: 'रथ' }, difficulty: 2 },
  { word: 'शस्त्र', root: 'शस्', meaning: { en: 'weapon', sa: 'शस्त्रम्' }, grammar: { type: 'नपुंसकलिङ्ग', derivation: 'शस् + ष्ट्रन्' }, difficulty: 3 },
  { word: 'पुस्तक', root: 'पुस्तक', meaning: { en: 'book', sa: 'पुस्तकम्' }, grammar: { type: 'नपुंसकलिङ्ग', derivation: 'पुस्तक' }, difficulty: 2 },
  { word: 'अन्न', root: 'अद्', meaning: { en: 'food', sa: 'अन्नम्' }, grammar: { type: 'नपुंसकलिङ्ग', derivation: 'अद् + क्त' }, difficulty: 1 },
  { word: 'वस्त्र', root: 'वस्', meaning: { en: 'cloth', sa: 'वस्त्रम्' }, grammar: { type: 'नपुंसकलिङ्ग', derivation: 'वस् + ष्ट्रन्' }, difficulty: 2 },
  { word: 'धन', root: 'धन', meaning: { en: 'wealth', sa: 'धनम्' }, grammar: { type: 'नपुंसकलिङ्ग', derivation: 'धन' }, difficulty: 1 },
  { word: 'रत्न', root: 'रत्न', meaning: { en: 'gem', sa: 'रत्नम्' }, grammar: { type: 'नपुंसकलिङ्ग', derivation: 'रत्न' }, difficulty: 2 },

  // Colors & Descriptions (वर्ण)
  { word: 'श्वेत', root: 'श्वित्', meaning: { en: 'white', sa: 'श्वेतः' }, grammar: { type: 'विशेषण', derivation: 'श्वित् + अच्' }, difficulty: 2 },
  { word: 'कृष्ण', root: 'कृष्', meaning: { en: 'black', sa: 'कृष्णः' }, grammar: { type: 'विशेषण', derivation: 'कृष् + णक्' }, difficulty: 2 },
  { word: 'रक्त', root: 'रञ्ज्', meaning: { en: 'red', sa: 'रक्तः' }, grammar: { type: 'विशेषण', derivation: 'रञ्ज् + क्त' }, difficulty: 2 },
  { word: 'पीत', root: 'पा', meaning: { en: 'yellow', sa: 'पीतः' }, grammar: { type: 'विशेषण', derivation: 'पा + क्त' }, difficulty: 2 },
  { word: 'नील', root: 'नील', meaning: { en: 'blue', sa: 'नीलः' }, grammar: { type: 'विशेषण', derivation: 'नील' }, difficulty: 1 },

  // Directions & Space (दिशा)
  { word: 'दिश्', root: 'दिश्', meaning: { en: 'direction', sa: 'दिक्' }, grammar: { type: 'स्त्रीलिङ्ग', derivation: 'दिश्' }, difficulty: 2 },
  { word: 'उत्तर', root: 'उद्', meaning: { en: 'north', sa: 'उत्तरम्' }, grammar: { type: 'विशेषण', derivation: 'उद् + तरप्' }, difficulty: 2 },
  { word: 'दक्षिण', root: 'दक्ष', meaning: { en: 'south', sa: 'दक्षिणम्' }, grammar: { type: 'विशेषण', derivation: 'दक्ष + इन' }, difficulty: 3 },

  // Deeper philosophy (दर्शन)
  { word: 'आत्मन्', root: 'अत्', meaning: { en: 'soul', sa: 'आत्मा' }, grammar: { type: 'पुंलिङ्ग', derivation: 'अत् + मनिन्' }, difficulty: 2 },
  { word: 'ब्रह्मन्', root: 'बृह्', meaning: { en: 'ultimate reality', sa: 'ब्रह्म' }, grammar: { type: 'नपुंसकलिङ्ग', derivation: 'बृह् + मनिन्' }, difficulty: 3 },
  { word: 'माया', root: 'मा', meaning: { en: 'illusion', sa: 'माया' }, grammar: { type: 'स्त्रीलिङ्ग', derivation: 'मा + या' }, difficulty: 2 },
  { word: 'संसार', root: 'सृ', meaning: { en: 'worldly existence', sa: 'संसारः' }, grammar: { type: 'पुंलिङ्ग', derivation: 'सम् + सृ + घञ्' }, difficulty: 3 },
  { word: 'निर्वाण', root: 'वा', meaning: { en: 'extinction of suffering', sa: 'निर्वाणम्' }, grammar: { type: 'नपुंसकलिङ्ग', derivation: 'निर् + वा + ल्युट्' }, difficulty: 4 },
  { word: 'अहिंसा', root: 'हिंस्', meaning: { en: 'non-violence', sa: 'अहिंसा' }, grammar: { type: 'स्त्रीलिङ्ग', derivation: 'न + हिंसा' }, difficulty: 3 },

  // War & State (राज्य)
  { word: 'सेना', root: 'सेन', meaning: { en: 'army', sa: 'सेना' }, grammar: { type: 'स्त्रीलिङ्ग', derivation: 'सेन + टाप्' }, difficulty: 2 },
  { word: 'युद्ध', root: 'युध्', meaning: { en: 'war', sa: 'युद्धम्' }, grammar: { type: 'नपुंसकलिङ्ग', derivation: 'युध् + क्त' }, difficulty: 2 },
  { word: 'शान्ति', root: 'शम्', meaning: { en: 'peace', sa: 'शान्तिः' }, grammar: { type: 'स्त्रीलिङ्ग', derivation: 'शम् + क्तिन्' }, difficulty: 2 },
  { word: 'विजय', root: 'जि', meaning: { en: 'victory', sa: 'विजयः' }, grammar: { type: 'पुंलिङ्ग', derivation: 'वि + जि + अच्' }, difficulty: 2 },

  // More words for variety
  { word: 'सरस्वती', root: 'सरस्', meaning: { en: 'goddess of learning', sa: 'सरस्वती' }, grammar: { type: 'स्त्रीलिङ्ग', derivation: 'सरस् + वत् + ङीप्' }, difficulty: 3 },
  { word: 'लक्ष्मी', root: 'लक्ष्', meaning: { en: 'goddess of wealth', sa: 'लक्ष्मीः' }, grammar: { type: 'स्त्रीलिङ्ग', derivation: 'लक्ष् + मिन्' }, difficulty: 3 },
  { word: 'गणेश', root: 'गण', meaning: { en: 'lord of hosts', sa: 'गणेशः' }, grammar: { type: 'पुंलिङ्ग', derivation: 'गण + ईश' }, difficulty: 2 },
  { word: 'कृपा', root: 'कृप्', meaning: { en: 'grace', sa: 'कृपा' }, grammar: { type: 'स्त्रीलिङ्ग', derivation: 'कृप् + अच्' }, difficulty: 2 },
  { word: 'दया', root: 'दय्', meaning: { en: 'compassion', sa: 'दया' }, grammar: { type: 'स्त्रीलिङ्ग', derivation: 'दय् + अच्' }, difficulty: 1 },
  { word: 'क्षमा', root: 'क्षम्', meaning: { en: 'forgiveness', sa: 'क्षमा' }, grammar: { type: 'स्त्रीलिङ्ग', derivation: 'क्षम् + अच्' }, difficulty: 3 },
  { word: 'वीर', root: 'वीर', meaning: { en: 'hero', sa: 'वीरः' }, grammar: { type: 'पुंलिङ्ग', derivation: 'वीर' }, difficulty: 1 },
  { word: 'धनुस्', root: 'धन्', meaning: { en: 'bow', sa: 'धनुः' }, grammar: { type: 'नपुंसकलिङ्ग', derivation: 'धन् + उस्' }, difficulty: 3 },
  { word: 'बाण', root: 'बण्', meaning: { en: 'arrow', sa: 'बाणः' }, grammar: { type: 'पुंलिङ्ग', derivation: 'बण् + घञ्' }, difficulty: 2 },
  { word: 'कवच', root: 'कवच', meaning: { en: 'armor', sa: 'कवचम्' }, grammar: { type: 'नपुंसकलिङ्ग', derivation: 'कवच' }, difficulty: 3 },
  { word: 'रस', root: 'रस', meaning: { en: 'essence', sa: 'रसः' }, grammar: { type: 'पुंलिङ्ग', derivation: 'रस' }, difficulty: 1 },
  { word: 'ध्यान', root: 'ध्यै', meaning: { en: 'meditation', sa: 'ध्यानम्' }, grammar: { type: 'नपुंसकलिङ्ग', derivation: 'ध्यै + ल्युट्' }, difficulty: 2 },
  { word: 'मन्त्र', root: 'मन्', meaning: { en: 'sacred formula', sa: 'मन्त्रः' }, grammar: { type: 'पुंलिङ्ग', derivation: 'मन् + ष्ट्रन्' }, difficulty: 2 },
  { word: 'यज्ञ', root: 'यज्', meaning: { en: 'sacrifice', sa: 'यज्ञः' }, grammar: { type: 'पुंलिङ्ग', derivation: 'यज् + नन्' }, difficulty: 3 },
  { word: 'वेद', root: 'विद्', meaning: { en: 'sacred knowledge', sa: 'वेदः' }, grammar: { type: 'पुंलिङ्ग', derivation: 'विद् + घञ्' }, difficulty: 1 },
  { word: 'श्लोक', root: 'श्लोक', meaning: { en: 'verse', sa: 'श्लोकः' }, grammar: { type: 'पुंलिङ्ग', derivation: 'श्लोक' }, difficulty: 3 },
  { word: 'सूत्र', root: 'सिव्', meaning: { en: 'thread/aphorism', sa: 'सूत्रम्' }, grammar: { type: 'नपुंसकलिङ्ग', derivation: 'सिव् + ष्ट्रन्' }, difficulty: 3 },
  { word: 'प्राण', root: 'प्रण्', meaning: { en: 'vital breath', sa: 'प्राणः' }, grammar: { type: 'पुंलिङ्ग', derivation: 'प्र + अन् + घञ्' }, difficulty: 2 },
  { word: 'चक्र', root: 'चक्र', meaning: { en: 'wheel', sa: 'चक्रम्' }, grammar: { type: 'नपुंसकलिङ्ग', derivation: 'कृ + अच्' }, difficulty: 2 },
  { word: 'पद्म', root: 'पद्म', meaning: { en: 'lotus', sa: 'पद्मम्' }, grammar: { type: 'नपुंसकलिङ्ग', derivation: 'पद्म' }, difficulty: 2 },
  { word: 'गङ्गा', root: 'गम्', meaning: { en: 'Ganges river', sa: 'गङ्गा' }, grammar: { type: 'स्त्रीलिङ्ग', derivation: 'गम् + गन्' }, difficulty: 3 },
  { word: 'हिमालय', root: 'हिम', meaning: { en: 'abode of snow', sa: 'हिमालयः' }, grammar: { type: 'पुंलिङ्ग', derivation: 'हिम + आलय' }, difficulty: 3 },
  { word: 'संगीत', root: 'गै', meaning: { en: 'music', sa: 'संगीतम्' }, grammar: { type: 'नपुंसकलिङ्ग', derivation: 'सम् + गै + क्त' }, difficulty: 3 },
  { word: 'नृत्य', root: 'नृत्', meaning: { en: 'dance', sa: 'नृत्यम्' }, grammar: { type: 'नपुंसकलिङ्ग', derivation: 'नृत् + यत्' }, difficulty: 3 },
  { word: 'काव्य', root: 'कवि', meaning: { en: 'poetry', sa: 'काव्यम्' }, grammar: { type: 'नपुंसकलिङ्ग', derivation: 'कवि + ष्यञ्' }, difficulty: 3 },
  { word: 'चित्र', root: 'चित्', meaning: { en: 'picture', sa: 'चित्रम्' }, grammar: { type: 'नपुंसकलिङ्ग', derivation: 'चित् + रन्' }, difficulty: 2 },
  { word: 'शिल्प', root: 'शिल्प', meaning: { en: 'art/craft', sa: 'शिल्पम्' }, grammar: { type: 'नपुंसकलिङ्ग', derivation: 'शिल्प' }, difficulty: 3 },
  { word: 'ग्राम', root: 'ग्रम्', meaning: { en: 'village', sa: 'ग्रामः' }, grammar: { type: 'पुंलिङ्ग', derivation: 'ग्रम् + घञ्' }, difficulty: 2 },
  { word: 'क्षेत्र', root: 'क्षि', meaning: { en: 'field', sa: 'क्षेत्रम्' }, grammar: { type: 'नपुंसकलिङ्ग', derivation: 'क्षि + ष्ट्रन्' }, difficulty: 3 },
  { word: 'सभा', root: 'सभा', meaning: { en: 'assembly', sa: 'सभा' }, grammar: { type: 'स्त्रीलिङ्ग', derivation: 'सभा' }, difficulty: 2 },
  { word: 'आश्रम', root: 'श्रम्', meaning: { en: 'hermitage', sa: 'आश्रमः' }, grammar: { type: 'पुंलिङ्ग', derivation: 'आ + श्रम् + अच्' }, difficulty: 3 },
];

async function seedDictionary(): Promise<void> {
  try {
    await mongoose.connect(ENV.MONGO_URI);
    console.log('[Seed] Connected to MongoDB');

    // Clear existing entries
    await DictionaryModel.deleteMany({});
    console.log('[Seed] Cleared existing dictionary');

    // Normalize all words before inserting
    const normalizedWords = SEED_WORDS.map(w => ({
      ...w,
      word: w.word.normalize('NFC'),
      root: w.root.normalize('NFC'),
    }));

    await DictionaryModel.insertMany(normalizedWords);
    console.log(`[Seed] Inserted ${normalizedWords.length} words`);

    await mongoose.disconnect();
    console.log('[Seed] Done');
  } catch (err) {
    console.error('[Seed] Error:', err);
    process.exit(1);
  }
}

seedDictionary();
