// ---------------------------------------------------------------------------
// STORY DESIGN — the shared editorial presentation system.
//
// One vocabulary, rendered identically in three places: the full-screen
// editor's live preview, the reader, and the home shelf. The server validates
// and stores a design; this module turns it into visual tokens.
//
// Presets make it fast (4 themes x 4 layouts); freehand overrides (accent,
// overlay strength) make it yours. Nothing here invents data — it renders.
// ---------------------------------------------------------------------------

export interface StoryDesign {
  theme: string;
  layout: string;
  accent: string | null;
  overlay: number;
}

export const DEFAULT_DESIGN: StoryDesign = { theme: 'classic', layout: 'center', accent: null, overlay: 0.55 };

export interface StoryTheme {
  id: string;
  label: string;
  blurb: string;
  /** Page surface for the article body. */
  surface: string;
  /** Primary ink on that surface. */
  ink: string;
  /** Secondary ink (kicker, meta). */
  inkDim: string;
  /** The theme's own accent when the editor has not freehand-set one. */
  defaultAccent: string;
  /** Title typography. */
  titleClass: string;
  /** Hairline colour for rules/borders inside the article. */
  line: string;
}

export const STORY_THEMES: StoryTheme[] = [
  {
    id: 'classic',
    label: 'Classic',
    blurb: 'Clean paper, dark ink.',
    surface: 'var(--color-paper)',
    ink: '#0D1117',
    inkDim: 'rgba(10, 14, 20, 0.62)',
    defaultAccent: '#40916C',
    titleClass: 'font-display text-3xl font-bold leading-tight',
    line: 'var(--brief-line)'
  },
  {
    id: 'noir',
    label: 'Noir',
    blurb: 'Night edition — light ink on near-black.',
    surface: '#0D1117',
    ink: 'var(--color-paper)',
    inkDim: 'rgba(255, 255, 255, 0.65)',
    defaultAccent: '#40916C',
    titleClass: 'font-display text-3xl font-bold leading-tight',
    line: 'rgba(255, 255, 255, 0.22)'
  },
  {
    id: 'poster',
    label: 'Poster',
    blurb: 'Big display type, loud and simple.',
    surface: 'var(--color-paper)',
    ink: '#0D1117',
    inkDim: 'rgba(10, 14, 20, 0.55)',
    defaultAccent: '#40916C',
    titleClass: 'text-4xl font-extrabold leading-[1.05] tracking-tight',
    line: '#0D1117'
  },
  {
    id: 'gazette',
    label: 'Gazette',
    blurb: 'Warm paper, ruled and quiet.',
    surface: '#FFF8F0',
    ink: '#0D1117',
    inkDim: 'rgba(10, 14, 20, 0.62)',
    defaultAccent: '#40916C',
    titleClass: 'font-display text-2xl font-bold leading-snug',
    line: '#7A8494'
  }
];

export interface StoryLayout {
  id: string;
  label: string;
  blurb: string;
}

export const STORY_LAYOUTS: StoryLayout[] = [
  { id: 'center', label: 'Centered', blurb: 'Text centred under the hero.' },
  { id: 'left', label: 'Left rail', blurb: 'A strong left-aligned column.' },
  { id: 'full-bleed', label: 'Full-bleed', blurb: 'Hero fills the frame, type over it.' },
  { id: 'split', label: 'Split', blurb: 'Hero beside the text.' }
];

export function themeFor(design: StoryDesign | null | undefined): StoryTheme {
  const id = design?.theme;
  return STORY_THEMES.find((t) => t.id === id) ?? STORY_THEMES[0];
}

export function layoutFor(design: StoryDesign | null | undefined): StoryLayout {
  const id = design?.layout;
  return STORY_LAYOUTS.find((l) => l.id === id) ?? STORY_LAYOUTS[0];
}

/** The effective accent: the editor's freehand colour, else the theme's own. */
export function accentFor(design: StoryDesign | null | undefined): string {
  if (design?.accent && /^#[0-9A-Fa-f]{6}$/.test(design.accent)) return design.accent;
  return themeFor(design).defaultAccent;
}

/** Normalize any article's design (old rows predating design default safely). */
export function designOf(article: any): StoryDesign {
  const d = article?.design ?? {};
  return {
    theme: d.theme ?? DEFAULT_DESIGN.theme,
    layout: d.layout ?? DEFAULT_DESIGN.layout,
    accent: d.accent ?? null,
    overlay: typeof d.overlay === 'number' ? d.overlay : DEFAULT_DESIGN.overlay
  };
}

/** The veil over a hero photo, at the design's strength. Dark at the bottom. */
export function heroVeil(design: StoryDesign | null | undefined): string {
  const o = Math.min(0.9, Math.max(0, designOf(design).overlay));
  const mid = Math.round(o * 45) / 100;
  return `linear-gradient(180deg, rgba(9,11,16,${(o * 0.25).toFixed(2)}) 0%, rgba(9,11,16,${mid.toFixed(2)}) 55%, rgba(9,11,16,${o.toFixed(2)}) 100%)`;
}
