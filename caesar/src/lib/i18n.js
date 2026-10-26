/**
 * LANGUAGE — three for the prototype, honest about the rest.
 *
 * The brand promises a multilingual Africa. The MVP ships the interface in
 * English, Kiswahili and French, and the language menu says plainly that the
 * next set (Hausa, Yorùbá, Amharic, isiZulu, Arabic, Portuguese) is not built
 * yet. Shipping two stubs would be worse than shipping three real ones.
 *
 * Post text is never machine-translated here: a post is shown in the language
 * it was written in, tagged, and nothing is put in the author's mouth.
 */

export const LOCALES = [
  { code: "en", label: "English", native: "English" },
  { code: "sw", label: "Swahili", native: "Kiswahili" },
  { code: "fr", label: "French", native: "Français" },
];

export const COMING_SOON = ["Hausa", "Yorùbá", "Amharic", "isiZulu", "العربية", "Português"];

const STRINGS = {
  en: {
    "nav.home": "Home",
    "nav.circles": "Circles",
    "nav.compose": "Post",
    "nav.profile": "Profile",
    "nav.safety": "Safety",
    "brand.tagline": "The community decides.",
    "feed.title": "Your feed",
    "feed.subtitle": "Ordered by what the community finds useful, not by who is loudest.",
    "feed.composer": "What does your community need to know?",
    "feed.empty": "Nothing here yet. Join a circle and the conversation starts.",
    "reaction.support": "Support",
    "reaction.disagree": "Disagree",
    "reaction.why": "Why this appears",
    "verdict.title": "The verdict",
    "verdict.confidence": "Confidence",
    "verdict.participation": "Participation",
    "verdict.recency": "Recency",
    "verdict.circle": "Circle fit",
    "verdict.score": "Ranking score",
    "circles.title": "Circles",
    "circles.subtitle": "Neighbourhoods, campuses, trades and causes — each with its own rules.",
    "compose.title": "Write a post",
    "profile.title": "Profile",
    "safety.title": "Safety centre",
    "data.saver": "Data saver",
    "data.offline": "Offline",
    "data.online": "Online",
    "data.queued": "Queued — will send when you are back online",
    "action.report": "Report",
    "action.block": "Block",
    "action.mute": "Mute",
    "action.join": "Join",
    "action.joined": "Joined",
    "action.post": "Post",
  },
  sw: {
    "nav.home": "Nyumbani",
    "nav.circles": "Miduara",
    "nav.compose": "Chapisha",
    "nav.profile": "Wasifu",
    "nav.safety": "Usalama",
    "brand.tagline": "Jumuiya inaamua.",
    "feed.title": "Mtiririko wako",
    "feed.subtitle": "Umepangwa kwa kile jumuiya inachoona kina manufaa, wala si kwa sauti kubwa.",
    "feed.composer": "Jumuiya yako inahitaji kujua nini?",
    "feed.empty": "Hakuna kitu bado. Jiunge na mduara na mazungumzo yaanze.",
    "reaction.support": "Kuunga mkono",
    "reaction.disagree": "Kutokubaliana",
    "reaction.why": "Kwa nini hii inaonekana",
    "verdict.title": "Uamuzi",
    "verdict.confidence": "Uhakika",
    "verdict.participation": "Ushiriki",
    "verdict.recency": "Ubichi",
    "verdict.circle": "Uhusiano na mduara",
    "verdict.score": "Alama ya mpangilio",
    "circles.title": "Miduara",
    "circles.subtitle": "Mitaa, vyuo, fani na misaada — kila mmoja na kanuni zake.",
    "compose.title": "Andika chapisho",
    "profile.title": "Wasifu",
    "safety.title": "Kituo cha usalama",
    "data.saver": "Hifadhi data",
    "data.offline": "Nje ya mtandao",
    "data.online": "Mtandaoni",
    "data.queued": "Imehifadhiwa — itatumwa mtakapounganishwa",
    "action.report": "Ripoti",
    "action.block": "Zuia",
    "action.mute": "Nyamazisha",
    "action.join": "Jiunge",
    "action.joined": "Umejiunga",
    "action.post": "Chapisha",
  },
  fr: {
    "nav.home": "Accueil",
    "nav.circles": "Cercles",
    "nav.compose": "Publier",
    "nav.profile": "Profil",
    "nav.safety": "Sécurité",
    "brand.tagline": "La communauté décide.",
    "feed.title": "Votre fil",
    "feed.subtitle": "Ordonné selon ce que la communauté trouve utile, pas selon qui parle le plus fort.",
    "feed.composer": "Que doit savoir votre communauté ?",
    "feed.empty": "Rien pour l'instant. Rejoignez un cercle et la conversation commence.",
    "reaction.support": "Soutenir",
    "reaction.disagree": "Pas d'accord",
    "reaction.why": "Pourquoi ceci apparaît",
    "verdict.title": "Le verdict",
    "verdict.confidence": "Confiance",
    "verdict.participation": "Participation",
    "verdict.recency": "Fraîcheur",
    "verdict.circle": "Lien au cercle",
    "verdict.score": "Score de classement",
    "circles.title": "Cercles",
    "circles.subtitle": "Quartiers, campus, métiers et causes — chacun avec ses règles.",
    "compose.title": "Écrire une publication",
    "profile.title": "Profil",
    "safety.title": "Centre de sécurité",
    "data.saver": "Économiseur de données",
    "data.offline": "Hors ligne",
    "data.online": "En ligne",
    "data.queued": "En file — envoyé dès votre retour en ligne",
    "action.report": "Signaler",
    "action.block": "Bloquer",
    "action.mute": "Masquer",
    "action.join": "Rejoindre",
    "action.joined": "Rejoint",
    "action.post": "Publier",
  },
};

export function makeT(locale = "en") {
  const table = STRINGS[locale] || STRINGS.en;
  return (key) => table[key] ?? STRINGS.en[key] ?? key;
}

export default { LOCALES, COMING_SOON, makeT };
