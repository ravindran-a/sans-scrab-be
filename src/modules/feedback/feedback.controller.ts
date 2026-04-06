import { Request, Response, Router } from "express";
import { z } from "zod";
import { FeedbackModel } from "./feedback.model";

const router = Router();

const feedbackSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email().max(200).optional().or(z.literal("")),
  phone: z.string().max(20).optional().or(z.literal("")),
  category: z.enum([
    "bug",
    "feature",
    "improvement",
    "ui",
    "gameplay",
    "general",
  ]),
  rating: z.number().min(1).max(5),
  experienceRating: z.number().min(1).max(5),
  message: z.string().min(10).max(2000),
  suggestions: z.string().max(2000).optional().or(z.literal("")),
  issues: z.string().max(2000).optional().or(z.literal("")),
  favoriteFeature: z.string().max(500).optional().or(z.literal("")),
  userId: z.string().optional(),
  isGuest: z.boolean().optional(),
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const data = feedbackSchema.parse(req.body);
    const feedback = await FeedbackModel.create({
      name: data.name,
      email: data.email || undefined,
      phone: data.phone || undefined,
      category: data.category,
      rating: data.rating,
      experienceRating: data.experienceRating,
      message: data.message,
      suggestions: data.suggestions || undefined,
      issues: data.issues || undefined,
      favoriteFeature: data.favoriteFeature || undefined,
      userId: data.userId,
      isGuest: data.isGuest || false,
    });
    return res.status(201).json({ feedback: { id: feedback._id } });
  } catch (err: any) {
    if (err.name === "ZodError") {
      return res
        .status(400)
        .json({ error: "Validation error", details: err.errors });
    }
    return res.status(400).json({ error: err.message });
  }
});

export const feedbackRouter = router;
