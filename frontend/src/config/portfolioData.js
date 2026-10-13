/**
 * Creative Portfolio & Freelance Services Configuration
 * ---------------------------------------------------------------------------
 * Easy-to-update source of truth for projects, case studies, services,
 * creative capabilities, process steps, and clearly-labeled sample content.
 *
 * IMPORTANT: All sample projects, metrics, and testimonials are explicitly
 * marked with `isPlaceholder: true` and `placeholderLabel` so visitors and
 * editors can distinguish sample layout content from live client records.
 */

const makeProjectArtwork = ({ bg = "#0D100F", accent = "#10B981", secondary = "#064E3B", label = "BRANDING", title = "Project", grid = "01" }) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="800" height="600">
    <defs>
      <radialGradient id="glow" cx="80%" cy="20%" r="65%">
        <stop offset="0%" stop-color="${accent}" stop-opacity="0.32"/>
        <stop offset="55%" stop-color="${secondary}" stop-opacity="0.16"/>
        <stop offset="100%" stop-color="${bg}" stop-opacity="1"/>
      </radialGradient>
      <linearGradient id="card" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#17251E"/>
        <stop offset="100%" stop-color="#0D100F"/>
      </linearGradient>
    </defs>
    <rect width="800" height="600" fill="${bg}"/>
    <rect width="800" height="600" fill="url(#glow)"/>
    <g stroke="#1F352A" stroke-width="1" opacity="0.65">
      <line x1="64" y1="0" x2="64" y2="600"/>
      <line x1="736" y1="0" x2="736" y2="600"/>
      <line x1="0" y1="88" x2="800" y2="88"/>
      <line x1="0" y1="512" x2="800" y2="512"/>
    </g>
    <rect x="96" y="120" width="608" height="360" rx="28" fill="url(#card)" stroke="${accent}" stroke-opacity="0.35" stroke-width="1.5"/>
    <circle cx="610" cy="220" r="78" fill="${accent}" fill-opacity="0.14" stroke="${accent}" stroke-opacity="0.45" stroke-width="1.5"/>
    <circle cx="610" cy="220" r="36" fill="${accent}" fill-opacity="0.28"/>
    <text x="136" y="178" fill="${accent}" font-family="system-ui, -apple-system, sans-serif" font-size="15" font-weight="700" letter-spacing="3.5">${label} · SAMPLE ${grid}</text>
    <text x="136" y="290" fill="#F3F7F4" font-family="system-ui, -apple-system, sans-serif" font-size="42" font-weight="800" letter-spacing="-1">${title}</text>
    <rect x="136" y="332" width="140" height="8" rx="4" fill="${accent}" fill-opacity="0.7"/>
    <rect x="136" y="354" width="240" height="6" rx="3" fill="#8FA89B" fill-opacity="0.35"/>
    <text x="136" y="438" fill="#9BB5A6" font-family="monospace" font-size="14" letter-spacing="1.5">EDITORIAL CASE STUDY PREVIEW</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

export const PORTFOLIO_NAVIGATION = [
  { id: "overview", label: "Overview", href: "#overview" },
  { id: "work", label: "Work", href: "#work" },
  { id: "case-studies", label: "Case Studies", href: "#case-studies" },
  { id: "services", label: "Services", href: "#services" },
  { id: "process", label: "About & Process", href: "#process" },
  { id: "inquire", label: "Start a Project", href: "#inquire" },
];

export const PORTFOLIO_DISCIPLINES = [
  { value: "All", label: "All", description: "All selected creative works across disciplines" },
  { value: "Branding", label: "Branding", description: "Visual identity systems, wordmarks, and brand guidelines" },
  { value: "Web Design", label: "Web Design", description: "Digital flagships, interactive design systems, and web platforms" },
  { value: "Print", label: "Print", description: "Packaging, editorial publications, tactile collateral, and signage" },
  { value: "Motion", label: "Motion", description: "Kinetic typography, launch reels, and animated brand toolkits" },
];

export const DEFAULT_CREATIVE_IDENTITY = {
  headline: "I design brands that people remember.",
  subheadline:
    "Independent creative studio blending strategic brand identity, editorial web design, tactile print systems, and expressive motion. Replace this sample introduction with your own personal story.",
  studioTagline: "Creative Portfolio & Freelance Studio",
  availability: {
    status: "Available for select projects",
    window: "Booking new creative commissions",
    responseTime: "Replies within 24 hours",
    mode: "Remote & on-location studio collaborations",
  },
  isPlaceholder: true,
};

export const INITIAL_PORTFOLIO_PROJECTS = [
  {
    id: "proj-branding-01",
    title: "Kibo Botanicals — Identity & Apothecary System",
    subtitle: "Visual identity, custom wordmark, and tactile label architecture for a botanical skincare house.",
    discipline: "Branding",
    year: "2026",
    role: "Brand Direction & Identity Design",
    timeline: "4 weeks (Sample)",
    featured: true,
    isPlaceholder: true,
    placeholderLabel: "Placeholder sample project",
    thumbnail: makeProjectArtwork({
      accent: "#10B981",
      secondary: "#065F46",
      label: "BRANDING",
      title: "Kibo Botanicals",
      grid: "01",
    }),
    deliverables: ["Brand Strategy", "Logotype & Monogram", "Color & Type System", "Brand Guidelines"],
    caseStudy: {
      challenge:
        "Sample Challenge: Create a calm, high-contrast visual identity that stands out on both physical apothecary shelves and dark-mode digital storefronts without relying on generic wellness clichés.",
      process:
        "Sample Process: Conducted typographic audits, material testing on uncoated cotton stocks, and modular grid explorations inspired by East African botanical herbarium archives.",
      concepts:
        "Sample Concepts: Explored three territories — (1) Archival Specimen Labels, (2) Monolithic Emerald Geometry, and (3) Expressive Serif Editorial — converging on a disciplined editorial identity.",
      finalDeliverables: [
        "Primary wordmark, botanical seal, and responsive monogram",
        "48-page digital and print brand guidelines book",
        "Packaging label grid for 12 SKU formats",
        "Art direction toolkit for studio photography",
      ],
      results:
        "Placeholder Sample Outcome: Replace this block with verified client metrics (e.g., launch conversion lift, retail stockist adoption, or audience response) once your real project is added.",
      gallery: [
        makeProjectArtwork({ accent: "#10B981", label: "IDENTITY SYSTEM", title: "Wordmark & Seal", grid: "01A" }),
        makeProjectArtwork({ accent: "#34D399", label: "TYPOGRAPHY", title: "Editorial Hierarchy", grid: "01B" }),
        makeProjectArtwork({ accent: "#059669", label: "GUIDELINES", title: "System Architecture", grid: "01C" }),
      ],
    },
  },
  {
    id: "proj-web-02",
    title: "Solstice Roasters — Digital Flagship & Subscription Experience",
    subtitle: "Editorial e-commerce flagship and origin-storytelling platform with dark-emerald aesthetic.",
    discipline: "Web Design",
    year: "2026",
    role: "Lead Product & Web Designer",
    timeline: "5 weeks (Sample)",
    featured: true,
    isPlaceholder: true,
    placeholderLabel: "Placeholder sample project",
    thumbnail: makeProjectArtwork({
      accent: "#34D399",
      secondary: "#047857",
      label: "WEB DESIGN",
      title: "Solstice Digital",
      grid: "02",
    }),
    deliverables: ["Design System", "Responsive Web UI", "Interactive Prototypes", "Component Library"],
    caseStudy: {
      challenge:
        "Sample Challenge: Translate the sensory craft of specialty coffee roasting into a fast, mobile-first web experience that guides visitors from harvest stories to recurring subscriptions.",
      process:
        "Sample Process: Mapped buyer journeys, built a token-driven dark interface system, and prototyped micro-interactions for tasting-note filters and subscription cadence selectors.",
      concepts:
        "Sample Concepts: Paired high-contrast editorial serif headlines with utilitarian monospace tasting cards so each coffee lot reads like a collector's release.",
      finalDeliverables: [
        "Responsive 14-screen web design system in Figma",
        "Interactive flavour-compass and roast selector",
        "Accessible dark-theme token specification",
        "Developer handoff documentation",
      ],
      results:
        "Placeholder Sample Outcome: Replace with your real launch metrics or client feedback.",
      gallery: [
        makeProjectArtwork({ accent: "#34D399", label: "WEB FLAGSHIP", title: "Landing Experience", grid: "02A" }),
        makeProjectArtwork({ accent: "#10B981", label: "DESIGN TOKENS", title: "Component Grid", grid: "02B" }),
      ],
    },
  },
  {
    id: "proj-print-03",
    title: "Atelier Monograph — Exhibition Catalogue & Packaging",
    subtitle: "Foil-stamped collector edition publication, slipcase packaging, and wayfinding print suite.",
    discipline: "Print",
    year: "2025",
    role: "Editorial & Packaging Designer",
    timeline: "3 weeks (Sample)",
    featured: false,
    isPlaceholder: true,
    placeholderLabel: "Placeholder sample project",
    thumbnail: makeProjectArtwork({
      accent: "#6EE7B7",
      secondary: "#064E3B",
      label: "PRINT",
      title: "Atelier Monograph",
      grid: "03",
    }),
    deliverables: ["Editorial Layout", "Structural Packaging", "Print Prepress", "Exhibition Signage"],
    caseStudy: {
      challenge:
        "Sample Challenge: Design a 160-page bilingual exhibition publication and protective slipcase that honours architectural photography while remaining durable for travelling shows.",
      process:
        "Sample Process: Developed a 12-column Swiss-inspired baseline grid, selected deep forest-dyed board stocks, and oversaw press checks for metallic emerald foil stamping.",
      concepts:
        "Sample Concepts: Contrasted raw exposed-spine binding with precision typographic index tabs for effortless chapter navigation.",
      finalDeliverables: [
        "160-page print-ready monograph layout",
        "Die-line and prepress package for slipcase box",
        "Large-format gallery wall vinyls and wayfinding cards",
      ],
      results:
        "Placeholder Sample Outcome: Add print run details or exhibition notes here.",
      gallery: [
        makeProjectArtwork({ accent: "#6EE7B7", label: "EDITORIAL PRINT", title: "Spread System", grid: "03A" }),
        makeProjectArtwork({ accent: "#10B981", label: "PACKAGING", title: "Foil Slipcase", grid: "03B" }),
      ],
    },
  },
  {
    id: "proj-motion-04",
    title: "Pulse Audio — Kinetic Identity & Launch Reel",
    subtitle: "Sound-reactive motion system, animated typography, and social launch toolkit.",
    discipline: "Motion",
    year: "2026",
    role: "Motion & Visual Designer",
    timeline: "3 weeks (Sample)",
    featured: true,
    isPlaceholder: true,
    placeholderLabel: "Placeholder sample project",
    thumbnail: makeProjectArtwork({
      accent: "#A7F3D0",
      secondary: "#065F46",
      label: "MOTION",
      title: "Pulse Kinetic",
      grid: "04",
    }),
    deliverables: ["Motion Guidelines", "60s Launch Reel", "Logo Idents", "Social Motion Templates"],
    caseStudy: {
      challenge:
        "Sample Challenge: Give a static geometric mark a distinctive behaviour in motion across product reveals, UI loading states, and vertical social formats.",
      process:
        "Sample Process: Built custom easing curves, audio-frequency expression rigs, and modular motion templates that internal teams can render in under five minutes.",
      concepts:
        "Sample Concepts: Treated typography as an acoustic waveform — expanding, contracting, and locking to the grid on rhythmic beats.",
      finalDeliverables: [
        "Master 60-second 4K brand launch film",
        "Looping 3D/2D logo idents and lower thirds",
        "Reusable motion system & easing cheat-sheet",
      ],
      results:
        "Placeholder Sample Outcome: Replace with campaign reach or client feedback.",
      gallery: [
        makeProjectArtwork({ accent: "#A7F3D0", label: "KINETIC TYPE", title: "Motion Frames", grid: "04A" }),
        makeProjectArtwork({ accent: "#10B981", label: "LAUNCH REEL", title: "Storyboard Sequence", grid: "04B" }),
      ],
    },
  },
];

export const CREATIVE_CAPABILITIES = [
  {
    id: "cap-branding",
    discipline: "Branding",
    title: "Brand Identity & Visual Systems",
    description: "Distinctive positioning, custom typography, marks, and guidelines built for longevity.",
    skills: ["Brand Strategy", "Visual Identity", "Art Direction", "Design Guidelines"],
  },
  {
    id: "cap-web",
    discipline: "Web Design",
    title: "Digital Websites & Interactive Design",
    description: "High-craft marketing sites, portfolios, and design systems with clean semantic structure.",
    skills: ["UI/UX Direction", "Design Systems", "Interactive Prototyping", "Responsive Web"],
  },
  {
    id: "cap-print",
    discipline: "Print",
    title: "Packaging & Editorial Print",
    description: "Tactile packaging, books, lookbooks, and environmental graphics from concept to press.",
    skills: ["Packaging Systems", "Editorial Layout", "Typography", "Prepress Production"],
  },
  {
    id: "cap-motion",
    discipline: "Motion",
    title: "Motion Design & Launch Assets",
    description: "Kinetic identity systems, product launch films, and expressive social toolkits.",
    skills: ["Kinetic Typography", "Logo Animation", "Launch Reels", "Social Toolkits"],
  },
];

export const CREATIVE_PROCESS_STEPS = [
  {
    step: "01",
    title: "Discovery & Brief",
    description: "We align on your goals, audience, deliverables, timeline, and what makes your brand unmistakable.",
  },
  {
    step: "02",
    title: "Creative Direction",
    description: "Exploration of visual territories, typography, colour palettes, and interactive or tactile concepts.",
  },
  {
    step: "03",
    title: "Design & Craft",
    description: "Iterative execution of the chosen direction across identity, web, print, or motion touchpoints.",
  },
  {
    step: "04",
    title: "Delivery & Launch",
    description: "Production-ready source files, comprehensive usage guidelines, and smooth launch support.",
  },
];

export const SERVICE_PACKAGES = [
  {
    id: "svc-identity",
    title: "Brand Identity System",
    discipline: "Branding",
    priceLabel: "Custom quote · Scoped per project",
    timeline: "3–4 weeks",
    summary: "For new ventures or rebrands needing a cohesive visual identity and clear brand world.",
    features: [
      "Primary & secondary logotype + monogram",
      "Colour palette, typography & layout system",
      "Core collateral or packaging templates",
      "Comprehensive brand guidelines document",
    ],
    ctaLabel: "Inquire about Branding",
    isPlaceholder: true,
  },
  {
    id: "svc-web",
    title: "Web Design & Digital Flagship",
    discipline: "Web Design",
    priceLabel: "Custom quote · Scoped per project",
    timeline: "3–5 weeks",
    summary: "For brands and studios that need an unforgettable website that converts visitors into clients.",
    features: [
      "Information architecture & editorial storytelling",
      "Custom dark or light UI design system",
      "Responsive desktop & mobile layouts",
      "Interactive states & developer-ready specs",
    ],
    ctaLabel: "Inquire about Web Design",
    isPlaceholder: true,
  },
  {
    id: "svc-print",
    title: "Packaging & Print Suite",
    discipline: "Print",
    priceLabel: "Custom quote · Scoped per project",
    timeline: "2–3 weeks",
    summary: "For physical products, publications, and events requiring tactile print craft.",
    features: [
      "Structural dielines & label systems",
      "Editorial books, lookbooks & catalogues",
      "Paper stock, foil & finish specification",
      "Press-ready production files",
    ],
    ctaLabel: "Inquire about Print",
    isPlaceholder: true,
  },
  {
    id: "svc-motion",
    title: "Motion & Launch Toolkit",
    discipline: "Motion",
    priceLabel: "Custom quote · Scoped per project",
    timeline: "2–3 weeks",
    summary: "For launches and campaigns that need kinetic energy across digital screens.",
    features: [
      "Animated logo idents & transitions",
      "Hero launch video or product reel",
      "Kinetic typography & motion principles",
      "Modular social & campaign templates",
    ],
    ctaLabel: "Inquire about Motion",
    isPlaceholder: true,
  },
];

export const PLACEHOLDER_TESTIMONIALS = [
  {
    id: "test-1",
    quote:
      "Placeholder testimonial — replace this sample quote with real feedback from a client about your creative process, communication, and final deliverables.",
    author: "Sample Client Name (Placeholder)",
    role: "Founder / Creative Director · Sample Brand",
    project: "Brand Identity System",
    isPlaceholder: true,
  },
  {
    id: "test-2",
    quote:
      "Placeholder testimonial — add a real client endorsement highlighting how your design work elevated their brand presence or digital launch.",
    author: "Sample Client Name (Placeholder)",
    role: "Head of Product · Sample Studio",
    project: "Web Design & Digital Flagship",
    isPlaceholder: true,
  },
];

export const HIERARCHY_TRANSFORMATION_MAP = [
  { existing: "No open call-ups", portfolio: "Featured work & live availability status" },
  { existing: "Browse by work category", portfolio: "Filter projects by creative discipline (All, Branding, Web Design, Print, Motion)" },
  { existing: "Active shift card", portfolio: "Current availability & studio booking status" },
  { existing: "Work portfolio & skill cards", portfolio: "Selected projects & creative capabilities" },
  { existing: "Squad and Brief", portfolio: "About, 4-step creative process & services" },
  { existing: "Post a Job", portfolio: "Start a Project (client brief & booking)" },
  { existing: "KES shift rates", portfolio: "Service packages & custom project quotes" },
];
