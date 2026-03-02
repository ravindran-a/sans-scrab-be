import mongoose, { Schema, Document } from 'mongoose';
import bcrypt from 'bcryptjs';

export interface IUser extends Document {
  username: string;
  email: string;
  password: string;
  displayName: string;
  avatar: string;
  elo: number;
  gamesPlayed: number;
  gamesWon: number;
  subscription: 'free' | 'pro' | 'guru';
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  country: string;
  refreshToken?: string;
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidate: string): Promise<boolean>;
}

const UserSchema = new Schema<IUser>(
  {
    username: { type: String, required: true, unique: true, trim: true, minlength: 3, maxlength: 30 },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    password: { type: String, required: true, minlength: 6, select: false },
    displayName: { type: String, required: true, trim: true },
    avatar: { type: String, default: '' },
    elo: { type: Number, default: 1200 },
    gamesPlayed: { type: Number, default: 0 },
    gamesWon: { type: Number, default: 0 },
    subscription: { type: String, enum: ['free', 'pro', 'guru'], default: 'free' },
    stripeCustomerId: { type: String },
    stripeSubscriptionId: { type: String },
    country: { type: String, default: 'IN' },
    refreshToken: { type: String, select: false },
  },
  { timestamps: true }
);

UserSchema.index({ elo: -1 });
UserSchema.index({ country: 1, elo: -1 });

UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

UserSchema.methods.comparePassword = async function (candidate: string): Promise<boolean> {
  return bcrypt.compare(candidate, this.password);
};

export const UserModel = mongoose.model<IUser>('User', UserSchema);
