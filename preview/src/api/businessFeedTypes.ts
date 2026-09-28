export type BusinessKind =
  'tool' | 'offer' | 'campaign' | 'task' | 'request' | 'playbook';
export interface FeedControls {
  topic: string;
  location: string;
  stage: string;
  budget: number | null;
  rememberActivity: boolean;
}
export interface FeedPreferences extends FeedControls {
  hiddenCount: number;
  followingCount: number;
  activityCount: number;
}
export interface BusinessCard {
  key: string;
  kind: BusinessKind;
  title: string;
  summary: string;
  scope: 'public' | 'private';
  source: string;
  vendorId: string | null;
  location: string;
  image: string | null;
  topics: string[];
  stages: string[];
  createdAt: string | null;
  price: string | null;
  priceNote: string;
  spend: number | null;
  href: string | null;
  cta: string;
  reviews: { count: number; average: number | null; href: string } | null;
  steps: [string, string][] | null;
  action: { label: string; href?: string; filter?: string } | null;
  blockers: string[];
  work?: {
    mode: string;
    remaining: number;
    deadline: string;
    eligible: boolean;
  };
  saved: boolean;
  hidden: boolean;
  following: boolean;
  score: number;
  reasons: { points: number; label: string }[];
}
export interface BusinessFeedPage {
  items: BusinessCard[];
  total: number;
  page: number;
  pages: number;
  focus: BusinessCard | null;
  focusUnavailable: boolean;
  preferences: FeedPreferences;
  applied: FeedControls;
  authenticated: boolean;
  topics: { id: string; label: string }[];
  availability: { commerce: boolean; workforce: boolean; matching: boolean };
  rankingVersion: number;
}
export interface BusinessFeedAction {
  key: string;
  action: 'save' | 'hide' | 'follow' | 'open' | 'share';
  value?: boolean;
}
