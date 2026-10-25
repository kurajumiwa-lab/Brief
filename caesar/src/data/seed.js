/**
 * SEED DATA — one morning in the network.
 *
 * Written to be a real test of the ranking, not a showreel. Between them these
 * fourteen posts cover every state the feed has to handle honestly:
 *
 *   · a well-supported local fact (produce prices, same morning)
 *   · a contested proposal where the community is split, and stays visible
 *   · a coordinated downvote burst from fresh accounts (damped, and labelled)
 *   · a post too new to judge (two reactions — the feed says it does not know)
 *   · a viewer's own under-read post
 *   · Swahili and French posts, shown in their own language
 *   · an image post and a voice post, both with real byte counts
 *
 * Everything is deterministic: the same `now` produces the same network, so a
 * screenshot, a test and a bug report all describe the same thing.
 */
import { IMG_COAST, IMG_FARM, IMG_MARKET } from "./imagery.js";

export const VIEWER_ID = "u-amina";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Small deterministic PRNG — the seed must not change between reloads. */
function mulberry32(a) {
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(list, rand) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

const kbOf = (value) => Math.max(1, Math.round((String(value).length / 1024) * 10) / 10);

/* ── circles ─────────────────────────────────────────────────────────────── */

export const CIRCLES = [
  {
    id: "c-market",
    name: "Kisumu Market Traders",
    place: "Kisumu, Kenya",
    memberCount: 2340,
    tone: "green",
    mark: "KM",
    rules: "Real figures, not rumours. Screenshots of another trader's books stay out.",
    about: "Stall holders and hawkers around Kibuye and Oginga Odinga street. Prices, deliveries, county notices.",
  },
  {
    id: "c-kilimo",
    name: "Kilimo Youth Network",
    place: "Nakuru, Kenya",
    memberCount: 890,
    tone: "gold",
    mark: "KY",
    rules: "Show your plot. Advice from people who farm, not people who watched a video.",
    about: "Small-scale growers sharing what worked on their own land this season.",
  },
  {
    id: "c-campus",
    name: "Campus Innovators KE",
    place: "Nairobi, Kenya",
    memberCount: 1120,
    tone: "green",
    mark: "CI",
    rules: "Cite your source. Builders before critics.",
    about: "Students and recent graduates building things, mostly on cheap phones.",
  },
  {
    id: "c-swahili",
    name: "Swahili & English Exchange",
    place: "Pan-African",
    memberCount: 3410,
    tone: "gold",
    mark: "SE",
    rules: "Correct gently. Every learner was a beginner.",
    about: "A shared language room. Post in either language; nobody is marked down for trying.",
  },
  {
    id: "c-coast",
    name: "Mombasa Coastal Cleanup",
    place: "Mombasa, Kenya",
    memberCount: 620,
    tone: "green",
    mark: "MC",
    rules: "Log what you collected. Photos before claims.",
    about: "Saturday cleanups, tide warnings, and what the county is not collecting.",
  },
  {
    id: "c-accra",
    name: "Accra Startup Circle",
    place: "Accra, Ghana",
    memberCount: 505,
    tone: "gold",
    mark: "AC",
    rules: "Customers first, funding second.",
    about: "Small shops and small software, mostly run from one phone.",
  },
];

/* ── accounts ────────────────────────────────────────────────────────────── */

export const USERS = [
  { id: VIEWER_ID, name: "Amina Otieno", handle: "amina", city: "Kisumu", joined: "2025-11-02", reactionsGiven: 46, circles: ["c-market", "c-kilimo", "c-swahili"] },
  { id: "u-wekesa", name: "Joseph Wekesa", handle: "wekesa_produce", city: "Kisumu", joined: "2024-06-18", reactionsGiven: 312, circles: ["c-market"] },
  { id: "u-grace", name: "Grace Njeri", handle: "grace_kilimo", city: "Nakuru", joined: "2024-02-09", reactionsGiven: 188, circles: ["c-kilimo"] },
  { id: "u-peter", name: "Peter Ochieng", handle: "peter_ochieng", city: "Kisumu", joined: "2024-09-30", reactionsGiven: 94, circles: ["c-market"] },
  { id: "u-brian", name: "Brian Kimani", handle: "briankimani", city: "Nairobi", joined: "2025-01-14", reactionsGiven: 71, circles: ["c-campus"] },
  { id: "u-neema", name: "Neema Mushi", handle: "neema_mushi", city: "Dar es Salaam", joined: "2024-11-21", reactionsGiven: 156, circles: ["c-swahili"] },
  { id: "u-kwame", name: "Kwame Mensah", handle: "kwame_accra", city: "Accra", joined: "2024-04-03", reactionsGiven: 143, circles: ["c-accra"] },
  { id: "u-fatuma", name: "Fatuma Ali", handle: "fatuma_ali", city: "Mombasa", joined: "2024-08-12", reactionsGiven: 207, circles: ["c-coast"] },
  { id: "u-simon", name: "Simon Kariuki", handle: "simon_kariuki", city: "Kisumu", joined: "2024-12-05", reactionsGiven: 63, circles: ["c-market"] },
  { id: "u-mercy", name: "Mercy Wanjiku", handle: "mercy_wanjiku", city: "Nyandarua", joined: "2024-03-27", reactionsGiven: 121, circles: ["c-kilimo"] },
  { id: "u-achieng", name: "Achieng Odhiambo", handle: "achieng_o", city: "Nairobi", joined: "2025-02-19", reactionsGiven: 88, circles: ["c-campus", "c-swahili"] },
  { id: "u-jp", name: "Jean-Paul Habimana", handle: "jp_habimana", city: "Kigali", joined: "2024-07-08", reactionsGiven: 134, circles: ["c-swahili", "c-accra"] },
  { id: "u-hassan", name: "Hassan Said", handle: "hassan_said", city: "Mombasa", joined: "2024-05-16", reactionsGiven: 176, circles: ["c-coast"] },
  { id: "u-daniel", name: "Daniel Otieno", handle: "dan_otieno", city: "Kisumu", joined: "2025-03-02", reactionsGiven: 39, circles: ["c-market", "c-kilimo"] },
];

/** Accounts behind the coordinated burst: new, no history, same minute. */
export const BURST_ACCOUNTS = Array.from({ length: 18 }, (_, i) => ({
  id: `u-fresh-${i + 1}`,
  name: `New member ${i + 1}`,
  handle: `member_${i + 1}`,
  city: "Kisumu",
  joined: "2026-10-24",
  reactionsGiven: i % 3 === 0 ? 1 : 0,
  circles: ["c-market"],
}));

/** The wider network — people who react and are never the subject. */
export const NETWORK_ACCOUNTS = Array.from({ length: 30 }, (_, i) => ({
  id: `u-net-${i + 1}`,
  name: `Member ${i + 1}`,
  handle: `member_${i + 1}_net`,
  city: ["Kisumu", "Nairobi", "Nakuru", "Mombasa", "Kampala", "Dar es Salaam"][i % 6],
  joined: "2025-05-01",
  reactionsGiven: 8 + ((i * 7) % 40),
  circles: [CIRCLES[i % CIRCLES.length].id],
}));

const NORMAL_POOL = [...USERS.filter((u) => u.id !== VIEWER_ID), ...NETWORK_ACCOUNTS];

/* ── reaction builders ───────────────────────────────────────────────────── */

function spreadReactions({ postId, up, down, createdAt, hours, pool, rand, now }) {
  const values = [...Array(up).fill("up"), ...Array(down).fill("down")];
  const shuffledValues = shuffle(values, rand);
  // One reaction per account per post: if a pool is ever smaller than the
  // reaction count, people react again rather than the seed throwing.
  const shuffled = shuffle(pool, rand);
  const people = shuffledValues.map((_, index) => shuffled[index % shuffled.length]);
  const span = Math.max(MINUTE, Math.min(hours * HOUR, now - createdAt));
  return shuffledValues.map((value, index) => ({
    id: `${postId}-r${index}`,
    userId: people[index].id,
    value,
    at: Math.round(createdAt + 0.12 * span + rand() * 0.88 * span),
  }));
}

/* ── posts ───────────────────────────────────────────────────────────────── */

export function buildSeed(now = Date.now()) {
  const rand = mulberry32(20261025);
  const at = (msAgo) => new Date(now - msAgo).toISOString();

  const posts = [
    {
      id: "p-tomato",
      circleId: "c-market",
      authorId: "u-wekesa",
      lang: "en",
      createdAt: at(2 * HOUR + 10 * MINUTE),
      body:
        "Tomato prices at Kibuye dropped to KSh 60 a crate this morning. Three lorries came in from Narok overnight, so the whole row is undercutting each other.\n\nIf you were holding stock to sell tomorrow, today is not the day to wait.",
      image: null,
      up: 34,
      down: 3,
      hours: 2,
    },
    {
      id: "p-kale",
      circleId: "c-kilimo",
      authorId: "u-grace",
      lang: "en",
      createdAt: at(5 * HOUR),
      body:
        "I stopped watering at midday and my kale stopped wilting. Same seed, same soil, two weeks apart — the only change was 6am and 6pm instead of noon.\n\nIt cost me nothing to try, so I am writing it down here in case it saves someone else a season.",
      image: IMG_FARM,
      imageAlt: "Illustration of crop rows on a small plot",
      up: 28,
      down: 1,
      hours: 5,
    },
    {
      id: "p-bypass",
      circleId: "c-market",
      authorId: "u-peter",
      lang: "en",
      createdAt: at(7 * HOUR),
      body:
        "Should the county move the Monday market to the bypass? Traffic on the main road is killing afternoon sales — by 2pm most buyers have given up and gone home.\n\nI know moving means new stalls for some of us. I would rather argue about it here than find out it has already been decided.",
      image: null,
      up: 12,
      down: 14,
      hours: 7,
    },
    {
      id: "p-ussd",
      circleId: "c-campus",
      authorId: "u-brian",
      lang: "en",
      createdAt: at(9 * HOUR),
      body:
        "Built a USSD prototype that lets a boda rider check fuel prices without data. Runs on any feature phone — no app, no smartphone, no bundle.\n\nI need three riders in Kisumu to test it for a week. I will come to you and pay for the calls.",
      image: null,
      up: 9,
      down: 1,
      hours: 8,
    },
    {
      id: "p-kiswahili",
      circleId: "c-swahili",
      authorId: "u-neema",
      lang: "sw",
      createdAt: at(11 * HOUR),
      body:
        "Nimeanza kufundisha Kiingereza kwa watoto wa mtaa kila Jumamosi asubuhi, bure, chini ya mti wa mwembe.\n\nTuseme kwa uvivu. Tusiogope makosa — mimi mwenyewe nilianza kwa kuhangaika.",
      image: null,
      up: 16,
      down: 0,
      hours: 10,
    },
    {
      id: "p-meters",
      circleId: "c-accra",
      authorId: "u-kwame",
      lang: "en",
      createdAt: at(13 * HOUR),
      body:
        "Our shop ran out of prepaid meters twice last month because we tracked stock in a notebook and nobody updated it after a sale.\n\nWe moved to one shared sheet on one phone. Two months, zero stockouts. That is the whole system.",
      image: null,
      up: 18,
      down: 2,
      hours: 12,
    },
    {
      id: "p-tide",
      circleId: "c-coast",
      authorId: "u-fatuma",
      lang: "en",
      createdAt: at(15 * HOUR),
      body:
        "The tide came in further than usual at Nyali this week. If you keep equipment near the wall, move it above the third post before Saturday.\n\nThe line in the photo is where the water reached on Tuesday, not where it usually stops.",
      image: IMG_COAST,
      imageAlt: "Illustration of tide lines on a sea wall",
      up: 11,
      down: 0,
      hours: 14,
    },
    {
      id: "p-packaging",
      circleId: "c-market",
      authorId: "u-simon",
      lang: "en",
      createdAt: at(20 * HOUR),
      body:
        "New packaging rule starts Monday: 2kg bags only for cassava flour. The county says it standardises the market. It will raise our costs by about 15%.\n\nDoes anyone actually have the circular? Let us read it before we react to what someone said it says.",
      image: null,
      up: 5,
      down: 18,
      burst: true,
      hours: 2,
    },
    {
      id: "p-voice",
      circleId: "c-kilimo",
      authorId: "u-mercy",
      lang: "en",
      createdAt: at(26 * HOUR),
      body: "Recorded this in the store instead of typing. How I dry maize without a dryer.",
      voice: { seconds: 42, kb: 190 },
      image: null,
      up: 7,
      down: 0,
      hours: 20,
    },
    {
      id: "p-hackathon",
      circleId: "c-campus",
      authorId: "u-achieng",
      lang: "en",
      createdAt: at(30 * HOUR),
      body:
        "The hackathon prize is KSh 200,000, but the judging criteria were only published after we registered and paid the entry fee.\n\nI am asking the organisers to publish the criteria before the next round. Not to win — so the next team knows what it is entering.",
      image: null,
      up: 13,
      down: 9,
      hours: 24,
    },
    {
      id: "p-couture",
      circleId: "c-swahili",
      authorId: "u-jp",
      lang: "fr",
      createdAt: at(34 * HOUR),
      body:
        "Un groupe de couturières à Kigali vend maintenant en ligne. La différence n'était pas la publicité : une photo par article, prise le matin, sur le même mur blanc.\n\nElles vendent trois fois plus, avec le même téléphone.",
      image: null,
      up: 8,
      down: 0,
      hours: 22,
    },
    {
      id: "p-cleanup",
      circleId: "c-coast",
      authorId: "u-hassan",
      lang: "en",
      createdAt: at(40 * HOUR),
      body:
        "We collected 412 kg on Saturday. 78 kg of it was plastic bottles that the county has not collected since June.\n\nThe dump point behind the fish market is full again. Photo is in the cleanup log, weighed at the gate.",
      image: IMG_MARKET,
      imageAlt: "Illustration of crates and market stalls",
      up: 14,
      down: 1,
      hours: 30,
    },
    {
      id: "p-own-stall",
      circleId: "c-market",
      authorId: VIEWER_ID,
      lang: "en",
      createdAt: at(52 * HOUR),
      body:
        "I sell tomatoes at Kibuye, stall 42, near the water point.\n\nIf you need a small order early, message before 7am. I keep the best crates for people who come before the rush — not because they pay more.",
      image: null,
      up: 3,
      down: 0,
      hours: 6,
    },
    {
      id: "p-seed",
      circleId: "c-kilimo",
      authorId: "u-daniel",
      lang: "en",
      createdAt: at(20 * MINUTE),
      body: "Anyone know where to get certified potato seed in Nyandarua this month? The two agrovets I trust are both out.",
      image: null,
      up: 2,
      down: 0,
      hours: 1,
    },
  ];

  const seeded = posts.map((post) => {
    const createdAt = new Date(post.createdAt).getTime();
    let reactions;

    if (post.burst) {
      // A real pattern: five people react over a day, then eighteen fresh
      // accounts arrive inside one minute and all disagree.
      const earlier = spreadReactions({
        postId: post.id,
        up: post.up,
        down: 0,
        createdAt,
        hours: 18,
        pool: NORMAL_POOL,
        rand,
        now,
      });
      const burstStart = createdAt + 19 * HOUR;
      const burst = BURST_ACCOUNTS.slice(0, post.down).map((account, i) => ({
        id: `${post.id}-b${i}`,
        userId: account.id,
        value: "down",
        at: Math.round(burstStart + rand() * 42_000),
      }));
      reactions = [...earlier, ...burst].slice(0, post.up + post.down);
    } else {
      reactions = spreadReactions({
        postId: post.id,
        up: post.up,
        down: post.down,
        createdAt,
        hours: post.hours,
        pool: NORMAL_POOL,
        rand,
        now,
      });
    }

    const imageKb = post.image ? kbOf(post.image) : 0;
    const voiceKb = post.voice ? post.voice.kb : 0;

    return {
      id: post.id,
      circleId: post.circleId,
      authorId: post.authorId,
      lang: post.lang,
      body: post.body,
      image: post.image ?? null,
      imageAlt: post.imageAlt ?? "",
      voice: post.voice ?? null,
      createdAt: post.createdAt,
      reactions,
      status: "published",
      reportsUpheld: 0,
      /** Estimated bytes this post costs a reader, shown by the data saver. */
      dataKb: Math.round((1.2 + imageKb + voiceKb) * 10) / 10,
    };
  });

  const allUsers = [...USERS, ...BURST_ACCOUNTS, ...NETWORK_ACCOUNTS];

  return {
    version: 1,
    viewerId: VIEWER_ID,
    users: allUsers,
    circles: CIRCLES.map((circle) => ({ ...circle })),
    posts: seeded,
    memberships: ["c-market", "c-kilimo", "c-swahili"],
    preferences: {
      locale: "en",
      theme: "light",
      dataSaver: false,
      offline: false,
    },
    queue: [],
    reports: [],
    blocks: [],
    mutes: [],
    seen: {},
  };
}

export default buildSeed;
