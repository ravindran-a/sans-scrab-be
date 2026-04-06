import mongoose, { Document, Schema } from "mongoose";

export interface IFeedback extends Document {
  name: string;
  email?: string;
  phone?: string;
  category: "bug" | "feature" | "improvement" | "ui" | "gameplay" | "general";
  rating: number;
  experienceRating: number;
  message: string;
  suggestions?: string;
  issues?: string;
  favoriteFeature?: string;
  userId?: string;
  isGuest: boolean;
  createdAt: Date;
}

const FeedbackSchema = new Schema<IFeedback>(
  {
    name: { type: String, required: true, maxlength: 100 },
    email: { type: String, maxlength: 200 },
    phone: { type: String, maxlength: 20 },
    category: {
      type: String,
      enum: ["bug", "feature", "improvement", "ui", "gameplay", "general"],
      default: "general",
    },
    rating: { type: Number, min: 1, max: 5, required: true },
    experienceRating: { type: Number, min: 1, max: 5, required: true },
    message: { type: String, required: true, maxlength: 2000 },
    suggestions: { type: String, maxlength: 2000 },
    issues: { type: String, maxlength: 2000 },
    favoriteFeature: { type: String, maxlength: 500 },
    userId: { type: String },
    isGuest: { type: Boolean, default: false },
  },
  { timestamps: true },
);

FeedbackSchema.index({ createdAt: -1 });
FeedbackSchema.index({ category: 1 });

export const FeedbackModel = mongoose.model<IFeedback>(
  "Feedback",
  FeedbackSchema,
);
