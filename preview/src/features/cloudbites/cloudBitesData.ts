// Concept-only content. There is no CloudBites kitchen, courier dispatch,
// checkout, inventory, verified ratings or service-area API in Brief today.
// Keep these values out of the real commerce APIs until an operator supplies
// actual stock, prices, coverage, fulfillment and terms.
export const photo = (name: string) => `/assets/cloudbites/${name}.webp`;

export const categories = [
  { id: 'burgers', name: 'Burgers', image: 'burgers', note: 'The good kind of messy' },
  { id: 'asian', name: 'Asian Fusion', image: 'asian', note: 'Big flavor, no borders' },
  { id: 'bowls', name: 'Healthy Bowls', image: 'bowls', note: 'A little more feel-good' },
  { id: 'pizza', name: 'Pizza', image: 'pizza', note: 'Hot out of the oven' },
  { id: 'desserts', name: 'Desserts', image: 'desserts', note: 'The best last bite' },
] as const;

export const dishes = [
  { id: 'smash', name: 'The Double Smash', category: 'burgers', note: 'Double patty · cheddar · house sauce', price: 950, image: 'smash-burger', badge: 'Popular idea' },
  { id: 'korean', name: 'Seoul Good Chicken', category: 'asian', note: 'Sticky glaze · steamed rice · sesame', price: 890, image: 'korean-chicken', badge: 'Popular idea' },
  { id: 'goddess', name: 'Green Goddess Bowl', category: 'bowls', note: 'Avocado · greens · lemon dressing', price: 790, image: 'green-goddess', badge: 'New idea' },
  { id: 'marg', name: 'The Classic Margherita', category: 'pizza', note: 'Tomato · mozzarella · fresh basil', price: 1100, image: 'margherita', badge: 'Popular idea' },
  { id: 'noodles', name: 'Chili Crunch Noodles', category: 'asian', note: 'Garlic chili · sesame · herbs', price: 820, image: 'chili-noodles', badge: 'New idea' },
  { id: 'chicken', name: 'Lemon & Herb Chicken', category: 'bowls', note: 'Roasted potatoes · herbs · lemon', price: 980, image: 'lemon-chicken', badge: '' },
  { id: 'brownie', name: 'Warm Brownie Moment', category: 'desserts', note: 'Chocolate · vanilla cream', price: 450, image: 'brownie', badge: 'Popular idea' },
  { id: 'mango', name: 'Mango Cloud Parfait', category: 'desserts', note: 'Mango · coconut · whipped yogurt', price: 420, image: 'mango-parfait', badge: 'New idea' },
] as const;

// Illustrative Nairobi planning zones, NOT verified service coverage. A free-
// form address is never geocoded or silently classified by postcode prefix.
export const zones = [
  { id: 'cbd', name: 'Nairobi CBD', minutes: '20–30 min', x: 50, y: 54, aliases: ['cbd', 'central business district', 'nairobi cbd'] },
  { id: 'westlands', name: 'Westlands', minutes: '25–35 min', x: 29, y: 31, aliases: ['westlands'] },
  { id: 'kilimani', name: 'Kilimani', minutes: '25–35 min', x: 31, y: 77, aliases: ['kilimani'] },
  { id: 'upperhill', name: 'Upper Hill', minutes: '25–35 min', x: 62, y: 76, aliases: ['upper hill', 'upperhill'] },
  { id: 'parklands', name: 'Parklands', minutes: '30–40 min', x: 69, y: 29, aliases: ['parklands'] },
] as const;

export function checkPlanningZone(input: string) {
  const normalized = input.toLowerCase().trim().replace(/\s+/g, ' ');
  if (!normalized) return null;
  // Accept only explicitly named neighborhoods (optionally inside an address).
  // ZIP-only inputs cannot establish location or availability.
  return zones.find(z => z.aliases.some(alias =>
    new RegExp(`(^|[^a-z])${alias.replace(/ /g, '\\s+')}($|[^a-z])`).test(normalized)
  )) ?? null;
}
