/**
 * THE ADAPTER — server rows in, the same entry shape the cards already render.
 *
 * The point of this file is that there is exactly one of it. The feed, the
 * verdict panel, the ranking explanation and the data-saver all keep their
 * existing contract; only where the numbers come from changes.
 *
 * The conversion is deliberately dumb — rename, and reshape. Anything that
 * looks like a decision (which posts are visible, what the score is, whether a
 * post is contested) was already decided by the server, and re-deciding it here
 * would be the client second-guessing the thing that is supposed to be
 * authoritative.
 */
import { whyThisAppears } from "./ranking.js";

/** Server verdict (snake_case) → the shape the panel and card read. */
export function toVerdict(verdict) {
  const participation = verdict.participation || 0;
  return {
    up: verdict.up,
    down: verdict.down,
    participation,
    // The three weighted figures are the server's when it sends them; when it
    // sends counts only, the counts are the honest fallback — never zero-filled.
    weightedUp: verdict.weighted_up ?? verdict.up,
    weightedDown: verdict.weighted_down ?? verdict.down,
    weightedParticipation: verdict.weighted_participation ?? participation,
    agreement: verdict.agreement ?? (participation ? verdict.up / participation : 0),
    confidence: verdict.confidence,
    dissentShare: verdict.dissent_share,
    contested: verdict.contested,
    coordination: verdict.coordination,
    needsMoreVoices: verdict.needs_more_voices,
  };
}

/**
 * One ranked feed row → one `entry` the components understand.
 *
 * `post.reactions` carries only the viewer's own reaction: the card needs to
 * know which button is pressed, and shipping every reaction in the network to
 * every client would be both expensive and a privacy question nobody asked.
 */
export function toEntry(item) {
  const post = item.post;
  const verdict = toVerdict(item.verdict);
  const mine = item.my_reaction
    ? [{ id: "mine", userId: "viewer", value: item.my_reaction, at: Date.now() }]
    : [];

  const entry = {
    post: {
      id: post.id,
      circleId: post.circle_id,
      authorId: post.author.id,
      body: post.body,
      lang: post.lang,
      image: post.image_url || null,
      imageAlt: "",
      voice: null,
      dataKb: post.data_kb,
      createdAt: post.created_at,
      status: post.status,
      reactions: mine,
    },
    verdict,
    score: item.score,
    parts: item.parts,
    raisedByFloor: item.raised_by_floor,
    author: post.author,
    authorName: post.author?.display_name || post.author?.handle || "Member",
    circleFollowing: Boolean(item.circle_following),
    viewerReaction: item.my_reaction || null,
  };

  // The same explanation function the local feed uses, fed the server's
  // membership answer — so a live card and a demo card explain themselves in
  // identical words.
  entry.why = whyThisAppears(entry, new Set(item.circle_following ? [post.circle_id] : []));
  return entry;
}

/** The whole feed response, in one call, dropping anything malformed. */
export function toEntries(payload) {
  if (!Array.isArray(payload)) return [];
  return payload.filter((item) => item && item.post && item.verdict).map(toEntry);
}

/** What a post created through the API looks like in the feed's vocabulary. */
export function toPostedEntry(post, account) {
  return {
    id: post.id,
    circleId: post.circle_id,
    authorId: post.author.id,
    body: post.body,
    lang: post.lang,
    image: post.image_url || null,
    imageAlt: "",
    voice: null,
    dataKb: post.data_kb,
    createdAt: post.created_at,
    status: post.status,
    reactions: [],
    author: post.author || account,
  };
}

export default { toEntry, toEntries, toVerdict, toPostedEntry };
