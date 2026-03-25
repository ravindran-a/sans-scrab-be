import mongoose from "mongoose";
import { ENV } from "./env";

export async function connectDB(): Promise<void> {
  try {
    await mongoose.connect(ENV.MONGO_URI, {
      tls: true,
      tlsAllowInvalidCertificates: true,
    });
    console.log("[DB] MongoDB connected");
  } catch (err) {
    console.error("[DB] MongoDB connection error:", err);
    process.exit(1);
  }
}
