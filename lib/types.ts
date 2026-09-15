import type { IncomingMessage, ServerResponse } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import type { Client } from "@libsql/client";
export type Locale = "en" | "zh";
export type Environment = Record<string, string | undefined>;
export type HttpHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => Promise<unknown> | unknown;
export type SqlValue = string | number | null;
export interface User {
  id: string;
  name: string;
  credits: number;
}
export interface Plan {
  id: string;
  name?: string;
  amount: number;
  credits: number;
}
export interface Identity {
  user_id: string;
}
export interface OAuthRow {
  state: string;
  browser: string;
  provider: string;
  verifier: string;
  expires: number;
}
export interface Order {
  id: string;
  user_id: string;
  plan: string;
  amount: number;
  credits: number;
  currency: string;
  session: string | null;
  paid: number;
  refunded: number;
}
export interface Job {
  id: string;
  user_id: string;
  status: "reserved" | "complete" | "released";
  output: string | null;
  created: number;
}
export interface HistoryEntry {
  output: string;
  created: number;
}
export interface Payment {
  orderId?: string;
  userId?: string;
  id: string;
  status: string;
  currency: string;
  amount: number;
}
export interface Refund {
  cumulative?: boolean;
  id: string;
  session: string;
  amount: number;
}
export interface AccountOperations {
  designs(userId: string): { output: string }[];
  history(
    userId: string,
    page?: number,
    limit?: number,
  ): { items: HistoryEntry[]; total: number };
  user(id: string): User | undefined;
  identify(provider: string, subject: string, name: string): User;
  grantWelcomeCredits(userId: string): boolean;
  session(userId: string): string;
  authenticate(raw?: string): User | null;
  logout(raw?: string): void;
  startOAuth(
    provider: string,
    browser: string,
  ): { state: string; verifier: string };
  finishOAuth(state: string, browser: string, provider: string): string;
  requireCredits(userId: string, count?: number): void;
  limitPlanning(userId: string): void;
  reserve(userId: string): string;
  complete(id: string, output: string): void;
  release(id: string): void;
  owns(userId: string, output: string): boolean;
  order(userId: string, plan: Plan): string;
  setCheckout(id: string, session: string): void;
  fulfill(payment: Payment): boolean;
  refund(refund: Refund): void;
  checkoutOrder(session: string | null, userId: string): Order | undefined;
}
export type AsyncOperations = {
  [K in keyof AccountOperations]: AccountOperations[K] extends (
    ...args: infer A
  ) => infer R
    ? (...args: A) => Promise<R>
    : never;
};
export type AccountStore = AccountOperations | AsyncOperations;
export type LocalAccounts = AccountOperations & {
  db: DatabaseSync;
  close(): void;
};
export type RemoteAccounts = AsyncOperations & {
  db: Client;
  close(): void;
  query<T = Record<string, unknown>>(
    sql: string,
    ...args: SqlValue[]
  ): Promise<T[]>;
  execute(sql: string, ...args: SqlValue[]): Promise<{ changes: number }>;
  transaction<T>(work: () => Promise<T>): Promise<T>;
};
export interface Variant {
  file: string;
  tags: string[];
  colors: string[];
  features: string;
}
export interface Brand extends Variant {
  id: string;
  name: string;
  url: string;
  variants: Variant[];
  visualStyle?: string | null;
}
export interface DesignSpec {
  brandName: string;
  name: string;
  subject: string;
  recognitionCue: string;
  avoid: string;
  markType: "symbol" | "lettermark" | "wordmark";
  lettering: string;
  rationale: string;
  constructionZh: string;
  construction: string;
  signature: string;
  palette: string;
  geometry: "angular" | "rounded" | "organic" | "typographic";
}
export interface DesignInput {
  description?: string;
  style?: string;
  resumeId?: string;
  accountId?: string | null;
  prompt?: string;
  name?: string;
  thesis?: string;
  referenceId?: string;
  referenceFile?: string;
  sourceId?: string;
  locale?: Locale;
  promptVersion?: string;
  designSpec?: Partial<DesignSpec>;
  variation?: string;
  seed?: number;
  width?: number;
  height?: number;
  steps?: number;
}
export interface Concept extends DesignInput {
  id: string;
  prompt: string;
  designSpec: DesignSpec;
  phase?: string;
  routeId?: string;
}
export interface Review {
  status: "pass" | "reject" | "unreviewed";
  reason: string;
  observed?: string;
  model?: string;
}
export interface Metadata extends DesignInput {
  createdAt?: string;
  concept?: DesignInput;
  review?: Review;
  backend?: string;
  renderMode?: string;
  model?: string;
  referenceImage?: string;
}
export interface GenerationEvent extends Metadata {
  id?: string;
  jobId?: string;
  done?: boolean;
  imageUrl?: string;
  stage?: string;
  completed?: number;
  total?: number;
  error?: string;
}
export interface Checkpoint {
  concepts: DesignSpec[];
  territories: Concept[];
  model?: string;
  providerSessionId?: string;
}
export interface PlanningSession {
  id: string;
  checkpoint: Checkpoint;
  reference?: Brand | null;
  referenceLoaded?: boolean;
  fingerprint?: string;
  touched?: number;
  busy?: boolean;
}
export interface PlanningIssue {
  code: string;
  field?: string;
  message: string;
}
export interface PlanningResult {
  status: "partial" | "complete";
  name: string;
  plannerModel: string;
  summary: string;
  promptVersion: string;
  territories: Concept[];
  failures: (PlanningIssue & {
    routeId: string;
    name: string;
    attempts: number;
  })[];
}
export interface CloudJobRow extends Job {
  fingerprint: string;
  input: string;
  endpoint: string;
  request_id: string | null;
  lease: string | null;
  lease_until: number;
  error: string | null;
  metadata: string | null;
  callback_hash: string;
}
export interface CloudJob extends Omit<CloudJobRow, "input" | "metadata"> {
  input: DesignInput;
  metadata: Metadata | null;
}
export interface PlanningRow {
  id: string;
  fingerprint: string;
  data: string;
  expires: number;
  lease: string | null;
  lease_until: number;
}
export interface ObjectStorage {
  read(id: string): Promise<Buffer>;
  put(id: string, bytes: Buffer): Promise<void>;
}
export interface ModelResponse {
  message?: { content?: string; thinking?: string };
  done_reason?: string;
  eval_count?: number;
}
export interface ChatMessage {
  role: string;
  content: string;
  images?: string[];
}
export interface ModelRequest {
  model: string;
  messages: ChatMessage[];
  format: unknown;
  options?: { num_predict?: number };
}
export interface LegacyBrief {
  name?: string;
  category?: string;
  audience?: string;
  personality?: string;
  story?: string;
  colors?: string;
  avoid?: string;
  seed?: number;
}
export interface EditorStatus {
  state: string;
  detail?: string;
  modelPath?: string;
  passed?: boolean;
}
