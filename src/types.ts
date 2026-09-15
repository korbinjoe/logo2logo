export type Locale = "en" | "zh";
export type PlanId = "starter" | "creator" | "studio";
export type ProviderId = "google" | "github";
export type ThemeCategory = "all" | "light" | "dark" | "playful";
export interface Variant {
  colors?: string[];
  file: string;
  tags: string[];
}
export interface Brand extends Variant {
  id: string;
  name: string;
  url: string;
  variants: Variant[];
}
export interface DesignSpec {
  subject?: string;
  recognitionCue?: string;
  constructionZh?: string;
  [key: string]: unknown;
}
export interface Concept {
  id?: string;
  name?: string;
  thesis?: string;
  prompt?: string;
  seed?: number;
  sourceId?: string;
  referenceId?: string;
  referenceFile?: string;
  promptVersion?: string;
  designSpec?: DesignSpec;
  variation?: string;
  locale?: Locale;
  phase?: string;
}
export interface Review {
  status: "pass" | "reject" | "unreviewed";
  reason?: string;
}
export interface OutputMetadata {
  designSpec?: DesignSpec;
  prompt?: string;
  review?: Review;
}
export interface SavedOutput {
  id: string;
  c: Concept;
  color: string | null;
  discarded: boolean;
  selected: boolean;
}
export interface Draft {
  description: string;
  style: string;
  referenceId: string;
  referenceFile: string;
}
export interface Preferences {
  version: 1;
  gallery: { query: string; filter: string; visible: number };
  draft: Draft;
  themeCategory: ThemeCategory;
  selectedPlan: PlanId | null;
  loginProvider: ProviderId | null;
  section: "inspiration" | "pricing" | "briefForm" | "board" | "history" | null;
  disclosures: Record<string, boolean>;
  workspaces: Record<string, SavedOutput[]>;
  brandPreviews: Record<string, string>;
  brandReactions: Record<
    string,
    { vote: "like" | "dislike" | null; favorite: boolean }
  >;
  galleryCollection: "all" | "liked" | "disliked" | "favorites";
  galleryOrder: string[];
  heroMotion: boolean;
}
export interface Account {
  id: string;
  name: string;
  credits: number;
}
export interface CreditPlan {
  id: PlanId;
  amount: number;
  credits: number;
}
export interface AccountResponse {
  isAdmin?: boolean;
  user: Account | null;
  localMode: boolean;
  billingReady: boolean;
  paymentEnvironment?: string;
  paymentProvider?: "paypal";
  providers: { id: ProviderId; enabled: boolean }[];
  plans: CreditPlan[];
  socials: Partial<Record<"github" | "x" | "youtube", string>>;
  designs: { output: string }[];
}
export interface ApiFailure {
  error?: string;
  message?: string;
  code?: string;
  requestId?: string;
  field?: string;
  name?: string;
}
export interface PlanInput {
  locale: Locale;
  description: string;
  style: string;
  referenceId: string;
  referenceFile: string;
}
export interface PlanResponse {
  status: "partial" | "complete";
  territories: Concept[];
  failures?: ApiFailure[];
  resumeId: string;
  requestId?: string;
}
export interface GenerationEvent extends ApiFailure {
  completed?: number;
  total?: number;
  stage?: string;
  imageUrl?: string;
  id?: string;
  review?: Review;
}

export interface HistoryItem {
  id: string;
  createdAt: string;
  title: string;
  review: Review["status"];
  phase: string;
  unavailable?: boolean;
  c: Concept;
}
export interface HistoryPage {
  pending?: { id: string }[];
  items: HistoryItem[];
  total: number;
  page: number;
  hasMore: boolean;
}
