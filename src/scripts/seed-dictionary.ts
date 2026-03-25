import fs from "fs";
import mongoose from "mongoose";
import path from "path";
import { ENV } from "../config/env";
import { DictionaryModel } from "../modules/dictionary/dictionary.model";

/**
 * Seed dictionary from Amarakosha CSV (file.csv).
 * Parses ~11.7k rows, deduplicates to ~9k unique Sanskrit words,
 * maps grammar types, assigns English meanings from headword mappings,
 * and bulk-inserts into MongoDB.
 */

// ─── Grammar type mapping ────────────────────────────────────────
const GRAMMAR_MAP: Record<string, string> = {
  "पुं.": "पुंलिङ्ग",
  "स्त्री.": "स्त्रीलिङ्ग",
  "नपुं.": "नपुंसकलिङ्ग",
  "अव्य.": "अव्यय",
  "पुं-नपुं.": "पुंलिङ्ग/नपुंसकलिङ्ग",
  "पुं-बहु.": "पुंलिङ्ग (बहुवचन)",
  "स्त्री-बहु.": "स्त्रीलिङ्ग (बहुवचन)",
  "नपुं-बहु.": "नपुंसकलिङ्ग (बहुवचन)",
  "वि.": "विशेषण",
};

// ─── Varga (section) to English ──────────────────────────────────
const VARGA_EN: Record<string, string> = {
  स्वर्गवर्गः: "celestial",
  व्योमवर्गः: "nature & elements",
  दिग्वर्गः: "directions & space",
  कालवर्गः: "time & seasons",
  धीवर्गः: "intellect & mind",
  शब्दादिवर्गः: "sound & senses",
  क्षत्रियवर्गः: "warrior & state",
  पातालभोगिवर्गः: "underworld & serpents",
  विशेष्यनिघ्नवर्गः: "qualities & attributes",
  अव्ययवर्गः: "indeclinables",
  मनुष्यवर्गः: "human & society",
  ब्रह्मवर्गः: "sacred & divine",
  वैश्यवर्गः: "trade & agriculture",
  शूद्रवर्गः: "arts & crafts",
  नानार्थवर्गः: "miscellaneous",
  सङ्कीर्णवर्गः: "mixed",
  वनौषधिवर्गः: "plants & herbs",
  सिंहादिवर्गः: "animals",
};

// ─── Headword → English meaning mapping ─────────────────────────
// Covers the most frequent headwords from the Amarakosha.
// Words whose headword is not found here fall back to the varga category.
const HEADWORD_EN: Record<string, string> = {
  // Celestial & Divine
  स्वर्गः: "heaven",
  देवः: "god/deity",
  देवयोनिः: "celestial being",
  गणदेवता: "group deity",
  असुरः: "demon",
  राक्षसः: "demon (rakshasa)",
  नरकः: "hell",

  // Major deities
  विष्णुः: "Vishnu",
  शिवः: "Shiva",
  ब्रह्मा: "Brahma",
  इन्द्रः: "Indra",
  कार्तिकेयः: "Kartikeya",
  गणेशः: "Ganesha",
  यमः: "Yama (god of death)",
  कुबेरः: "Kubera (god of wealth)",
  वरुणः: "Varuna",
  कामदेवः: "Kamadeva (god of love)",
  बलभद्रः: "Balarama",
  बृहस्पतिः: "Brihaspati",
  शनीः: "Shani (Saturn)",
  गरुडः: "Garuda",

  // Goddesses
  पार्वती: "Parvati",
  लक्ष्मी: "Lakshmi",
  सरस्वती: "Saraswati",
  शक्तिदेवता: "Shakti deity",

  // Vishnu attributes
  विष्णुचापः: "bow of Vishnu",
  विष्णुशङ्खः: "conch of Vishnu",
  विष्णुचक्रम्: "discus of Vishnu",
  विष्णुलाञ्छनम्: "emblem of Vishnu",
  अनिरुद्धः: "Aniruddha",
  अश्विनीकुमारौ: "Ashvini Kumaras",

  // Nature & Elements
  सूर्यः: "sun",
  चन्द्रः: "moon",
  आकाशः: "sky/space",
  वायुः: "wind",
  अग्निः: "fire",
  जलम्: "water",
  भूमिः: "earth/land",
  मेघः: "cloud",
  किरणः: "ray/beam",
  प्रभा: "light/radiance",
  तडित्: "lightning",
  हिमम्: "snow/ice",
  रात्रिः: "night",
  दिवसः: "day",
  प्रत्यूषः: "dawn",

  // Geography & Nature
  पर्वतः: "mountain",
  समुद्रः: "ocean",
  नदी: "river",
  वनम्: "forest",
  गङ्गा: "Ganga river",
  बिलम्: "hole/cave",
  नगरम्: "city",
  मार्गः: "path/road",
  गृहम्: "house",

  // Living beings
  सर्पः: "snake/serpent",
  पक्षी: "bird",
  पक्षिजातिविशेषः: "species of bird",
  हस्तिः: "elephant",
  अश्वः: "horse",
  सिंहः: "lion",
  गौः: "cow",
  वानरः: "monkey",
  वराहः: "boar",
  मत्स्यः: "fish",
  मयूरः: "peacock",
  काकः: "crow",
  भ्रमरः: "bee/beetle",
  मूषकः: "mouse/rat",
  वृषभः: "bull",
  मेषः: "ram/sheep",
  हरिणः: "deer",
  उलूकः: "owl",
  शुनकः: "dog",
  मण्डूकः: "frog",
  मृगभेदः: "type of deer/animal",
  अजिनजातीयमृगः: "hide-bearing animal",
  जम्भूकः: "jackal",

  // Trees & Plants
  वृक्षः: "tree",
  पद्मम्: "lotus",
  शतावरी: "shatavari plant",
  पिप्पली: "long pepper",
  एरण्डः: "castor plant",
  नीली: "indigo plant",
  हरीतकी: "haritaki (medicinal fruit)",
  कुङ्कुमम्: "saffron",
  प्रियङ्गुवृक्षः: "priyangu tree",
  शोणकः: "shonaka tree",
  वेणुः: "bamboo",
  वेतसः: "cane/rattan",
  देवदारुवृक्षः: "deodar tree",
  राजवृक्षः: "royal tree",
  प्रफुल्लितवृक्षः: "blossoming tree",

  // Medicinal herbs
  गुडूची: "giloy (herb)",
  मञ्जिष्टा: "manjishtha (herb)",
  मूर्वा: "murva (herb)",
  कण्टकारिका: "thorny nightshade",
  स्पृक्का: "sprikka plant",
  मूषिकपर्णी: "mushikaparni (herb)",
  वीरणमूलम्: "vetiver root",
  धन्वयासः: "dhanvayasa (herb)",
  पाटा: "pata (herb)",
  कटुरोहिणी: "kutki (herb)",
  अतिविषा: "ativisha (herb)",
  अपामार्गः: "apamarga (herb)",
  बाकुची: "bakuchi (herb)",
  रास्ना: "rasna (herb)",
  सिंहिपुच्छी: "simhipuchchi (herb)",
  भार्गी: "bhargi (herb)",
  सल्लकी: "sallaki (herb)",
  शतपुष्पा: "dill plant",
  मर्कटी: "markati plant",
  सीहुण्डः: "euphorbia plant",
  कैवर्तीमुस्तकम्: "kaivartimustaka (herb)",
  शीतलद्रव्यम्: "cooling substance",
  स्थावरविषभेदाः: "plant-based poison",
  तृणविशेषः: "type of grass",

  // People & Society
  राजा: "king",
  स्त्री: "woman",
  स्त्रीविशेषः: "type of woman",
  पत्नी: "wife",
  शिशुः: "child",
  दासः: "servant",
  ब्राह्मणः: "brahmin",
  मनुष्यः: "human",
  वणिक्: "merchant",
  चोरः: "thief",
  चण्डालः: "outcaste",
  सारथिः: "charioteer",
  गोपालः: "cowherd",
  चारपुरुषः: "spy",
  ज्यौतिषिकः: "astrologer",
  कामुकः: "lustful person",
  सगोत्रः: "kinsman",
  विद्वान्: "learned person",
  मूर्खः: "fool",
  वृद्धः: "elder",
  रजस्वला: "menstruating woman",
  स्वैरिणी: "independent woman",
  अधिपतिः: "ruler/chief",
  बुद्धः: "Buddha/enlightened one",
  शाक्यः: "Shakya/Buddhist",
  जीवकः: "living being",

  // Body & Health
  देहः: "body",
  नेत्रम्: "eye",
  केशः: "hair",
  शिरः: "head",
  रोगः: "disease",

  // War & Weapons
  युद्धम्: "battle/war",
  बाणः: "arrow",
  खड्गः: "sword",
  सेना: "army",
  सन्नाहः: "armor",
  शराधारः: "quiver",
  कामबाणः: "arrow of Kama",

  // Abstract Concepts
  मारणम्: "killing/death",
  मरणम्: "death",
  दुःखम्: "suffering/sorrow",
  आनन्दः: "bliss/joy",
  शब्दः: "sound/word",
  स्पृहा: "desire/longing",
  बुद्धिः: "intellect",
  कोपः: "anger",
  मदः: "intoxication/pride",
  भयानकरसः: "fearful sentiment",
  करुणरसः: "compassionate sentiment",
  कीर्तिः: "fame/glory",
  सिद्धिः: "accomplishment",
  मोक्षः: "liberation",
  नीतिः: "ethics/policy",
  शोभा: "beauty/splendor",
  जुगुप्सा: "disgust/contempt",
  परिभवः: "insult/humiliation",
  स्वभावः: "nature/temperament",
  मर्यादा: "boundary/propriety",
  शापवचनम्: "curse",

  // Qualities & Attributes
  अतिशयः: "excellence/excess",
  श्रेष्ठम्: "best/excellent",
  शुभम्: "auspicious",
  मनोरमम्: "delightful",
  अधमम्: "lowest/worst",
  पापम्: "sin/evil",
  कपटः: "deceit/fraud",
  कठिनम्: "hard/tough",
  सूक्ष्मम्: "subtle/fine",
  शुक्लवर्णः: "white color",
  कृष्णवर्णः: "black color",
  रक्तम्: "red/blood",
  कपिलवर्णः: "tawny color",
  वक्रम्: "crooked/curved",
  बहुलम्: "abundant",
  समग्रम्: "complete/whole",
  अल्पम्: "small/little",
  शीघ्रम्: "swift/quick",
  विस्तृतम्: "expanded/wide",
  नीचः: "low/base",
  कुशलः: "skillful",
  अलसः: "lazy/idle",
  ह्रस्वः: "short/small",
  सदृशः: "similar/alike",
  यथेप्सितम्: "as desired",

  // Actions & States
  दानम्: "giving/charity",
  याचनम्: "begging/requesting",
  चलनम्: "movement",
  अन्तर्धानम्: "disappearance",
  पलायनम्: "flight/escape",
  वचनम्: "speech/utterance",
  भक्षितम्: "eaten/consumed",
  स्तुतम्: "praised",
  स्तुतिः: "praise/hymn",
  अङ्गीकारः: "acceptance",
  अङ्गीकृतम्: "accepted",
  जननम्: "birth",
  बद्धः: "bound/tied",
  खण्डितम्: "broken/divided",
  आरम्भः: "beginning",
  आज्ञा: "command/order",
  प्रतिमा: "image/idol",
  भेदः: "difference/division",
  अविरतम्: "continuous",
  तत्क्षणम्: "instantly",
  सामर्थ्यम्: "ability/power",
  परिमाणः: "measurement",
  वेगः: "speed/force",
  वेतनम्: "wages/salary",
  प्रश्नः: "question",

  // Objects & Places
  द्रव्यम्: "substance/material",
  वस्त्रम्: "cloth/garment",
  सुवर्णम्: "gold",
  लोहः: "iron/metal",
  चिह्नम्: "mark/sign",
  सभा: "assembly/court",
  समूहः: "group/collection",
  विशेषनिधिः: "special treasure",
  वंशः: "dynasty/lineage",
  नाम: "name",
  सिद्धान्नम्: "cooked food",
  काञ्जिकम्: "fermented rice water",
  नक्षत्रम्: "constellation/star",
  शची: "Shachi (Indra's wife)",
  अमावासी: "new moon day",
  संवत्सरः: "year",

  // Concepts with underscore separators
  समीपः: "nearness/proximity",
  शत्रुः: "enemy",
  सुरा: "liquor/wine",
  विजनः: "solitary/deserted",
  कारणम्: "cause/reason",
  ग्रीष्मऋतुः: "summer season",
  नवरसेष्वेकः: "one of the nine rasas",
  पुरीषम्: "excrement",

  // Religious & Ritual
  यज्ञः: "sacrifice/ritual",

  // Complex headwords (underscore-separated phrases)
  इन्द्रस्य_वज्रायुधम्: "Indra's thunderbolt",
  प्राक्तनशुभाशुभकर्मः: "past karma (good & bad)",
  रविचन्द्रबिम्बम्: "disc of sun/moon",
  अत्यन्धकाररात्रिः: "extremely dark night",
  घृताचीनामाप्सरा: "apsara named Ghritachi",
  तिलोत्तमानामाप्सरा: "apsara named Tilottama",
  अदृष्टचन्द्रामावासी: "moonless new moon",
  परमा_शोभा: "supreme beauty",
  नरकस्थ_नदी: "river of hell",
  विष्णोः_मणिः: "gem of Vishnu",
  विष्णोः_अश्वः: "horse of Vishnu",
  विष्णोः_सारथिः: "charioteer of Vishnu",
  विष्णोः_मन्त्रिः: "minister of Vishnu",
  शिवस्य_जटाबन्धः: "matted hair of Shiva",
  कुबेरस्य_उद्यानम्: "garden of Kubera",
  राज्ञः_बाला: "king's daughter",
  ईशानदिशायाः_स्वामी: "lord of the northeast",
  नैरृत्यदिशायाः_स्वामी: "lord of the southwest",
  अग्नेः_निर्गतज्वाला: "flame from fire",
  मार्गपौषाभ्यां_निष्पन्नः_ऋतुः: "winter season",
  माघफाल्गुनाभ्यां_निष्पन्नः_ऋतुः: "cool season",
  श्रावणभाद्राभ्यां_निष्पन्नः_ऋतुः: "rainy season",
  आश्विनकार्तिकाभ्यां_निष्पन्नः_ऋतुः: "autumn season",
  ज्येष्ठाषाढाभ्याम्_ऋतुः: "hot season",
  स्त्रीणाम्_श्रृङ्गारभावजाः_क्रिया: "amorous gesture of women",
  दिवसः_पूर्वो_भागः: "forenoon",
  दिवसः_मध्यो_भागः: "midday",
  दिवसः_अन्त्यो_भागः: "afternoon",
  दिनद्वयमध्यगता_रात्रिः: "night between two days",
  बहुभिः_कृतः_महाध्वनिः: "great noise by many",
  युगपदुच्यमानौ_सूर्यचन्द्रौ: "sun and moon together",
  पूर्णचन्द्रसहिता_पूर्णिमा: "full moon with full moon",
  देवानां_राज्ञां_च_गृहम्: "palace of gods and kings",
  ससामर्थ्यम्_शत्रूणां_सम्मुखं_गतः: "one who bravely faces enemies",
  सजातीयैः_प्राणिभिरप्राणिभिर्वा_समूहः: "group of same kind",
  मनसः_सुखभोगे_तत्परता: "attachment to pleasure",
  भूमौ_वर्तमानं_रन्ध्रम्: "hole in the ground",
  द्वाभ्यामेव_कृत_मन्त्रः: "counsel by two",
  राहुग्रस्थेन्दुः_अथवा_सूर्यः: "eclipsed moon or sun",
  युद्धारम्भे_अन्ते_वा_पानकर्मः: "drinking at war's start or end",
  पित्रादेः_पुरतः_जातलज्जा: "shame before elders",
  सुतस्य_सुतायाः_वा_अपत्यः: "grandchild",
  पत्युर्वा_पत्न्याः_वा_माता: "mother-in-law",
  यस्य_यत्_ज्ञातः_तत्: "what is known to whom",
  "अरिष्टः-रीढा": "soapnut tree",
};

// ─── Parse CSV & build entries ───────────────────────────────────

interface CsvRow {
  word: string;
  grammar: string;
  varga: string;
  headword: string;
}

function parseCsv(csvPath: string): CsvRow[] {
  const content = fs.readFileSync(csvPath, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim());
  const rows: CsvRow[] = [];

  for (const line of lines) {
    const cols = line.split(",");
    if (cols.length < 6) continue;

    const word = cols[1]?.trim();
    const grammar = cols[3]?.trim();
    const varga = cols[4]?.trim();
    const headword = cols[5]?.trim();

    if (!word) continue;

    rows.push({ word, grammar, varga, headword });
  }

  return rows;
}

function getEnglishMeaning(headword: string, varga: string): string {
  // Direct mapping
  if (HEADWORD_EN[headword]) {
    return HEADWORD_EN[headword];
  }

  // Try varga-based fallback
  if (VARGA_EN[varga]) {
    return VARGA_EN[varga];
  }

  // Generic fallback
  return "Sanskrit word";
}

function mapGrammar(raw: string): string {
  return GRAMMAR_MAP[raw] || raw || "अज्ञात";
}

/**
 * Calculate difficulty 1-5 based on akshara (syllable) complexity.
 * Shorter, common words = easier; longer, complex words = harder.
 */
function calculateDifficulty(word: string): number {
  // Count approximate aksharas by counting vowel signs + independent vowels + consonant clusters
  // Simple heuristic: count Unicode code points minus combining marks, divided by ~2
  const codepoints = [...word];
  const len = codepoints.length;

  // Very short words (1-3 codepoints) → difficulty 1
  if (len <= 3) return 1;
  // Short words (4-6 codepoints) → difficulty 1-2
  if (len <= 6) return 1;
  // Medium words (7-10 codepoints) → difficulty 2
  if (len <= 10) return 2;
  // Longer words (11-15 codepoints) → difficulty 3
  if (len <= 15) return 3;
  // Long words (16-20 codepoints) → difficulty 4
  if (len <= 20) return 4;
  // Very long words → difficulty 5
  return 5;
}

async function seedDictionary(): Promise<void> {
  try {
    await mongoose.connect(ENV.MONGO_URI);
    console.log("[Seed] Connected to MongoDB");

    // Parse CSV
    const csvPath = path.resolve(__dirname, "../../file.csv");
    console.log(`[Seed] Reading CSV from ${csvPath}`);
    const rows = parseCsv(csvPath);
    console.log(`[Seed] Parsed ${rows.length} rows from CSV`);

    // Deduplicate: keep first occurrence of each word
    const seen = new Set<string>();
    const uniqueEntries: Array<{
      word: string;
      root: string;
      meaning: { en: string; sa: string };
      grammar: { type: string; derivation: string };
      difficulty: number;
    }> = [];

    for (const row of rows) {
      const normalized = row.word.normalize("NFC");
      if (seen.has(normalized)) continue;
      seen.add(normalized);

      uniqueEntries.push({
        word: normalized,
        root: normalized, // Use word as root since CSV doesn't provide separate roots
        meaning: {
          en: getEnglishMeaning(row.headword, row.varga),
          sa: row.headword || row.varga,
        },
        grammar: {
          type: mapGrammar(row.grammar),
          derivation: "",
        },
        difficulty: calculateDifficulty(normalized),
      });
    }

    console.log(
      `[Seed] ${uniqueEntries.length} unique words after deduplication`,
    );

    // Clear existing dictionary
    const deletedCount = await DictionaryModel.countDocuments();
    await DictionaryModel.deleteMany({});
    console.log(`[Seed] Cleared ${deletedCount} existing entries`);

    // Bulk insert in batches of 1000
    const BATCH_SIZE = 1000;
    let inserted = 0;
    for (let i = 0; i < uniqueEntries.length; i += BATCH_SIZE) {
      const batch = uniqueEntries.slice(i, i + BATCH_SIZE);
      await DictionaryModel.insertMany(batch, { ordered: false });
      inserted += batch.length;
      console.log(`[Seed] Inserted ${inserted}/${uniqueEntries.length} words`);
    }

    console.log(
      `[Seed] Successfully seeded ${uniqueEntries.length} dictionary entries`,
    );

    // Print some stats
    const difficultyStats = [1, 2, 3, 4, 5].map((d) => ({
      difficulty: d,
      count: uniqueEntries.filter((e) => e.difficulty === d).length,
    }));
    console.log("[Seed] Difficulty distribution:");
    difficultyStats.forEach((s) =>
      console.log(`  Level ${s.difficulty}: ${s.count} words`),
    );

    // Show sample entries
    console.log("\n[Seed] Sample entries:");
    uniqueEntries
      .slice(0, 5)
      .forEach((e) =>
        console.log(
          `  ${e.word} → ${e.meaning.en} (${e.meaning.sa}) [${e.grammar.type}] D:${e.difficulty}`,
        ),
      );

    await mongoose.disconnect();
    console.log("[Seed] Done");
  } catch (err) {
    console.error("[Seed] Error:", err);
    process.exit(1);
  }
}

seedDictionary();
