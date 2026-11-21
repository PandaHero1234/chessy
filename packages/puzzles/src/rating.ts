/** Elo-Anpassung für Spieler- und Puzzle-Ratings. */
export function expectedScore(player: number, puzzle: number) {
  return 1 / (1 + 10 ** ((puzzle - player) / 400));
}

export function updateRatings(player: { rating: number; attempts: number }, puzzle: { rating: number; plays: number }, win: boolean) {
  const e = expectedScore(player.rating, puzzle.rating);
  const s = win ? 1 : 0;
  const kPlayer = player.attempts < 20 ? 40 : player.attempts < 100 ? 24 : 16;
  const kPuzzle = puzzle.plays < 10 ? 16 : 8;
  const clamp = (v: number) => Math.max(400, Math.min(3200, v));
  return {
    player: clamp(Math.round(player.rating + kPlayer * (s - e))),
    puzzle: clamp(Math.round(puzzle.rating + kPuzzle * (e - s))),
    delta: Math.round(kPlayer * (s - e)),
  };
}

export const START_RATING = 1200;
