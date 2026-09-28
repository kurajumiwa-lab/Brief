export interface ReviewMedia {
  id: string;
  url: string;
  kind: 'image' | 'video';
  alt: string;
}
export interface ReviewGalleryItem extends ReviewMedia {
  reviewId: string;
  name: string;
  title: string;
  rating: number;
  body: string;
}
export interface ReviewSummary {
  count: number;
  average: number | null;
  recommendPercent: number | null;
  recommendCount: number;
  breakdown: { rating: number; count: number; percent: number }[];
  categories: {
    id: string;
    label: string;
    count: number;
    average: number | null;
  }[];
}
export interface ReviewProduct {
  id: string;
  name: string;
  type: string;
  category: string;
  price: number;
  currency: string;
  image: string | null;
  seller: string;
  summary: ReviewSummary;
}
export interface ProductReview {
  id: string;
  rating: number;
  title: string;
  body: string;
  createdAt: string;
  name: string;
  verifiedPurchase: boolean;
  incentivized: boolean;
  recommend: boolean;
  categories: Record<string, number>;
  pros: string[];
  cons: string[];
  size: string;
  color: string;
  variantSource: string;
  media: ReviewMedia[];
  helpful: number;
  notHelpful: number;
  myVote: 'yes' | 'no' | null;
  isMine: boolean;
  canRespond: boolean;
  canVote: boolean;
  response: {
    body: string;
    at: string;
    seller: string;
    verifiedSeller: boolean;
  } | null;
}
export interface ReviewPage {
  product: ReviewProduct;
  summary: ReviewSummary;
  reviews: ProductReview[];
  total: number;
  page: number;
  pages: number;
  pageSize: number;
  from: number;
  to: number;
  featured: ProductReview[];
  focus: ProductReview | null;
  highlights: {
    kind: string;
    themes: { id: string; label: string; count: number }[];
    pros: { text: string; count: number }[];
    cons: { text: string; count: number }[];
  };
  gallery: ReviewGalleryItem[];
  galleryTotal: number;
  photoCount: number;
  videoCount: number;
  variants: { sizes: string[]; colors: string[] };
  related: ReviewProduct[];
  relatedLabel: string;
  capabilities: { aiSummary: boolean; photos: boolean; videos: boolean };
}
export interface ReviewContext {
  isSeller: boolean;
  canModerate: boolean;
  myReview: { id: string; status: string } | null;
  orders: { id: string; date: string; quantity: number }[];
  uploadLimit: number;
}
export interface ReviewInput {
  rating: number;
  title: string;
  body: string;
  orderId: string | null;
  categories: Record<string, number>;
  uploadIds: string[];
  recommend: boolean | null;
  pros: string[];
  cons: string[];
  size: string;
  color: string;
  incentivized: boolean;
  anonymous: boolean;
  consent: boolean;
  key: string;
}
export interface ReviewCatalog {
  products: ReviewProduct[];
  total: number;
  page: number;
  pages: number;
}
export interface ReviewReport {
  id: string;
  reviewId: string;
  reason: string;
  note: string;
  status: string;
  createdAt: string;
  resolution?: string;
  review: (ProductReview & { status: string; listingId: string }) | null;
}
