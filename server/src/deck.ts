/**
 * The order games are dealt in.
 *
 * Two jobs pull against each other. Early on the deck should spread out across the library, and
 * the players should not be looking at the same game, so nobody agrees on the first thing they
 * see. Later it should converge, or a night ends with eighty swipes and no match. So the deck
 * runs in three stages: five cards nobody else is being shown, then weighted randomness, then
 * the same weighting with a thumb on the scale for games that are one "yes" away from a match.
 */

/** Cards at the start of a round that are yours alone. */
export const OPENING_CARDS = 5;

/** From the tenth card, games the others already liked start being pushed forward. */
export const MATCH_BONUS_FROM = 9;

/** BGG says this is the best count for tonight's group. */
const BEST_WITH = 2.2;
/** BGG says it works at this count, without being the sweet spot. */
const RECOMMENDED_WITH = 1.4;
/** Extra weight for a game you have never voted on, tapering in over STALE_DAYS. */
const UNSEEN = 1.5;
const STALE_DAYS = 120;
/** Somebody else already said yes and nobody has said no. */
const NEARLY_A_MATCH = 3;

export interface Candidate {
  id: number;
  bestPlayers: number[];
  recommendedPlayers: number[];
  /** When the player being dealt to last voted on this game, ever. Null if never. */
  lastVotedAt: string | null;
  /** Decisions the other players in this round have already made on it. */
  likedByOthers: number;
  dislikedByOthers: number;
}

export interface DealContext {
  /** How many cards this player has already swiped in this round. */
  position: number;
  playerCount?: number;
  now?: number;
}

/**
 * How much more often than a plain game this one should come up. Multiplicative, so a game that
 * is both ideal for tonight and long unseen beats one that is only ideal.
 */
export function weightFor(candidate: Candidate, context: DealContext): number {
  let weight = 1;

  if (context.playerCount !== undefined) {
    if (candidate.bestPlayers.includes(context.playerCount)) weight *= BEST_WITH;
    else if (candidate.recommendedPlayers.includes(context.playerCount)) weight *= RECOMMENDED_WITH;
  }

  weight *= 1 + UNSEEN * stalenessOf(candidate.lastVotedAt, context.now ?? Date.now());

  if (context.position >= MATCH_BONUS_FROM && candidate.likedByOthers > 0 && candidate.dislikedByOthers === 0) {
    weight *= NEARLY_A_MATCH;
  }

  return weight;
}

/** 0 for a game just voted on, rising to 1 at STALE_DAYS and for one never voted on at all. */
function stalenessOf(lastVotedAt: string | null, now: number): number {
  if (!lastVotedAt) return 1;
  // SQLite writes "YYYY-MM-DD HH:MM:SS" in UTC; Date needs telling.
  const voted = Date.parse(lastVotedAt.includes("T") ? lastVotedAt : `${lastVotedAt.replace(" ", "T")}Z`);
  if (Number.isNaN(voted)) return 1;
  const days = (now - voted) / 86_400_000;
  return Math.max(0, Math.min(days / STALE_DAYS, 1));
}

/**
 * A random order in which heavier games tend to come first, without ever being certain to.
 * Each game draws u^(1/weight) and the highest key wins — Efraimidis and Spirakis' weighted
 * sampling, which gives exactly "twice the weight, twice as likely to be next".
 */
export function weightedOrder<T>(items: T[], weightOf: (item: T) => number, random: () => number = Math.random): T[] {
  return items
    .map((item) => {
      const weight = Math.max(weightOf(item), 0.0001);
      return { item, key: Math.pow(random(), 1 / weight) };
    })
    .sort((a, b) => b.key - a.key)
    .map((entry) => entry.item);
}

/** Small deterministic PRNG, so an opening hand is the same on every refetch within a round. */
export function seededRandom(seed: number): () => number {
  let state = (seed + 0x6d2b79f5) | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Hands each player their own opening cards, with no game given to two players. Dealt round
 * robin from one shuffle, so a short library degrades into fewer cards each rather than into
 * overlap — with no overlap, nobody can match before everyone is past their opening.
 *
 * Seeded by the round, so the same player is dealt the same opening hand every time the deck is
 * refetched, and every player's client agrees on who got what.
 */
export function openingHands(gameIds: number[], playerIds: number[], seed: number): Map<number, number[]> {
  const hands = new Map<number, number[]>(playerIds.map((id) => [id, []]));
  if (playerIds.length === 0) return hands;

  const random = seededRandom(seed);
  const shuffled = [...gameIds].sort((a, b) => a - b);
  // Fisher-Yates with the seeded source.
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  for (let i = 0; i < shuffled.length && i < playerIds.length * OPENING_CARDS; i++) {
    hands.get(playerIds[i % playerIds.length])!.push(shuffled[i]);
  }
  return hands;
}
