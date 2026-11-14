/**
 * REGIONS — the one geography the product uses.
 *
 * Markets were a *place you go to*: a physical market with a gate, a day and a
 * set of stalls. They made the app read like a vendor directory, and they
 * duplicated the map, the directory and the feed at the same time. A region is
 * the unit that survives a trader changing what they sell next month:
 *
 *   region → hub city → the people, institutions, offers and needs around it
 *
 * The list is deliberately short. It covers the corridors this network actually
 * serves today — Kenya, Uganda, Ethiopia, Rwanda and Tanzania — with the city
 * people use when they give directions, not a full administrative gazetteer.
 * Adding a region is adding one object here; no screen has a hard-coded list.
 */

export const COUNTRIES = [
  { code: "KE", name: "Kenya", currency: "KES" },
  { code: "UG", name: "Uganda", currency: "UGX" },
  { code: "ET", name: "Ethiopia", currency: "ETB" },
  { code: "RW", name: "Rwanda", currency: "RWF" },
  { code: "TZ", name: "Tanzania", currency: "TZS" },
];

/**
 * `knownFor` is what a person from outside would ask this region for. It is not
 * a category taxonomy and it does not gate anything — it is the line that makes
 * a region recognisable instead of a dot on a map.
 *
 * `slug` is the URL. `aliases` is what a typed address or an imported contact
 * might call the same place, and it is what makes the region match without
 * asking anyone to spell "Nyanza" correctly.
 */
export const REGIONS = [
  {
    slug: "nairobi-metro",
    name: "Nairobi Metro",
    country: "KE",
    hub: "Nairobi",
    aliases: ["nairobi", "kiambu", "machakos", "kajiado", "thika", "ruiru", "westlands", "cbd"],
    knownFor: ["Services", "Software", "Finance", "Logistics"],
    summary: "The country's services and logistics hub: professional practices, software, transport and wholesale.",
    note: "Fastest place to find a licensed professional or a same-day courier.",
  },
  {
    slug: "coast",
    name: "Coast",
    country: "KE",
    hub: "Mombasa",
    aliases: ["mombasa", "kilifi", "malindi", "watamu", "diani", "lamu", "taita", "taveta"],
    knownFor: ["Import & export", "Hospitality", "Spices", "Transport"],
    summary: "The port economy: imports, clearing and forwarding, hospitality and the coastal food trade.",
    note: "Most cross-border goods enter here before moving inland.",
  },
  {
    slug: "nyanza",
    name: "Nyanza",
    country: "KE",
    hub: "Kisumu",
    aliases: ["kisumu", "kisii", "siaya", "homa bay", "migori", "bondo", "ahero"],
    knownFor: ["Fresh produce", "Fishing", "Education", "Health services"],
    summary: "The lake economy: fresh produce, fish, learning institutions and a dense small-town service trade.",
    note: "Kisumu and Kisii are the two anchors; most routes pass through one of them.",
  },
  {
    slug: "western",
    name: "Western",
    country: "KE",
    hub: "Kakamega",
    aliases: ["kakamega", "bungoma", "busia", "webuye", "vihiga", "kisumu road"],
    knownFor: ["Sugar", "Maize", "Cross-border trade", "Building materials"],
    summary: "The western corridor into Uganda: sugar, maize, building materials and busy border trade.",
    note: "Busia is the crossing most members here use.",
  },
  {
    slug: "rift-valley",
    name: "Rift Valley",
    country: "KE",
    hub: "Nakuru",
    aliases: ["nakuru", "eldoret", "kericho", "naivasha", "kitale", "narok", "bomet"],
    knownFor: ["Grains", "Dairy", "Flowers", "Transport"],
    summary: "The country's food basket and haulage spine: grains, dairy, horticulture and long-distance transport.",
    note: "Nakuru and Eldoret are the two depots to know.",
  },
  {
    slug: "central",
    name: "Central",
    country: "KE",
    hub: "Nyeri",
    aliases: ["nyeri", "thika", "murang'a", "karatina", "nyahururu", "kirinyaga", "kerugoya"],
    knownFor: ["Coffee", "Dairy", "Produce", "Agri-inputs"],
    summary: "Highland produce and dairy, with strong coffee and agri-input chains around Nyeri and Karatina.",
    note: "A good region for cooperatives and group buying.",
  },
  {
    slug: "eastern",
    name: "Eastern",
    country: "KE",
    hub: "Machakos",
    aliases: ["machakos", "meru", "embu", "kitui", "makueni", "wote", "isiolo"],
    knownFor: ["Fruit", "Livestock", "Hardware", "Repairs"],
    summary: "Fruit, livestock and a deep bench of fundis and repair trades along the Mombasa road corridor.",
    note: "Machakos is the busiest town for trades and hardware.",
  },
  {
    slug: "north-eastern",
    name: "North Eastern",
    country: "KE",
    hub: "Garissa",
    aliases: ["garissa", "wajir", "mandera", "dadaab"],
    knownFor: ["Livestock", "Water", "Solar", "Cross-border trade"],
    summary: "Livestock, water and solar equipment, with trade moving across the eastern border.",
    note: "Long distances make verified contacts more valuable here, not less.",
  },
  {
    slug: "kampala",
    name: "Kampala & Central Uganda",
    country: "UG",
    hub: "Kampala",
    aliases: ["kampala", "entebbe", "mukono", "jinja", "wakiso", "masaka"],
    knownFor: ["Services", "Food", "Textiles", "Logistics"],
    summary: "Uganda's commercial centre: services, food distribution, textiles and the lake routes.",
    note: "Jinja and Mukono are within the same day's trading radius.",
  },
  {
    slug: "eastern-uganda",
    name: "Eastern Uganda",
    country: "UG",
    hub: "Mbale",
    aliases: ["mbale", "tororo", "busia uganda", "soroti", "kumi"],
    knownFor: ["Grains", "Coffee", "Border trade", "Produce"],
    summary: "The grain and coffee belt towards the Kenyan border, anchored by Mbale and Tororo.",
    note: "Busia and Malaba crossings set the day's prices.",
  },
  {
    slug: "northern-uganda",
    name: "Northern Uganda",
    country: "UG",
    hub: "Gulu",
    aliases: ["gulu", "lira", "arua", "kitgum", "nebbi"],
    knownFor: ["Oil seeds", "Livestock", "Construction", "Transport"],
    summary: "Oil seeds, livestock and a construction trade growing around Gulu and Lira.",
    note: "Arua is the western anchor of this corridor.",
  },
  {
    slug: "western-uganda",
    name: "Western Uganda",
    country: "UG",
    hub: "Mbarara",
    aliases: ["mbarara", "fort portal", "kasese", "bushenyi", "kabale"],
    knownFor: ["Dairy", "Bananas", "Tourism", "Coffee"],
    summary: "Dairy, bananas and tourism services, with strong cooperative structures around Mbarara.",
    note: "Fort Portal and Kasese serve the Rwenzori corridor.",
  },
  {
    slug: "addis-ababa",
    name: "Addis Ababa",
    country: "ET",
    hub: "Addis Ababa",
    aliases: ["addis", "addis ababa", "bole", "mer kato", "akaki"],
    knownFor: ["Manufacturing", "Services", "Coffee", "Logistics"],
    summary: "Ethiopia's commercial centre and the clearing point for coffee, manufacturing and services.",
    note: "Mer Kato remains the reference market for wholesale pricing.",
  },
  {
    slug: "oromia",
    name: "Oromia",
    country: "ET",
    hub: "Adama",
    aliases: ["oromia", "adama", "nazret", "bishoftu", "jimma", "hawassa road"],
    knownFor: ["Coffee", "Grains", "Floriculture", "Transport"],
    summary: "Coffee, grains and flowers along the Addis–Adama corridor, with strong haulage links.",
    note: "Adama is the junction most members use for the south.",
  },
  {
    slug: "amhara",
    name: "Amhara",
    country: "ET",
    hub: "Bahir Dar",
    aliases: ["amhara", "bahir dar", "gondar", "dessie", "kombolcha"],
    knownFor: ["Textiles", "Grains", "Livestock", "Lake trade"],
    summary: "Textiles, grains and livestock around Bahir Dar, Gondar and the Dessie–Kombolcha corridor.",
    note: "Lake Tana links the northern towns.",
  },
  {
    slug: "tigray",
    name: "Tigray",
    country: "ET",
    hub: "Mekelle",
    aliases: ["tigray", "mekelle", "axum", "adigrat", "shire"],
    knownFor: ["Building materials", "Produce", "Transport", "Repairs"],
    summary: "Building materials, produce and repair trades rebuilding around Mekelle and Adigrat.",
    note: "Verified contacts matter most where supply is thin.",
  },
  {
    slug: "kigali",
    name: "Kigali",
    country: "RW",
    hub: "Kigali",
    aliases: ["kigali", "nyarugenge", "gasabo", "kicukiro"],
    knownFor: ["Services", "Software", "Hospitality", "Logistics"],
    summary: "Rwanda's services and technology centre, with a compact, well-connected supplier base.",
    note: "Most national routes start and end inside Kigali.",
  },
  {
    slug: "eastern-rwanda",
    name: "Eastern Rwanda",
    country: "RW",
    hub: "Rwamagana",
    aliases: ["rwamagana", "kayonza", "nyagatare", "kibungo"],
    knownFor: ["Livestock", "Maize", "Agri-inputs", "Transport"],
    summary: "The eastern livestock and maize belt, with a growing agri-input trade.",
    note: "Nyagatare is the reference point for cattle.",
  },
  {
    slug: "dar-es-salaam",
    name: "Dar es Salaam",
    country: "TZ",
    hub: "Dar es Salaam",
    aliases: ["dar", "dar es salaam", "kariakoo", "temeke", "kinondoni"],
    knownFor: ["Import & export", "Wholesale", "Logistics", "Hospitality"],
    summary: "Tanzania's port and wholesale centre; the Kariakoo trade sets prices for much of the interior.",
    note: "A key crossing point for goods moving to and from the coast.",
  },
  {
    slug: "northern-tanzania",
    name: "Northern Tanzania",
    country: "TZ",
    hub: "Arusha",
    aliases: ["arusha", "moshi", "kilimanjaro", "manyara", "tanga"],
    knownFor: ["Tourism", "Coffee", "Fresh produce", "Transport"],
    summary: "Tourism, coffee and fresh produce around Arusha and Moshi, with strong service trades.",
    note: "Arusha is the meeting point for the northern circuit.",
  },
  {
    slug: "lake-tanzania",
    name: "Lake Zone",
    country: "TZ",
    hub: "Mwanza",
    aliases: ["mwanza", "geita", "bukoba", "shinyanga", "bariadi"],
    knownFor: ["Fishing", "Cotton", "Mining supplies", "Transport"],
    summary: "Fishing, cotton and mining supplies around Mwanza and the lake ports.",
    note: "Ferries carry a large share of the daily trade.",
  },
];

export const REGION_BY_SLUG = Object.fromEntries(REGIONS.map((r) => [r.slug, r]));

export const regionsForCountry = (code) =>
  code ? REGIONS.filter((region) => region.country === code) : REGIONS;

export const countryName = (code) =>
  COUNTRIES.find((country) => country.code === code)?.name || code;

/**
 * Find the region a free-text place belongs to. Used for imported addresses,
 * typed locations and old market names, so a member does not have to re-enter
 * where they already told us they are.
 *
 * Matching is deliberately generous (alias substring, then hub, then name) and
 * returns null rather than guessing — an unplaced member is honest, a wrongly
 * placed one is a bad introduction.
 */
export function regionFromPlace(place = "") {
  const needle = String(place || "").trim().toLowerCase();
  if (!needle) return null;
  const direct = REGIONS.find((region) =>
    [region.slug, region.name, region.hub, ...region.aliases]
      .map((value) => value.toLowerCase())
      .some((value) => needle === value || needle.includes(value)),
  );
  if (direct) return direct;
  return null;
}

/** The region used when nothing is known: the largest corridor we serve. */
export const DEFAULT_REGION = REGION_BY_SLUG["nairobi-metro"];

export const regionPath = (region) => `/regions/${region.slug}`;

/** A region's short line: "Nyanza · Kisumu, Kenya". */
export function regionLine(region) {
  if (!region) return "";
  return `${region.name} · ${region.hub}, ${countryName(region.country)}`;
}
