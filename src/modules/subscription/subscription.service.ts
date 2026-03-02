import Stripe from 'stripe';
import { ENV } from '../../config/env';
import { UserModel } from '../auth/auth.model';

const stripe = new Stripe(ENV.STRIPE_SECRET_KEY, { apiVersion: '2024-12-18.acacia' as any });

export const PLANS = {
  free: {
    name: 'Free',
    multiplayerGamesPerDay: 3,
    aiMaxLevel: 1,
    ranked: false,
    tournaments: false,
    wordMeanings: false,
    analytics: false,
  },
  pro: {
    name: 'Pro',
    priceId: 'price_pro_monthly',
    multiplayerGamesPerDay: Infinity,
    aiMaxLevel: 3,
    ranked: true,
    tournaments: false,
    wordMeanings: false,
    analytics: false,
  },
  guru: {
    name: 'Guru',
    priceId: 'price_guru_monthly',
    multiplayerGamesPerDay: Infinity,
    aiMaxLevel: 3,
    ranked: true,
    tournaments: true,
    wordMeanings: true,
    analytics: true,
  },
} as const;

export type PlanKey = keyof typeof PLANS;

export async function createCheckoutSession(
  userId: string,
  plan: 'pro' | 'guru'
): Promise<string> {
  const user = await UserModel.findById(userId);
  if (!user) throw new Error('User not found');

  let customerId = user.stripeCustomerId;

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { userId: user._id.toString() },
    });
    customerId = customer.id;
    user.stripeCustomerId = customerId;
    await user.save();
  }

  const priceId = PLANS[plan].priceId;

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    payment_method_types: ['card'],
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${ENV.CORS_ORIGIN}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${ENV.CORS_ORIGIN}/subscription/cancel`,
    metadata: { userId: user._id.toString(), plan },
  });

  return session.url || '';
}

export async function handleWebhook(
  payload: Buffer,
  signature: string
): Promise<void> {
  const event = stripe.webhooks.constructEvent(
    payload,
    signature,
    ENV.STRIPE_WEBHOOK_SECRET
  );

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.userId;
      const plan = session.metadata?.plan as PlanKey;
      if (userId && plan) {
        await UserModel.findByIdAndUpdate(userId, {
          subscription: plan,
          stripeSubscriptionId: session.subscription as string,
        });
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;
      const user = await UserModel.findOne({ stripeSubscriptionId: subscription.id });
      if (user) {
        user.subscription = 'free';
        user.stripeSubscriptionId = undefined;
        await user.save();
      }
      break;
    }

    case 'customer.subscription.updated': {
      const subscription = event.data.object as Stripe.Subscription;
      const user = await UserModel.findOne({ stripeSubscriptionId: subscription.id });
      if (user && subscription.status === 'active') {
        // Keep current plan
      } else if (user && subscription.status !== 'active') {
        user.subscription = 'free';
        await user.save();
      }
      break;
    }
  }
}

export async function getSubscriptionStatus(userId: string): Promise<{
  plan: PlanKey;
  features: typeof PLANS[PlanKey];
}> {
  const user = await UserModel.findById(userId);
  if (!user) throw new Error('User not found');

  const plan = user.subscription as PlanKey;
  return { plan, features: PLANS[plan] };
}

export async function checkFeatureAccess(
  userId: string,
  feature: keyof typeof PLANS['free']
): Promise<boolean> {
  const { features } = await getSubscriptionStatus(userId);
  return !!features[feature];
}

export const SubscriptionService = {
  createCheckoutSession,
  handleWebhook,
  getSubscriptionStatus,
  checkFeatureAccess,
  PLANS,
};
