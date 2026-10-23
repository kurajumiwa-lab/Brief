/**
 * Deterministic client-side category inference & progressive template metadata.
 *
 * Mirrors `backend/app/modules/ledger/inference.py` so `/create` can show
 * immediate, explainable template detection and progressive fields as a
 * neighbour, household, artisan, or institution types — with zero AI latency
 * and full offline/draft resilience.
 */

export const PRIMARY_POSTING_TYPES = [
  {
    value: "available",
    label: "Available",
    shortHint: "Skills, produce, tools to lend, or home shelf items",
    description: "Offer a repair skill, farm produce or fodder, a tool to borrow, or occasional household surplus.",
  },
  {
    value: "wanted",
    label: "Wanted",
    shortHint: "Ask for a fundi, repair, group buy, or local help",
    description: "Need a fence repaired, fodder sourced together, or a hand in the neighbourhood.",
  },
  {
    value: "scheduled",
    label: "Scheduled",
    shortHint: "Travelling artisan rounds, learning sessions, collection windows",
    description: "Set a time window — a cobbler visiting an area, a learning circle, or a Saturday pickup slot.",
  },
  {
    value: "opportunity",
    label: "Opportunity",
    shortHint: "Local work, apprenticeships, or supervised youth tasks",
    description: "Invite people to help, earn, apprentice, or join a supervised daytime holiday task.",
  },
];

export const ACCOUNT_KINDS = [
  {
    value: "person",
    label: "Person",
    hint: "Everyday resident, neighbour, learner, or helper — no business needed",
    defaultPrivateLocation: true,
  },
  {
    value: "household",
    label: "Household",
    hint: "Homestead or family compound arranging repairs, rounds, or shared produce",
    defaultPrivateLocation: true,
  },
  {
    value: "artisan",
    label: "Artisan / Fundi",
    hint: "Repairer, cobbler, carpenter, plumber, tailor, or local craftsperson",
    defaultPrivateLocation: false,
  },
  {
    value: "institution",
    label: "Institution / Group",
    hint: "School, church, cooperative, youth hub, or neighbourhood association",
    defaultPrivateLocation: false,
  },
  {
    value: "business",
    label: "Business (optional)",
    hint: "Shop, kiosk, market trader, or wholesaler using full inventory tools",
    defaultPrivateLocation: false,
  },
];

export const SETTLEMENT_METHODS = [
  { value: "direct_mpesa", label: "Direct M-Pesa between participants" },
  { value: "direct_cash", label: "Direct cash in person" },
  { value: "in_kind", label: "In-kind exchange / reciprocity" },
  { value: "cost_share", label: "Shared group cost" },
  { value: "free", label: "Free / neighbourly help" },
];

export const YOUTH_SAFE_DOMAINS = [
  { value: "garden_help", label: "Supervised garden, nursery, or compound care" },
  { value: "tutoring_peer", label: "Peer tutoring & learning support" },
  { value: "community_event", label: "Supervised community event help" },
  { value: "craft_learning", label: "Supervised craft or repair learning" },
  { value: "digital_help", label: "Library, reading, or digital literacy help" },
  { value: "light_sorting", label: "Light daytime sorting & packing" },
];

export const YOUTH_AGE_BANDS = [
  { value: "16_17_supervised", label: "Ages 16–17 (supervised daytime)" },
  { value: "13_15_holiday_learning", label: "Ages 13–15 (holiday learning, supervised)" },
];

export const TEMPLATE_LABELS = {
  repair_artisan: "Repair & Fundi",
  agricultural_produce_fodder: "Farm Produce & Fodder",
  tool_lending: "Tool Lending",
  collection_point: "Collection Window",
  travelling_round: "Travelling Artisan Round",
  group_sourcing: "Group Sourcing",
  community_learning: "Community Learning",
  supervised_youth_task: "Supervised Youth Task",
  general: "Neighbourhood Activity",
};

const INFERENCE_RULES = [
  {
    template: "supervised_youth_task",
    pattern: /\b(teenager|teenagers|youth|holiday\s+task|supervised\b.*\btask|young\s+person|student\s+helper|16[\s-]*17|13[\s-]*15)\b/i,
    category: "youth_opportunity",
    reason: "Detected a youth/teenager task — enabling mandatory adult supervision & guardian consent safeguards.",
  },
  {
    template: "travelling_round",
    pattern: /\b(cobbler|shoe\s+repair|knife\s+sharpen|sharpening\s+round|area\s+round|travelling|visiting\s+round|household\s+stops|door[\s-]to[\s-]door)\b/i,
    category: "artisan_round",
    reason: "Detected a travelling artisan area round — adding area window & private ordered household stops.",
  },
  {
    template: "group_sourcing",
    pattern: /\b(group\s+buy|group\s+sourcing|pool\s+orders|together|split\s+transport|bulk\s+fodder|shared\s+lorry|co[\s-]?source)\b/i,
    category: "agriculture_group_buy",
    reason: "Detected shared group sourcing — adding fractional target quantity & neighbour pledges.",
  },
  {
    template: "agricultural_produce_fodder",
    pattern: /\b(napier|fodder|silage|hay|boma\s+rhodes|bales|maize|beans|avocado|bananas|milk|eggs|seedlings|manure|harvest|produce|chaff)\b/i,
    category: "agriculture",
    reason: "Detected farm produce or fodder — adding fractional quantity (bales/kg/tonnes) & harvest details.",
  },
  {
    template: "repair_artisan",
    pattern: /\b(fence|fencing|gate|roof|gutter|plumb|pipe|leak|carpenter|welder|welding|mason|masonry|wiring|electrician|fundi|repair|fix|broken|post\s+hole)\b/i,
    category: "repairs",
    reason: "Detected a repair or fundi need — adding urgency, materials on hand, and quote comparison.",
  },
  {
    template: "tool_lending",
    pattern: /\b(lend|borrow|loan\s+tool|wheelbarrow|ladder|sprayer|jembe|spade|chaff\s+cutter|chainsaw|drill|tool\s+share)\b/i,
    category: "tools",
    reason: "Detected neighbourhood tool sharing — adding condition & return care rules.",
  },
  {
    template: "community_learning",
    pattern: /\b(workshop|lesson|class|tutoring|study\s+group|learning|training|demo\s+plot|reading\s+circle|revision|mentorship|skill\s+share)\b/i,
    category: "learning",
    reason: "Detected a community learning session — adding facilitator, seats, and session format.",
  },
  {
    template: "collection_point",
    pattern: /\b(collection\s+point|drop[\s-]?off|pick[\s-]?up\s+window|milk\s+cooler|aggregation|buying\s+centre|saturday\s+table)\b/i,
    category: "collection",
    reason: "Detected a collection or pickup window — adding collection point hours.",
  },
];

export function inferActivityTemplate({ posting_type = "available", title = "", body = "", category = "" } = {}) {
  const combined = `${title || ""} ${body || ""} ${category || ""}`.trim();
  for (const rule of INFERENCE_RULES) {
    if (rule.pattern.test(combined)) {
      return {
        posting_type,
        inferred_template: rule.template,
        label: TEMPLATE_LABELS[rule.template],
        suggested_category: category || rule.category,
        reason: rule.reason,
      };
    }
  }
  const fallbackByType = {
    scheduled: "collection_point",
    opportunity: "general",
    wanted: "general",
    available: "general",
  };
  const tpl = fallbackByType[posting_type] || "general";
  return {
    posting_type,
    inferred_template: tpl,
    label: TEMPLATE_LABELS[tpl],
    suggested_category: category || "neighbourhood",
    reason: "General neighbourhood activity — add details below to unlock specialized fields.",
  };
}

export const LEDGER_STAGES = [
  { key: "published", step: 1, label: "Published" },
  { key: "notified", step: 2, label: "Notified" },
  { key: "responses_received", step: 3, label: "Responses" },
  { key: "booking_agreed", step: 4, label: "Booking agreed" },
  { key: "completed", step: 5, label: "Completed" },
  { key: "reusable_record", step: 6, label: "Reusable record" },
];
