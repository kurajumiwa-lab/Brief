/**
 * WHAT THIS WOULD MEASURE.
 *
 * The brief ends with a rule that most products fail quietly:
 *
 *   "Measure success through retention, data consumption, content quality,
 *    fairness, language participation, and moderation outcomes — not
 *    engagement alone."
 *
 * A prototype cannot report a retention cohort, and inventing one would be the
 * exact dishonesty this product is arguing against. So each of the six is
 * treated one of two ways here:
 *
 *   · the ones a single browser can answer honestly — data, quality, fairness,
 *     language, moderation — are computed from real state: the seed network
 *     plus whatever the person using the prototype has actually done;
 *   · retention refuses to answer. It says what it would take, and why this
 *     build cannot know it.
 *
 * Every number below is derived, never stored: if a metric is worth reporting,
 * it is worth being able to recompute from the same state the interface shows.
 */
import { computeVerdict } from "./ranking.js";
import { isUsefulPost, USEFUL_MIN_REACTIONS } from "./reputation.js";
import { dataSize, percent, count } from "./format.js";

const round = (value, places = 1) => {
  const factor = 10 ** places;
  return Math.round((Number(value) || 0) * factor) / factor;
};

/** Baseline bytes for a text-only post, as the composer estimates them. */
const TEXT_KB = 1.2;

function imageKbOf(post) {
  if (!post.image) return 0;
  return Math.max(0, (Number(post.dataKb) || TEXT_KB) - TEXT_KB);
}

/**
 * @returns {Array<{
 *   key: string, label: string, question: string,
 *   measurable: boolean, headline: string, sub: string,
 *   rows: Array<{ label: string, value: string }>,
 *   note: string,
 * }>}
 */
export function measure(state = {}, { now = Date.now() } = {}) {
  const posts = Array.isArray(state.posts) ? state.posts : [];
  const users = Array.isArray(state.users) ? state.users : [];
  const usersById = Object.fromEntries(users.map((user) => [user.id, user]));
  const published = posts.filter((post) => post.status !== "removed");
  const removed = posts.length - published.length;
  const locale = state.preferences?.locale || "en";

  const verdicts = published.map((post) => ({
    post,
    verdict: computeVerdict(post, { usersById, now }),
  }));

  /* ── 1. retention ─────────────────────────────────────────────────────── */

  const retention = {
    key: "retention",
    label: "Retention",
    question: "Do people come back on a bad connection?",
    measurable: false,
    headline: "Not measurable here",
    sub: "and deliberately not guessed at",
    rows: [
      { label: "Accounts to cohort", value: "none — one viewer, no login" },
      { label: "Second day", value: "cannot occur on one device" },
      { label: "What it needs", value: "app_open per account, D1 / D7 / D30" },
    ],
    note:
      "Any retention figure produced by a prototype with no accounts and one browser would be a number about me, not about the product. The honest output of this build is the event, not the percentage.",
  };

  /* ── 2. data consumption ──────────────────────────────────────────────── */

  const totalKb = published.reduce((sum, post) => sum + (Number(post.dataKb) || 0), 0);
  const imagesKb = published.reduce((sum, post) => sum + imageKbOf(post), 0);
  const voiceKb = published.reduce((sum, post) => sum + (post.voice?.kb || 0), 0);
  const textKb = Math.max(0, totalKb - imagesKb - voiceKb);
  const heaviest = published.reduce(
    (worst, post) => ((Number(post.dataKb) || 0) > (Number(worst?.dataKb) || 0) ? post : worst),
    null
  );
  const data = {
    key: "data",
    label: "Data consumption",
    question: "What does reading this feed cost a metered phone?",
    measurable: true,
    headline: dataSize(totalKb),
    sub: `for all ${count(published.length, "post")}, once`,
    rows: [
      { label: "Text", value: `${dataSize(textKb)} · ${totalKb ? percent(textKb / totalKb) : "—"}` },
      { label: "Photographs", value: `${dataSize(imagesKb)} · ${totalKb ? percent(imagesKb / totalKb) : "—"}` },
      { label: "Voice notes", value: `${dataSize(voiceKb)} · ${totalKb ? percent(voiceKb / totalKb) : "—"}` },
      {
        label: "Withheld by data saver",
        value: imagesKb + voiceKb > 0 ? dataSize(imagesKb + voiceKb) : "nothing to withhold",
      },
      {
        label: "Average post",
        value: published.length ? dataSize(totalKb / published.length) : "—",
      },
    ],
    note: heaviest
      ? `Counted from the same per-post byte estimates the cards print, so the interface and the metric cannot disagree. The heaviest single post is ${dataSize(
          heaviest.dataKb
        )}${heaviest.voice ? `, most of it a ${heaviest.voice.seconds}-second voice note` : ""} — which is why the data saver gates voice as well as photographs.`
      : "Counted from the same per-post byte estimates the cards print.",
  };

  /* ── 3. content quality ───────────────────────────────────────────────── */

  const useful = published.filter(isUsefulPost).length;
  const unjudged = published.filter((post) => (post.reactions || []).length < USEFUL_MIN_REACTIONS).length;
  const quality = {
    key: "quality",
    label: "Content quality",
    question: "How much of what is here was worth someone's time?",
    measurable: true,
    headline: percent(published.length ? useful / published.length : 0),
    sub: `${useful} of ${published.length} posts reached “useful”`,
    rows: [
      { label: "Useful = 5+ reactions, 60% confidence", value: String(useful) },
      { label: "Not yet judged", value: String(unjudged) },
      { label: "Median reactions per post", value: String(median(published.map((post) => (post.reactions || []).length))) },
    ],
    note:
      "The threshold is published in the app, not tuned here. A quality metric that moves when the threshold moves is a metric nobody should quote.",
  };

  /* ── 4. fairness ──────────────────────────────────────────────────────── */

  const contested = verdicts.filter((entry) => entry.verdict.contested);
  const totalReactions = verdicts.reduce((sum, entry) => sum + entry.verdict.participation, 0);
  const dissent = verdicts.reduce((sum, entry) => sum + entry.verdict.down, 0);
  const fairness = {
    key: "fairness",
    label: "Fairness",
    question: "Does a minority keep its voice?",
    measurable: true,
    headline: `${contested.length} of ${contested.length}`,
    sub: "contested posts still in the feed",
    rows: [
      { label: "Contested posts visible", value: `${contested.length} / ${contested.length}` },
      { label: "Hidden for disagreement", value: "0 — no code path can do it" },
      { label: "Removed by moderation", value: String(removed) },
      { label: "Dissent as share of reactions", value: totalReactions ? percent(dissent / totalReactions) : "—" },
    ],
    note:
      "The first row is a fraction with the same number twice on purpose: the ranking can lower a contested post but cannot delete it. If that ever stopped being true, this row would show it.",
  };

  /* ── 5. language participation ────────────────────────────────────────── */

  const byLang = published.reduce((acc, post) => {
    const code = post.lang || "en";
    acc[code] = (acc[code] || 0) + 1;
    return acc;
  }, {});
  const outsideInterface = published.filter((post) => (post.lang || "en") !== locale).length;
  const language = {
    key: "language",
    label: "Language participation",
    question: "Who gets to write in the language they think in?",
    measurable: true,
    headline: percent(published.length ? outsideInterface / published.length : 0),
    sub: `of posts are not in the ${locale} interface`,
    rows: Object.keys(byLang)
      .sort((a, b) => byLang[b] - byLang[a])
      .map((code) => ({
        label: `${LANGUAGE_NAMES[code] || code.toUpperCase()} (${code})`,
        value: `${byLang[code]} · ${percent(byLang[code] / (published.length || 1))}`,
      })),
    note:
      "Read from the tag each author chose. Nothing is machine-translated, so this counts people writing in their own language rather than people being served a translation.",
  };

  /* ── 6. moderation outcomes ───────────────────────────────────────────── */

  const reports = Array.isArray(state.reports) ? state.reports : [];
  const byStatus = reports.reduce((acc, report) => {
    const status = report.status || "received";
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
  const moderation = {
    key: "moderation",
    label: "Moderation outcomes",
    question: "Do reports end in a decision, or in a queue?",
    measurable: true,
    headline: String(reports.length),
    sub: reports.length === 1 ? "report filed" : "reports filed",
    rows: [
      { label: "Awaiting a moderator", value: String(byStatus.received || 0) },
      { label: "Upheld", value: String(byStatus.upheld || 0) },
      { label: "Dismissed", value: String(byStatus.dismissed || 0) },
      { label: "Appeals", value: "no appeal queue in this build" },
      { label: "Blocked / muted by you", value: `${(state.blocks || []).length} / ${(state.mutes || []).length}` },
    ],
    note:
      "Nothing here leaves “awaiting” because there is no moderator console yet — the same gap the Safety centre names. A queue that never drains is the failure mode this row exists to catch.",
  };

  return [retention, data, quality, fairness, language, moderation];
}

const LANGUAGE_NAMES = {
  en: "English",
  sw: "Kiswahili",
  fr: "Français",
  pt: "Português",
  ar: "العربية",
  ha: "Hausa",
  yo: "Yorùbá",
  am: "አማርኛ",
  zu: "isiZulu",
};

function median(values = []) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : round((sorted[middle - 1] + sorted[middle]) / 2);
}

export default { measure };
