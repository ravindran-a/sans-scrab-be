import mongoose from "mongoose";
import { ENV } from "./env";

export async function connectDB(): Promise<void> {
  try {
    await mongoose.connect(ENV.MONGO_URI, {
      tls: true,
      tlsAllowInvalidCertificates: true,
      maxPoolSize: 30,
      minPoolSize: 3,
      maxIdleTimeMS: 30000,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    console.log("[DB] MongoDB connected");
  } catch (err) {
    console.error("[DB] MongoDB connection error:", err);
    process.exit(1);
  }
}
