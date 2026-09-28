// CloudBites is a food-commerce concept preview inside Brief, not a live
// merchant, menu or fulfillment service. These sample dishes, prices and areas
// are illustrative and must never be sent to real commerce APIs as inventory.
export const photo = (name: string) => `/assets/cloudbites/${name}.webp`;

export const categories = [
  { id: 'burgers', name: 'Burgers', image: 'burgers', note: 'A sample menu category' },
  { id: 'asian', name: 'Asian fusion', image: 'asian', note: 'A sample menu category' },
  { id: 'bowls', name: 'Bowls & plates', image: 'bowls', note: 'A sample menu category' },
  { id: 'pizza', name: 'Pizza', image: 'pizza', note: 'A sample menu category' },
  { id: 'desserts', name: 'Desserts', image: 'desserts', note: 'A sample menu category' },
] as const;

export const dishes = [
  { id: 'smash', name: 'The Double Smash', category: 'burgers', note: 'Double patty · cheddar · house sauce', price: 950, image: 'smash-burger', badge: 'Sample item' },
  { id: 'korean', name: 'Seoul Good Chicken', category: 'asian', note: 'Sticky glaze · steamed rice · sesame', price: 890, image: 'korean-chicken', badge: 'Sample item' },
  { id: 'goddess', name: 'Green Goddess Bowl', category: 'bowls', note: 'Avocado · greens · lemon dressing', price: 790, image: 'green-goddess', badge: 'Sample item' },
  { id: 'marg', name: 'The Classic Margherita', category: 'pizza', note: 'Tomato · mozzarella · fresh basil', price: 1100, image: 'margherita', badge: 'Sample item' },
  { id: 'noodles', name: 'Chili Crunch Noodles', category: 'asian', note: 'Garlic chili · sesame · herbs', price: 820, image: 'chili-noodles', badge: 'Sample item' },
  { id: 'chicken', name: 'Lemon & Herb Chicken', category: 'bowls', note: 'Roasted potatoes · herbs · lemon', price: 980, image: 'lemon-chicken', badge: 'Sample item' },
  { id: 'brownie', name: 'Warm Brownie Moment', category: 'desserts', note: 'Chocolate · vanilla cream', price: 450, image: 'brownie', badge: 'Sample item' },
  { id: 'mango', name: 'Mango Cloud Parfait', category: 'desserts', note: 'Mango · coconut · whipped yogurt', price: 420, image: 'mango-parfait', badge: 'Sample item' },
] as const;

// These are sample Nairobi areas for the concept's destination-first browse
// flow. Selecting one does not geocode an address or claim merchant coverage.
export const zones = [
  { id: 'cbd', name: 'Nairobi CBD', x: 50, y: 54, aliases: ['cbd', 'central business district', 'nairobi cbd'] },
  { id: 'westlands', name: 'Westlands', x: 29, y: 31, aliases: ['westlands'] },
  { id: 'kilimani', name: 'Kilimani', x: 31, y: 77, aliases: ['kilimani'] },
  { id: 'upperhill', name: 'Upper Hill', x: 62, y: 76, aliases: ['upper hill', 'upperhill'] },
  { id: 'parklands', name: 'Parklands', x: 69, y: 29, aliases: ['parklands'] },
] as const;

/** Match only a named demo neighborhood; this is not geocoding or availability. */
export function findConceptArea(input: string) {
  const normalized = input.toLowerCase().trim().replace(/\s+/g, ' ');
  if (!normalized) return null;
  return zones.find(zone => zone.aliases.some(alias =>
    new RegExp(`(^|[^a-z])${alias.replace(/ /g, '\\s+')}($|[^a-z])`).test(normalized)
  )) ?? null;
}
