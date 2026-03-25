import { IUser, UserModel } from "../auth/auth.model";

const K_FACTOR = 32;

/**
 * Calculate expected score for player A against player B.
 */
function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/**
 * Update ELO ratings after a match.
 * Returns the rating changes for each player.
 */
export async function updateElo(
  winnerId: string,
  loserId: string,
  isDraw: boolean = false,
): Promise<{ winnerChange: number; loserChange: number }> {
  const winner = await UserModel.findById(winnerId);
  const loser = await UserModel.findById(loserId);

  if (!winner || !loser) {
    throw new Error("Player not found");
  }

  const expectedWinner = expectedScore(winner.elo, loser.elo);
  const expectedLoser = expectedScore(loser.elo, winner.elo);

  const actualWinner = isDraw ? 0.5 : 1;
  const actualLoser = isDraw ? 0.5 : 0;

  const winnerChange = Math.round(K_FACTOR * (actualWinner - expectedWinner));
  const loserChange = Math.round(K_FACTOR * (actualLoser - expectedLoser));

  winner.elo += winnerChange;
  winner.gamesPlayed += 1;
  if (!isDraw) winner.gamesWon += 1;

  loser.elo += loserChange;
  loser.gamesPlayed += 1;

  await Promise.all([winner.save(), loser.save()]);

  return { winnerChange, loserChange };
}

export async function getGlobalLeaderboard(
  limit: number = 50,
  offset: number = 0,
): Promise<IUser[]> {
  return UserModel.find()
    .sort({ elo: -1 })
    .skip(offset)
    .limit(limit)
    .select("username displayName elo gamesPlayed gamesWon avatar country");
}

export async function getCountryLeaderboard(
  country: string,
  limit: number = 50,
  offset: number = 0,
): Promise<IUser[]> {
  return UserModel.find({ country })
    .sort({ elo: -1 })
    .skip(offset)
    .limit(limit)
    .select("username displayName elo gamesPlayed gamesWon avatar country");
}

export async function getPlayerRank(userId: string): Promise<number> {
  const user = await UserModel.findById(userId);
  if (!user) throw new Error("User not found");

  const rank = await UserModel.countDocuments({ elo: { $gt: user.elo } });
  return rank + 1;
}

export const LeaderboardService = {
  updateElo,
  getGlobalLeaderboard,
  getCountryLeaderboard,
  getPlayerRank,
};
