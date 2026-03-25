import mongoose, { Schema, Document } from 'mongoose';

export interface IDictionaryEntry extends Document {
  word: string;
  root: string;
  meaning: {
    en: string;
    sa: string;
  };
  grammar: {
    type: string;
    derivation: string;
  };
  difficulty: number;
}

const DictionarySchema = new Schema<IDictionaryEntry>(
  {
    word: { type: String, required: true, unique: true },
    root: { type: String, required: true },
    meaning: {
      en: { type: String, required: true },
      sa: { type: String, required: true },
    },
    grammar: {
      type: { type: String, required: true },
      derivation: { type: String, default: '' },
    },
    difficulty: { type: Number, required: true, min: 1, max: 5, default: 1 },
  },
  { timestamps: true }
);

DictionarySchema.index({ difficulty: 1 });
DictionarySchema.index({ root: 1 });

export const DictionaryModel = mongoose.model<IDictionaryEntry>('Dictionary', DictionarySchema);
