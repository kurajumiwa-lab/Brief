/**
 * THE BALANCED VERDICT — the ranking, written down and shown to the user.
 *
 * The product promise is that the community decides what matters, and that the
 * rule is *visible*. So the score is not a mystery number: it is four
 * components, each between 0 and 1, added with published weights. The Verdict
 * panel renders exactly these numbers — the same function that sorts the feed
 * draws the explanation, which means the explanation cannot drift from the
 * behaviour.
 *
 *   score = 0.50 × confidence      Wilson lower bound of support
 *         + 0.20 × participation   log-scaled reaction volume, capped
 *         + 0.15 × recency         half-life decay
 *         + 0.15 × circle fit      is this one of your communities
 *
 * Three properties matter more than the ordering:
 *
 * 1. **Small samples cannot swing it.** `confidence` is the Wilson lower bound,
 *    not the raw share. Two thumbs-up out of two is 100% support and a
 *    confidence of ~0.34 — the feed waits for the community rather than letting
 *    the first arrivals decide.
 *
 * 2. **Dissent is never erasure.** A post is *contested* once it has enough
 *    reactions and at least a third disagree. Contested posts keep a score
 *    floor, so they stay in the feed, labelled, with a link to the verdict.
 *    Disagreement lowers reach; it does not delete speech. Only moderation
 *    removes a post, and moderation is a separate system (see Safety).
 *
 * 3. **Coordinated bursts are damped, not banned.** If a third of a post's
 *    reactions land inside sixty seconds, those reactions count at half weight
 *    and the panel says so. The people who reacted are not punished, the post is
 *    not removed, and an honest crowd that simply arrived at once loses very
 *    little.
 */

/** Published constants. The UI prints these, so they are not a private dial. */
export const RANKING = {
  weights: { confidence: 0.5, participation: 0.2, recency: 0.15, circle: 0.15 },
  /** Reaction volume stops earning credit past this many weighted reactions. */
  participationCap: 40,
  /** A post is contested at this much participation… */
  contestedMinReactions: 8,
  /** …and this share of it disagreeing. */
  contestedDissentShare: 0.34,
  /**
   * Contested posts never fall below this, whatever their support. A quarter
   * is deliberately small: the promise is that disagreement cannot push a post
   * to the bottom of the feed *by itself*, not that an unpopular view gets a
   * good score. It stays visible and labelled; it does not get promoted.
   */
  contestedFloor: 0.25,
  /** Ranking half-life, in hours. */
  halfLifeHours: 12,
  /** Burst detection: window length, minimum share, and damping factor. */
  burstWindowMs: 60_000,
  burstShare: 0.3,
  burstMinCount: 5,
  burstDamping: 0.5,
  /** An account outside a circle still counts, at this fraction. */
  outsiderWeight: 0.7,
  /** A brand-new account counts at this fraction until it has history. */
  newAccountWeight: 0.85,
};

const clamp01 = (n) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));

/**
 * Wilson score interval, lower bound — the standard "how sure can we be, given
 * this many observations" estimator. 95% confidence.
 */
export function wilsonLower(support, total, z = 1.96) {
  if (!total || total <= 0) return 0;
  const p = support / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const centre = p + z2 / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total);
  return clamp01((centre - margin) / denominator);
}

/**
 * The largest cluster of reactions inside one window, if it is big enough to
 * look coordinated. Returns the ids of the reactions in that window.
 */
export function burstWindow(reactions = [], {
  windowMs = RANKING.burstWindowMs,
  share = RANKING.burstShare,
  minCount = RANKING.burstMinCount,
} = {}) {
  const ordered = [...reactions].sort((a, b) => a.at - b.at);
  let best = { ids: [], count: 0 };
  for (let start = 0; start < ordered.length; start += 1) {
    const from = ordered[start].at;
    const ids = [];
    for (let end = start; end < ordered.length; end += 1) {
      if (ordered[end].at - from > windowMs) break;
      ids.push(ordered[end].id ?? `${ordered[end].userId}:${ordered[end].at}`);
    }
    if (ids.length > best.count) best = { ids, count: ids.length };
  }
  const total = ordered.length;
  const suspected = total >= minCount && best.count >= Math.max(minCount, Math.ceil(total * share));
  return {
    suspected,
    count: best.count,
    total,
    share: total ? best.count / total : 0,
    ids: new Set(suspected ? best.ids : []),
  };
}

/**
 * Everything the Verdict panel needs about one post's community feedback.
 *
 * @param {object} post
 * @param {object} context
 * @param {Record<string, object>} context.usersById  account standing
 * @param {Set<string>} context.circleMemberIds      members of the post's circle
 * @param {number} context.now                       epoch ms
 */
export function computeVerdict(post, { usersById = {}, circleMemberIds = null, now = Date.now() } = {}) {
  const reactions = Array.isArray(post?.reactions) ? post.reactions : [];
  const burst = burstWindow(reactions);

  let up = 0;
  let down = 0;
  let weightedUp = 0;
  let weightedDown = 0;

  for (const reaction of reactions) {
    const id = reaction.id ?? `${reaction.userId}:${reaction.at}`;
    const user = usersById[reaction.userId];
    // Account standing: a newcomer's first reaction is worth a little less
    // than an established member's, and an outsider's a little less again.
    const standing = user && user.reactionsGiven >= 3 ? 1 : RANKING.newAccountWeight;
    const inCircle = circleMemberIds ? circleMemberIds.has(reaction.userId) : true;
    const place = inCircle ? 1 : RANKING.outsiderWeight;
    const damping = burst.ids.has(id) ? RANKING.burstDamping : 1;
    const weight = standing * place * damping;

    if (reaction.value === "up") {
      up += 1;
      weightedUp += weight;
    } else {
      down += 1;
      weightedDown += weight;
    }
  }

  const participation = up + down;
  const weightedParticipation = weightedUp + weightedDown;
  const agreement = participation ? up / participation : 0;
  const confidence = wilsonLower(up, participation);
  const dissentShare = participation ? down / participation : 0;
  const contested = participation >= RANKING.contestedMinReactions && dissentShare >= RANKING.contestedDissentShare;

  return {
    up,
    down,
    participation,
    weightedUp: round(weightedUp),
    weightedDown: round(weightedDown),
    weightedParticipation: round(weightedParticipation),
    agreement,
    confidence,
    dissentShare,
    contested,
    coordination: {
      suspected: burst.suspected,
      count: burst.count,
      total: burst.total,
      share: burst.share,
      factor: burst.suspected ? RANKING.burstDamping : 1,
    },
    /** How much of the sample is still missing before confidence settles. */
    needsMoreVoices: participation < RANKING.contestedMinReactions,
    at: now,
  };
}

/** One post's rank, plus the exact parts that produced it. */
export function scorePost(post, { verdict, viewerCircleIds = new Set(), now = Date.now() } = {}) {
  const v = verdict ?? computeVerdict(post, { now });
  const ageHours = Math.max(0, (now - new Date(post.createdAt).getTime()) / 3_600_000);

  const confidence = clamp01(v.confidence);
  const participation = clamp01(
    Math.log1p(v.weightedParticipation) / Math.log1p(RANKING.participationCap)
  );
  const recency = clamp01(Math.pow(0.5, ageHours / RANKING.halfLifeHours));
  const circle = viewerCircleIds.has(post.circleId) ? 1 : 0.35;

  const w = RANKING.weights;
  const raw = w.confidence * confidence + w.participation * participation + w.recency * recency + w.circle * circle;
  const score = v.contested ? Math.max(raw, RANKING.contestedFloor) : raw;

  return {
    score: round(score),
    raisedByFloor: v.contested && score > raw,
    parts: {
      confidence: round(confidence),
      participation: round(participation),
      recency: round(recency),
      circle: round(circle),
    },
  };
}

/**
 * Sort a set of posts. Nothing is ever filtered out by reaction count — the
 * caller decides visibility from blocks, mutes and moderation, and this
 * function only decides *order*. That separation is the promise, in code.
 */
export function rankPosts(posts, { usersById = {}, viewerCircleIds = new Set(), now = Date.now() } = {}) {
  return posts
    .map((post) => {
      const verdict = computeVerdict(post, { usersById, now });
      const rank = scorePost(post, { verdict, viewerCircleIds, now });
      return { post, verdict, ...rank };
    })
    .sort((a, b) => b.score - a.score || b.post.createdAt.localeCompare(a.post.createdAt));
}

/** The one-line reason a card shows before the user opens the full panel. */
export function whyThisAppears(entry, viewerCircleIds = new Set()) {
  const { post, verdict, parts } = entry;
  if (verdict.contested) {
    return {
      tone: "terra",
      text: `${verdict.participation} reactions · ${Math.round(verdict.dissentShare * 100)}% disagree. Shown because the community is still arguing — dissent never hides a post.`,
    };
  }
  if (verdict.needsMoreVoices) {
    return {
      tone: "quiet",
      text: `Only ${verdict.participation} ${verdict.participation === 1 ? "reaction" : "reactions"} so far. A small sample does not decide anything here.`,
    };
  }
  if (viewerCircleIds.has(post.circleId)) {
    return {
      tone: "quiet",
      text: `You are in this circle · ${Math.round(parts.confidence * 100)}% confidence from ${verdict.participation} reactions.`,
    };
  }
  return {
    tone: "quiet",
    text: `Outside your circles, but the community is ${Math.round(verdict.confidence * 100)}% confident across ${verdict.participation} reactions.`,
  };
}

function round(n, places = 3) {
  return Math.round(n * 10 ** places) / 10 ** places;
}

export default { RANKING, wilsonLower, burstWindow, computeVerdict, scorePost, rankPosts, whyThisAppears };
