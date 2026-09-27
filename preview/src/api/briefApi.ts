// ---------------------------------------------------------------------------
// BRIEF API CLIENT
//
// One place where the frontend talks to the ingestion + feature-schema server.
// App.tsx currently calls fetch() inline for connectors; this module is the
// layer those calls should migrate to, and the only layer Phase 4 UI will use.
//
// Design rules enforced here:
//
//   1. Nothing throws. Every function returns ApiResult<T> so one dead
//      endpoint degrades one surface instead of breaking Brief.
//   2. Authoritative economic values are never sent. The update/create types
//      exclude currentValue/progress, so attempting to fake progress is a
//      COMPILE error, not a silent runtime no-op.
//   3. Capabilities the server does not have are reported as unavailable
//      rather than stubbed.
// ---------------------------------------------------------------------------

import type { ApiResult, Block, ResaleTicket, ResaleListing,  ResaleListingRow, TicketOrder, CapabilityUnavailable, Circle, CircleCreate, CircleUpdate, Member, Signal, TargetView, AppConfig, ReleaseStatus, AuthStatus, Campaign, CampaignCreate, CampaignUpdate, PublicCampaign, Registration, RegistrationStatus, ShareChannel, ShareLink, ShareChannels, CampaignShare, CampaignBanner, Venue, MediaUpload, MediaStorageStatus, TriageQueue, Subscription, Subscriber, SubscriptionJoin, PaymentConfirmation, Transaction, TransactionCreate, TransactionStatus, VerificationKind, Wallet, Source, RawItem, VoteTally, MemberEvidence, BriefItPreview, BriefItSaved, Vendor, VendorCreate, VendorUpdate, Listing, ListingRevision, ListingCreate, ListingUpdate, ListingStatus, Order, OrderCreate, Dispute, VendorEarnings, PaymentIntent, PaymentInitiation, Vault, VaultCreate, Footstep, FootstepPage, VaultRequest, VaultSearchResult, ResolutionItem, VaultEntry, Ticket, CheckInResult, CommandCentre, Space, SpaceCreate, SpaceMode, SpaceOfferCreate, SpaceActivity, SpaceConversation, SpaceQuote, SpacePaymentPrompt, SpaceExpense, SpaceCustomerTab, SpaceMoneySummary, SpaceDispatch, SpaceDispatchCreate, SpaceDispatchStatus, SpaceUpdate, PublicSpace, SpaceFieldStatus, SpaceMaintenance, SpaceEditorialItem, SpacePipeline, SpacePublicPageView, SpacePublicFace, GuardianNetwork, SpaceGuardian, RoleAssignment, Invite, IssueInviteInput, RedeemInviteResult, ShopBrief, ShopBriefPrefs, ShopBriefFlag, ShopBriefSpace, ShopBriefPerson } from "./types";
import { enqueue, replayQueue, queueDepth, type QueuedWrite } from './offlineQueue';
import { asTarget } from './types';
import type { SpaceBroadcast, SpaceInsights, SpaceTemplate, PlaceSnapshot, PlacePriceClaim, PlacePriceClaimInput, MapPlace, EventRecurrence } from './types';
import {
  areBlocks, areCampaigns, areCircles, areMembers, areRegistrations,
  areSignals, areTransactions, isAuthStatus, isCampaign, isCircle, isBlock,
  isAppConfig, isMember, isProviderStatus, isPublicCampaign, isRegistration,
  isTransaction, isWallet, isCampaignShare, isCampaignBanner, areCampaignBanners, isPaymentConfirmation,
  areSources, areRawItems, isBriefItPreview, isVoteTally, isMemberEvidence,
  isVendor, areVendors, isListing, areListings, isOrder, areOrders,
  isDispute, areDisputes, isPaymentIntent, arePaymentIntents,
  isVault, areVaults, isFootstep, areFootsteps, isVaultRequest, areVaultRequests, isTicket, isCommandCentre,
  isTeaArticle, areTeaArticles, isMediaUpload, areMediaUploads,
  isTriageQueue, isSubscription, areSubscriptions, isSubscriber,
  areSubscribers, isSubscriptionJoin
} from './validate';

/**
 * The dev server proxies /ingest -> the API. The browser is not the sandbox,
 * so this must stay a relative path: never call localhost from client code.
 */
export const INGEST_API = '/ingest';
// How long a request may wait before we abort it and report a timeout. A
// stalled connection (half-open socket on a flaky mobile network) otherwise
// hangs the UI forever — the exact "button spins forever" failure.
const REQUEST_TIMEOUT_MS = 15000;
/** Shared with /api/config so a deployed frontend can detect an older API. */
export const CLIENT_API_CONTRACT = 'gallery-banners-v1';

// ---------------------------------------------------------------------------
// SESSION
//
// The token lives in ONE place and is attached by `request()`, so no call site
// can forget it and no component ever handles a credential directly.
//
// localStorage rather than a JS-readable cookie: the app is a single-page
// client talking to an API on another origin, and a cookie would not be sent
// cross-origin without further configuration. The trade-off (XSS can read it)
// is the same either way for a non-httpOnly cookie.
// ---------------------------------------------------------------------------

const TOKEN_KEY = 'brief_session';
let memoryToken: string | null = null;

export function setSessionToken(token: string | null): void {
  memoryToken = token;
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Private browsing or a blocked store: the in-memory copy still works for
    // this session rather than the app failing to sign in at all.
  }
}

export function getSessionToken(): string | null {
  if (memoryToken) return memoryToken;
  try {
    memoryToken = window.localStorage.getItem(TOKEN_KEY);
  } catch {
    memoryToken = null;
  }
  return memoryToken;
}

/** Called when the server reports a dead session, so the UI can re-prompt. */
let onSessionExpired: (() => void) | null = null;
export function setSessionExpiredHandler(fn: (() => void) | null): void {
  onSessionExpired = fn;
}

async function request<T>(
  path: string,
  init?: RequestInit,
  // Returning undefined is how a selector reports "the server answered 200 but
  // the body is not the shape we expect". Narrowed below into a real error.
  select?: (raw: any) => T | undefined
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {
    ...((init?.headers as Record<string, string> | undefined) ?? {})
  };
  if (init?.body !== undefined) headers['content-type'] = 'application/json';
  return send<T>(path, { ...init, headers }, select);
}

/**
 * The same request path, for a MULTIPART body.
 *
 * The content-type is deliberately NOT set: the browser has to add its own
 * `multipart/form-data; boundary=...`, and setting the header by hand is the
 * classic way to produce an unparseable body. Everything else — the session
 * token, the 401 handling, the "unexpected response shape" rule — is shared
 * with every other call, because this file is the only place that fetches.
 */
async function requestForm<T>(
  path: string,
  form: FormData,
  select?: (raw: any) => T | undefined
): Promise<ApiResult<T>> {
  return send<T>(path, { method: 'POST', body: form }, select);
}

async function send<T>(
  path: string,
  init: RequestInit,
  select?: (raw: any) => T | undefined
): Promise<ApiResult<T>> {
  // A stalled connection must never hang the UI forever. Every request races
  // a timeout; if the network neither resolves nor rejects in time, we abort
  // and return an honest "timed out" instead of leaving a button spinning.
  // (This was the root cause of "create a space / vault never finishes":
  // fetch had no timeout, so a half-open mobile connection hung indefinitely.)
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const token = getSessionToken();
    const headers: Record<string, string> = {
      ...((init.headers as Record<string, string> | undefined) ?? {})
    };
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`${INGEST_API}${path}`, {
      ...init,
      headers,
      signal: controller.signal
    });
    clearTimeout(timer);

    // A dead session must clear itself rather than leaving the client
    // retrying with a token the server has already rejected.
    if (res.status === 401) {
      const stale = getSessionToken();
      // A delayed anonymous/old-session response must not clear a newer login.
      if (token && stale === token) {
        setSessionToken(null);
        onSessionExpired?.();
      }
    }

    // Read the body once, defensively: an HTML error page or an empty body
    // must not throw a raw SyntaxError at the call site.
    const text = await res.text();
    let parsed: any = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        return {
          ok: false,
          status: res.status,
          error: 'server returned a non-JSON response'
        };
      }
    }

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error:
          (parsed && typeof parsed.error === 'string' && parsed.error) ||
          `request failed with status ${res.status}`,
        // The parsed body rides along for callers that need the server's
        // structured refusal (e.g. the engine tier's honest 402 detail).
        errorBody: parsed ?? undefined
      };
    }

    const data: T | undefined = select ? select(parsed) : (parsed as T);
    // A 200 whose body is missing the expected key is a contract mismatch,
    // not success. Surface it rather than handing `undefined` to the UI.
    if (data === undefined || data === null) {
      return { ok: false, status: res.status, error: 'unexpected response shape' };
    }
    return { ok: true, data };
  } catch (e) {
    clearTimeout(timer);
    // Our own timeout fired — the connection stalled rather than failing.
    // Report it honestly so the button stops spinning and the user can retry.
    if (e && ((e as any)?.name === 'AbortError' || (e as any)?.code === 20)) {
      return { ok: false, status: null, error: 'The request timed out. Check your connection and try again.' };
    }
    // Network failure, offline server, aborted request. A WRITE is not lost:
    // it is parked with a clientKey and replays after reconnect — the
    // server-side idempotency makes the replay safe. A read is just offline.
    // Requests, Quotes and Work have explicit retry/revision semantics. Never silently replay
    // private demand after the user has edited or discarded their form.
    if (/^\/api\/(requests|request-quotes|quote-requests|work-orders|matches|enterprises|supply|ops\/supply-verification|me\/work|workforces|work-programs|work-tasks|work-territories)(?:\/|$)/.test(path)) {
      return { ok: false, status: null, error: 'Could not confirm the save. Your form is still here. Retry to check or save it safely.' };
    }
    // Credentials must never enter the durable offline queue. Multipart
    // uploads also cannot be replayed: that queue only serializes JSON.
    if (/^\/api\/auth(?:\/|$)/.test(path) || (init.body != null && typeof init.body !== 'string')) {
      return { ok: false, status: null, error: 'Connection interrupted. Please try again.' };
    }
    const method = (init.method ?? 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      const body = typeof init.body === 'string' ? init.body : null;
      const token = getSessionToken();
      enqueue({
        path,
        method,
        body,
        // The key travels in the body itself; a re-tap replaces, not doubles.
        clientKey: (body ? clientKeyOf(body) : null) ?? `auto_${method}_${path}_${Date.now().toString(36)}`,
        headers: token ? { authorization: `Bearer ${token}` } : undefined
      });
      return {
        ok: false,
        status: null,
        queued: true,
        error: 'You are offline — this change is queued and will send itself when you reconnect.'
      };
    }
    return {
      ok: false,
      status: null,
      error: e instanceof Error ? e.message : 'network error'
    };
  }
}

/** Pull a clientKey out of a JSON body, if the caller sent one. */
function clientKeyOf(body: string): string | null {
  try {
    const parsed = JSON.parse(body);
    return typeof parsed?.clientKey === 'string' ? parsed.clientKey : null;
  } catch {
    return null;
  }
}

/**
 * Replay the offline queue through the same fetch contract. Called on the
 * browser's 'online' event. Idempotent server keys make double-sends harmless.
 */
export async function flushOfflineQueue(): Promise<number> {
  return replayQueue(async (w: QueuedWrite) => {
    const headers: Record<string, string> = {};
    if (w.body) headers['content-type'] = 'application/json';
    const token = getSessionToken();
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`${INGEST_API}${w.path}`, {
      method: w.method,
      headers,
      body: w.body ?? undefined
    });
    if (res.ok) return { ok: true };
    const text = await res.text().catch(() => '');
    let errMsg = `replay failed with status ${res.status}`;
    try {
      errMsg = JSON.parse(text)?.error ?? errMsg;
    } catch {}
    return { ok: false, error: errMsg };
  });
}

/** How many writes are parked, for a badge if a surface wants one. */
export function offlineQueueDepth(): number {
  return queueDepth();
}

// ---------------------------------------------------------------------------
// CIRCLES
// ---------------------------------------------------------------------------

export interface GroupEligibility { eligible: boolean; identityVerified: boolean; shops: Array<{ id: string; name: string }>; reason: string | null; }
export interface GroupDirectoryRow { id: string; name: string; description: string; location: string; industry: string; purposes: string[]; memberCount?: number; isMember: boolean; canJoin: boolean; canRequest?: boolean; hostName: string | null; }
export interface GroupDirectory { groups: GroupDirectoryRow[]; locations: string[]; industries: string[]; purposes: Array<{ id: string; label: string }>; }
export function getGroupEligibility(): Promise<ApiResult<GroupEligibility>> {
  return request('/api/groups/eligibility', undefined, r => r && typeof r.eligible === 'boolean' && Array.isArray(r.shops) ? r : undefined);
}
export function getGroupDirectory(): Promise<ApiResult<GroupDirectory>> {
  return request('/api/groups/directory', undefined, r => r && Array.isArray(r.groups) && Array.isArray(r.purposes) ? r : undefined);
}

export function getCircles(): Promise<ApiResult<Circle[]>> {
  return request('/api/circles', undefined, (r) => areCircles(r?.circles));
}

export interface CircleDetail {
  circle: Circle;
  blocks: Block[];
  signals: Signal[];
}

export function getCircle(id: string): Promise<ApiResult<CircleDetail>> {
  return request(`/api/circles/${encodeURIComponent(id)}`, undefined, (r) => {
    if (!isCircle(r?.circle)) return undefined;
    const blocks = areBlocks(r.blocks ?? []);
    const signals = areSignals(r.signals ?? []);
    if (!blocks || !signals) return undefined;
    return { circle: r.circle, blocks, signals };
  });
}

export function createCircle(body: CircleCreate): Promise<ApiResult<Circle>> {
  return request(
    '/api/circles',
    { method: 'POST', body: JSON.stringify(body) },
    (r) => (isCircle(r?.circle) ? r.circle : undefined)
  );
}

/**
 * `patch` is typed CircleUpdate, which has no progress fields. A caller
 * writing `updateCircle(id, { currentValue: 33750 })` fails to compile.
 */
export function updateCircle(id: string, patch: CircleUpdate): Promise<ApiResult<Circle>> {
  return request(
    `/api/circles/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(patch) },
    (r) => (isCircle(r?.circle) ? r.circle : undefined)
  );
}

// ---------------------------------------------------------------------------
// TARGETS -- a view over circles, not a separate endpoint
// ---------------------------------------------------------------------------

/** Circles that are measurable targets, with server-derived progress. */
export async function getTargets(): Promise<ApiResult<TargetView[]>> {
  const res = await getCircles();
  if (!res.ok) return res;
  const targets = res.data
    .map(asTarget)
    .filter((t): t is TargetView => t !== null);
  return { ok: true, data: targets };
}

// ---------------------------------------------------------------------------
// MEMBERS + TRUST
// ---------------------------------------------------------------------------

export function getMembers(circleId: string): Promise<ApiResult<Member[]>> {
  return request(
    `/api/circles/${encodeURIComponent(circleId)}/members`,
    undefined,
    (r) => areMembers(r?.members)
  );
}

/**
 * Join the circle AS THE AUTHENTICATED CALLER.
 *
 * There is deliberately no userId parameter. The server derives identity from
 * the request, so a userId here would be a forgeable claim that the server
 * ignores -- an API that invites callers to write code the server rejects.
 */
export function joinCircle(
  circleId: string,
  role?: Member['role']
): Promise<ApiResult<Member>> {
  return request(
    `/api/circles/${encodeURIComponent(circleId)}/members`,
    { method: 'POST', body: JSON.stringify({ role }) },
    (r) => (isMember(r?.member) ? r.member : undefined)
  );
}

/**
 * Add SOMEBODY ELSE to a circle. Requires coordinator authority; the server
 * returns 403 otherwise. Named separately from joinCircle so the privileged
 * act is visible at the call site.
 */
/**
 * Add a member by @handle. The id is resolved by the server, which is where the
 * lookup belongs: a client that guessed an id from a name could hand the room to
 * the wrong person. An unknown handle comes back as a refusal, not a silent add.
 */
export function inviteMember(
  circleId: string,
  handle: string,
  role?: Member['role']
): Promise<ApiResult<Member>> {
  return request(
    `/api/circles/${encodeURIComponent(circleId)}/members`,
    { method: 'POST', body: JSON.stringify({ handle: handle.replace(/^@/, ''), role }) },
    (r) => (isMember(r?.member) ? r.member : undefined)
  );
}

/** Record a verification for another member. Coordinator-only; self-verification is refused. */
export function recordVerification(
  circleId: string,
  userId: string,
  kind: VerificationKind
): Promise<ApiResult<Member>> {
  return request(
    `/api/circles/${encodeURIComponent(circleId)}/members/${encodeURIComponent(userId)}/verify`,
    { method: 'POST', body: JSON.stringify({ kind }) },
    (r) => (isMember(r?.member) ? r.member : undefined)
  );
}

/** Change a member's role. Coordinator-only. */
/**
 * Change a member's role. `reason` is not decoration: the server refuses a silent
 * role change, because a promotion nobody can explain is how a group gets
 * captured and a quiet demotion is how dissent is tidied away.
 */
export function setMemberRole(
  circleId: string,
  userId: string,
  role: Member['role'],
  reason?: string
): Promise<ApiResult<Member>> {
  return request(
    `/api/circles/${encodeURIComponent(circleId)}/members/${encodeURIComponent(userId)}/role`,
    { method: 'PATCH', body: JSON.stringify({ role, reason: reason ?? null }) },
    (r) => (isMember(r?.member) ? r.member : undefined)
  );
}

/** Whether caller identity is genuinely verified. Currently false. */
export function getAuthStatus(): Promise<ApiResult<AuthStatus>> {
  return request('/api/auth/status', undefined, (r) => (isAuthStatus(r) ? r : undefined));
}

// ---------------------------------------------------------------------------
// BLOCKS
// ---------------------------------------------------------------------------

export function getBlocks(circleId?: string): Promise<ApiResult<Block[]>> {
  const q = circleId ? `?circleId=${encodeURIComponent(circleId)}` : '';
  return request(`/api/blocks${q}`, undefined, (r) => areBlocks(r?.blocks));
}

export interface BlockCreate {
  circleId: string;
  type?: Block['type'];
  content?: string;
  /** Promote an existing extracted object into the circle. */
  objectId?: string;
}

export function createBlock(body: BlockCreate): Promise<ApiResult<Block>> {
  return request(
    '/api/blocks',
    { method: 'POST', body: JSON.stringify(body) },
    (r) => (isBlock(r?.block) ? r.block : undefined)
  );
}

// ---------------------------------------------------------------------------
// CIRCLE OPERATIONS: tasks and votes
//
// These act on Blocks, addressed through their circle. The circle in the path
// is not decoration -- the server refuses a block that does not belong to it,
// which is what stops one circle operating on another's work.
//
// Authority is enforced server-side. These bindings do not pre-check roles:
// a client-side check is a convenience, and treating it as protection is how
// authorisation holes are born. The UI hides what you cannot do; the SERVER
// is what makes it impossible.
// ---------------------------------------------------------------------------

/** Take on a task, or (as coordinator) assign it to another member. */
export function assignTask(
  circleId: string,
  blockId: string,
  assigneeId?: string
): Promise<ApiResult<{ block: Block; changed: boolean }>> {
  return request(
    `/api/circles/${encodeURIComponent(circleId)}/blocks/${encodeURIComponent(blockId)}/assign`,
    { method: 'POST', body: JSON.stringify(assigneeId ? { assigneeId } : {}) },
    (r) => (isBlock(r?.block) ? { block: r.block, changed: Boolean(r.changed) } : undefined)
  );
}

/** Put a task back in the pool. */
export function releaseTask(
  circleId: string,
  blockId: string
): Promise<ApiResult<{ block: Block; changed: boolean }>> {
  return request(
    `/api/circles/${encodeURIComponent(circleId)}/blocks/${encodeURIComponent(blockId)}/release`,
    { method: 'POST', body: JSON.stringify({}) },
    (r) => (isBlock(r?.block) ? { block: r.block, changed: Boolean(r.changed) } : undefined)
  );
}

/**
 * Mark a task done. `changed: false` means it was already complete -- a
 * harmless no-op, not a second completion.
 */
export function completeTask(
  circleId: string,
  blockId: string
): Promise<ApiResult<{ block: Block; changed: boolean }>> {
  return request(
    `/api/circles/${encodeURIComponent(circleId)}/blocks/${encodeURIComponent(blockId)}/complete`,
    { method: 'POST', body: JSON.stringify({}) },
    (r) => (isBlock(r?.block) ? { block: r.block, changed: Boolean(r.changed) } : undefined)
  );
}

/**
 * Cast a ballot. The voter is the authenticated caller -- deliberately not a
 * parameter, because a client-supplied voter id would be a forgeable claim.
 * A second attempt returns a 409 conflict rather than replacing the first.
 */
export function castVote(
  circleId: string,
  blockId: string,
  option: string
): Promise<ApiResult<{ option: string; tally: VoteTally }>> {
  return request(
    `/api/circles/${encodeURIComponent(circleId)}/blocks/${encodeURIComponent(blockId)}/vote`,
    { method: 'POST', body: JSON.stringify({ option }) },
    (r) =>
      isVoteTally(r?.tally)
        ? { option: String(r?.vote?.option ?? option), tally: r.tally }
        : undefined
  );
}

/** Close a vote to further ballots. Coordinator only, enforced server-side. */
export function closeVote(
  circleId: string,
  blockId: string
): Promise<ApiResult<{ block: Block; tally: VoteTally }>> {
  return request(
    `/api/circles/${encodeURIComponent(circleId)}/blocks/${encodeURIComponent(blockId)}/close-vote`,
    { method: 'POST', body: JSON.stringify({}) },
    (r) => (isBlock(r?.block) && isVoteTally(r?.tally) ? { block: r.block, tally: r.tally } : undefined)
  );
}

/** A row of the circle's history: one change, with its pre-image and, where it
 *  matters, the reason. `text` is the server's own one-line reading of it, so no
 *  client can soften "cancelled" into "closed". */
export interface CircleHistoryRow {
  id: string;
  kind: string;
  subject: string | null;
  subjectKind: string | null;
  field: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  redacted: boolean;
  actorId: string | null;
  at: string;
  text: string;
}
export function getCircleHistory(circleId: string, opts: { subject?: string; limit?: number } = {}): Promise<ApiResult<{ history: CircleHistoryRow[] }>> {
  const q = new URLSearchParams();
  if (opts.subject) q.set('subject', opts.subject);
  if (opts.limit) q.set('limit', String(opts.limit));
  const qs = q.toString();
  return request(`/api/circles/${encodeURIComponent(circleId)}/history${qs ? `?${qs}` : ''}`, undefined, (r) =>
    r && Array.isArray(r.history) ? (r as { history: CircleHistoryRow[] }) : undefined);
}

export function pinWelcome(circleId: string, text: string): Promise<ApiResult<Circle>> {
  return request<Circle>(`/api/circles/${encodeURIComponent(circleId)}/welcome`, { method: 'POST', body: JSON.stringify({ text }) },
    (r) => (r?.circle ? (r.circle as Circle) : undefined));
}

/** Edit a task. `reason` is required by the server for a deadline move, and the
 *  title is locked once somebody has claimed the work. */
export function editTask(circleId: string, blockId: string, patch: { title?: string; description?: string; dueAt?: string; reason?: string }): Promise<ApiResult<{ block: Block; changed: boolean; edits: number }>> {
  return request(`/api/circles/${encodeURIComponent(circleId)}/blocks/${encodeURIComponent(blockId)}/task`, { method: 'PATCH', body: JSON.stringify(patch) },
    (r) => (r?.block ? (r as { block: Block; changed: boolean; edits: number }) : undefined));
}
export function cancelTask(circleId: string, blockId: string, reason: string): Promise<ApiResult<{ block: Block; changed: boolean }>> {
  return request(`/api/circles/${encodeURIComponent(circleId)}/blocks/${encodeURIComponent(blockId)}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) },
    (r) => (r?.block ? (r as { block: Block; changed: boolean }) : undefined));
}
export function reopenTask(circleId: string, blockId: string, reason: string): Promise<ApiResult<{ block: Block; changed: boolean }>> {
  return request(`/api/circles/${encodeURIComponent(circleId)}/blocks/${encodeURIComponent(blockId)}/reopen`, { method: 'POST', body: JSON.stringify({ reason }) },
    (r) => (r?.block ? (r as { block: Block; changed: boolean }) : undefined));
}
export function verifyTask(circleId: string, blockId: string): Promise<ApiResult<{ block: Block; changed: boolean }>> {
  return request(`/api/circles/${encodeURIComponent(circleId)}/blocks/${encodeURIComponent(blockId)}/verify`, { method: 'POST', body: '{}' },
    (r) => (r?.block ? (r as { block: Block; changed: boolean }) : undefined));
}
/** Cancelling a vote. The ballots stay; the reason is published to the circle. */
export function cancelVote(circleId: string, blockId: string, reason: string): Promise<ApiResult<{ block: Block; changed: boolean; tally: unknown }>> {
  return request(`/api/circles/${encodeURIComponent(circleId)}/blocks/${encodeURIComponent(blockId)}/cancel-vote`, { method: 'POST', body: JSON.stringify({ reason }) },
    (r) => (r?.block ? (r as { block: Block; changed: boolean; tally: unknown }) : undefined));
}
export function transferCoordinator(circleId: string, userId: string, reason?: string): Promise<ApiResult<{ to: Member; from: Member; coordinators: number }>> {
  return request(`/api/circles/${encodeURIComponent(circleId)}/members/${encodeURIComponent(userId)}/transfer`, { method: 'POST', body: JSON.stringify({ reason: reason ?? null }) },
    (r) => (r?.to ? (r as { to: Member; from: Member; coordinators: number }) : undefined));
}
/** Listing a private room needs a reason — the members are owed one. */
export function setCircleVisibility(circleId: string, visibility: 'invite_only' | 'discoverable' | 'open', reason: string, directory?: Circle['directory']): Promise<ApiResult<Circle>> {
  return request<Circle>(`/api/circles/${encodeURIComponent(circleId)}`, { method: 'PATCH', body: JSON.stringify({ visibility, reason, ...(directory ? { directory } : {}) }) },
    (r) => (r?.circle ? (r.circle as Circle) : undefined));
}
export interface JoinPreview {
  listed: boolean;
  id: string;
  name: string | null;
  purpose: string | null;
  type: string | null;
  memberCount: number;
  openTaskCount: number;
  liveVoteCount: number;
  externalLink: string | null;
  externalLinkNote: string | null;
  joinCode: string | null;
  canJoin: boolean;
  needsInvite: boolean;
  targetValue: number | null;
  currentValue: number | null;
  currency: string;
}
/** What a stranger may see through a shared link, before signing up. */
export function getJoinPreview(code: string): Promise<ApiResult<JoinPreview>> {
  return request<JoinPreview>(`/api/circles/join/${encodeURIComponent(code)}`, undefined, (r) =>
    r?.circle ? (r.circle as JoinPreview) : undefined);
}


export function getTally(circleId: string, blockId: string): Promise<ApiResult<VoteTally>> {
  return request(
    `/api/circles/${encodeURIComponent(circleId)}/blocks/${encodeURIComponent(blockId)}/tally`,
    undefined,
    (r) => (isVoteTally(r?.tally) ? r.tally : undefined)
  );
}

/**
 * A member's evidence history. Returns things that happened -- never a score.
 * An empty list means this member has done nothing yet, which is a real and
 * useful answer, not a gap to fill with a default rating.
 */
export function getMemberEvidence(
  circleId: string,
  userId: string
): Promise<ApiResult<MemberEvidence>> {
  return request(
    `/api/circles/${encodeURIComponent(circleId)}/members/${encodeURIComponent(userId)}/evidence`,
    undefined,
    (r) => (isMemberEvidence(r) ? r : undefined)
  );
}

// ---------------------------------------------------------------------------
// SIGNALS
// ---------------------------------------------------------------------------

export function getSignals(opts: { circleId?: string; limit?: number } = {}): Promise<
  ApiResult<Signal[]>
> {
  const p = new URLSearchParams();
  if (opts.circleId) p.set('circleId', opts.circleId);
  if (opts.limit) p.set('limit', String(opts.limit));
  const q = p.toString();
  return request(`/api/signals${q ? `?${q}` : ''}`, undefined, (r) => areSignals(r?.signals));
}

// ---------------------------------------------------------------------------
// ECONOMIC
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// TICKET RESALE MARKET (Tikiti T1). All fetches live here (§4); the UI never
// sees a raw response shape. The scan code version is part of the ticket
// object, so a stale QR is impossible to render by accident.
// ---------------------------------------------------------------------------

export function getEventResaleListings(eventId: string): Promise<ApiResult<{ listings: ResaleListing[] }>> {
  return request(`/api/ticket-market/events/${encodeURIComponent(eventId)}/listings`, undefined, (r) =>
    Array.isArray(r?.listings) ? r : undefined);
}

export function getMyTickets(): Promise<ApiResult<{ tickets: ResaleTicket[] }>> {
  return request('/api/ticket-market/me/tickets', undefined, (r) =>
    Array.isArray(r?.tickets) ? r : undefined);
}

export function getMyResaleDesk(): Promise<ApiResult<{ listings: ResaleListingRow[]; orders: TicketOrder[] }>> {
  return request('/api/ticket-market/me/listings', undefined, (r) =>
    Array.isArray(r?.listings) && Array.isArray(r?.orders)
      ? { listings: r.listings, orders: r.orders }
      : undefined);
}

export function createResaleListing(
  ticketId: string,
  price: number,
  note?: string
): Promise<ApiResult<{ listing: ResaleListing }>> {
  return request('/api/ticket-market/listings', {
    method: 'POST',
    body: JSON.stringify({ ticketId, price, note: note ?? null })
  });
}

export function cancelResaleListing(listingId: string): Promise<ApiResult<{ listing: ResaleListing; changed: boolean }>> {
  return request(`/api/ticket-market/listings/${encodeURIComponent(listingId)}/cancel`, { method: 'POST', body: '{}' });
}

export function openTicketOrder(listingId: string): Promise<ApiResult<{ order: TicketOrder }>> {
  return request('/api/ticket-market/orders', {
    method: 'POST',
    body: JSON.stringify({ listingId })
  });
}

export function cancelTicketOrder(orderId: string): Promise<ApiResult<{ order: TicketOrder; changed: boolean }>> {
  return request(`/api/ticket-market/orders/${encodeURIComponent(orderId)}/cancel`, { method: 'POST', body: '{}' });
}

/**
 * Pay for a ticket order. With no payment provider configured the server
 * answers 503 charged:false — an honest refusal, surfaced here as the error
 * result with the server's own detail, never a fake success.
 */
export function payTicketOrder(orderId: string): Promise<ApiResult<{ charged: boolean }>> {
  return request(`/api/ticket-market/orders/${encodeURIComponent(orderId)}/pay`, { method: 'POST', body: '{}' });
}

export function settleTicketOrder(orderId: string, transactionId: string): Promise<ApiResult<{ order: TicketOrder; changed: boolean }>> {
  return request(`/api/ticket-market/orders/${encodeURIComponent(orderId)}/settle`, {
    method: 'POST',
    body: JSON.stringify({ transactionId })
  });
}

export function refundTicketOrder(orderId: string): Promise<ApiResult<{ order: TicketOrder; changed: boolean }>> {
  return request(`/api/ticket-market/orders/${encodeURIComponent(orderId)}/refund`, { method: 'POST', body: '{}' });
}

export function giftTicket(ticketId: string, toUserId: string): Promise<ApiResult<{ ticket: ResaleTicket }>> {
  return request(`/api/ticket-market/tickets/${encodeURIComponent(ticketId)}/transfer`, {
    method: 'POST',
    body: JSON.stringify({ toUserId })
  });
}

/** Gifting in the UI addresses people by handle — what people actually know. */
export function giftTicketToHandle(ticketId: string, toHandle: string): Promise<ApiResult<{ ticket: ResaleTicket }>> {
  return request(`/api/ticket-market/tickets/${encodeURIComponent(ticketId)}/transfer`, {
    method: 'POST',
    body: JSON.stringify({ toHandle })
  });
}

/**
 * The seller confirms receiving the money out-of-band. Brief records a real
 * settled ledger row and moves the seat — this is how a sale completes while
 * no payment provider is connected, and it is the seller's attestation, never
 * Brief pretending it collected the money.
 */
export function confirmTicketOrderReceived(orderId: string): Promise<ApiResult<{ order: TicketOrder; changed: boolean }>> {
  return request(`/api/ticket-market/orders/${encodeURIComponent(orderId)}/confirm-received`, { method: 'POST', body: '{}' });
}

export function getWallet(currency = 'KES'): Promise<ApiResult<Wallet>> {
  // Validated rather than passed through: a 200 with an empty body would
  // otherwise reach the UI as a wallet with `undefined` balance, which is
  // exactly the kind of silent nonsense that turns into a fake zero on screen.
  return request(
    `/api/economic/wallet?currency=${encodeURIComponent(currency)}`,
    undefined,
    (r) => (isWallet(r) ? r : undefined)
  );
}

export interface TransactionList {
  transactions: Transaction[];
  provider: Wallet['provider'];
}

export function getTransactions(limit?: number): Promise<ApiResult<TransactionList>> {
  const q = limit ? `?limit=${limit}` : '';
  return request(`/api/transactions${q}`, undefined, (r) => {
    const transactions = areTransactions(r?.transactions);
    if (!transactions || !isProviderStatus(r?.provider)) return undefined;
    return { transactions, provider: r.provider };
  });
}

export function createTransaction(body: TransactionCreate): Promise<ApiResult<Transaction>> {
  return request(
    '/api/transactions',
    { method: 'POST', body: JSON.stringify(body) },
    (r) => (isTransaction(r?.transaction) ? r.transaction : undefined)
  );
}

/**
 * Advance a transaction. The SERVER owns the state machine and rejects
 * illegal hops -- notably created -> settled, which is how a UI would fake a
 * settlement. This client cannot bypass that; it only relays the request and
 * reports what the server decided.
 *
 * This is deliberately NOT named `settle`. There is no client-side settle.
 */
export function requestTransactionTransition(
  id: string,
  status: TransactionStatus,
  note?: string
): Promise<ApiResult<Transaction>> {
  return request(
    `/api/transactions/${encodeURIComponent(id)}/transition`,
    { method: 'POST', body: JSON.stringify({ status, note }) },
    (r) => (isTransaction(r?.transaction) ? r.transaction : undefined)
  );
}

/**
 * Disbursements are NOT implemented server-side (GET /api/disbursements -> 404,
 * no domain service, no payment provider). This returns the reason so the UI
 * can state the limitation instead of rendering an empty list that implies
 * "no payouts yet" when the truth is "payouts do not exist".
 */
export function getDisbursements(): CapabilityUnavailable {
  return {
    available: false,
    reason:
      'Disbursements are not implemented. No payment provider is connected, ' +
      'so Brief cannot pay anyone out and does not record disbursement state.'
  };
}

// ---------------------------------------------------------------------------
// CAMPAIGNS
// ---------------------------------------------------------------------------

export function getCampaigns(): Promise<ApiResult<Campaign[]>> {
  return request('/api/campaigns', undefined, (r) => areCampaigns(r?.campaigns));
}

export function getCampaign(id: string): Promise<ApiResult<Campaign>> {
  return request(`/api/campaigns/${encodeURIComponent(id)}`, undefined, (r) =>
    isCampaign(r?.campaign) ? r.campaign : undefined
  );
}

/** ownerId is NOT a parameter: the server derives it from the caller. */
export function createCampaign(body: CampaignCreate): Promise<ApiResult<Campaign>> {
  return request(
    '/api/campaigns',
    { method: 'POST', body: JSON.stringify(body) },
    (r) => (isCampaign(r?.campaign) ? r.campaign : undefined)
  );
}

export function updateCampaign(id: string, patch: CampaignUpdate): Promise<ApiResult<Campaign>> {
  return request(
    `/api/campaigns/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(patch) },
    (r) => (isCampaign(r?.campaign) ? r.campaign : undefined)
  );
}

/**
 * Lifecycle transitions. The SERVER owns the state machine and refuses
 * illegal hops; this only relays the request.
 */
export type CampaignAction = 'publish' | 'golive' | 'close' | 'cancel' | 'complete';

export function campaignAction(id: string, action: CampaignAction): Promise<ApiResult<Campaign>> {
  return request(
    `/api/campaigns/${encodeURIComponent(id)}/${action}`,
    { method: 'POST', body: JSON.stringify({}) },
    (r) => (isCampaign(r?.campaign) ? r.campaign : undefined)
  );
}

export function getCampaignRegistrations(id: string): Promise<ApiResult<Registration[]>> {
  return request(
    `/api/campaigns/${encodeURIComponent(id)}/registrations`,
    undefined,
    (r) => areRegistrations(r?.registrations)
  );
}

/**
 * The organiser confirms that payment for a held spot actually arrived.
 *
 * Deliberately takes no amount: the server uses the campaign price, so this
 * call cannot mint revenue of the caller's choosing. The server creates the
 * transaction, settles it, and promotes the registration in one step -- there
 * is no client-side settlement anywhere in this flow.
 */
export function confirmRegistrationPayment(
  campaignId: string,
  registrationId: string
): Promise<ApiResult<PaymentConfirmation>> {
  return request(
    `/api/campaigns/${encodeURIComponent(campaignId)}/registrations/${encodeURIComponent(registrationId)}/confirm-payment`,
    { method: 'POST', body: JSON.stringify({}) },
    (r) => (isPaymentConfirmation(r) ? r : undefined)
  );
}

export function setRegistrationStatus(
  campaignId: string,
  registrationId: string,
  status: RegistrationStatus
): Promise<ApiResult<Registration>> {
  return request(
    `/api/campaigns/${encodeURIComponent(campaignId)}/registrations/${encodeURIComponent(registrationId)}/status`,
    { method: 'POST', body: JSON.stringify({ status }) },
    (r) => (isRegistration(r?.registration) ? r.registration : undefined)
  );
}

export function deleteCampaign(
  id: string
): Promise<ApiResult<{ ok: boolean }>> {
  return request(
    `/api/campaigns/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
    (r) => (r?.ok ? { ok: true } : undefined)
  );
}

// --- public (no authentication) ---------------------------------------------

export function getPublicCampaign(slug: string): Promise<ApiResult<PublicCampaign>> {
  return request(`/api/public/campaigns/${encodeURIComponent(slug)}`, undefined, (r) =>
    isPublicCampaign(r?.campaign) ? r.campaign : undefined
  );
}

/** The derived context rails of the rich detail screen (T4). */
export interface PublicCampaignContext {
  related: EventListing[];
  fromHost: EventListing[];
  seriesOccurrences: EventListing[];
}

/** Related events + more-from-this-host + series occurrences, all derived. */
export function getPublicCampaignContext(slug: string): Promise<ApiResult<PublicCampaignContext>> {
  return request(
    `/api/public/campaigns/${encodeURIComponent(slug)}/context`,
    undefined,
    (r) =>
      Array.isArray(r?.related) && Array.isArray(r?.fromHost) && Array.isArray(r?.seriesOccurrences)
        ? {
            related: r.related as EventListing[],
            fromHost: r.fromHost as EventListing[],
            seriesOccurrences: r.seriesOccurrences as EventListing[]
          }
        : undefined
  );
}

export interface PublicRegisterResult {
  registration: { id: string; status: RegistrationStatus; createdAt: string; ticketCode?: string | null };
  campaign: PublicCampaign;
}

export function registerForCampaign(
  slug: string,
  body: { attendeeRef: string; name?: string; contact?: string; trackingHash?: string; amount?: number }
): Promise<ApiResult<PublicRegisterResult>> {
  return request(
    `/api/public/campaigns/${encodeURIComponent(slug)}/register`,
    { method: 'POST', body: JSON.stringify(body) },
    (r) =>
      isRegistration(r?.registration) && isPublicCampaign(r?.campaign)
        ? { registration: r.registration, campaign: r.campaign }
        : undefined
  );
}

export type { ShareChannel, ShareChannels, ShareLink, CampaignShare } from './types';
export { COPY_ONLY_CHANNELS } from './types';

/** Client-visible server configuration, including the canonical public origin. */
export function getConfig(): Promise<ApiResult<AppConfig>> {
  return request('/api/config', undefined, (r) => (isAppConfig(r) ? r : undefined));
}

/** Detect that the frontend and API came from the same current deployment. */
export function getRelease(): Promise<ApiResult<ReleaseStatus>> {
  return request('/api/release', undefined, (r) =>
    typeof r?.apiContractVersion === 'string' && typeof r?.serverTime === 'string'
      ? r as ReleaseStatus
      : undefined
  );
}

/**
 * Build the canonical share link, or report honestly that there isn't one.
 *
 * The origin MUST come from server config. Deriving it from
 * `window.location.origin` was the previous behaviour and was wrong: a creator
 * on a preview host would distribute a link tied to that host. When no origin
 * is configured the caller gets a structured unavailable state and shows the
 * slug instead of a fabricated URL.
 */
export function campaignShareLink(slug: string, publicOrigin: string | null): ShareLink {
  if (!publicOrigin) {
    return { available: false, reason: 'public_origin_not_configured', slug };
  }
  return {
    available: true,
    url: `${publicOrigin.replace(/\/+$/, '')}/c/${slug}`,
    slug
  };
}

/**
 * The server's canonical distribution payload for one campaign. Owner-only.
 *
 * Prefer this over composing a link locally: the origin lives in server
 * config, so the server is the only party that can answer authoritatively.
 */
export function getCampaignShare(id: string): Promise<ApiResult<CampaignShare>> {
  return request(
    `/api/campaigns/${encodeURIComponent(id)}/share`,
    undefined,
    (r) => (isCampaignShare(r?.share) ? r.share : undefined)
  );
}

/** Public home-shelf banners over already-published campaigns. */
export function getCampaignBanners(): Promise<ApiResult<CampaignBanner[]>> {
  return request('/api/banners', undefined, (r) => areCampaignBanners(r?.banners) ? r.banners : undefined);
}

export function getCampaignBanner(id: string): Promise<ApiResult<CampaignBanner | null>> {
  return request(`/api/campaigns/${encodeURIComponent(id)}/banner`, undefined, (r) =>
    r?.banner === null ? null : (isCampaignBanner(r?.banner) ? r.banner : undefined)
  );
}

/** Create a standalone banner; the server requires a published campaign. */
export function createCampaignBanner(
  id: string,
  fields: { headline?: string; body?: string; imageUrl?: string | null } = {}
): Promise<ApiResult<{ banner: CampaignBanner; reused: boolean }>> {
  return request(
    `/api/campaigns/${encodeURIComponent(id)}/banner`,
    { method: 'POST', body: JSON.stringify(fields) },
    (r) => isCampaignBanner(r?.banner)
      ? { banner: r.banner, reused: Boolean(r.reused) }
      : undefined
  );
}

export function archiveCampaignBanner(id: string): Promise<ApiResult<CampaignBanner>> {
  return request(`/api/banners/${encodeURIComponent(id)}/archive`, { method: 'POST', body: '{}' }, (r) =>
    isCampaignBanner(r?.banner) ? r.banner : undefined
  );
}

/**
 * Build the share-intent URLs for a canonical campaign link.
 *
 * This mirrors the server's `shareView()` byte-for-byte and is asserted to do
 * so by the contract suite. It exists client-side so the share sheet needs no
 * extra round-trip, NOT as a second source of truth: if the two ever diverge,
 * the contract test fails rather than a creator quietly distributing a
 * differently-shaped link on one channel.
 */
export function campaignShareChannels(url: string, title: string): ShareChannels {
  const enc = encodeURIComponent(url);
  const text = encodeURIComponent(title);
  return {
    whatsapp: `https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}`,
    telegram: `https://t.me/share/url?url=${enc}&text=${text}`,
    x: `https://twitter.com/intent/tweet?url=${enc}&text=${text}`
  };
}

/**
 * Records that the creator distributed the link. Emits a signal server-side
 * and moves no money. Only meaningful once published.
 */
export function shareCampaign(
  id: string,
  channel: ShareChannel = 'link'
): Promise<ApiResult<Campaign>> {
  return request(
    `/api/campaigns/${encodeURIComponent(id)}/share`,
    { method: 'POST', body: JSON.stringify({ channel }) },
    (r) => (isCampaign(r?.campaign) ? r.campaign : undefined)
  );
}

/** A single Brief object. 404s for objects the caller may not see. */
export function getObject(id: string): Promise<ApiResult<Record<string, unknown>>> {
  return request(`/api/objects/${encodeURIComponent(id)}`, undefined, (r) =>
    r && typeof r.object === 'object' && r.object !== null ? r.object : undefined
  );
}

/** Objects the caller may attach to a campaign. */
export function getObjects(publication?: string): Promise<ApiResult<any[]>> {
  const q = publication ? `?publication=${encodeURIComponent(publication)}` : '';
  return request(`/api/objects${q}`, undefined, (r) =>
    Array.isArray(r?.objects) ? r.objects : undefined
  );
}

/** The ranked discovery feed: freshness + trust + engagement, optionally geo-scoped. */
export function discoverObjects(opts: { lat?: number; lng?: number; radiusKm?: number; limit?: number } = {}): Promise<ApiResult<any[]>> {
  const params = new URLSearchParams({ rank: '1' });
  if (opts.lat !== undefined) params.set('lat', String(opts.lat));
  if (opts.lng !== undefined) params.set('lng', String(opts.lng));
  if (opts.radiusKm !== undefined) params.set('radiusKm', String(opts.radiusKm));
  if (opts.limit !== undefined) params.set('limit', String(opts.limit));
  return request(`/api/objects?${params.toString()}`, undefined, (r) =>
    Array.isArray(r?.objects) ? r.objects : undefined
  );
}

/** Confirm an object as accurate. Idempotent per user. */
export function confirmObject(id: string): Promise<ApiResult<{ verificationStatus: string; confirmationCount: number }>> {
  return request(`/api/objects/${encodeURIComponent(id)}/confirm`, { method: 'POST', body: '{}' }, (r) =>
    typeof r?.verificationStatus === 'string' ? r : undefined
  );
}

/** Report an object as wrong/spam/offensive. */
export function reportObject(id: string, reason: string): Promise<ApiResult<any>> {
  return request(`/api/objects/${encodeURIComponent(id)}/report`, { method: 'POST', body: JSON.stringify({ reason }) }, (r) => (r?.report ? r : undefined));
}

/** One notification row as served by the in-app center. */
export interface Notification {
  id: string;
  kind: string;
  type: string;
  title: string;
  body: string | null;
  objectId: string | null;
  entityId: string | null;
  collectionId: string | null;
  imageUrl: string | null;
  sourceName: string | null;
  context: string | null;
  /** Deep-link target: object:… | entity:… | location:… | collection:… */
  dest: string | null;
  priority: 'important' | 'normal' | 'low';
  status: string;
  read: boolean;
  readAt: string | null;
  dedupeKey: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  entityName?: string | null;
  object?: {
    id: string;
    type: string;
    title: string | null;
    status: string | null;
    imageUrl: string | null;
    sourceNames: string[];
  } | null;
}

export interface NotificationPrefs {
  categories: Record<string, boolean>;
  generatedAt?: string | null;
}

export function getNotifications(unreadOnly = false): Promise<ApiResult<{ notifications: Notification[]; unread: number; preferences: NotificationPrefs }>> {
  const q = unreadOnly ? '?unread=1' : '';
  return request(`/api/notifications${q}`, undefined, (r) =>
    Array.isArray(r?.notifications) ? r : undefined
  );
}

/**
 * Mark read (default) / unread (`read: false`) for one notification, or mark
 * all read with no id. Returns the notified row(s) + fresh unread count.
 */
export function markNotificationsRead(idOrAll?: string, read = true): Promise<ApiResult<any>> {
  const body = idOrAll === undefined ? { all: true } : { id: idOrAll, read };
  return request('/api/notifications/read', { method: 'POST', body: JSON.stringify(body) }, (r) => r);
}

/** A tap on a notification: marks read server-side + records `opened`. */
export function openNotification(id: string): Promise<ApiResult<{ notification: Notification; unread: number }>> {
  return request(`/api/notifications/${encodeURIComponent(id)}/open`, { method: 'POST', body: '{}' }, (r) =>
    r?.notification ? r : undefined
  );
}

export function getNotificationPreferences(): Promise<ApiResult<{ preferences: NotificationPrefs }>> {
  return request('/api/notifications/preferences', undefined, (r) =>
    r?.preferences ? r : undefined
  );
}

/** Patch category toggles: { categories: { events: false, … } }. */
export function updateNotificationPreferences(categories: Record<string, boolean>): Promise<ApiResult<{ ok: boolean; preferences: Record<string, boolean>; changed: boolean }>> {
  return request('/api/notifications/preferences', { method: 'PUT', body: JSON.stringify({ categories }) }, (r) =>
    r?.preferences ? r : undefined
  );
}

// ---------------------------------------------------------------------------
// SOURCES
//
// Where Brief's information comes from. The server computes every count from
// real rows (items processed/pending/rejected, objects created), so this
// binding is a pass-through: the client adds no arithmetic of its own.
// ---------------------------------------------------------------------------

export function getSources(): Promise<ApiResult<Source[]>> {
  return request('/api/sources', undefined, (r) => areSources(r?.sources));
}

// Connector capability + ingestion status. These were the last two fetch()
// calls living outside this file (inlined in App.tsx "until they earn a
// binding"): they have earned one. Same proxy prefix, same session header,
// same response guards as everything else.
export type ConnectorCapabilities = {
  telegram?: Record<string, unknown>;
  web?: Record<string, unknown>;
  rss?: Record<string, unknown>;
  whatsapp?: Record<string, unknown>;
  manual?: Record<string, unknown>;
  payments?: Record<string, unknown>;
  auth?: Record<string, unknown>;
  outbound?: Record<string, unknown>;
  features?: Record<string, unknown>;
};

export function getConnectorCapabilities(): Promise<ApiResult<ConnectorCapabilities>> {
  return request('/api/capabilities', undefined, (r) =>
    r && typeof r === 'object' && typeof r.manual === 'object'
      ? (r as ConnectorCapabilities)
      : undefined);
}

export type IngestStatus = {
  sources: number;
  connected: number;
  rawItems: number;
  objects: number;
  relationships: number;
  errors: number;
  queue: Record<string, unknown>;
  lastSyncRuns: unknown[];
};

export function getIngestStatus(): Promise<ApiResult<IngestStatus>> {
  return request('/api/status', undefined, (r) =>
    typeof r?.sources === 'number' && typeof r?.objects === 'number'
      ? (r as IngestStatus)
      : undefined);
}

export interface SourceCreate {
  name: string;
  type: string;
  url?: string;
  description?: string;
  accessType?: string;
  externalId?: string;
  ownerName?: string;
}

/**
 * The create response is the stored row only. It deliberately does NOT carry
 * the derived counts: a source created one millisecond ago has processed
 * nothing, and returning `itemsProcessed: 0` here would be indistinguishable
 * from a real measurement. Callers that need counts re-read getSources().
 */
export type CreatedSource = Omit<
  Source,
  'itemsProcessed' | 'itemsPending' | 'itemsRejected' | 'objectsCreated' | 'membership'
>;

export function createSource(input: SourceCreate): Promise<ApiResult<CreatedSource>> {
  return request('/api/sources', {
    method: 'POST',
    body: JSON.stringify(input)
  }, (r) =>
    r?.source && typeof r.source.id === 'string'
      ? (r.source as CreatedSource)
      : undefined);
}

// ---------------------------------------------------------------------------
// RAW ITEMS
//
// The inbound queue: messages as they actually arrived from connected sources.
// This is what the review inbox reads. If no source has been connected the
// list is genuinely empty, and the inbox must say so rather than showing
// invented sample traffic -- an empty queue is a true statement about the
// system, a fabricated one is not.
// ---------------------------------------------------------------------------

export function getRawItems(
  opts: { sourceId?: string; status?: string } = {}
): Promise<ApiResult<RawItem[]>> {
  const qs = new URLSearchParams();
  if (opts.sourceId) qs.set('sourceId', opts.sourceId);
  if (opts.status) qs.set('status', opts.status);
  const q = qs.toString();
  return request(`/api/raw-items${q ? `?${q}` : ''}`, undefined, (r) =>
    areRawItems(r?.rawItems) ? r.rawItems : undefined);
}

// ---------------------------------------------------------------------------
// BRIEF-IT
//
// Manual capture, deliberately two steps. `preview` is read-only: it shows
// what Brief would extract and whether the text is worth keeping at all.
// `save` is the only call that writes. A caller cannot accidentally ingest by
// previewing, which is why these are not collapsed into one function.
// ---------------------------------------------------------------------------

export function previewBriefIt(text: string): Promise<ApiResult<BriefItPreview>> {
  return request('/api/brief-it/preview', {
    method: 'POST',
    body: JSON.stringify({ text })
  }, (r) => (isBriefItPreview(r?.preview) ? r.preview : undefined));
}

export function saveBriefIt(
  text: string,
  meta: { sourceUrl?: string; sourceName?: string } = {}
): Promise<ApiResult<BriefItSaved>> {
  return request('/api/brief-it/save', {
    method: 'POST',
    body: JSON.stringify({ text, ...meta })
  }, (r) =>
    r && typeof r.rawItemId === 'string'
      ? { rawItemId: r.rawItemId, duplicate: Boolean(r.duplicate), result: r.result }
      : undefined);
}

// ---------------------------------------------------------------------------
// COMMERCE (Batch 3)
//
// Vendor -> Listing -> Order -> Fulfilment -> Transaction.
//
// Two things are deliberately impossible to express through these bindings:
//
//   1. An identity. No function takes an ownerId, buyerId or vendorId for the
//      acting party -- the server resolves the caller. A client-supplied
//      identity is a claim, and claims do not belong in an API surface.
//
//   2. A price. createOrder takes a listingId and a quantity. OrderCreate has
//      no total/unitPrice/amount field, so a forged total is a TYPE error
//      here and an ignored field at the server. Two independent refusals.
//
// Authority is enforced server-side. These bindings do not pre-check whether
// you own a listing; the UI hides what you cannot do, the SERVER is what makes
// it impossible.
// ---------------------------------------------------------------------------

/** Every active seller. */
export function getVendors(): Promise<ApiResult<Vendor[]>> {
  return request('/api/vendors', undefined, (r) => (areVendors(r?.vendors) ? r.vendors : undefined));
}

/**
 * The caller's own seller identity, or null. Null is a real answer -- most
 * people are not vendors -- so it resolves as success, not an error.
 */
export function getMyVendor(): Promise<ApiResult<Vendor | null>> {
  return request('/api/vendors/me', undefined, (r) => {
    if (r?.vendor === null) return null;
    return isVendor(r?.vendor) ? r.vendor : undefined;
  });
}

/** A public seller profile plus their active listings. */
export function getVendor(
  id: string
): Promise<ApiResult<{ vendor: Vendor; listings: Listing[] }>> {
  return request(`/api/vendors/${encodeURIComponent(id)}`, undefined, (r) =>
    isVendor(r?.vendor) && areListings(r?.listings)
      ? { vendor: r.vendor, listings: r.listings }
      : undefined
  );
}

/** Become a seller. Ownership comes from the caller, never from this payload. */
export function createVendor(body: VendorCreate): Promise<ApiResult<Vendor>> {
  return request('/api/vendors', { method: 'POST', body: JSON.stringify(body) }, (r) =>
    isVendor(r?.vendor) ? r.vendor : undefined
  );
}

export function updateVendor(id: string, body: VendorUpdate): Promise<ApiResult<Vendor>> {
  return request(
    `/api/vendors/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(body) },
    (r) => (isVendor(r?.vendor) ? r.vendor : undefined)
  );
}

/**
 * Browse. Active listings only unless a status is named. An empty array means
 * an empty marketplace, which the UI must show as empty rather than fill.
 */
export function getListings(
  opts: { vendorId?: string; type?: string; status?: string } = {}
): Promise<ApiResult<Listing[]>> {
  const q = new URLSearchParams();
  if (opts.vendorId) q.set('vendorId', opts.vendorId);
  if (opts.type) q.set('type', opts.type);
  if (opts.status) q.set('status', opts.status);
  const qs = q.toString();
  return request(`/api/listings${qs ? `?${qs}` : ''}`, undefined, (r) =>
    areListings(r?.listings) ? r.listings : undefined
  );
}

/** The caller's own shelf, including drafts and archived rows. */
export function getMyListings(): Promise<ApiResult<{ vendor: Vendor | null; listings: Listing[] }>> {
  return request('/api/listings/mine', undefined, (r) => {
    if (!areListings(r?.listings)) return undefined;
    const vendor = r?.vendor === null || r?.vendor === undefined ? null : r.vendor;
    if (vendor !== null && !isVendor(vendor)) return undefined;
    return { vendor, listings: r.listings };
  });
}

export function getListing(id: string): Promise<ApiResult<Listing>> {
  return request(`/api/listings/${encodeURIComponent(id)}`, undefined, (r) =>
    isListing(r?.listing) ? r.listing : undefined
  );
}

export function createListing(body: ListingCreate): Promise<ApiResult<Listing>> {
  return request('/api/listings', { method: 'POST', body: JSON.stringify(body) }, (r) =>
    isListing(r?.listing) ? r.listing : undefined
  );
}

/**
 * `reason` travels with the body: the server refuses a money-field change on a
 * published offer without one, and keeps it on the record. The response carries
 * the revised history so the caller can show it without a second round-trip.
 */
export function updateListing(id: string, body: ListingUpdate): Promise<ApiResult<Listing>> {
  return request(
    `/api/listings/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(body) },
    (r) => (isListing(r?.listing) ? r.listing : undefined)
  );
}

/**
 * Move a listing through its lifecycle. `changed: false` means it was already
 * in that state -- a harmless no-op, not a second publication.
 */
export function setListingStatus(
  id: string,
  status: ListingStatus
): Promise<ApiResult<{ listing: Listing; changed: boolean }>> {
  return request(
    `/api/listings/${encodeURIComponent(id)}/status`,
    { method: 'POST', body: JSON.stringify({ status }) },
    (r) => (isListing(r?.listing) ? { listing: r.listing, changed: Boolean(r.changed) } : undefined)
  );
}

/** What I bought. */
export function getMyOrders(status?: string): Promise<ApiResult<Order[]>> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  return request(`/api/orders${qs}`, undefined, (r) => (areOrders(r?.orders) ? r.orders : undefined));
}

/** What I sold. */
export function getVendorOrders(status?: string): Promise<ApiResult<Order[]>> {
  const q = new URLSearchParams({ role: 'vendor' });
  if (status) q.set('status', status);
  return request(`/api/orders?${q.toString()}`, undefined, (r) =>
    areOrders(r?.orders) ? r.orders : undefined
  );
}

export function getOrder(id: string): Promise<ApiResult<Order>> {
  return request(`/api/orders/${encodeURIComponent(id)}`, undefined, (r) =>
    isOrder(r?.order) ? r.order : undefined
  );
}

/**
 * Place an order. The server derives unitPrice, total and currency from the
 * listing -- OrderCreate cannot carry them.
 */
export function createOrder(body: OrderCreate): Promise<ApiResult<Order>> {
  return request('/api/orders', { method: 'POST', body: JSON.stringify(body) }, (r) =>
    isOrder(r?.order) ? r.order : undefined
  );
}

/**
 * Start paying for an order. The phone number is the only input the buyer
 * supplies; the amount is read from the order row by the server and is never
 * sent. `charged:true` means the STK prompt was dispatched, NOT that money
 * arrived -- the client must never treat this as a successful payment. The
 * server returns the intent, whose `status` is the single source of truth;
 * poll getOrderPayments() until it leaves `intent`/`authorized`.
 */
export function payOrder(
  orderId: string,
  phone: string,
  idempotencyKey?: string
): Promise<ApiResult<PaymentInitiation>> {
  const body: Record<string, unknown> = { phone };
  if (idempotencyKey) body.idempotencyKey = idempotencyKey;
  return request(
    `/api/orders/${encodeURIComponent(orderId)}/pay`,
    { method: 'POST', body: JSON.stringify(body) },
    (r) =>
      isPaymentIntent(r?.intent)
        ? {
            intent: r.intent,
            reused: Boolean(r.reused),
            charged: Boolean(r.charged),
            customerMessage: typeof r.customerMessage === 'string' ? r.customerMessage : null
          }
        : undefined
  );
}

/**
 * Payment intents for an order. The buyer polls this to discover the verified
 * state -- success is only ever the server's word, never the client's guess.
 */
export function getOrderPayments(orderId: string): Promise<ApiResult<PaymentIntent[]>> {
  return request(`/api/orders/${encodeURIComponent(orderId)}/payments`, undefined, (r) =>
    arePaymentIntents(r?.payments) ? r.payments : undefined
  );
}

/**
 * Vendor marks an order delivered. Fulfilment says nothing about payment:
 * an order can be fulfilled and still unpaid, and the UI shows both facts.
 */
export function fulfilOrder(
  id: string,
  note = ''
): Promise<ApiResult<{ order: Order; changed: boolean }>> {
  return request(
    `/api/orders/${encodeURIComponent(id)}/fulfil`,
    { method: 'POST', body: JSON.stringify({ note }) },
    (r) => (isOrder(r?.order) ? { order: r.order, changed: Boolean(r.changed) } : undefined)
  );
}

export function cancelOrder(
  id: string,
  reason = ''
): Promise<ApiResult<{ order: Order; changed: boolean }>> {
  return request(
    `/api/orders/${encodeURIComponent(id)}/cancel`,
    { method: 'POST', body: JSON.stringify({ reason }) },
    (r) => (isOrder(r?.order) ? { order: r.order, changed: Boolean(r.changed) } : undefined)
  );
}

/**
 * Settlement requires a settled ledger transaction matching the order total.
 * No payment provider is connected, so this currently refuses -- deliberately.
 * The shape is ready for Batch 4; the money is not pretended in the meantime.
 */
export function settleOrder(
  id: string,
  transactionId?: string
): Promise<ApiResult<{ order: Order; changed: boolean }>> {
  return request(
    `/api/orders/${encodeURIComponent(id)}/settle`,
    { method: 'POST', body: JSON.stringify(transactionId ? { transactionId } : {}) },
    (r) => (isOrder(r?.order) ? { order: r.order, changed: Boolean(r.changed) } : undefined)
  );
}

/**
 * Contest an order. Establishes one fact -- this is contested and must not be
 * read as clean fulfilment. No refund is implied, because no money has moved.
 */
export function disputeOrder(
  id: string,
  reason: string
): Promise<ApiResult<{ dispute: Dispute; order: Order }>> {
  return request(
    `/api/orders/${encodeURIComponent(id)}/dispute`,
    { method: 'POST', body: JSON.stringify({ reason }) },
    (r) => (isDispute(r?.dispute) && isOrder(r?.order) ? { dispute: r.dispute, order: r.order } : undefined)
  );
}

/** Disputes against my listings (role='vendor') or ones I raised. */
export function getDisputes(role?: 'vendor'): Promise<ApiResult<Dispute[]>> {
  const qs = role ? `?role=${role}` : '';
  return request(`/api/disputes${qs}`, undefined, (r) =>
    areDisputes(r?.disputes) ? r.disputes : undefined
  );
}


// ---------------------------------------------------------------------------
// EARNINGS & COMPLIANCE (Batch 4)
// ---------------------------------------------------------------------------

/**
 * What this seller has actually earned, derived server-side from settled
 * orders. Deliberately NOT called "balance": `payoutAvailable` is false while
 * no payment provider is connected, and the UI must show that distinction.
 */
export function getMyEarnings(): Promise<ApiResult<VendorEarnings>> {
  return request('/api/vendors/me/earnings', undefined, (r) => {
    const e = r?.earnings;
    if (!e || typeof e.gross !== 'number' || typeof e.net !== 'number') return undefined;
    if (typeof e.payoutAvailable !== 'boolean') return undefined;
    return e as VendorEarnings;
  });
}

/**
 * Whether real-money contests are legally available in this deployment.
 * Returns the unmet requirements so the client states the actual reason
 * instead of "coming soon".
 */



// ---------------------------------------------------------------------------
// AUTH
// ---------------------------------------------------------------------------

export interface AuthedUser {
  id: string;
  handle: string | null;
  displayName: string;
  personId?: string;
  devFallback?: boolean;
  /** Platform roles + derived capabilities (operator surface). Server truth. */
  platformRoles?: string[];
  capabilities?: string[];
}

export interface PersonStanding {
  personId: string;
  displayName: string;
  hosted: number;
  bought: number;
  arrived: number;
  registered: number;
  vendor: { id: string; displayName: string } | null;
}



export interface PersonMe {
  person: { id: string; displayName: string | null; tags: string[]; aliases: any[] };
  standing: PersonStanding | null;
}

/** Register and sign in. The token is stored centrally on success. */
// The acquisition context captured at page load, forwarded on sign-up so the
// server records provenance once (first-touch-wins). See ./acquisition.ts.
import { pendingAcquisition, clearAcquisition } from './acquisition';
function acquisitionPayload(): Record<string, string> {
  const ctx = pendingAcquisition();
  return ctx ? (ctx as Record<string, string>) : {};
}

export async function register(
  handle: string,
  password: string,
  displayName?: string
): Promise<ApiResult<AuthedUser>> {
  const res = await request<{ user: AuthedUser; token: string }>(
    '/api/auth/register',
    { method: 'POST', body: JSON.stringify({ handle, password, displayName, ...acquisitionPayload() }) },
    (r) => (r?.user && r?.token ? { user: r.user, token: r.token } : undefined)
  );
  if (!res.ok) return res;
  setSessionToken(res.data.token);
  clearAcquisition();
  return { ok: true, data: res.data.user };
}

export async function login(handle: string, password: string): Promise<ApiResult<AuthedUser>> {
  const res = await request<{ user: AuthedUser; token: string }>(
    '/api/auth/login',
    { method: 'POST', body: JSON.stringify({ handle, password }) },
    (r) => (r?.user && r?.token ? { user: r.user, token: r.token } : undefined)
  );
  if (!res.ok) return res;
  setSessionToken(res.data.token);
  return { ok: true, data: res.data.user };
}

export async function logout(): Promise<ApiResult<{ ok: boolean }>> {
  const res = await request<{ ok: boolean }>('/api/auth/logout', { method: 'POST', body: '{}' },
    (r) => (r ? { ok: Boolean(r.ok) } : undefined));
  // Clear locally regardless: a failed logout must not leave the user stuck
  // in a signed-in UI they cannot leave.
  setSessionToken(null);
  return res;
}

/** Who the server says we are. Used on boot to restore a session. */
export function whoAmI(): Promise<ApiResult<AuthedUser>> {
  return request('/api/auth/me', undefined, (r) => (r?.user ? (r.user as AuthedUser) : undefined));
}

// ---------------------------------------------------------------------------
// FEDERATED SIGN-IN + ONBOARDING
//
// The first screen leads with Google and falls back to a handle. Telegram is
// never required. Everything here is a thin binding over routes that verify
// the claim server-side; the client asserts no identity of its own.
// ---------------------------------------------------------------------------

export interface AuthProviderStatus {
  configured: boolean;
  label: string;
  reason?: string | null;
  clientId?: string | null;
  required?: boolean;
}

export interface AuthProviders {
  password: AuthProviderStatus;
  google: AuthProviderStatus;
  telegram: AuthProviderStatus;
  emailLink: AuthProviderStatus;
}

/** What this deployment can honestly offer on the sign-in screen. */
export function getAuthProviders(): Promise<ApiResult<AuthProviders>> {
  return request('/api/auth/providers', undefined, (r) =>
    r?.providers ? (r.providers as AuthProviders) : undefined
  );
}

/** Exchange a Google ID token for a Brief session. The server verifies it. */
export async function googleSignIn(
  credential: string,
  source?: string | null
): Promise<ApiResult<AuthedUser>> {
  const res = await request<{ user: AuthedUser; token: string }>(
    '/api/auth/google',
    { method: 'POST', body: JSON.stringify({ credential, source: source ?? null, ...acquisitionPayload() }) },
    (r) => (r?.user && r?.token ? { user: r.user, token: r.token } : undefined)
  );
  if (!res.ok) return res;
  setSessionToken(res.data.token);
  clearAcquisition();
  return { ok: true, data: res.data.user };
}

/**
 * Continue from a link that carries a Brief-signed email token.
 *
 * This is the "arrived from a TikTok link and was already recognised" path.
 * The token is verified server-side; a bare email in a query string is not an
 * identity and is refused there.
 */
export async function continueFromLinkToken(
  token: string,
  source?: string | null
): Promise<ApiResult<AuthedUser>> {
  const res = await request<{ user: AuthedUser; token: string }>(
    '/api/auth/email-link',
    { method: 'POST', body: JSON.stringify({ token, source: source ?? null, ...acquisitionPayload() }) },
    (r) => (r?.user && r?.token ? { user: r.user, token: r.token } : undefined)
  );
  if (!res.ok) return res;
  setSessionToken(res.data.token);
  clearAcquisition();
  return { ok: true, data: res.data.user };
}

/** Mint a one-tap link token for someone you are inviting by email. */
export function mintEmailLinkToken(
  email: string,
  source?: string | null
): Promise<ApiResult<{ token: string; expiresInMs: number }>> {
  return request(
    '/api/auth/email-link/mint',
    { method: 'POST', body: JSON.stringify({ email, source: source ?? null }) },
    (r) => (typeof r?.token === 'string' ? { token: r.token, expiresInMs: Number(r.expiresInMs ?? 0) } : undefined)
  );
}

export type LadderRungId = 'identity' | 'orient' | 'value' | 'contribute' | 'reach';

export interface LadderRung {
  id: LadderRungId;
  label: string;
  detail: string;
  cta: string;
  index: number;
  done: boolean;
  reached: boolean;
  at: string | null;
  how: string | null;
}

export interface LadderService {
  id: string;
  label: string;
  requires: LadderRungId;
  surface: { tab: string; section?: string };
  unlocked: boolean;
  unlocksAfter: string | null;
  /** True when the segmentation answer moved this service one rung earlier. */
  promoted?: boolean;
}

export interface Ladder {
  rungs: LadderRung[];
  reached: LadderRungId[];
  currentRungId: LadderRungId | null;
  nextStep: { id: LadderRungId; label: string; detail: string; cta: string } | null;
  complete: boolean;
  activated: boolean;
  activatedAt: string | null;
  services: LadderService[];
}

export interface OnboardingGoal {
  id: string;
  label: string;
  leadsTo: { tab: string; section?: string };
}

export interface OnboardingState {
  profile: {
    goal: string | null;
    place: string | null;
    source: string | null;
    startedAt: string | null;
    finishedAt: string | null;
    skippedAt: string | null;
  } | null;
  goals: OnboardingGoal[];
  ladder: Ladder;
}

export type ActivationEventName =
  | 'onboarding_started'
  | 'signed_in'
  | 'goal_chosen'
  | 'place_chosen'
  | 'feed_seen'
  | 'object_opened'
  | 'object_saved'
  | 'object_confirmed'
  | 'capture_saved'
  | 'onboarding_skipped'
  | 'onboarding_finished'
  | 'service_locked_tapped';

function isOnboardingState(raw: any): OnboardingState | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  if (!raw.ladder || !Array.isArray(raw.ladder.rungs)) return undefined;
  return raw as OnboardingState;
}

export function getOnboarding(): Promise<ApiResult<OnboardingState>> {
  return request('/api/onboarding', undefined, isOnboardingState);
}

export function getLadder(): Promise<ApiResult<Ladder>> {
  return request('/api/ladder', undefined, (r) =>
    r?.ladder && Array.isArray(r.ladder.rungs) ? (r.ladder as Ladder) : undefined
  );
}

export function setOnboardingGoal(goal: string): Promise<ApiResult<OnboardingState>> {
  return request('/api/onboarding/goal', { method: 'POST', body: JSON.stringify({ goal }) }, isOnboardingState);
}

export function setOnboardingPlace(place: string): Promise<ApiResult<OnboardingState>> {
  return request('/api/onboarding/place', { method: 'POST', body: JSON.stringify({ place }) }, isOnboardingState);
}

export function setOnboardingSource(source: string): Promise<ApiResult<OnboardingState>> {
  return request('/api/onboarding/source', { method: 'POST', body: JSON.stringify({ source }) }, isOnboardingState);
}

export function finishOnboarding(skipped = false): Promise<ApiResult<OnboardingState>> {
  return request('/api/onboarding/finish', { method: 'POST', body: JSON.stringify({ skipped }) }, isOnboardingState);
}

/**
 * Report a real step someone took. Only the steps that leave no server row of
 * their own are reported this way; everything else is derived from rows.
 */
export function recordActivation(
  name: ActivationEventName,
  meta: Record<string, unknown> = {}
): Promise<ApiResult<{ ladder: Ladder }>> {
  return request(
    '/api/onboarding/event',
    { method: 'POST', body: JSON.stringify({ name, meta }) },
    (r) => (r?.ladder ? { ladder: r.ladder as Ladder } : undefined)
  );
}

export interface ActivationMetrics {
  started: number;
  activated: number;
  activationRate: number | null;
  medianSecondsToActivate: number | null;
  perRung: Record<string, number>;
  dropOff: { from: string; to: string; lost: number }[];
  note: string | null;
}

export function getActivationMetrics(): Promise<ApiResult<ActivationMetrics>> {
  return request('/api/onboarding/metrics', undefined, (r) =>
    r && typeof r.started === 'number' ? (r as ActivationMetrics) : undefined
  );
}

// ---------------------------------------------------------------------------
// THE VAULT
//
// The client never decides a vault's access level: every call returns the
// SERVER's scoped `role` and the fields that role is allowed to see. Money is
// never accepted from the client; requests carry a description, not a price.
// ---------------------------------------------------------------------------

export function createVault(body: VaultCreate): Promise<ApiResult<Vault>> {
  return request('/api/vaults', { method: 'POST', body: JSON.stringify(body) }, (r) =>
    isVault(r?.vault) ? r.vault : undefined
  );
}

export function listVaults(status?: string): Promise<ApiResult<Vault[]>> {
  const q = status ? `?status=${encodeURIComponent(status)}` : '';
  return request(`/api/vaults${q}`, undefined, (r) =>
    areVaults(r?.vaults) ? r.vaults : undefined
  );
}

export function getVault(id: string): Promise<ApiResult<Vault>> {
  return request(`/api/vaults/${encodeURIComponent(id)}`, undefined, (r) =>
    isVault(r?.vault) ? r.vault : undefined
  );
}

export function closeVault(id: string): Promise<ApiResult<Vault>> {
  return request(`/api/vaults/${encodeURIComponent(id)}/close`, { method: 'POST', body: '{}' }, (r) =>
    isVault(r?.vault) ? r.vault : undefined
  );
}

export function getFootsteps(id: string, category?: string, cursor?: number): Promise<ApiResult<FootstepPage>> {
  const params = new URLSearchParams();
  if (category) params.set('category', category);
  if (cursor !== undefined) params.set('cursor', String(cursor));
  const qs = params.toString();
  return request(`/api/vaults/${encodeURIComponent(id)}/footsteps${qs ? `?${qs}` : ''}`, undefined, (r) =>
    r && areFootsteps(r.footsteps) ? { footsteps: r.footsteps, nextCursor: r.nextCursor ?? null, total: r.total ?? r.footsteps.length } : undefined
  );
}

export function recordFootstep(
  id: string,
  body: { kind: string; narrative?: string; actorName?: string; value?: string | number | null }
): Promise<ApiResult<Footstep>> {
  return request(`/api/vaults/${encodeURIComponent(id)}/footsteps`, { method: 'POST', body: JSON.stringify(body) }, (r) =>
    isFootstep(r?.footstep) ? r.footstep : undefined
  );
}

export function addVaultParticipant(id: string, body: { role?: string; name?: string; phone?: string; userId?: string }): Promise<ApiResult<{ id: string; role: string }>> {
  return request(`/api/vaults/${encodeURIComponent(id)}/participants`, { method: 'POST', body: JSON.stringify(body) }, (r) =>
    r?.participant && typeof r.participant.id === 'string' ? r.participant : undefined
  );
}

export function createVaultRequest(id: string, body: { description: string; kind?: string; quantity?: number; notes?: string }): Promise<ApiResult<VaultRequest>> {
  return request(`/api/vaults/${encodeURIComponent(id)}/requests`, { method: 'POST', body: JSON.stringify(body) }, (r) =>
    isVaultRequest(r?.request) ? r.request : undefined
  );
}

export function listVaultRequests(id: string): Promise<ApiResult<VaultRequest[]>> {
  return request(`/api/vaults/${encodeURIComponent(id)}/requests`, undefined, (r) =>
    areVaultRequests(r?.requests) ? r.requests : undefined
  );
}

export function routeVaultRequest(id: string, requestId: string, vendorId: string): Promise<ApiResult<VaultRequest>> {
  return request(
    `/api/vaults/${encodeURIComponent(id)}/requests/${encodeURIComponent(requestId)}/route`,
    { method: 'POST', body: JSON.stringify({ vendorId }) },
    (r) => (isVaultRequest(r?.request) ? r.request : undefined)
  );
}

export function acceptVaultRequest(id: string, requestId: string): Promise<ApiResult<VaultRequest>> {
  return request(
    `/api/vaults/${encodeURIComponent(id)}/requests/${encodeURIComponent(requestId)}/accept`,
    { method: 'POST', body: '{}' },
    (r) => (isVaultRequest(r?.request) ? r.request : undefined)
  );
}

export function createHandoff(id: string, body: { participantId: string; toChannel?: string }): Promise<ApiResult<{ token: string; expiresAt: string }>> {
  return request(`/api/vaults/${encodeURIComponent(id)}/handoff`, { method: 'POST', body: JSON.stringify(body) }, (r) =>
    typeof r?.token === 'string' ? { token: r.token, expiresAt: r.expiresAt } : undefined
  );
}

export function searchVaults(q: string): Promise<ApiResult<VaultSearchResult[]>> {
  return request(`/api/vaults/search?q=${encodeURIComponent(q)}`, undefined, (r) =>
    Array.isArray(r?.results) ? r.results : undefined
  );
}

export function getResolution(): Promise<ApiResult<ResolutionItem[]>> {
  return request('/api/vaults/resolution', undefined, (r) =>
    Array.isArray(r?.items) ? r.items : undefined
  );
}

export function getPublicVault(slug: string): Promise<ApiResult<Vault>> {
  return request(`/api/public/vaults/${encodeURIComponent(slug)}`, undefined, (r) =>
    isVault(r?.vault) ? r.vault : undefined
  );
}

export function publicEnter(slug: string, body: { name?: string; phone?: string }): Promise<ApiResult<VaultEntry>> {
  return request(`/api/public/vaults/${encodeURIComponent(slug)}/enter`, { method: 'POST', body: JSON.stringify(body) }, (r) =>
    r && typeof r === 'object' ? (r as VaultEntry) : undefined
  );
}

// ---------------------------------------------------------------------------
// THE GATE — ticket lookup + check-in (host/gate operator)
// ---------------------------------------------------------------------------

export function getTicket(code: string): Promise<ApiResult<Ticket>> {
  return request(`/api/tickets/${encodeURIComponent(code)}`, undefined, (r) =>
    isTicket(r?.ticket) ? r.ticket : undefined
  );
}

export function checkInTicket(code: string): Promise<ApiResult<CheckInResult>> {
  return request(`/api/tickets/${encodeURIComponent(code)}/check-in`, { method: 'POST', body: '{}' }, (r) =>
    r && typeof r === 'object' ? (r as CheckInResult) : undefined
  );
}

/** The host command centre: derived figures across the caller's campaigns + vaults. */
export function getCommandCentre(): Promise<ApiResult<CommandCentre>> {
  return request('/api/host/command', undefined, (r) =>
    isCommandCentre(r?.command) ? r.command : undefined
  );
}

// ---------------------------------------------------------------------------
// DEMO SEED — in-process, authenticated. Lets an authorised user populate or
// clear demo content from within the running server (the CLI wrote to a file
// the server never re-read).
// ---------------------------------------------------------------------------

export function seedDemo(): Promise<ApiResult<{ seeded: any }>> {
  return request('/api/ops/seed', { method: 'POST', body: '{}' }, (r) => (r?.seeded ? { seeded: r.seeded } : undefined));
}

export function clearDemo(): Promise<ApiResult<{ cleared: any }>> {
  return request('/api/ops/seed/clear', { method: 'POST', body: '{}' }, (r) => (r?.cleared ? { cleared: r.cleared } : undefined));
}

/** Kenya + major world headlines, last 24h. Empty lists if the wire is down. */
export function getWire(): Promise<ApiResult<{
  kenya: any[];
  world: any[];
  note: string;
  error: string | null;
  fetchedAt: string;
  source: string;
}>> {
  return request('/api/wire', undefined, (r) =>
    r?.wire && Array.isArray(r.wire.kenya) && Array.isArray(r.wire.world) ? r.wire : undefined
  );
}

/** Published Tea articles (ranked), optionally filtered by category/location. */
export function getTea(opts: { category?: string; location?: string; limit?: number } = {}): Promise<ApiResult<any[]>> {
  const params = new URLSearchParams();
  if (opts.category) params.set('category', opts.category);
  if (opts.location) params.set('location', opts.location);
  if (opts.limit !== undefined) params.set('limit', String(opts.limit));
  const q = params.toString() ? `?${params.toString()}` : '';
  return request(`/api/tea${q}`, undefined, (r) =>
    Array.isArray(r?.tea) ? (r.tea as unknown[]).filter((x) => isTeaArticle(x)) : undefined
  );
}

/** One published Tea article by slug. */
export function getTeaArticle(slug: string): Promise<ApiResult<any>> {
  return request(`/api/tea/${encodeURIComponent(slug)}`, undefined, (r) =>
    isTeaArticle(r?.article) ? r.article : undefined
  );
}

/** The composed home feed (hero/discovery/opportunities/more + featured tea). */
export interface FeedRequest {
  lat?: number;
  lng?: number;
  radiusKm?: number;
  /** A named locality (county/area/landmark/venue) — never defaulted. */
  area?: string;
  /** A content-type category (event, offer, place, news, ...). */
  type?: string;
  limit?: number;
  offset?: number;
}

function feedQuery(opts: FeedRequest): string {
  const params = new URLSearchParams();
  if (opts.lat !== undefined) params.set('lat', String(opts.lat));
  if (opts.lng !== undefined) params.set('lng', String(opts.lng));
  if (opts.radiusKm !== undefined) params.set('radiusKm', String(opts.radiusKm));
  if (opts.area) params.set('area', opts.area);
  if (opts.type) params.set('type', opts.type);
  if (opts.limit !== undefined) params.set('limit', String(opts.limit));
  if (opts.offset !== undefined) params.set('offset', String(opts.offset));
  return params.toString();
}

export function getFeed(opts: FeedRequest = {}): Promise<ApiResult<any>> {
  const q = feedQuery(opts);
  return request(`/api/feed${q ? `?${q}` : ''}`, undefined, (r) => (
    r?.feed
      ? { ...r.feed, _meta: r.meta ?? null, _mediaProvider: r.mediaProvider ?? null }
      : undefined
  ));
}

/**
 * Anonymous feed contract for external consumers. It returns the same
 * title/media composition as getFeed, but uses the explicit public URL so
 * integrations do not depend on the first-party alias.
 */
export function getPublicFeed(opts: FeedRequest = {}): Promise<ApiResult<any>> {
  const q = feedQuery(opts);
  return request(`/api/public/feed${q ? `?${q}` : ''}`, undefined, (r) => (r?.feed ? r.feed : undefined));
}

// --- Tea Desk (editorial admin) ---------------------------------------------

/** All Tea articles including drafts, for the desk. */
export function listTeaAll(status?: string): Promise<ApiResult<any[]>> {
  const q = status ? `?status=${encodeURIComponent(status)}` : '';
  return request(`/api/admin/tea${q}`, undefined, (r) =>
    Array.isArray(r?.articles) ? r.articles : undefined
  );
}

/** Create a Tea article (draft by default). */
export function createTeaArticle(fields: Record<string, unknown>): Promise<ApiResult<any>> {
  return request('/api/admin/tea', { method: 'POST', body: JSON.stringify(fields) }, (r) => r?.article ?? undefined);
}

/** Edit a Tea article. */
export function updateTeaArticle(id: string, patch: Record<string, unknown>): Promise<ApiResult<any>> {
  return request(`/api/admin/tea/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }, (r) => r?.article ?? undefined);
}

/** Drive a status transition: submit/approve/publish/schedule/unpublish/expire/archive. */
export function transitionTea(id: string, action: string): Promise<ApiResult<any>> {
  return request(`/api/admin/tea/${encodeURIComponent(id)}/${encodeURIComponent(action)}`, { method: 'POST', body: '{}' }, (r) => r?.article ?? undefined);
}

/** Published editorial collections (metadata). */
export function getCollections(): Promise<ApiResult<any[]>> {
  return request('/api/collections', undefined, (r) =>
    Array.isArray(r?.collections) ? r.collections : undefined
  );
}

/** One published collection resolved to its current member objects. */
export function getCollection(key: string): Promise<ApiResult<any>> {
  return request(`/api/collections/${encodeURIComponent(key)}`, undefined, (r) =>
    r?.collection ? r.collection : undefined
  );
}

/**
 * Cross-entity search: objects + Tea + vendors + collections. Filters map to
 * fields the server already stores: type, location (county/area/landmark/
 * venue), date (YYYY-MM-DD), source (source id or name).
 */
export interface SearchFilters {
  type?: string;
  location?: string;
  date?: string;
  source?: string;
}

export function searchAll(q: string, filters: SearchFilters = {}): Promise<ApiResult<any>> {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  const qs = params.toString();
  return request(`/api/search${qs ? `?${qs}` : ''}`, undefined, (r) => (r?.results ? r.results : undefined));
}

/**
 * Exchange Telegram Mini App initData for a Brief session. Only callable from
 * inside Telegram, where the WebApp SDK injects a signed initData string; the
 * server verifies the HMAC and binds the Telegram user to a Brief account.
 */
export async function telegramInit(initData: string): Promise<ApiResult<AuthedUser>> {
  const res = await request<{ user: AuthedUser; token: string }>(
    '/api/telegram/init',
    { method: 'POST', body: JSON.stringify({ initData }) },
    (r) => (r?.user && r?.token ? { user: r.user, token: r.token } : undefined)
  );
  if (!res.ok) return res;
  setSessionToken(res.data.token);
  return { ok: true, data: res.data.user };
}

/** Are we running inside a Telegram Mini App (WebApp SDK present)? */
export function isTelegramMiniApp(): boolean {
  try {
    const tg = (window as any)?.Telegram?.WebApp;
    return Boolean(tg && typeof tg.initData === 'string' && tg.initData.length > 0);
  } catch {
    return false;
  }
}

// --- Automation engine (creator cockpit) -------------------------------------

export function getWorkflows(): Promise<ApiResult<any>> {
  return request('/api/workflows', undefined, (r) => (r?.workflows ? { workflows: r.workflows, runs: r.runs, stats: r.stats } : undefined));
}

export function createWorkflow(fields: Record<string, unknown>): Promise<ApiResult<any>> {
  return request('/api/workflows', { method: 'POST', body: JSON.stringify(fields) }, (r) => r?.workflow ?? undefined);
}

export function updateWorkflow(id: string, patch: Record<string, unknown>): Promise<ApiResult<any>> {
  return request(`/api/workflows/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }, (r) => r?.workflow ?? undefined);
}

export function runWorkflowSweep(): Promise<ApiResult<any>> {
  return request('/api/workflows/sweep', { method: 'POST', body: '{}' }, (r) => r ?? undefined);
}

// --- AI seam ---------------------------------------------------------------

export function getAssistStatus(): Promise<ApiResult<any>> {
  return request('/api/assist/status', undefined, (r) => r?.assist ?? undefined);
}

export function requestAssist(task: string, input: unknown): Promise<ApiResult<any>> {
  return request('/api/assist', { method: 'POST', body: JSON.stringify({ task, input }) }, (r) => r ?? undefined);
}

// --- Creator workspace (profile, rate cards, media kit, partnership, inbox) ---

export function getCreatorProfile(): Promise<ApiResult<any>> {
  return request('/api/creator/profile', undefined, (r) => r?.profile ?? undefined);
}

export function updateCreatorProfile(fields: Record<string, unknown>): Promise<ApiResult<any>> {
  return request('/api/creator/profile', { method: 'PATCH', body: JSON.stringify(fields) }, (r) => r?.profile ?? undefined);
}

export function getCreatorRateCards(): Promise<ApiResult<any[]>> {
  return request('/api/creator/rate-cards', undefined, (r) => Array.isArray(r?.rateCards) ? r.rateCards : undefined);
}

export function createCreatorRateCard(fields: Record<string, unknown>): Promise<ApiResult<any>> {
  return request('/api/creator/rate-cards', { method: 'POST', body: JSON.stringify(fields) }, (r) => r?.rateCard ?? undefined);
}

export function updateCreatorRateCard(id: string, fields: Record<string, unknown>): Promise<ApiResult<any>> {
  return request(`/api/creator/rate-cards/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(fields) }, (r) => r?.rateCard ?? undefined);
}

export function getMyMediaKit(): Promise<ApiResult<any>> {
  return request('/api/creator/mediakit/mine', undefined, (r) => (r?.mediaKit ? r.mediaKit : null));
}

export function getOpportunities(): Promise<ApiResult<any[]>> {
  return request('/api/creator/opportunities', undefined, (r) => Array.isArray(r?.opportunities) ? r.opportunities : undefined);
}

export function respondOpportunity(id: string, action: string): Promise<ApiResult<any>> {
  return request(`/api/creator/opportunities/${encodeURIComponent(id)}/${encodeURIComponent(action)}`, { method: 'POST', body: '{}' }, (r) => r?.opportunity ?? undefined);
}

export function getInboxContacts(): Promise<ApiResult<any[]>> {
  return request('/api/inbox/contacts', undefined, (r) => Array.isArray(r?.contacts) ? r.contacts : undefined);
}

export function getInboxThread(key: string): Promise<ApiResult<any[]>> {
  return request(`/api/inbox/thread/${encodeURIComponent(key)}`, undefined, (r) => Array.isArray(r?.messages) ? r.messages : undefined);
}

export function getSubscriptions(): Promise<ApiResult<any[]>> {
  return request('/api/subscriptions', undefined, (r) => Array.isArray(r?.subscriptions) ? r.subscriptions : undefined);
}

export function createSubscription(fields: Record<string, unknown>): Promise<ApiResult<any>> {
  return request('/api/subscriptions', { method: 'POST', body: JSON.stringify(fields) }, (r) => r?.subscription ?? undefined);
}

export function subscriptionAction(id: string, action: string): Promise<ApiResult<any>> {
  return request(`/api/subscriptions/${encodeURIComponent(id)}/${encodeURIComponent(action)}`, { method: 'POST', body: '{}' }, (r) => r?.subscription ?? r?.transaction ?? undefined);
}

// --- Yard Engine: advertising, matching and distribution --------------------

export function getAdvertiserProfile(): Promise<ApiResult<any>> {
  return request('/api/advertising/advertiser', undefined, (r) => r?.advertiser ?? undefined);
}

export function updateAdvertiserProfile(fields: Record<string, unknown>): Promise<ApiResult<any>> {
  return request('/api/advertising/advertiser', { method: 'PATCH', body: JSON.stringify(fields) }, (r) => r?.advertiser ?? undefined);
}

export function getAdvertiserCampaigns(status?: string): Promise<ApiResult<any[]>> {
  const q = status ? `?status=${encodeURIComponent(status)}` : '';
  return request(`/api/advertising/campaigns${q}`, undefined, (r) => Array.isArray(r?.campaigns) ? r.campaigns : undefined);
}

export function createAdvertiserCampaign(fields: Record<string, unknown>): Promise<ApiResult<any>> {
  return request('/api/advertising/campaigns', { method: 'POST', body: JSON.stringify(fields) }, (r) => r?.campaign ?? undefined);
}

export function updateAdvertiserCampaign(id: string, fields: Record<string, unknown>): Promise<ApiResult<any>> {
  return request(`/api/advertising/campaigns/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(fields) }, (r) => r?.campaign ?? undefined);
}

export function submitAdvertiserCampaign(id: string): Promise<ApiResult<any>> {
  return request(`/api/advertising/campaigns/${encodeURIComponent(id)}/submit`, { method: 'POST', body: '{}' }, (r) => r?.campaign ?? undefined);
}

export function confirmAdvertiserFunding(id: string, reference?: string): Promise<ApiResult<any>> {
  return request(`/api/advertising/campaigns/${encodeURIComponent(id)}/confirm-funding`, { method: 'POST', body: JSON.stringify({ confirmation: true, reference: reference ?? null }) }, (r) => r?.campaign ?? undefined);
}

export function allocateAdvertiserCampaign(id: string): Promise<ApiResult<any>> {
  return request(`/api/advertising/campaigns/${encodeURIComponent(id)}/allocate`, { method: 'POST', body: '{}' }, (r) => r ?? undefined);
}

export function getAdvertiserMatches(id: string): Promise<ApiResult<any[]>> {
  return request(`/api/advertising/campaigns/${encodeURIComponent(id)}/matches`, undefined, (r) => Array.isArray(r?.matches) ? r.matches : undefined);
}

export function getMyAdvertiserMatches(): Promise<ApiResult<any[]>> {
  return request('/api/advertising/matches/mine', undefined, (r) => Array.isArray(r?.matches) ? r.matches : undefined);
}

export function acceptAdvertiserMatch(id: string): Promise<ApiResult<any>> {
  return request(`/api/advertising/matches/${encodeURIComponent(id)}/accept`, { method: 'POST', body: '{}' }, (r) => r?.match ?? undefined);
}

export function declineAdvertiserMatch(id: string): Promise<ApiResult<any>> {
  return request(`/api/advertising/matches/${encodeURIComponent(id)}/decline`, { method: 'POST', body: '{}' }, (r) => r?.match ?? undefined);
}

export function verifyAdvertiserFulfillment(id: string, proofUrl?: string): Promise<ApiResult<any>> {
  return request(`/api/advertising/matches/${encodeURIComponent(id)}/verify-fulfillment`, { method: 'POST', body: JSON.stringify({ performanceVerified: true, proofUrl: proofUrl ?? null }) }, (r) => r ?? undefined);
}

export function retryAdvertiserSettlement(id: string): Promise<ApiResult<any>> {
  return request(`/api/advertising/matches/${encodeURIComponent(id)}/retry-settlement`, { method: 'POST', body: '{}' }, (r) => r ?? undefined);
}

export function getAdAssets(advertiserCampaignId?: string): Promise<ApiResult<any[]>> {
  const q = advertiserCampaignId ? `?advertiserCampaignId=${encodeURIComponent(advertiserCampaignId)}` : '';
  return request(`/api/advertising/assets${q}`, undefined, (r) => Array.isArray(r?.assets) ? r.assets : undefined);
}

export function createAdAsset(fields: Record<string, unknown>): Promise<ApiResult<any>> {
  return request('/api/advertising/assets', { method: 'POST', body: JSON.stringify(fields) }, (r) => r?.asset ?? undefined);
}

export function approveAdAsset(id: string): Promise<ApiResult<any>> {
  return request(`/api/advertising/assets/${encodeURIComponent(id)}/approve`, { method: 'POST', body: '{}' }, (r) => r?.asset ?? undefined);
}

export function issueAdAsset(id: string): Promise<ApiResult<any>> {
  return request(`/api/advertising/assets/${encodeURIComponent(id)}/issue`, { method: 'POST', body: '{}' }, (r) => r?.asset ?? undefined);
}

export function getDistributionKit(id: string): Promise<ApiResult<any>> {
  return request(`/api/advertising/assets/${encodeURIComponent(id)}/distribution-kit`, undefined, (r) => r?.kit ?? undefined);
}

// --- Calendar and waiting lists ---------------------------------------------

export function getCalendarEntries(): Promise<ApiResult<any[]>> {
  return request('/api/calendar', undefined, (r) => Array.isArray(r?.entries) ? r.entries : undefined);
}

export function createCalendarEntry(fields: Record<string, unknown>): Promise<ApiResult<any>> {
  return request('/api/calendar', { method: 'POST', body: JSON.stringify(fields) }, (r) => r?.entry ?? undefined);
}

export function sweepCalendar(): Promise<ApiResult<any>> {
  return request('/api/calendar/sweep', { method: 'POST', body: '{}' }, (r) => r ?? undefined);
}

export function getCampaignWaitlist(slug: string): Promise<ApiResult<any[]>> {
  return request(`/api/calendar/campaigns/${encodeURIComponent(slug)}/waitlist`, undefined, (r) => Array.isArray(r?.waitlist) ? r.waitlist : undefined);
}

export function joinCampaignWaitlist(slug: string, fields: Record<string, unknown>): Promise<ApiResult<any>> {
  return request(`/api/calendar/campaigns/${encodeURIComponent(slug)}/waitlist`, { method: 'POST', body: JSON.stringify(fields) }, (r) => r?.entry ?? undefined);
}

export function acceptWaitlistOffer(id: string, attendeeRef?: string): Promise<ApiResult<any>> {
  return request(`/api/waitlist/${encodeURIComponent(id)}/accept`, { method: 'POST', body: JSON.stringify({ attendeeRef: attendeeRef ?? null }) }, (r) => r ?? undefined);
}

// --- Vendor capability shelf -----------------------------------------------

export function getVendorCapabilities(id: string): Promise<ApiResult<any>> {
  return request(`/api/vendors/${encodeURIComponent(id)}/capabilities`, undefined, (r) => r ?? undefined);
}

export function updateVendorCapabilities(id: string, fields: Record<string, unknown>): Promise<ApiResult<any>> {
  return request(`/api/vendors/${encodeURIComponent(id)}/capabilities`, { method: 'PUT', body: JSON.stringify(fields) }, (r) => r?.capabilities ?? undefined);
}














export function getPersonMe(): Promise<ApiResult<PersonMe>> {
  return request('/api/person/me', undefined, (r) =>
    r?.person && r.person.id ? (r as PersonMe) : undefined
  );
}





// ---------------------------------------------------------------------------
// ENGINE — the power-plant layer: sync pipeline, universal router, tiers.
// Every response is the server's honest shape; nothing here simulates a
// capability the server did not report.
// ---------------------------------------------------------------------------

export interface EngineGuardrail {
  tier: string;
  label: string;
  caps: { syncIntervalMs: number; maxRoutes: number | null; pipelineDepth: string };
  micro: string;
  next: { tier: string; label: string; micro: string } | null;
  billingConfigured: boolean;
}

export interface EngineStatus {
  engine: string;
  version: string;
  watermark: string | null;
  collections: Record<string, number>;
  guardrail: EngineGuardrail | null;
  router: { signingConfigured: boolean; channels: { kind: string; configured: boolean }[] };
  billingConfigured: boolean;
}

export function getEngineStatus(): Promise<ApiResult<EngineStatus>> {
  return request('/api/engine/status', undefined, (r) =>
    r?.engine && r?.guardrail ? (r as EngineStatus) : undefined
  );
}

export interface EngineRouteChannel {
  kind: 'webhook' | 'discord' | 'slack' | 'whatsapp' | 'sms';
  to: string;
}

export interface EngineRoute {
  id: string;
  name: string;
  match: { signalType: string; objectId: string | null };
  channels: EngineRouteChannel[];
  enabled: boolean;
  createdAt: string;
}

export function getEngineRoutes(): Promise<ApiResult<EngineRoute[]>> {
  return request('/api/engine/routes', undefined, (r) =>
    Array.isArray(r?.routes) ? (r.routes as EngineRoute[]) : undefined
  );
}

export function createEngineRoute(body: {
  name: string;
  match?: { signalType?: string; objectId?: string | null };
  channels: EngineRouteChannel[];
}): Promise<ApiResult<EngineRoute>> {
  return request(
    '/api/engine/routes',
    { method: 'POST', body: JSON.stringify(body) },
    (r) => (r?.route ? (r.route as EngineRoute) : undefined)
  );
}

export function deleteEngineRoute(id: string): Promise<ApiResult<{ ok: boolean }>> {
  return request(`/api/engine/routes/${encodeURIComponent(id)}`, { method: 'DELETE' }, (r) =>
    r?.ok ? { ok: true } : undefined
  );
}

export function requestEngineTier(tier: string): Promise<ApiResult<any>> {
  // The server answers 402 with the honest refusal payload; request() folds
  // non-2xx into { ok:false, error } — the detail fields ride on errorBody.
  return request('/api/engine/tier', { method: 'POST', body: JSON.stringify({ tier }) }, (r) => r);
}

export function getEngineDeliveries(): Promise<ApiResult<any[]>> {
  return request('/api/engine/deliveries', undefined, (r) =>
    Array.isArray(r?.deliveries) ? r.deliveries : undefined
  );
}

// --- Story likes (the public rating) ------------------------------------------

export function likeTeaArticle(id: string): Promise<ApiResult<{ liked: boolean; likeCount: number }>> {
  return request(
    `/api/tea/${encodeURIComponent(id)}/like`,
    { method: 'POST', body: '{}' },
    (r) => (typeof r?.likeCount === 'number' ? r : undefined)
  );
}

export function unlikeTeaArticle(id: string): Promise<ApiResult<{ liked: boolean; likeCount: number }>> {
  return request(
    `/api/tea/${encodeURIComponent(id)}/like`,
    { method: 'DELETE' },
    (r) => (typeof r?.likeCount === 'number' ? r : undefined)
  );
}

// --- Group Buy engine (Table banking & group-order pipelines) ---------------------------

export interface GroupBuyContribution {
  id: string;
  memberRef: string;
  amount: number;
  source: string;
  receiptHash: string;
  createdAt: string;
}

export interface GroupBuy {
  id: string;
  title: string;
  note: string | null;
  targetAmount: number;
  stage: string;
  stages: { id: string; label: string; blurb: string }[];
  stageIndex: number;
  total: number;
  remaining: number;
  progressPct: number;
  contributionCount: number;
  contributions: GroupBuyContribution[];
  history: { stage: string; at: string; note: string }[];
}

export function listGroupBuys(): Promise<ApiResult<GroupBuy[]>> {
  return request('/api/engine/group-buys', undefined, (r) =>
    Array.isArray(r?.groupBuys) ? (r.groupBuys as GroupBuy[]) : undefined
  );
}

export function createGroupBuy(body: { title: string; targetAmount: number; note?: string }): Promise<ApiResult<GroupBuy>> {
  return request('/api/engine/group-buys', { method: 'POST', body: JSON.stringify(body) }, (r) =>
    r?.groupBuy ? (r.groupBuy as GroupBuy) : undefined
  );
}

export function contributeGroupBuy(id: string, body: { memberRef: string; amount: number; source: string }): Promise<ApiResult<{
  receipt: { contributionId: string; memberRef: string; amount: number; source: string; receiptHash: string; createdAt: string };
  total: number;
  progressPct: number;
  stageChanged: boolean;
}>> {
  return request(`/api/engine/group-buys/${encodeURIComponent(id)}/contribute`, { method: 'POST', body: JSON.stringify(body) }, (r) =>
    r?.receipt ? r : undefined
  );
}

export function advanceGroupBuyStage(id: string, to: string): Promise<ApiResult<GroupBuy>> {
  return request(`/api/engine/group-buys/${encodeURIComponent(id)}/stage`, { method: 'POST', body: JSON.stringify({ to }) }, (r) =>
    r?.groupBuy ? (r.groupBuy as GroupBuy) : undefined
  );
}

// --- Priced bargains (Tikiti T2) -----------------------------------------------

export interface BargainTier {
  min: number;
  max: number | null;
  pricePerHead: number;
  label: string | null;
}

/**
 * The honest price view the server derives: what a joiner pays NOW, the next
 * band and what it needs, and what everyone settles at if the room fills.
 * Nothing here is client-computed.
 */
export interface BargainView {
  participants: number;
  requiredParticipants: number | null;
  maxParticipants: number | null;
  spotsLeft: number | null;
  currentPricePerHead: number | null;
  currentTierLabel: string | null;
  nextTier: { at: number; pricePerHead: number; needs: number } | null;
  settlesAt: number;
  expiresAt: string | null;
  expired: boolean;
  minimumMet: boolean;
}

export interface GroupBuyWithBargain {
  groupBuy: GroupBuy;
  bargain: BargainView | null;
}

/** One buy with its derived bargain view (owner-only route). */
export function getGroupBuy(id: string): Promise<ApiResult<GroupBuyWithBargain>> {
  return request(`/api/engine/group-buys/${encodeURIComponent(id)}`, undefined, (r) =>
    r?.groupBuy ? { groupBuy: r.groupBuy as GroupBuy, bargain: (r.bargain ?? null) as BargainView | null } : undefined
  );
}

/**
 * Attach per-head pricing bands to a buy. The ladder must climb down in price
 * as participation climbs up; the server refuses anything else, and the
 * refusal text is the useful part.
 */
export function priceGroupBuyBargain(
  id: string,
  body: {
    tiers: { min: number; pricePerHead: number; max?: number | null; label?: string | null }[];
    minParticipants?: number | null;
    maxParticipants?: number | null;
    expiresAt?: string | null;
  }
): Promise<ApiResult<GroupBuy>> {
  return request(
    `/api/engine/group-buys/${encodeURIComponent(id)}/pricing`,
    { method: 'POST', body: JSON.stringify(body) },
    (r) => (r?.buy ? (r.buy as GroupBuy) : undefined)
  );
}

/**
 * Join a priced bargain. There is deliberately no price argument: the price is
 * derived server-side from the live count at the moment of joining.
 */
export function joinBargain(id: string): Promise<ApiResult<{
  participant: { id: string; priceAtJoin: number; tierLabelAtJoin: string; status: string };
  changed: boolean;
}>> {
  return request(
    `/api/engine/group-buys/${encodeURIComponent(id)}/join`,
    { method: 'POST', body: '{}' },
    (r) => (r?.participant ? { participant: r.participant, changed: Boolean(r.changed) } : undefined)
  );
}

/** Leave before the bargain executes; the spot opens again. */
export function leaveBargain(id: string): Promise<ApiResult<{
  participant: { id: string; status: string };
  changed: boolean;
}>> {
  return request(
    `/api/engine/group-buys/${encodeURIComponent(id)}/leave`,
    { method: 'POST', body: '{}' },
    (r) => (r?.participant ? { participant: r.participant, changed: Boolean(r.changed) } : undefined)
  );
}

// --- Campaign updates (Tikiti T3) ----------------------------------------------

export interface CampaignUpdatePost {
  id: string;
  campaignId: string;
  title: string;
  body: string;
  createdAt: string;
}

/** Updates on a published campaign, addressed by its PUBLIC slug. */
export function getCampaignUpdatesBySlug(slug: string): Promise<ApiResult<CampaignUpdatePost[]>> {
  return request(
    `/api/public/campaigns/${encodeURIComponent(slug)}/updates`,
    undefined,
    (r) => (Array.isArray(r?.updates) ? (r.updates as CampaignUpdatePost[]) : undefined)
  );
}

/** The organiser authors an update; supporters read it on the public page. */
export function postCampaignUpdate(
  campaignId: string,
  body: { title: string; body: string }
): Promise<ApiResult<CampaignUpdatePost>> {
  return request(
    `/api/campaigns/${encodeURIComponent(campaignId)}/updates`,
    { method: 'POST', body: JSON.stringify(body) },
    (r) => (r?.update ? (r.update as CampaignUpdatePost) : undefined)
  );
}

// --- Verification (Tikiti T6) ----------------------------------------------------

export type AccountVerificationKind = 'email' | 'phone' | 'identity';
export type VerificationStatus = 'pending' | 'approved' | 'rejected' | 'revoked';

export interface VerificationRecord {
  id: string;
  kind: AccountVerificationKind;
  status: VerificationStatus;
  providerRef: string | null;
  note: string | null;
  submittedAt: string;
  reviewedAt: string | null;
  /** The reviewer's own reason, shown verbatim. */
  reason: string | null;
}

export function submitVerification(body: {
  kind: AccountVerificationKind; providerRef?: string | null; note?: string | null;
}): Promise<ApiResult<{ record: VerificationRecord; changed: boolean }>> {
  return request('/api/verification', { method: 'POST', body: JSON.stringify(body) }, (r) =>
    r?.record ? { record: r.record as VerificationRecord, changed: Boolean(r.changed) } : undefined
  );
}

/** My records and my DERIVED standing (never a stored second truth). */
export function getMyVerification(): Promise<ApiResult<{
  records: VerificationRecord[];
  standing: Record<string, 'verified' | 'pending' | 'unverified'>;
}>> {
  return request('/api/verification/me', undefined, (r) =>
    Array.isArray(r?.records) ? { records: r.records as VerificationRecord[], standing: r.standing ?? {} } : undefined
  );
}

// --- Email topic subscriptions (Tikiti T7) -----------------------------------------

export const EMAIL_TOPICS = [
  'event_announcements', 'new_ticket_listings', 'bargain_alerts',
  'contribution_updates', 'product_updates'
] as const;
export type EmailTopic = typeof EMAIL_TOPICS[number];

export const EMAIL_TOPIC_LABELS: Record<EmailTopic, string> = {
  event_announcements: 'Events',
  new_ticket_listings: 'Ticket resale',
  bargain_alerts: 'Bargain bands',
  contribution_updates: 'Causes you back',
  product_updates: 'Brief itself'
};

export function subscribeEmailTopics(email: string, topics: string[]): Promise<ApiResult<{
  subscription: { email: string; status: string; topics: string[]; token?: string };
  delivery: string;
  changed: boolean;
}>> {
  return request('/api/email-subscriptions', { method: 'POST', body: JSON.stringify({ email, topics }) }, (r) =>
    r?.subscription ? { subscription: r.subscription, delivery: String(r.delivery ?? ''), changed: Boolean(r.changed) } : undefined
  );
}

export function confirmEmailSubscription(token: string): Promise<ApiResult<{ ok: true; already: boolean; topics: string[] }>> {
  return request(`/api/email-subscriptions/confirm?token=${encodeURIComponent(token)}`, undefined, (r) =>
    r?.ok === true ? { ok: true, already: Boolean(r.already), topics: r.topics ?? [] } : undefined
  );
}

/** Leaving a list needs no account: the token (or the address) is enough. */
export function unsubscribeEmail(tokenOrEmail: string): Promise<ApiResult<{ ok: true; already: boolean }>> {
  return request('/api/email-subscriptions/unsubscribe', { method: 'POST', body: JSON.stringify({ token: tokenOrEmail }) }, (r) =>
    r?.ok === true ? { ok: true, already: Boolean(r.already) } : undefined
  );
}

// ---------------------------------------------------------------------------
// OPERATOR SURFACE (F4 / Tikiti T8). Every call here is capability-gated
// server-side (ops.read / ops.run / moderate / finance / admin); the client
// mirrors the gating only to decide what to OFFER. 403 bodies name
// `requiredCapability`, which the desk shows verbatim.
// ---------------------------------------------------------------------------

/** True when the session may operate at all (any operator capability). */
export const OPERATOR_CAPABILITIES = ['ops.read', 'ops.run', 'moderate', 'finance', 'admin'] as const;

export function isOperator(user: { capabilities?: string[] | null } | null | undefined): boolean {
  const caps = user?.capabilities ?? [];
  return OPERATOR_CAPABILITIES.some((c) => caps.includes(c));
}

const isRowArray = (v: unknown): v is Record<string, any>[] => Array.isArray(v);

export function getOpsDiagnostics(): Promise<ApiResult<Record<string, any>>> {
  return request('/api/ops/diagnostics', undefined, (r) => (r && typeof r === 'object' && 'counts' in r ? r : undefined));
}

export function opsBackup(): Promise<ApiResult<{ ok: boolean; file?: string; size?: number }>> {
  return request('/api/ops/backup', { method: 'POST', body: '{}' }, (r) => (r?.ok === true ? r : undefined));
}

export function getOpsAnalytics(): Promise<ApiResult<{ analytics: Record<string, any> }>> {
  return request('/api/ops/analytics', undefined, (r) => (r && typeof r.analytics === 'object' ? r as { analytics: Record<string, any> } : undefined));
}

export function getOpsReports(): Promise<ApiResult<Record<string, any>[]>> {
  return request('/api/ops/reports', undefined, (r) => (isRowArray(r?.reports) ? r.reports : undefined));
}

export function resolveOpsReport(id: string, action: 'dismiss' | 'remove', reason: string): Promise<ApiResult<Record<string, any>>> {
  return request(`/api/ops/reports/${encodeURIComponent(id)}/resolve`, { method: 'POST', body: JSON.stringify({ action, reason }) }, (r) => r ?? undefined);
}

export function getOpsCorrections(): Promise<ApiResult<Record<string, any>[]>> {
  return request('/api/ops/corrections', undefined, (r) => (isRowArray(r?.corrections) ? r.corrections : undefined));
}

export function opsCreateCorrection(objectId: string, field: string, value: string, reason: string, isMeta = false): Promise<ApiResult<Record<string, any>>> {
  return request('/api/ops/corrections', { method: 'POST', body: JSON.stringify({ objectId, field, value, reason, isMeta }) }, (r) => (r?.correction ? r : undefined));
}

export function opsRejectCorrection(id: string, reason: string): Promise<ApiResult<Record<string, any>>> {
  return request(`/api/ops/corrections/${encodeURIComponent(id)}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }, (r) => (r?.correction ? r : undefined));
}

export function getOpsSourceTrust(): Promise<ApiResult<Record<string, any>[]>> {
  return request('/api/ops/sources/trust', undefined, (r) => (isRowArray(r?.sources) ? r.sources : undefined));
}

export function opsSetSourceTrust(id: string, status: 'trusted' | 'normal' | 'degraded' | 'disabled', reason: string): Promise<ApiResult<Record<string, any>>> {
  return request(`/api/ops/sources/${encodeURIComponent(id)}/trust`, { method: 'POST', body: JSON.stringify({ status, reason }) }, (r) => (r?.source ? r : undefined));
}

export function getOpsUnverified(): Promise<ApiResult<Record<string, any>[]>> {
  return request('/api/ops/unverified', undefined, (r) => (isRowArray(r?.objects) ? r.objects : undefined));
}

export function getOpsContributors(): Promise<ApiResult<Record<string, any>[]>> {
  return request('/api/ops/contributors', undefined, (r) => (isRowArray(r?.contributors) ? r.contributors : undefined));
}

export function getOpsDisputes(): Promise<ApiResult<Record<string, any>[]>> {
  return request('/api/ops/disputes', undefined, (r) => (isRowArray(r?.disputes) ? r.disputes : undefined));
}

export function getOpsTicketListings(): Promise<ApiResult<Record<string, any>[]>> {
  return request('/api/ops/ticket-listings', undefined, (r) => (isRowArray(r?.listings) ? r.listings : undefined));
}

export function getOpsVerificationQueue(): Promise<ApiResult<Record<string, any>[]>> {
  return request('/api/ops/verification', undefined, (r) => (isRowArray(r?.queue) ? r.queue : undefined));
}

export function opsVerificationDecision(id: string, decision: 'approved' | 'rejected', reason: string): Promise<ApiResult<Record<string, any>>> {
  return request(`/api/ops/verification/${encodeURIComponent(id)}/decision`, { method: 'POST', body: JSON.stringify({ decision, reason }) }, (r) => r ?? undefined);
}

export function opsVerificationRevoke(id: string, reason: string): Promise<ApiResult<Record<string, any>>> {
  return request(`/api/ops/verification/${encodeURIComponent(id)}/revoke`, { method: 'POST', body: JSON.stringify({ reason }) }, (r) => r ?? undefined);
}

export function getOpsEmailLog(limit = 50): Promise<ApiResult<Record<string, any>[]>> {
  return request(`/api/ops/email-log?limit=${limit}`, undefined, (r) => (isRowArray(r?.log) ? r.log : undefined));
}

export function getOpsAudit(limit = 100): Promise<ApiResult<{ audit: Record<string, any>[]; total: number }>> {
  return request(`/api/ops/audit?limit=${limit}`, undefined, (r) => (isRowArray(r?.audit) && Number.isFinite(r?.total) ? r : undefined));
}

export function setPlatformRoles(userId: string, roles: string[], reason: string): Promise<ApiResult<Record<string, any>>> {
  return request('/api/ops/roles', { method: 'POST', body: JSON.stringify({ userId, roles, reason }) }, (r) => r ?? undefined);
}

export function getEconomicReconcile(): Promise<ApiResult<Record<string, any>>> {
  return request('/api/economic/reconcile', undefined, (r) => (r && typeof r.reconciliation === 'object' ? r : undefined));
}

export function getPaymentsReconcile(): Promise<ApiResult<Record<string, any>>> {
  return request('/api/economic/payments/reconcile', undefined, (r) => (r && typeof r.reconciliation === 'object' ? r : undefined));
}


/** Editorial collections (moderate capability). */
export function getAdminCollections(): Promise<ApiResult<Record<string, any>[]>> {
  return request('/api/admin/collections', undefined, (r) => (isRowArray(r?.collections) ? r.collections : undefined));
}

export function transitionAdminCollection(key: string, action: string): Promise<ApiResult<Record<string, any>>> {
  return request(`/api/admin/collections/${encodeURIComponent(key)}/${encodeURIComponent(action)}`, { method: 'POST', body: '{}' }, (r) => r ?? undefined);
}

/** Record an editorial/library image (ops.run). Validation is the server's. */
export function recordAdminMedia(fields: {
  kind?: string; key?: string; url?: string; alt?: string | null; attribution?: string | null; status?: string;
}): Promise<ApiResult<Record<string, any>>> {
  return request('/api/admin/media', { method: 'POST', body: JSON.stringify(fields) }, (r) => r ?? undefined);
}

// --- Events hub (Tikiti T4) ------------------------------------------------------

export interface EventListing {
  /** The public identity; internal ids stay private. */
  slug: string;
  title: string;
  description: string | null;
  coverImageUrl: string | null;
  category: string;
  categoryLabel: string;
  location: string | null;
  startsAt: string | null;
  endsAt: string | null;
  price: number;
  currency: string;
  goalAmount: number | null;
  // NO `featured`: Decision 6 — no featured slot anywhere.
  /** The campaign row's own createdAt — when this was actually published. */
  publishedAt?: string | null;
  /** The organiser's account name, allowed explicitly by the operator.
      Attribution, not social proof: a name with no counts behind it. */
  hostName: string | null;
  /** Optional recurrence schedule when the event repeats. */
  recurrence?: EventRecurrence | null;
  // NO `popularity` and NO `tableBankingOverlap`: Decision 6 forbids social
  // proof on events — no "X going", no attendee names, no view count. The
  // server's listing projection carries neither, so a card cannot render them.
}

export function browseEvents(opts: {
  category?: string; location?: string; from?: string; to?: string;
  // No `featured`, no `sort`: Decision 6 removed the featured filter and the
  // popularity sort from the server, so there is nothing to ask for. The order
  // is startsAt ascending and the endpoint ignores both parameters.
  limit?: number;
} = {}): Promise<ApiResult<{ events: EventListing[]; total: number }>> {
  const q = new URLSearchParams();
  if (opts.category) q.set('category', opts.category);
  if (opts.location) q.set('location', opts.location);
  if (opts.from) q.set('from', opts.from);
  if (opts.to) q.set('to', opts.to);
  if (opts.limit) q.set('limit', String(opts.limit));
  const qs = q.toString();
  return request(`/api/events${qs ? `?${qs}` : ''}`, undefined, (r) =>
    Array.isArray(r?.events) ? { events: r.events as EventListing[], total: Number(r.total ?? r.events.length) } : undefined
  );
}

export function getEventCategories(): Promise<ApiResult<{ categories: string[]; labels: Record<string, string> }>> {
  return request('/api/events/categories', undefined, (r) =>
    Array.isArray(r?.categories) ? { categories: r.categories, labels: r.labels ?? {} } : undefined
  );
}

// --- The dynamic ticket bar ------------------------------------------------------

export interface EngineTicketBar {
  active: boolean;
  ticket?: {
    eventTitle: string;
    ticketCode: string;
    registrationId: string;
    entryState: 'active' | 'upcoming' | 'checked-in';
    startsAt: string | null;
    checkedIn: boolean;
  };
  deltas?: { kind: string; at: string }[];
  reason?: string;
}

export function getEngineTicketBar(): Promise<ApiResult<EngineTicketBar>> {
  return request('/api/engine/ticket-bar', undefined, (r) =>
    typeof r?.active === 'boolean' ? (r as EngineTicketBar) : undefined
  );
}

// ---------------------------------------------------------------------------
// REAL IMAGE UPLOADS
//
// The editorial surfaces used to accept only a URL, so every photo was
// somebody else's asset on somebody else's server: free to rot, free to
// hotlink-block, free to change under a published story. These calls put an
// actual file in Brief instead.
//
// The link route is NOT removed -- an editor may still have a legitimately
// attributed external image -- but it is no longer the only way in, and it is
// no longer the default.
// ---------------------------------------------------------------------------

/**
 * Turn a server image reference into something an <img> can load.
 *
 * The server returns a ROOT-relative path (`/api/media/file/<id>`) because it
 * does not know how the client reaches it. In the browser that path has to go
 * through the ingestion proxy; an absolute http(s) link passes straight
 * through. Deciding this here keeps the proxy detail out of every component.
 */
/**
 * The path the store keeps: `/api/media/file/<id>`. Strips the SPA's `/ingest`
 * proxy prefix so a URL that leaked into a row still resolves, and wraps a
 * bare upload id. Display goes through `mediaFileUrl`, which puts `/ingest`
 * back on for the browser.
 */
export function canonicalMediaUrl(ref: string | null | undefined): string | null {
  if (ref == null) return null;
  let s = String(ref).trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith('/ingest/')) s = s.slice('/ingest'.length) || '/';
  if (s.startsWith('/api/')) return s;
  return `/api/media/file/${s}`;
}

export function mediaFileUrl(url: string): string {
  const canonical = canonicalMediaUrl(url);
  if (!canonical) return url;
  if (/^https?:\/\//i.test(canonical)) return canonical;
  return canonical.startsWith('/') ? `${INGEST_API}${canonical}` : canonical;
}

/**
 * Upload one image file.
 *
 * The server decides what the file really is from its magic bytes, so a
 * refusal here is worth showing to the person verbatim: "only JPEG, PNG, WebP
 * and GIF images can be uploaded" is a better message than a generic failure.
 */
export function uploadMediaFile(
  file: File,
  opts: { alt?: string; purpose?: 'public' | 'private_evidence' | 'private_request' | 'private_quote' | 'private_work' } = {}
): Promise<ApiResult<{ upload: MediaUpload; duplicate: boolean }>> {
  const form = new FormData();
  form.append('file', file, file.name);
  if (opts.alt) form.append('alt', opts.alt.slice(0, 240));
  if (opts.purpose) form.append('purpose', opts.purpose);
  return requestForm('/api/media/upload', form, (r) =>
    isMediaUpload(r?.upload)
      ? { upload: r.upload as MediaUpload, duplicate: Boolean(r.duplicate) }
      : undefined
  );
}

/** Your own uploads, newest first. */
export function listMyMedia(): Promise<ApiResult<MediaUpload[]>> {
  return request('/api/media/mine', undefined, (r) => areMediaUploads(r?.uploads ?? []));
}

/** Remove one of your own uploads, bytes and all. */
export function deleteMedia(id: string): Promise<ApiResult<{ removed: true }>> {
  return request(`/api/media/${encodeURIComponent(id)}`, { method: 'DELETE' }, (r) =>
    r?.removed === true ? { removed: true as const } : undefined
  );
}

/**
 * What this deployment can promise about uploads.
 *
 * Local disk, so `persisted` is false: images survive a restart but not a
 * redeploy to a fresh container. The editor says that out loud instead of
 * letting somebody discover it.
 */
export function getMediaStatus(): Promise<ApiResult<{ media: any; uploads: MediaStorageStatus }>> {
  return request('/api/media/status', undefined, (r) =>
    r?.uploads && typeof r.uploads === 'object'
      ? { media: r.media ?? null, uploads: r.uploads as MediaStorageStatus }
      : undefined
  );
}

// ---------------------------------------------------------------------------
// THE WAITING-ON-YOU QUEUE
// ---------------------------------------------------------------------------

/**
 * Everything currently blocked on the signed-in person: the circle tasks they
 * hold, the orders on their shelf, the events they are running, and the
 * messages nobody has reviewed.
 *
 * Derived on the server from real rows, per caller. There is no cache and no
 * local merging, so the list cannot disagree with the work it points at.
 */
export function getTriageQueue(withinHours?: number): Promise<ApiResult<TriageQueue>> {
  const q = withinHours ? `?withinHours=${encodeURIComponent(String(withinHours))}` : '';
  return request(`/api/triage${q}`, undefined, (r) => (isTriageQueue(r) ? r : undefined));
}

// ---------------------------------------------------------------------------
// CIRCLE MEMBERSHIP: JOIN, LEAVE, REMOVE
// ---------------------------------------------------------------------------

/**
 * Leave a circle as the signed-in caller.
 *
 * The loop had no exit: you could be added to a circle, or self-join an open
 * one, and then had no way to stop being a member. Leaving is self-service --
 * it removes YOUR row and nobody else's.
 */
export function leaveCircle(circleId: string): Promise<ApiResult<{ left: true; circleId: string }>> {
  return request(
    `/api/circles/${encodeURIComponent(circleId)}/members/me`,
    { method: 'DELETE' },
    (r) => (r?.left === true ? { left: true as const, circleId } : undefined)
  );
}

/**
 * Remove SOMEBODY ELSE from a circle. Coordinator-only; the server returns
 * 403 otherwise. Separate from leaveCircle so the privileged act is visible
 * at the call site -- and so you cannot "remove" yourself by accident.
 */
/** Remove a member — with a reason, always. The membership row ENDS rather than
 *  disappears, so the work and ballots that name them still mean something. */
export function removeMember(
  circleId: string,
  userId: string,
  reason?: string
): Promise<ApiResult<{ left: true; userId: string }>> {
  return request(
    `/api/circles/${encodeURIComponent(circleId)}/members/${encodeURIComponent(userId)}`,
    { method: 'DELETE', body: JSON.stringify({ reason: reason ?? null }) },
    (r) => (r?.left === true ? { left: true as const, userId } : undefined)
  );
}

// ---------------------------------------------------------------------------
// SUBSCRIPTIONS: THE FOLLOWER'S HALF
// ---------------------------------------------------------------------------

/** The plans I publish. */
export function getMySubscriptions(): Promise<ApiResult<Subscription[]>> {
  return request('/api/subscriptions', undefined, (r) => areSubscriptions(r?.subscriptions ?? []));
}

/**
 * Public plans by other creators. This is the discovery the follower side was
 * missing: without it a plan could exist but be unreachable by anybody except
 * the person who wrote it.
 */
export function browseSubscriptions(): Promise<ApiResult<Subscription[]>> {
  return request('/api/subscriptions?browse=1', undefined, (r) => areSubscriptions(r?.subscriptions ?? []));
}

/** One creator's public plans. */
export function getCreatorSubscriptions(creatorId: string): Promise<ApiResult<Subscription[]>> {
  return request(
    `/api/subscriptions?creator=${encodeURIComponent(creatorId)}`,
    undefined,
    (r) => areSubscriptions(r?.subscriptions ?? [])
  );
}

/**
 * Join a plan AS THE AUTHENTICATED CALLER.
 *
 * The response says `charged: false` while no payment provider is connected.
 * The UI must show that rather than implying money moved.
 */
export function subscribeToPlan(id: string): Promise<ApiResult<SubscriptionJoin>> {
  return request(
    `/api/subscriptions/${encodeURIComponent(id)}/subscribe`,
    { method: 'POST', body: '{}' },
    (r) => (isSubscriptionJoin(r) ? r : undefined)
  );
}

export function unsubscribeFromPlan(id: string): Promise<ApiResult<{ subscriber: Subscriber; changed: boolean }>> {
  return request(
    `/api/subscriptions/${encodeURIComponent(id)}/unsubscribe`,
    { method: 'POST', body: '{}' },
    (r) => (isSubscriber(r?.subscriber)
      ? { subscriber: r.subscriber, changed: r.changed === true }
      : undefined)
  );
}

/** Who is subscribed. Creator-only; the server refuses everybody else with 403. */
export function getPlanSubscribers(id: string): Promise<ApiResult<Subscriber[]>> {
  return request(
    `/api/subscriptions/${encodeURIComponent(id)}/subscribers`,
    undefined,
    (r) => areSubscribers(r?.subscribers ?? [])
  );
}

/**
 * Move an order to the next fulfilment stage as its vendor.
 *
 * The stage is the server's vocabulary (accepted / preparing / ready) because
 * those are the only stages a vendor may set: settlement is economic and needs
 * a settled transaction, so it has its own guarded endpoint.
 */
export function stageOrder(
  id: string,
  stage: string,
  note = ''
): Promise<ApiResult<{ order: Order; changed: boolean }>> {
  return request(
    `/api/orders/${encodeURIComponent(id)}/stage`,
    { method: 'POST', body: JSON.stringify({ stage, note }) },
    (r) => (isOrder(r?.order) ? { order: r.order, changed: Boolean(r.changed) } : undefined)
  );
}
// ---------------------------------------------------------------------------
// MSHIKANO — the peer-to-peer cooperation network. Four intents, complementary
// matching, two-party-confirmed cooperations, evidence-based trust.
// ---------------------------------------------------------------------------

export type CoopIntent = 'have' | 'need' | 'can_help' | 'looking_for';

export interface CoopTrust {
  userId: string;
  level: 'new' | 'cooperating' | 'proven' | 'established';
  levelWords: string;
  evidence: {
    confirmedCooperations: number;
    repeatPartners: number;
    recommendations: number;
    identityVerified: boolean;
    disputes: number;
  };
  recommendationNotes: { by: { displayName: string }; note: string; at: string }[];
}

export interface CoopPost {
  id: string;
  intent: CoopIntent;
  intentLabel: string;
  title: string;
  body: string | null;
  category: string | null;
  town: string | null;
  county: string | null;
  createdAt: string;
  status: string;
  mine: boolean;
  author: { id: string; handle: string | null; displayName: string };
  trust: CoopTrust | null;
}

export interface CoopMatch {
  post: CoopPost;
  sharedCount: number;
  reasons: string[];
  score: number;
}

export interface CoopCooperation {
  id: string;
  postId: string | null;
  fromUserId: string;
  toUserId: string;
  summary: string | null;
  status: 'pending' | 'confirmed' | 'declined' | 'disputed';
  recommendations: { byUserId: string; forUserId: string; note: string; at: string }[];
  createdAt: string;
  confirmedAt: string | null;
  disputedAt?: string | null;
  dispute?: { byUserId: string; note: string; at: string } | null;
  direction?: 'outgoing' | 'incoming';
  partner?: { id: string; displayName: string };
}

export function createCoopPost(body: {
  intent: CoopIntent; title: string; body?: string | null;
  category?: string | null; town?: string | null; county?: string | null;
}): Promise<ApiResult<{ post: CoopPost }>> {
  return request('/api/mshikano/posts', { method: 'POST', body: JSON.stringify(body) }, (r) => (r?.post ? { post: r.post as CoopPost } : undefined));
}

export function listCoopPosts(opts: { intent?: string; q?: string; county?: string; mine?: boolean } = {}): Promise<ApiResult<{ posts: CoopPost[] }>> {
  const qs = new URLSearchParams();
  if (opts.intent) qs.set('intent', opts.intent);
  if (opts.q) qs.set('q', opts.q);
  if (opts.county) qs.set('county', opts.county);
  if (opts.mine) qs.set('mine', '1');
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return request(`/api/mshikano/posts${suffix}`, undefined, (r) => (Array.isArray(r?.posts) ? { posts: r.posts as CoopPost[] } : undefined));
}

export function coopMatches(postId: string): Promise<ApiResult<{ matches: CoopMatch[] }>> {
  return request(`/api/mshikano/posts/${encodeURIComponent(postId)}/matches`, undefined, (r) => (Array.isArray(r?.matches) ? { matches: r.matches as CoopMatch[] } : undefined));
}

export function proposeCooperation(body: { postId?: string | null; partnerUserId: string; summary?: string | null }): Promise<ApiResult<{ cooperation: CoopCooperation }>> {
  return request('/api/mshikano/cooperations', { method: 'POST', body: JSON.stringify(body) }, (r) => (r?.cooperation ? { cooperation: r.cooperation as CoopCooperation } : undefined));
}

export interface CoopCooperations {
  pending: CoopCooperation[];
  confirmed: CoopCooperation[];
  declined: CoopCooperation[];
  disputed: CoopCooperation[];
}

export function listCooperations(): Promise<ApiResult<CoopCooperations>> {
  return request('/api/mshikano/cooperations', undefined, (r): CoopCooperations | undefined =>
    Array.isArray(r?.pending) && Array.isArray(r?.confirmed) && Array.isArray(r?.declined) && Array.isArray(r?.disputed)
      ? { pending: r.pending, confirmed: r.confirmed, declined: r.declined, disputed: r.disputed }
      : undefined);
}

export function respondCooperation(id: string, accept: boolean): Promise<ApiResult<{ cooperation: CoopCooperation }>> {
  return request(`/api/mshikano/cooperations/${encodeURIComponent(id)}/respond`, { method: 'POST', body: JSON.stringify({ accept }) }, (r) => (r?.cooperation ? { cooperation: r.cooperation as CoopCooperation } : undefined));
}

export function recommendCooperation(id: string, note: string): Promise<ApiResult<{ cooperation: CoopCooperation }>> {
  return request(`/api/mshikano/cooperations/${encodeURIComponent(id)}/recommend`, { method: 'POST', body: JSON.stringify({ note }) }, (r) => (r?.cooperation ? { cooperation: r.cooperation as CoopCooperation } : undefined));
}

export function disputeCooperation(id: string, reason: string): Promise<ApiResult<{ cooperation: CoopCooperation }>> {
  return request(`/api/mshikano/cooperations/${encodeURIComponent(id)}/dispute`, { method: 'POST', body: JSON.stringify({ reason }) }, (r) => (r?.cooperation ? { cooperation: r.cooperation as CoopCooperation } : undefined));
}

export interface CoopGraph {
  totals: { confirmed: number; helped: number; received: number; repeatPartners: number };
  helped: { with: { displayName: string }; at: string; summary: string | null }[];
  received: { with: { displayName: string }; at: string; summary: string | null }[];
}

export function coopGraph(): Promise<ApiResult<CoopGraph>> {
  return request('/api/mshikano/graph', undefined, (r): CoopGraph | undefined =>
    r?.totals && Array.isArray(r?.helped) && Array.isArray(r?.received)
      ? { totals: r.totals, helped: r.helped, received: r.received }
      : undefined);
}

export function coopTrust(userId: string): Promise<ApiResult<CoopTrust>> {
  return request(`/api/mshikano/trust/${encodeURIComponent(userId)}`, undefined, (r) => (r?.evidence ? r as CoopTrust : undefined));
}

export interface WhoCanHelpAnswer {
  query: string;
  counts: { people: number; businesses: number; groups: number; guides: number };
  people: CoopPost[];
  businesses: CoopPost[];
  groups: { id: string; name: string; description: string | null; visibility: string | null; members: number }[];
  guides: { slug: string; title: string }[];
}

export function whoCanHelp(q: string): Promise<ApiResult<WhoCanHelpAnswer>> {
  return request(`/api/mshikano/who-can-help?q=${encodeURIComponent(q)}`, undefined, (r): WhoCanHelpAnswer | undefined =>
    r?.counts && Array.isArray(r?.people) && Array.isArray(r?.guides) && Array.isArray(r?.groups)
      ? {
          query: r.query ?? q,
          counts: r.counts,
          people: r.people,
          businesses: r.businesses ?? [],
          groups: r.groups,
          guides: r.guides
        }
      : undefined);
}

// ---------------------------------------------------------------------------
// Service fees — paying Brief through Pochi la Biashara (manual M-Pesa code
// flow; Pochi has no developer API). Amounts come from the server catalog.
// ---------------------------------------------------------------------------

export interface ServiceCatalogItem { key: string; label: string; amountKes: number }
export interface ServiceFeeTarget { kind: 'listing' | 'coop_post' | 'shop' | 'object'; id: string; title: string }
export interface ServiceFee {
  id: string; userId: string; service: string; label: string; amountKes: number;
  mpesaCode: string; status: 'pending' | 'confirmed' | 'refused';
  refusedReason: string | null; confirmedAt: string | null; createdAt: string; ledgerId: string;
  /** What the payment was for (a boosted listing, an intro to a match…). */
  target?: ServiceFeeTarget | null;
}
export interface MyServiceFees { pochi: string | null; services: ServiceCatalogItem[]; fees: ServiceFee[] }

const isServiceFee = (f: any): f is ServiceFee =>
  typeof f?.id === 'string' && typeof f?.amountKes === 'number' &&
  typeof f?.mpesaCode === 'string' && (['pending', 'confirmed', 'refused'] as const).includes(f?.status);

export function myServiceFees(): Promise<ApiResult<MyServiceFees>> {
  return request('/api/fees/mine', undefined, (r): MyServiceFees | undefined =>
    Array.isArray(r?.services) && Array.isArray(r?.fees) && r.fees.every(isServiceFee)
      ? { pochi: r.pochi ?? null, services: r.services, fees: r.fees }
      : undefined);
}

export function payServiceFee(service: string, mpesaCode: string, target?: ServiceFeeTarget): Promise<ApiResult<{ fee: ServiceFee }>> {
  // NOTE: no amount ever leaves this client. The price is the server
  // catalog's; the body carries only which service, the M-Pesa code, and
  // what the payment was for.
  return request('/api/fees/pay', { method: 'POST', body: JSON.stringify({ service, mpesaCode, ...(target ? { target } : {}) }) }, (r) =>
    isServiceFee(r?.fee) ? { fee: r.fee } : undefined);
}

// ---------------------------------------------------------------------------
// Referrals — rewards with a mathematical edge, not a pyramid: depth is ONE
// level, there is no entry fee, and points become cash only from a pool
// backed by real confirmed revenue.
// ---------------------------------------------------------------------------

export interface ReferralPool { backingKes: number; paidOrPromisedKes: number; availableKes: number }
export interface ReferralBalance { earned: number; locked: number; available: number }
export interface ReferralEvent { id: string; kind: string; points: number; valueKes: number; at: string }
export interface ReferralConversion { id: string; points: number; kes: number; status: 'pending' | 'confirmed' | 'refused'; refusedReason: string | null; createdAt: string }
export interface MyReferrals {
  code: string; maxDepth: number; link: string;
  balance: ReferralBalance; pool: ReferralPool;
  conversion: { ptsToKes: number; minPoints: number };
  events: ReferralEvent[]; conversions: ReferralConversion[];
}
export interface ShareMessage { code: string; slug: string | null; url: string; message: string; waMe: string }

export function myReferrals(): Promise<ApiResult<MyReferrals>> {
  return request('/api/referrals/mine', undefined, (r): MyReferrals | undefined =>
    typeof r?.code === 'string' && r?.balance?.available >= 0 && Array.isArray(r?.events) && Array.isArray(r?.conversions)
      ? r as MyReferrals
      : undefined);
}

export function referralShare(slug?: string): Promise<ApiResult<ShareMessage>> {
  const q = slug ? `?slug=${encodeURIComponent(slug)}` : '';
  return request(`/api/referrals/share${q}`, undefined, (r): ShareMessage | undefined =>
    typeof r?.code === 'string' && typeof r?.message === 'string' && typeof r?.waMe === 'string'
      ? { code: r.code, slug: r.slug ?? null, url: r.url, message: r.message, waMe: r.waMe }
      : undefined);
}

export function convertReferralPoints(points: number): Promise<ApiResult<{ conversion: ReferralConversion }>> {
  return request('/api/referrals/convert', { method: 'POST', body: JSON.stringify({ points }) }, (r) =>
    typeof r?.conversion?.id === 'string' && typeof r?.conversion?.kes === 'number'
      ? { conversion: r.conversion as ReferralConversion }
      : undefined);
}

// ---------------------------------------------------------------------------
// WHATSAPP SHOP — build on Brief, sell in WhatsApp. The shop row is the
// builder state; the storefront is the WhatsApp conversation itself. The
// share (formatted text + wa.me link) is DERIVED server-side, and publishing
// is gated on a confirmed store-service payment (Pochi la Biashara).
// ---------------------------------------------------------------------------

export interface ShopItem { id: string; name: string; priceKes: number; note: string | null }
export interface Shop {
  id: string | null; ownerId: string; name: string; tagline: string; orderNumber: string;
  items: ShopItem[]; status: 'draft' | 'published'; publishedAt: string | null;
}
export interface ShopStoreService { priceKes: number; active: boolean; activeUntil: string | null }
export interface ShopView {
  shop: Shop;
  store: ShopStoreService;
  share: { text: string; waMe: string; shareable: boolean } | null;
}

export function getMyShop(): Promise<ApiResult<ShopView>> {
  return request('/api/shop/mine', undefined, (r): ShopView | undefined =>
    r?.shop && typeof r?.store?.active === 'boolean' ? r as ShopView : undefined);
}

export function saveMyShop(body: { name: string; tagline: string; orderNumber: string; items: { name: string; priceKes: number; note?: string }[] }): Promise<ApiResult<ShopView>> {
  return request('/api/shop/mine', { method: 'PUT', body: JSON.stringify(body) }, (r): ShopView | undefined =>
    r?.shop?.id ? r as ShopView : undefined);
}

export function publishMyShop(): Promise<ApiResult<ShopView & { changed: boolean }>> {
  return request('/api/shop/mine/publish', { method: 'POST', body: '{}' }, (r): (ShopView & { changed: boolean }) | undefined =>
    r?.shop ? r as ShopView & { changed: boolean } : undefined);
}

export function unpublishMyShop(): Promise<ApiResult<ShopView & { changed: boolean }>> {
  return request('/api/shop/mine/unpublish', { method: 'POST', body: '{}' }, (r): (ShopView & { changed: boolean }) | undefined =>
    r?.shop ? r as ShopView & { changed: boolean } : undefined);
}

// ---------------------------------------------------------------------------
// THE DUKA BOOK + POOLED RESTOCKS + ESCROW RECORDS
//
// The book holds what the shopkeeper LOGS (Brief never claims to see inside
// WhatsApp); every total is derived server-side. Sales carry a clientKey so
// the offline queue can replay them safely. Escrow rows are RECORDS of funds
// held between two sides — Brief moves no money itself.
// ---------------------------------------------------------------------------

export interface ShopSale { id: string; name: string; qty: number; unitKes: number; amountKes: number; channel: string; day: string; createdAt: string; clientKey: string | null }
export interface ShopBook {
  shop: { id: string | null; name: string; status: string };
  today: { sales: number; items: number; kes: number };
  yesterday: { sales: number; items: number; kes: number };
  week: { sales: number; items: number; kes: number };
  topItems: { name: string; qty: number }[];
  items: { name: string; priceKes: number; stockQty: number | null; soldWeek: number; remaining: number | null }[];
  lowStock: { name: string; remaining: number }[];
  recent: ShopSale[];
  note: string;
}
export interface EscrowRow { id: string; kind: 'group_buy' | 'ticket'; refId: string; title: string; role: string; state: 'pending' | 'locked' | 'released' | 'refunded'; amountKes: number; updatedAt: string }
export interface MyEscrows { rows: EscrowRow[]; totals: { heldKes: number; releasedKes: number; heldCount: number }; note: string }

export function getMyBook(): Promise<ApiResult<ShopBook>> {
  return request('/api/shop/mine/book', undefined, (r): ShopBook | undefined =>
    r?.today && Array.isArray(r?.topItems) ? r as ShopBook : undefined);
}

export function logShopSale(body: { name: string; qty: number; unitKes: number; channel?: string; clientKey?: string }): Promise<ApiResult<{ sale: ShopSale; replayed: boolean }>> {
  return request('/api/shop/mine/sales', { method: 'POST', body: JSON.stringify(body) }, (r): { sale: ShopSale; replayed: boolean } | undefined =>
    r?.sale ? r as { sale: ShopSale; replayed: boolean } : undefined);
}

export function poolRestock(body: { itemName: string; unitCostKes: number; goalUnits: number; myUnits: number }): Promise<ApiResult<{ pool: { id: string; title: string; targetAmount: number; total: number; stage: string }; share: { text: string; waMe: string } }>> {
  return request('/api/shop/mine/pool', { method: 'POST', body: JSON.stringify(body) }, (r): { pool: { id: string; title: string; targetAmount: number; total: number; stage: string }; share: { text: string; waMe: string } } | undefined =>
    r?.pool ? r as { pool: { id: string; title: string; targetAmount: number; total: number; stage: string }; share: { text: string; waMe: string } } : undefined);
}

export function getMyEscrows(): Promise<ApiResult<MyEscrows>> {
  return request('/api/escrows/mine', undefined, (r): MyEscrows | undefined =>
    Array.isArray(r?.rows) && r?.totals ? r as MyEscrows : undefined);
}

// ---------------------------------------------------------------------------
// MEMBERS (admin) — the directory for onboarding real people. Derived rows;
// suspension is immediate and audited server-side.
// ---------------------------------------------------------------------------

export interface MemberOnboarding { rung: string | null; latestEvent: string | null; latestAt: string | null; finished: boolean }
export interface MemberRow {
  id: string; handle: string; displayName: string; createdAt: string | null;
  status: 'active' | 'suspended' | string; platformRoles: string[];
  verification: 'approved' | 'pending' | 'none' | string;
  onboarding: MemberOnboarding; shop: { name: string } | null;
}
export interface MembersPage { rows: MemberRow[]; total: number; page: number; pageSize: number }
export interface OnboardingFunnel {
  funnel: Record<string, number>;
  members: MemberRow[];
  totals: { members: number; withAnyEvent: number; finishedOnboarding: number };
  rungs: { id: string; label: string }[];
  note: string;
}

export function listMembers(query = '', page = 0): Promise<ApiResult<MembersPage>> {
  return request(`/api/ops/members?q=${encodeURIComponent(query)}&page=${page}`, undefined, (r): MembersPage | undefined =>
    Array.isArray(r?.rows) && typeof r?.total === 'number' ? r as MembersPage : undefined);
}

export function onboardingFunnel(): Promise<ApiResult<OnboardingFunnel>> {
  return request('/api/ops/onboarding', undefined, (r): OnboardingFunnel | undefined =>
    r?.totals && r?.rungs ? r as OnboardingFunnel : undefined);
}

export function setMemberStatus(id: string, status: 'active' | 'suspended', reason = ''): Promise<ApiResult<{ user: MemberRow; changed: boolean; sessionsRevoked: number }>> {
  return request(`/api/ops/members/${encodeURIComponent(id)}/status`, { method: 'POST', body: JSON.stringify({ status, reason }) }, (r): { user: MemberRow; changed: boolean; sessionsRevoked: number } | undefined =>
    r?.user ? r as { user: MemberRow; changed: boolean; sessionsRevoked: number } : undefined);
}

// ---------------------------------------------------------------------------
// PERSONAL BRIEF — interests, personal feed, saves, relevance controls
// ---------------------------------------------------------------------------

export interface PersonalTopic {
  id: string;
  label: string;
  keywords: string[];
}

export interface PersonalState {
  interests: {
    locations: string[];
    types: string[];
    topics: string[];
  };
  saved: string[];
  relevance: {
    more: string[];
    less: string[];
    notInterested: string[];
    hiddenSources: string[];
  };
  topics: PersonalTopic[];
  suggestedLocations: string[];
  notificationCandidates: {
    kind: string;
    objectId: string;
    title: string;
    dueAt: string | null;
    reason: string;
  }[];
  /** The viewer's own entity follows (venue/business/publisher/organizer/community). */
  followed: {
    id: string;
    kind: string;
    entityKey: string;
    name: string;
  }[];
}

export interface PersonalFeedRow {
  personal?: { boost: number; reasons: string[] };
}

function isPersonalState(raw: any): PersonalState | undefined {
  if (raw && raw.interests && Array.isArray(raw.saved) && Array.isArray(raw.topics)) return raw as PersonalState;
  return undefined;
}

/** The caller's whole personal state in one round trip. */
export function getPersonalState(): Promise<ApiResult<PersonalState>> {
  return request('/api/me', undefined, isPersonalState);
}

/** The personal feed: the same global objects, re-ranked per user. */
export function getPersonalFeed(opts: { limit?: number } = {}): Promise<ApiResult<{ objects: any[]; personalized: boolean }>> {
  const params = new URLSearchParams();
  if (opts.limit !== undefined) params.set('limit', String(opts.limit));
  const qs = params.toString();
  return request(`/api/me/feed${qs ? `?${qs}` : ''}`, undefined, (r): { objects: any[]; personalized: boolean } | undefined =>
    Array.isArray(r?.objects) ? r as { objects: any[]; personalized: boolean } : undefined);
}

/** Batch-replace interests (lightweight onboarding). */
export function putInterests(body: { locations?: string[]; types?: string[]; topics?: string[] }): Promise<ApiResult<{ ok: boolean; interests: PersonalState['interests'] }>> {
  return request('/api/me/interests', { method: 'PUT', body: JSON.stringify(body) }, (r) =>
    r?.interests ? r as { ok: boolean; interests: PersonalState['interests'] } : undefined);
}

/** Follow one location / type / topic. */
export function followInterest(kind: 'location' | 'type' | 'topic', value: string): Promise<ApiResult<{ ok: boolean; interests: PersonalState['interests'] }>> {
  return request('/api/me/interests', { method: 'POST', body: JSON.stringify({ kind, value }) }, (r) =>
    r?.interests ? r as { ok: boolean; interests: PersonalState['interests'] } : undefined);
}

/** Unfollow one location / type / topic. */
export function unfollowInterest(kind: 'location' | 'type' | 'topic', value: string): Promise<ApiResult<{ ok: boolean; interests: PersonalState['interests'] }>> {
  return request('/api/me/interests', { method: 'DELETE', body: JSON.stringify({ kind, value }) }, (r) =>
    r?.interests ? r as { ok: boolean; interests: PersonalState['interests'] } : undefined);
}

/** Server-persisted save (the durable copy of the client bookmark). */
export function saveObjectForMe(objectId: string): Promise<ApiResult<{ ok: boolean; saved: string[] }>> {
  return request(`/api/me/saved/${encodeURIComponent(objectId)}`, { method: 'POST', body: '{}' }, (r) =>
    Array.isArray(r?.saved) ? r as { ok: boolean; saved: string[] } : undefined);
}

/** Remove a server-persisted save. */
export function unsaveObjectForMe(objectId: string): Promise<ApiResult<{ ok: boolean; saved: string[] }>> {
  return request(`/api/me/saved/${encodeURIComponent(objectId)}`, { method: 'DELETE', body: '{}' }, (r) =>
    Array.isArray(r?.saved) ? r as { ok: boolean; saved: string[] } : undefined);
}

/** Explicit relevance control: more | less | not_interested | hide_source. */
export function setRelevanceControl(kind: 'more' | 'less' | 'not_interested' | 'hide_source', target: { objectId?: string; sourceId?: string }): Promise<ApiResult<{ ok: boolean; relevance: PersonalState['relevance'] }>> {
  return request('/api/me/relevance', { method: 'POST', body: JSON.stringify({ kind, ...target }) }, (r) =>
    r?.relevance ? r as { ok: boolean; relevance: PersonalState['relevance'] } : undefined);
}

/** Undo an explicit relevance control. */
export function unsetRelevanceControl(kind: 'more' | 'less' | 'not_interested' | 'hide_source', target: { objectId?: string; sourceId?: string }): Promise<ApiResult<{ ok: boolean; relevance: PersonalState['relevance'] }>> {
  return request('/api/me/relevance', { method: 'DELETE', body: JSON.stringify({ kind, ...target }) }, (r) =>
    r?.relevance ? r as { ok: boolean; relevance: PersonalState['relevance'] } : undefined);
}

/** Notification candidates — the data model only; nothing is sent. */
export function getNotificationCandidates(): Promise<ApiResult<{ candidates: PersonalState['notificationCandidates'] }>> {
  return request('/api/me/notification-candidates', undefined, (r) =>
    Array.isArray(r?.candidates) ? r as { candidates: PersonalState['notificationCandidates'] } : undefined);
}

// ---------------------------------------------------------------------------
// ENTITY LAYER — followable entities, entity pages, the Following feed
// ---------------------------------------------------------------------------

export type EntityKind = 'venue' | 'business' | 'publisher' | 'organizer' | 'community';

/** One public entity projection, exactly as the server shapes it. */
export interface BriefEntity {
  kind: EntityKind;
  id: string;
  entityKey: string;
  name: string;
  slug: string;
  summary: string | null;
  description: string | null;
  imageUrl: string | null;
  category: string | null;
  location: { area: string | null; county: string | null } | null;
  locationName: string | null;
  sourceNames: string[];
  trust: { degraded: boolean; disabled: boolean; corroborated: boolean };
  isFollowed: boolean;
  followCount: number;
  objects: {
    id: string;
    type: string;
    title: string;
    summary: string | null;
    imageUrl: string | null;
    locationName: string | null;
    category: string | null;
    area: string | null;
    county: string | null;
    temporal: {
      status: string;
      startsAt?: string | null;
      endsAt?: string | null;
      deadlineAt?: string | null;
    } | null;
    sourceNames: string[];
  }[];
}

function isBriefEntity(raw: any): BriefEntity | undefined {
  if (raw && typeof raw.kind === 'string' && typeof raw.name === 'string'
    && typeof raw.entityKey === 'string' && Array.isArray(raw.objects)) {
    return raw as BriefEntity;
  }
  return undefined;
}

/** A public entity page. Works without a session (stable shareable URL). */
export function getEntity(id: string): Promise<ApiResult<{ entity: BriefEntity }>> {
  return request(`/api/entities/${encodeURIComponent(id)}`, undefined, (r) =>
    isBriefEntity(r?.entity) ? r as { entity: BriefEntity } : undefined);
}

/** Resolve an entity by exact name (for "Venue · X" / "Source · X" links). */
export function getEntityByName(kind: EntityKind, name: string): Promise<ApiResult<{ entity: BriefEntity | null }>> {
  return request(`/api/entities/by-name?kind=${encodeURIComponent(kind)}&name=${encodeURIComponent(name)}`, undefined, (r) =>
    r && ('entity' in r) ? r as { entity: BriefEntity | null } : undefined);
}

/** Follow an entity (authenticated, self-scoped, idempotent). */
export function followEntity(id: string): Promise<ApiResult<{ followed: boolean; already: boolean; followCount: number }>> {
  return request(`/api/entities/${encodeURIComponent(id)}/follow`, { method: 'POST', body: '{}' }, (r) =>
    r && typeof r.followed === 'boolean' ? r as { followed: boolean; already: boolean; followCount: number } : undefined);
}

/** Unfollow an entity (authenticated, self-scoped, idempotent). */
export function unfollowEntity(id: string): Promise<ApiResult<{ unfollowed: boolean; already: boolean; followCount: number }>> {
  return request(`/api/entities/${encodeURIComponent(id)}/follow`, { method: 'DELETE', body: '{}' }, (r) =>
    r && typeof r.unfollowed === 'boolean' ? r as { unfollowed: boolean; already: boolean; followCount: number } : undefined);
}

/** The viewer's follow list, grouped by kind (management surface). */
export interface FollowsGroups {
  groups: Record<string, {
    kind: string;
    id: string;
    entityKey: string;
    name: string;
    category: string | null;
    imageUrl: string | null;
    location: { area: string | null; county: string | null } | null;
    sourceNames: string[];
    objectCount: number;
    followedAt: string | null;
  }[]>;
  total: number;
  kindLabels: Record<string, string>;
}

export function getMyFollows(): Promise<ApiResult<FollowsGroups>> {
  return request('/api/me/follows', undefined, (r) =>
    r && r.groups && typeof r.total === 'number' ? r as FollowsGroups : undefined);
}

/** The Following feed: sections per followed entity, objects ranked by discovery. */
export interface FollowingSection {
  kind: string;
  entityId: string;
  entityKey: string;
  name: string;
  category: string | null;
  imageUrl: string | null;
  location: { area: string | null; county: string | null } | null;
  objects: {
    id: string;
    type: string;
    title: string;
    summary: string | null;
    imageUrl: string | null;
    locationName: string | null;
    category: string | null;
    area: string | null;
    county: string | null;
    temporal: {
      status: string;
      startsAt?: string | null;
      deadlineAt?: string | null;
    } | null;
    score: number | null;
  }[];
}

export function getMyFollowingFeed(): Promise<ApiResult<{ sections: FollowingSection[]; total: number }>> {
  return request('/api/me/following', undefined, (r) =>
    Array.isArray(r?.sections) ? r as { sections: FollowingSection[]; total: number } : undefined);
}

/** Analytics: record that the viewer opened an object from an entity page. */
export function recordEntityObjectOpened(id: string, objectId: string): Promise<ApiResult<{ ok: boolean }>> {
  return request(`/api/entities/${encodeURIComponent(id)}/object-opened`, { method: 'POST', body: JSON.stringify({ objectId }) }, (r) =>
    r && r.ok === true ? r as { ok: boolean } : undefined);
}

/** Analytics: record that the viewer opened a source from an entity page. */
export function recordSourceOpened(id: string, sourceId: string): Promise<ApiResult<{ ok: boolean }>> {
  return request(`/api/entities/${encodeURIComponent(id)}/source-opened`, { method: 'POST', body: JSON.stringify({ sourceId }) }, (r) =>
    r && r.ok === true ? r as { ok: boolean } : undefined);
}

// ---------------------------------------------------------------------------
// LOCAL ACTIVITY GRAPH — location pages, related content, nearby.
// ---------------------------------------------------------------------------

export interface GraphObject {
  id: string;
  type: string;
  title: string;
  summary: string;
  locationName?: string | null;
  area?: string | null;
  county?: string | null;
  landmark?: string | null;
  imageUrl?: string | null;
  media?: { url?: string | null } | null;
  gallery?: { url: string }[] | null;
  temporal?: { status: string; startsAt?: string | null; deadlineAt?: string | null } | null;
  sourceNames?: string[];
  sourceCount?: number;
  degraded?: boolean;
  distanceKm?: number;
}

export interface GraphEdge {
  verb: string;
  label: string;
  confidence: 'structured' | 'provenance' | 'relationship';
  location?: { name: string; kind: string; county: string | null } | null;
  objects: GraphObject[];
}

export interface LocationActivity {
  counts: { happeningNow: number; today: number; comingUp: number; latest: number };
  happeningNow: GraphObject[];
  today: GraphObject[];
  comingUp: GraphObject[];
  latest: GraphObject[];
}

export interface LocationPage {
  location: { name: string; kind: string; county: string | null; areas?: string[] };
  activity: LocationActivity;
  sections: Record<string, GraphObject[]>;
  map: { available: boolean; items: GraphObject[] };
  nearby: { available: boolean; reason: string | null; items: GraphObject[] };
}

/** A public location discovery page (/explore/:name). */
export function getLocationPage(name: string): Promise<ApiResult<LocationPage>> {
  return request(`/api/locations/${encodeURIComponent(name)}`, undefined, (r) =>
    r && r.location && r.activity ? r as LocationPage : undefined);
}

/** The explore index: every location with live content, most active first. */
export function getLocationIndex(): Promise<ApiResult<{ locations: { name: string; kind: string; county: string | null; counts: { happeningNow: number; today: number; comingUp: number; latest: number } }[] }>> {
  return request('/api/locations', undefined, (r) =>
    Array.isArray(r?.locations) ? r as { locations: { name: string; kind: string; county: string | null; counts: { happeningNow: number; today: number; comingUp: number; latest: number } }[] } : undefined);
}

/** Related content for a detail page — the object graph. */
export function getObjectGraph(objectId: string): Promise<ApiResult<{ object: GraphObject; edges: GraphEdge[] }>> {
  return request(`/api/graph/object/${encodeURIComponent(objectId)}`, undefined, (r) =>
    r && Array.isArray(r.edges) ? r as { object: GraphObject; edges: GraphEdge[] } : undefined);
}

/** Nearby discovery over genuinely stored coordinates. */
export function getNearby(opts: { lat?: number; lng?: number; radiusKm?: number; area?: string } = {}): Promise<ApiResult<{ available: boolean; reason: string | null; items: GraphObject[] }>> {
  const params = new URLSearchParams();
  if (opts.lat !== undefined && opts.lng !== undefined) {
    params.set('lat', String(opts.lat));
    params.set('lng', String(opts.lng));
  }
  if (opts.area) params.set('area', opts.area);
  if (opts.radiusKm) params.set('radiusKm', String(opts.radiusKm));
  const qs = params.toString();
  return request(`/api/nearby${qs ? `?${qs}` : ''}`, undefined, (r) =>
    r && typeof r.available === 'boolean' ? r as { available: boolean; reason: string | null; items: GraphObject[] } : undefined);
}

// ---------------------------------------------------------------------------
// PERSONAL COLLECTIONS — named groups of object references.
// ---------------------------------------------------------------------------

export type CollectionVisibility = 'private' | 'public';

export interface CollectionCover {
  kind: 'custom' | 'single' | 'mosaic' | 'none';
  url?: string;
  urls?: string[];
}

export interface BriefCollectionSummary {
  id: string;
  name: string;
  description: string;
  visibility: CollectionVisibility;
  createdAt: string;
  updatedAt: string;
  count: number;
  cover: CollectionCover;
  locations: { areas: string[]; counties: string[] };
}

export interface CollectionItem {
  id: string;
  addedAt: string;
  position: number;
  object: any;
}

export interface CollectionPage {
  id: string;
  name: string;
  description: string;
  visibility: CollectionVisibility;
  coverImage: string | null;
  createdAt: string;
  updatedAt: string;
  count: number;
  cover: CollectionCover;
  locations: { areas: string[]; counties: string[] };
  items: CollectionItem[];
}

/** The owner's collections, optionally searched by name or item title. */
export function listCollections(q = ''): Promise<ApiResult<{ collections: BriefCollectionSummary[] }>> {
  const qs = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
  return request(`/api/me/collections${qs}`, undefined, (r) =>
    r && Array.isArray(r.collections) ? r as { collections: BriefCollectionSummary[] } : undefined);
}

/** Create a collection (private by default). */
export function createCollection(input: { name: string; description?: string; coverImage?: string | null; visibility?: CollectionVisibility }): Promise<ApiResult<{ ok: boolean; collection: BriefCollectionSummary }>> {
  return request('/api/me/collections', { method: 'POST', body: JSON.stringify(input) }, (r) =>
    r && r.collection ? r as { ok: boolean; collection: BriefCollectionSummary } : undefined);
}

/** Owner-only rename / description / cover / visibility. */
export function updateCollection(id: string, patch: { name?: string; description?: string; coverImage?: string | null; visibility?: CollectionVisibility }): Promise<ApiResult<{ ok: boolean; collection: BriefCollectionSummary }>> {
  return request(`/api/me/collections/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }, (r) =>
    r && r.collection ? r as { ok: boolean; collection: BriefCollectionSummary } : undefined);
}

/** Owner-only delete. The objects themselves are never touched. */
export function deleteCollection(id: string): Promise<ApiResult<{ ok: boolean }>> {
  return request(`/api/me/collections/${encodeURIComponent(id)}`, { method: 'DELETE', body: '{}' }, (r) =>
    r && r.ok === true ? r as { ok: boolean } : undefined);
}

/** The owner's full collection view (items resolved live). */
export function getMyCollection(id: string): Promise<ApiResult<{ collection: CollectionPage }>> {
  return request(`/api/me/collections/${encodeURIComponent(id)}`, undefined, (r) =>
    r && r.collection && Array.isArray(r.collection.items) ? r as { collection: CollectionPage } : undefined);
}

/** Add an object reference. Idempotent; public objects only. */
export function addToCollection(collectionId: string, objectId: string): Promise<ApiResult<{ ok: boolean; added: boolean; collectionId: string }>> {
  return request(`/api/me/collections/${encodeURIComponent(collectionId)}/items`, { method: 'POST', body: JSON.stringify({ objectId }) }, (r) =>
    r && r.ok === true ? r as { ok: boolean; added: boolean; collectionId: string } : undefined);
}

/** Remove an object reference. */
export function removeFromCollection(collectionId: string, objectId: string): Promise<ApiResult<{ ok: boolean; removed: boolean }>> {
  return request(`/api/me/collections/${encodeURIComponent(collectionId)}/items/${encodeURIComponent(objectId)}`, { method: 'DELETE', body: '{}' }, (r) =>
    r && r.ok === true ? r as { ok: boolean; removed: boolean } : undefined);
}

/** Owner-only reorder: objectIds defines the new order. */
export function reorderCollection(collectionId: string, objectIds: string[]): Promise<ApiResult<{ ok: boolean }>> {
  return request(`/api/me/collections/${encodeURIComponent(collectionId)}/items/order`, { method: 'PUT', body: JSON.stringify({ objectIds }) }, (r) =>
    r && r.ok === true ? r as { ok: boolean } : undefined);
}

/** The PUBLIC shareable page (only public objects; 404 for private/unknown). */
export function getPublicCollection(id: string): Promise<ApiResult<{ collection: CollectionPage }>> {
  return request(`/api/collections/personal/${encodeURIComponent(id)}`, undefined, (r) =>
    r && r.collection && Array.isArray(r.collection.items) ? r as { collection: CollectionPage } : undefined);
}

/** Share a public collection: returns the stable URL. */
export function shareCollection(id: string): Promise<ApiResult<{ ok: boolean; url: string | null }>> {
  return request(`/api/me/collections/${encodeURIComponent(id)}/share`, { method: 'POST', body: '{}' }, (r) =>
    r && r.ok === true ? r as { ok: boolean; url: string | null } : undefined);
}

// ---------------------------------------------------------------------------
// BRIEF 2.0: SPACES API
// ---------------------------------------------------------------------------

/** List all spaces owned by current user. */
export function listMySpaces(): Promise<ApiResult<{ spaces: Space[] }>> {
  return request<{ spaces: Space[] }>('/api/spaces', undefined, (r) =>
    r && Array.isArray(r.spaces) ? { spaces: r.spaces } : undefined);
}

/** Create a new Space. */
export function createSpace(input: SpaceCreate): Promise<ApiResult<{ space: Space }>> {
  return request<{ space: Space }>('/api/spaces', {
    method: 'POST',
    body: JSON.stringify(input)
  }, (r) => r && r.space ? { space: r.space } : undefined);
}

/**
 * Get a space by ID with hydrated metrics, offers and activities.
 *
 * `modes` is the server's own arm-of-business list, read alongside the row it
 * describes: an editor that kept its own copy could offer an arm the server
 * would refuse, and that is how a picker becomes a lie.
 */
export function getSpace(spaceId: string): Promise<ApiResult<{ space: Space; modes: SpaceMode[] }>> {
  return request<{ space: Space; modes: SpaceMode[] }>(`/api/spaces/${encodeURIComponent(spaceId)}`, undefined, (r) =>
    r && r.space ? { space: r.space, modes: Array.isArray(r.modes) ? r.modes : [] } : undefined);
}

/** The public directory: every public, active space, for discovery and collaboration. */
export function discoverPublicSpaces(limit?: number): Promise<ApiResult<PublicSpace[]>> {
  const q = limit ? `?limit=${limit}` : '';
  return request<PublicSpace[]>(`/api/public/spaces${q}`, undefined, (r) =>
    Array.isArray(r?.spaces) ? (r.spaces as PublicSpace[]) : undefined);
}

/**
 * The space SCHEMA, straight from the server, so the creation wizard and the
 * workspace ask the same questions the pipeline reads.
 */
export function getSpaceProfileSchema(): Promise<ApiResult<{ fields: SpaceFieldStatus[] }>> {
  return request<{ fields: SpaceFieldStatus[] }>('/api/spaces/profile-schema', undefined, (r) =>
    Array.isArray(r?.fields) ? { fields: r.fields as SpaceFieldStatus[] } : undefined);
}

/** The maintained answers plus their derived reads (owner-only). */
export interface SpaceOperatingView {
  fields: SpaceFieldStatus[];
  maintenance: SpaceMaintenance;
  editorial: SpaceEditorialItem[];
  pipeline: SpacePipeline;
}
export function getSpaceOperating(spaceId: string): Promise<ApiResult<SpaceOperatingView>> {
  return request<SpaceOperatingView>(`/api/spaces/${encodeURIComponent(spaceId)}/operating`, undefined, (r) =>
    r && r.maintenance && Array.isArray(r.editorial) && r.pipeline ? (r as SpaceOperatingView) : undefined);
}

/** Write structured answers. Only fields you send are touched; each keeps its
 *  own server timestamp, and re-sending an unchanged answer records a
 *  CONFIRMATION rather than pretending to be new information. */
export function updateSpaceProfile(
  spaceId: string,
  fields: Record<string, unknown>
): Promise<ApiResult<{ space: Space; changed: string[]; confirmed: string[] }>> {
  return request<{ space: Space; changed: string[]; confirmed: string[] }>(
    `/api/spaces/${encodeURIComponent(spaceId)}/profile`,
    { method: 'PATCH', body: JSON.stringify({ fields }) },
    (r) => (r && r.space ? { space: r.space, changed: r.changed ?? [], confirmed: r.confirmed ?? [] } : undefined)
  );
}

/** "Still true." A real, timestamped confirmation of one existing answer. */
export function confirmSpaceField(spaceId: string, key: string): Promise<ApiResult<{ space: Space }>> {
  return request<{ space: Space }>(
    `/api/spaces/${encodeURIComponent(spaceId)}/profile/${encodeURIComponent(key)}/confirm`,
    { method: 'POST', body: '{}' },
    (r) => (r && r.space ? { space: r.space } : undefined)
  );
}

/** Edit a space (name, goal, targetValueKes, image, status). Owner-only. */
export function updateSpace(spaceId: string, input: SpaceUpdate): Promise<ApiResult<{ space: Space }>> {
  return request<{ space: Space }>(`/api/spaces/${encodeURIComponent(spaceId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input)
  }, (r) => r && r.space ? { space: r.space } : undefined);
}

/** Delete a space. Owner-only. Offers are withdrawn; economic history is kept. */
export function deleteSpace(spaceId: string): Promise<ApiResult<{ removed: true }>> {
  return request<{ removed: true }>(`/api/spaces/${encodeURIComponent(spaceId)}`, {
    method: 'DELETE'
  }, (r) => r && r.removed === true ? { removed: true } : undefined);
}

/** Create an offer inside a space. */
export function createSpaceOffer(spaceId: string, input: SpaceOfferCreate): Promise<ApiResult<{ offer: Listing }>> {
  return request<{ offer: Listing }>(`/api/spaces/${encodeURIComponent(spaceId)}/offers`, {
    method: 'POST',
    body: JSON.stringify(input)
  }, (r) => r && r.offer ? { offer: r.offer } : undefined);
}

/** Publish an offer inside a space (makes it public and active). */
export function publishSpaceOffer(spaceId: string, offerId: string): Promise<ApiResult<{ offer: Listing }>> {
  return request<{ offer: Listing }>(`/api/spaces/${encodeURIComponent(spaceId)}/offers/${encodeURIComponent(offerId)}/publish`, {
    method: 'POST',
    body: '{}'
  }, (r) => r && r.offer ? { offer: r.offer } : undefined);
}

/** List activities in a space. */
export function getSpaceActivities(spaceId: string): Promise<ApiResult<{ activities: SpaceActivity[] }>> {
  return request<{ activities: SpaceActivity[] }>(`/api/spaces/${encodeURIComponent(spaceId)}/activities`, undefined, (r) =>
    r && Array.isArray(r.activities) ? { activities: r.activities } : undefined);
}

/** Customer asks a question about an offer in a space. */
export function createSpaceConversation(spaceId: string, input: {
  offerId?: string | null;
  customerName: string;
  customerContact?: string;
  message: string;
}): Promise<ApiResult<{ conversation: SpaceConversation }>> {
  return request<{ conversation: SpaceConversation }>(`/api/spaces/${encodeURIComponent(spaceId)}/conversations`, {
    method: 'POST',
    body: JSON.stringify(input)
  }, (r) => r && r.conversation ? { conversation: r.conversation } : undefined);
}

/** Get conversations inside a space. */
export function getSpaceConversations(spaceId: string): Promise<ApiResult<{ conversations: SpaceConversation[] }>> {
  return request<{ conversations: SpaceConversation[] }>(`/api/spaces/${encodeURIComponent(spaceId)}/conversations`, undefined, (r) =>
    r && Array.isArray(r.conversations) ? { conversations: r.conversations } : undefined);
}

/** Create an order from an offer in a space (server-authoritative price). */
export function createSpaceOrder(spaceId: string, input: {
  offerId: string;
  customerId?: string;
  customerName?: string;
  quantity?: number;
  deliveryNotes?: string;
}): Promise<ApiResult<{ order: Order }>> {
  return request<{ order: Order }>(`/api/spaces/${encodeURIComponent(spaceId)}/orders`, {
    method: 'POST',
    body: JSON.stringify(input)
  }, (r) => r && r.order ? { order: r.order } : undefined);
}

/** Post a chat message into a Space conversation thread. */
export function postSpaceMessage(spaceId: string, convId: string, input: {
  text: string;
  sender?: string;
  from?: 'customer' | 'owner' | 'seller';
}): Promise<ApiResult<{ conversation: SpaceConversation; whatsappDelivery: { ok: boolean; reason?: string; messageId?: string } | null }>> {
  return request<{ conversation: SpaceConversation; whatsappDelivery: { ok: boolean; reason?: string; messageId?: string } | null }>(`/api/spaces/${encodeURIComponent(spaceId)}/conversations/${encodeURIComponent(convId)}/messages`, {
    method: 'POST',
    body: JSON.stringify(input)
  }, (r) => r && r.conversation ? { conversation: r.conversation, whatsappDelivery: r.whatsappDelivery ?? null } : undefined);
}

/** Send a customized quotation card in a Space conversation thread. */
export function createSpaceQuote(spaceId: string, convId: string, input: {
  title: string;
  priceKes: number;
  notes?: string;
}): Promise<ApiResult<{ quote: SpaceQuote }>> {
  return request<{ quote: SpaceQuote }>(`/api/spaces/${encodeURIComponent(spaceId)}/conversations/${encodeURIComponent(convId)}/quote`, {
    method: 'POST',
    body: JSON.stringify(input)
  }, (r) => r && r.quote ? { quote: r.quote } : undefined);
}

/** Trigger an M-Pesa STK Push prompt to the customer's phone number. */
export function triggerSpaceMpesaPrompt(spaceId: string, convId: string, input: {
  quoteId?: string;
  phoneNumber?: string;
  amountKes: number;
  description?: string;
}): Promise<ApiResult<{ prompt: SpacePaymentPrompt }>> {
  return request<{ prompt: SpacePaymentPrompt }>(`/api/spaces/${encodeURIComponent(spaceId)}/conversations/${encodeURIComponent(convId)}/mpesa-prompt`, {
    method: 'POST',
    body: JSON.stringify(input)
  }, (r) => r && r.prompt ? { prompt: r.prompt } : undefined);
}

/** Complete an M-Pesa payment, settle transaction, and auto-convert to order. */
export function completeSpaceMpesaPayment(spaceId: string, convId: string, input: {
  paymentRequestId: string;
  mpesaReceipt?: string;
  amountPaid?: number;
}): Promise<ApiResult<{ order: Order; receipt: string; status: string }>> {
  return request<{ order: Order; receipt: string; status: string }>(`/api/spaces/${encodeURIComponent(spaceId)}/conversations/${encodeURIComponent(convId)}/mpesa-complete`, {
    method: 'POST',
    body: JSON.stringify(input)
  }, (r) => r && r.order ? { order: r.order, receipt: r.receipt, status: r.status } : undefined);
}

/** Route an inbound WhatsApp customer message into a Space conversation. */
export function routeInboundWhatsApp(spaceId: string, input: {
  from: string;
  customerName?: string;
  text: string;
  offerId?: string;
}): Promise<ApiResult<{ conversation: SpaceConversation }>> {
  return request<{ conversation: SpaceConversation }>(`/api/spaces/${encodeURIComponent(spaceId)}/whatsapp/inbound`, {
    method: 'POST',
    body: JSON.stringify(input)
  }, (r) => r && r.conversation ? { conversation: r.conversation } : undefined);
}

/** Get the Money & DukaBook financial summary for a space. */
export function getSpaceMoneySummary(spaceId: string): Promise<ApiResult<{ money: SpaceMoneySummary }>> {
  return request<{ money: SpaceMoneySummary }>(`/api/spaces/${encodeURIComponent(spaceId)}/money`, undefined, (r) =>
    r && r.money ? { money: r.money } : undefined);
}

/** Record a supply or operational cost for a space. */
export function recordSpaceExpense(spaceId: string, input: {
  category?: string;
  description: string;
  amountKes: number;
  date?: string;
}): Promise<ApiResult<{ expense: SpaceExpense }>> {
  return request<{ expense: SpaceExpense }>(`/api/spaces/${encodeURIComponent(spaceId)}/expenses`, {
    method: 'POST',
    body: JSON.stringify(input)
  }, (r) => r && r.expense ? { expense: r.expense } : undefined);
}

/** Record a customer credit tab in DukaBook (Lipa Pole Pole). */
export function recordSpaceCustomerTab(spaceId: string, input: {
  customerName: string;
  customerContact?: string;
  amountKes: number;
  note?: string;
}): Promise<ApiResult<{ tab: SpaceCustomerTab }>> {
  return request<{ tab: SpaceCustomerTab }>(`/api/spaces/${encodeURIComponent(spaceId)}/tabs`, {
    method: 'POST',
    body: JSON.stringify(input)
  }, (r) => r && r.tab ? { tab: r.tab } : undefined);
}

/** Record payment towards a customer tab. */
export function recordSpaceTabPayment(spaceId: string, tabId: string, input: {
  amountKes: number;
  note?: string;
}): Promise<ApiResult<{ tab: SpaceCustomerTab }>> {
  return request<{ tab: SpaceCustomerTab }>(`/api/spaces/${encodeURIComponent(spaceId)}/tabs/${encodeURIComponent(tabId)}/payments`, {
    method: 'POST',
    body: JSON.stringify(input)
  }, (r) => r && r.tab ? { tab: r.tab } : undefined);
}

/** List all customer tabs for a space. */
export function getSpaceTabs(spaceId: string): Promise<ApiResult<{ tabs: SpaceCustomerTab[] }>> {
  return request<{ tabs: SpaceCustomerTab[] }>(`/api/spaces/${encodeURIComponent(spaceId)}/tabs`, undefined, (r) =>
    r && Array.isArray(r.tabs) ? { tabs: r.tabs } : undefined);
}

/** Create an Inter-County Cargo dispatch waybill (Matatu Sacco parcel / courier). */
export function createSpaceDispatch(spaceId: string, input: SpaceDispatchCreate): Promise<ApiResult<{ dispatch: SpaceDispatch }>> {
  return request<{ dispatch: SpaceDispatch }>(`/api/spaces/${encodeURIComponent(spaceId)}/dispatches`, {
    method: 'POST',
    body: JSON.stringify(input)
  }, (r) => r && r.dispatch ? { dispatch: r.dispatch } : undefined);
}

/** Update the delivery status of an active cargo dispatch. */
export function updateSpaceDispatchStatus(spaceId: string, dispatchId: string, input: {
  status: SpaceDispatchStatus;
  conductorContact?: string;
}): Promise<ApiResult<{ dispatch: SpaceDispatch }>> {
  return request<{ dispatch: SpaceDispatch }>(`/api/spaces/${encodeURIComponent(spaceId)}/dispatches/${encodeURIComponent(dispatchId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input)
  }, (r) => r && r.dispatch ? { dispatch: r.dispatch } : undefined);
}

/** List all cargo dispatches for a space. */
export function getSpaceDispatches(spaceId: string): Promise<ApiResult<{ dispatches: SpaceDispatch[] }>> {
  return request<{ dispatches: SpaceDispatch[] }>(`/api/spaces/${encodeURIComponent(spaceId)}/dispatches`, undefined, (r) =>
    r && Array.isArray(r.dispatches) ? { dispatches: r.dispatches } : undefined);
}


// Requests: durable demand. Never offline-queue a creation as if it were saved.
import type { DemandRequest, RequestInput, RequestStatus } from './requestTypes';
function demandRequest(raw: any): DemandRequest | undefined {
  return raw && typeof raw.id === 'string' && typeof raw.requesterId === 'string'
    && typeof raw.title === 'string' && Number.isSafeInteger(raw.revision)
    && Array.isArray(raw.history) && Array.isArray(raw.attachments) ? raw as DemandRequest : undefined;
}
export function listMyRequests(): Promise<ApiResult<DemandRequest[]>> {
  return request('/api/me/requests', undefined, r => Array.isArray(r?.requests)
    && r.requests.every((v: any) => demandRequest(v)) ? r.requests : undefined);
}
export function getRequest(id: string): Promise<ApiResult<DemandRequest>> {
  return request(`/api/requests/${encodeURIComponent(id)}`, undefined, r => demandRequest(r?.request));
}
export function createRequest(body: Partial<RequestInput> & { title: string; intent: 'draft' | 'submit'; idempotencyKey?: string }): Promise<ApiResult<DemandRequest>> {
  return request('/api/requests', { method: 'POST', body: JSON.stringify(body) }, r => demandRequest(r?.request));
}
export function updateRequest(id: string, body: Partial<RequestInput> & { revision: number }): Promise<ApiResult<DemandRequest>> {
  return request(`/api/requests/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }, r => demandRequest(r?.request));
}
export function changeRequestStatus(id: string, status: RequestStatus, revision: number): Promise<ApiResult<DemandRequest>> {
  return request(`/api/requests/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status, revision }) }, r => demandRequest(r?.request));
}

// Supply uses the same API transport, session and error contract as Requests.
import type { Enterprise, EnterpriseInput, Capability, CapabilityInput, SourcingInput, CapabilitySearch, SupplyVerification, VerificationKind as SupplyVerificationKind, SupplyEvidence, PotentialParticipant, VendorLead, VendorLeadInput, LeadCodeView } from './supplyTypes';
const enterpriseOf = (r: any): Enterprise | undefined => typeof r?.id === 'string' && Array.isArray(r?.capabilities) && r.verification ? r : undefined;
const capabilityOf = (r: any): Capability | undefined => typeof r?.id === 'string' && typeof r?.participantId === 'string' && Number.isSafeInteger(r?.revision) ? r : undefined;
export function getMyEnterprise(): Promise<ApiResult<{enterprise: Enterprise | null}>> { return request('/api/me/enterprise',undefined,r=>r?.enterprise===null?{enterprise:null}:enterpriseOf(r?.enterprise)?{enterprise:r.enterprise}:undefined); }
export function getEnterprise(id: string, publicView = false): Promise<ApiResult<Enterprise>> {return request(`/api/${publicView?'public/':''}enterprises/${encodeURIComponent(id)}`,undefined,r=>enterpriseOf(r?.enterprise));}
export function createEnterprise(body: EnterpriseInput & {firstCapability?: Partial<CapabilityInput>}): Promise<ApiResult<Enterprise>> {return request('/api/enterprises',{method:'POST',body:JSON.stringify(body)},r=>enterpriseOf(r?.enterprise));}
export function updateEnterprise(id: string, body: Partial<EnterpriseInput> & {revision:number}): Promise<ApiResult<Enterprise>> {return request(`/api/enterprises/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(body)},r=>enterpriseOf(r?.enterprise));}
export function createCapability(id: string, body: Partial<CapabilityInput> & {idempotencyKey?:string}): Promise<ApiResult<Capability>> {return request(`/api/enterprises/${encodeURIComponent(id)}/capabilities`,{method:'POST',body:JSON.stringify(body)},r=>capabilityOf(r?.capability));}
export function updateCapability(id: string, body: Partial<CapabilityInput> & {revision:number}): Promise<ApiResult<Capability>> {return request(`/api/supply/capabilities/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(body)},r=>capabilityOf(r?.capability));}
export function archiveCapability(id:string,revision:number): Promise<ApiResult<Capability>> {return request(`/api/supply/capabilities/${encodeURIComponent(id)}`,{method:'DELETE',body:JSON.stringify({revision})},r=>capabilityOf(r?.capability));}
export function saveSourcingProfile(id:string,body:SourcingInput&{revision:number}): Promise<ApiResult<Enterprise>> {return request(`/api/enterprises/${encodeURIComponent(id)}/sourcing`,{method:'PUT',body:JSON.stringify(body)},r=>enterpriseOf(r?.enterprise));}
export function searchCapabilities(filters: Record<string,string>): Promise<ApiResult<CapabilitySearch>> {return request(`/api/capabilities/search?${new URLSearchParams(filters)}`,undefined,r=>Array.isArray(r?.capabilities)&&typeof r.total==='number'?r:undefined);}
export function getSupplyVerification(id:string): Promise<ApiResult<SupplyVerification[]>> {return request(`/api/enterprises/${encodeURIComponent(id)}/verification`,undefined,r=>Array.isArray(r?.records)?r.records:undefined);}
export function submitSupplyVerification(id:string,body:{kind:SupplyVerificationKind;capabilityId:string|null;participantRevision:number;evidence:SupplyEvidence[];note:string}): Promise<ApiResult<SupplyVerification>> {return request(`/api/enterprises/${encodeURIComponent(id)}/verification`,{method:'POST',body:JSON.stringify(body)},r=>r?.record?.id?r.record:undefined);}
export function supplyReviewQueue(): Promise<ApiResult<SupplyVerification[]>> {return request('/api/ops/supply-verification',undefined,r=>Array.isArray(r?.records)?r.records:undefined);}
export function reviewSupplyVerification(id:string,body:{status:string;revision:number;reason:string;expiresAt?:string}): Promise<ApiResult<SupplyVerification>> {return request(`/api/ops/supply-verification/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(body)},r=>r?.record?.id?r.record:undefined);}
export function getPotentialParticipants(id:string): Promise<ApiResult<PotentialParticipant[]>> {return request(`/api/requests/${encodeURIComponent(id)}/participants`,undefined,r=>Array.isArray(r?.participants)?r.participants:undefined);}
export function listVendorLeads(): Promise<ApiResult<{leads: VendorLead[]}>> {return request('/api/supply/vendor-leads',undefined,r=>Array.isArray(r?.leads)?{leads:r.leads}:undefined);}
export function createVendorLead(body: VendorLeadInput): Promise<ApiResult<{lead: VendorLead; replayed: boolean}>> {return request('/api/supply/vendor-leads',{method:'POST',body:JSON.stringify(body)},r=>r?.lead?.id?{lead:r.lead,replayed:r.replayed===true}:undefined);}
export function getVendorLead(id:string): Promise<ApiResult<VendorLead>> {return request(`/api/supply/vendor-leads/${encodeURIComponent(id)}`,undefined,r=>r?.lead?.id?r.lead:undefined);}
export function validateVendorLead(id:string,body:{causeType:string;causeId:string}): Promise<ApiResult<VendorLead>> {return request(`/api/supply/vendor-leads/${encodeURIComponent(id)}/validate`,{method:'POST',body:JSON.stringify(body)},r=>r?.lead?.id?r.lead:undefined);}
export function setVendorLeadExposureTerms(id:string,body:{amountKes:number;period:string;note?:string}): Promise<ApiResult<VendorLead>> {return request(`/api/supply/vendor-leads/${encodeURIComponent(id)}/exposure-terms`,{method:'POST',body:JSON.stringify(body)},r=>r?.lead?.id?r.lead:undefined);}
export function dropVendorLead(id:string,body?:{reason?:string}): Promise<ApiResult<VendorLead>> {return request(`/api/supply/vendor-leads/${encodeURIComponent(id)}/drop`,{method:'POST',body:JSON.stringify(body??{})},r=>r?.lead?.id?r.lead:undefined);}
export function mintLeadCode(id:string): Promise<ApiResult<{lead: VendorLead}>> {return request(`/api/supply/vendor-leads/${encodeURIComponent(id)}/code`,{method:'POST',body:'{}'},r=>r?.lead?.id?{lead:r.lead}:undefined);}
export function resolveLeadCode(code:string): Promise<ApiResult<{place: LeadCodeView}>> {return request(`/api/supply/lead-codes/${encodeURIComponent(code)}`,undefined,r=>r?.place?.code?{place:r.place}:undefined);}
export function searchExternalPlaces(location:string,category:string,limit=10): Promise<ApiResult<{snapshot: PlaceSnapshot}>> {const q=new URLSearchParams({location,category,limit:String(limit)});return request(`/api/places/search?${q}`,undefined,r=>r?.snapshot?.key?{snapshot:r.snapshot}:undefined);}
export function listPlacePriceClaims(placeKey:string): Promise<ApiResult<{claims: PlacePriceClaim[]}>> {const q=new URLSearchParams({placeKey});return request(`/api/places/price-claims?${q}`,undefined,r=>Array.isArray(r?.claims)?{claims:r.claims}:undefined);}
export function claimPlacePrice(body:PlacePriceClaimInput): Promise<ApiResult<{claim: PlacePriceClaim; replayed: boolean}>> {return request('/api/places/price-claims',{method:'POST',body:JSON.stringify(body)},r=>r?.claim?.id?{claim:r.claim,replayed:r.replayed===true}:undefined);}
export function listMapPlaces(): Promise<ApiResult<{places: MapPlace[]}>> {return request('/api/places/map',undefined,r=>Array.isArray(r?.places)?{places:r.places}:undefined);}
export function addPotentialParticipant(id:string,capabilityId:string): Promise<ApiResult<PotentialParticipant>> {return request(`/api/requests/${encodeURIComponent(id)}/participants`,{method:'POST',body:JSON.stringify({capabilityId})},r=>r?.participant?.id?r.participant:undefined);}
export function removePotentialParticipant(requestId:string,id:string,revision:number): Promise<ApiResult<{removed:boolean}>> {return request(`/api/requests/${encodeURIComponent(requestId)}/participants/${encodeURIComponent(id)}`,{method:'DELETE',body:JSON.stringify({revision})},r=>r?.removed?{removed:true}:undefined);}
/** Private image bytes use an authenticated fetch, never a token in a URL. */
export async function readPrivateEvidence(id:string): Promise<ApiResult<Blob>> {
  try {
    const token=getSessionToken();const res=await fetch(`${INGEST_API}/api/media/file/${encodeURIComponent(id)}`,{headers:token?{authorization:`Bearer ${token}`}:{},cache:'no-store'});
    if(!res.ok)return {ok:false,status:res.status,error:'Private evidence is unavailable or you do not have access. Sign in again if your session expired.'};
    return {ok:true,data:await res.blob()};
  }catch{return {ok:false,status:null,error:'Could not load the evidence. Please retry.'};}
}

// Request matching: private requester relationships and expressly shared briefs.
import type {DemandMatch,RequestMatches,RelevantRequest} from './matchTypes';
export function getRequestMatches(id:string,filters:Record<string,string>={}):Promise<ApiResult<RequestMatches>> {return request(`/api/requests/${encodeURIComponent(id)}/matches?${new URLSearchParams(filters)}`,undefined,r=>Array.isArray(r?.matches)&&r?.counts?r:undefined);}
export function refreshRequestMatches(id:string,body:{requestRevision:number;generationRevision:number;idempotencyKey:string}):Promise<ApiResult<RequestMatches>> {return request(`/api/requests/${encodeURIComponent(id)}/matches`,{method:'POST',body:JSON.stringify(body)},r=>Array.isArray(r?.matches)&&r?.counts?r:undefined);}
export function changeMatch(id:string,body:{requestRevision:number;revision:number;status:'viewed'|'saved'|'dismissed'|'suggested'}):Promise<ApiResult<DemandMatch>> {return request(`/api/matches/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(body)},r=>r?.match?.id?r.match:undefined);}
export function relevantRequests():Promise<ApiResult<RelevantRequest[]>> {return request('/api/supply/relevant-requests',undefined,r=>Array.isArray(r?.requests)?r.requests:undefined);}
export function expressMatchInterest(id:string,requestRevision:number,revision:number):Promise<ApiResult<RelevantRequest>> {return request(`/api/matches/${encodeURIComponent(id)}/interest`,{method:'POST',body:JSON.stringify({requestRevision,revision})},r=>r?.request?.matchId?r.request:undefined);}
export function withdrawMatchInterest(id:string,revision:number):Promise<ApiResult<{withdrawn:boolean}>> {return request(`/api/matches/${encodeURIComponent(id)}/interest`,{method:'DELETE',body:JSON.stringify({revision})},r=>r?.withdrawn?{withdrawn:true}:undefined);}

// Commercial proposals reuse this transport; never queue offline or settle money.
import type { Quote, QuoteInvitation, CommercialWorkspace, QuoteAction } from './quoteTypes';
export function requestMatchQuote(id:string,body:{requestRevision:number;matchRevision:number;shareRequirements:boolean}):Promise<ApiResult<QuoteInvitation>> {return request(`/api/matches/${encodeURIComponent(id)}/quote-request`,{method:'POST',body:JSON.stringify(body)},r=>r?.invitation?.id?r.invitation:undefined);}
export function getRequestQuotes(id:string):Promise<ApiResult<CommercialWorkspace>> {return request(`/api/requests/${encodeURIComponent(id)}/quotes`,undefined,r=>Array.isArray(r?.quotes)&&Array.isArray(r?.invitations)?r:undefined);}
export function getMyQuotes():Promise<ApiResult<CommercialWorkspace>> {return request('/api/supply/quotes',undefined,r=>Array.isArray(r?.quotes)&&Array.isArray(r?.invitations)?r:undefined);}
export function startRequestQuote(id:string,revision:number):Promise<ApiResult<Quote>> {return request(`/api/quote-requests/${encodeURIComponent(id)}/quote`,{method:'POST',body:JSON.stringify({revision})},r=>r?.quote?.id?r.quote:undefined);}
export function getRequestQuote(id:string):Promise<ApiResult<Quote>> {return request(`/api/request-quotes/${encodeURIComponent(id)}`,undefined,r=>r?.quote?.id?r.quote:undefined);}
export function changeRequestQuote(id:string,body:QuoteAction):Promise<ApiResult<Quote>> {return request(`/api/request-quotes/${encodeURIComponent(id)}/actions`,{method:'POST',body:JSON.stringify(body)},r=>r?.quote?.id?r.quote:undefined);}

// Explicit work coordination, using the existing session and retry transport.
import type {WorkOrder,WorkInput,WorkCollection} from './workTypes';
export function getWorkOrder(id:string):Promise<ApiResult<WorkOrder>> {return request(`/api/work-orders/${encodeURIComponent(id)}`,undefined,r=>r?.workOrder?.id?r.workOrder:undefined);}
export function getRequestWork(id:string):Promise<ApiResult<WorkCollection>> {return request(`/api/requests/${encodeURIComponent(id)}/work-orders`,undefined,r=>Array.isArray(r?.workOrders)?r:undefined);}
export function getMyWork():Promise<ApiResult<WorkCollection>> {return request('/api/supply/work-orders',undefined,r=>Array.isArray(r?.workOrders)?r:undefined);}
export function createWorkOrder(quoteId:string):Promise<ApiResult<WorkOrder>> {return request(`/api/request-quotes/${encodeURIComponent(quoteId)}/work-order`,{method:'POST',body:JSON.stringify({})},r=>r?.workOrder?.id?r.workOrder:undefined);}
export function changeWorkOrder(id:string,body:WorkInput):Promise<ApiResult<WorkOrder>> {return request(`/api/work-orders/${encodeURIComponent(id)}/actions`,{method:'POST',body:JSON.stringify(body)},r=>r?.workOrder?.id?r.workOrder:undefined);}

// Repeat procurement: private business memory of completed procurements.
import type { ProcurementReference, RepeatProcurementInput, RepeatProcurementResult } from './procurementTypes';
const procurementOf = (r: any): ProcurementReference | undefined =>
  r && typeof r.id === 'string' && typeof r.sourceWorkOrderId === 'string' && r.lastAgreedPrice ? r : undefined;
export function listProcurement(): Promise<ApiResult<ProcurementReference[]>> {
  return request('/api/me/procurement', undefined, r => Array.isArray(r?.procurements) && r.procurements.every(procurementOf) ? r.procurements : undefined);
}
export function getProcurement(id: string): Promise<ApiResult<{ procurement: ProcurementReference; prefill: Record<string, unknown> }>> {
  return request(`/api/me/procurement/${encodeURIComponent(id)}`, undefined, r => procurementOf(r?.procurement) ? { procurement: r.procurement, prefill: r.prefill } : undefined);
}
export function repeatProcurement(id: string, body: RepeatProcurementInput): Promise<ApiResult<RepeatProcurementResult>> {
  return request(`/api/me/procurement/${encodeURIComponent(id)}/repeat`, { method: 'POST', body: JSON.stringify(body ?? {}) }, r => r?.request?.id ? r : undefined);
}
export function getWorkOrderProcurement(workOrderId: string): Promise<ApiResult<ProcurementReference | null>> {
  return request(`/api/work-orders/${encodeURIComponent(workOrderId)}/procurement`, undefined, r =>
    r && 'procurement' in r ? (r.procurement === null || procurementOf(r.procurement) ? r.procurement : undefined) : undefined);
}

// Participant trust & economic history (Phase 7): derived, privacy-safe.
import type { TrustProfile, CapabilityTrust } from './trustTypes';
const trustProfileOf = (r: any): TrustProfile | undefined =>
  r && typeof r.participantId === 'string' && r.verification && r.history && r.signals ? r : undefined;
export function getPublicTrust(id: string): Promise<ApiResult<TrustProfile>> {
  return request(`/api/public/enterprises/${encodeURIComponent(id)}/trust`, undefined, trustProfileOf);
}
export function getPublicCapabilityTrust(id: string, capabilityId: string): Promise<ApiResult<CapabilityTrust>> {
  return request(`/api/public/enterprises/${encodeURIComponent(id)}/capabilities/${encodeURIComponent(capabilityId)}/trust`, undefined, r =>
    r && typeof r.participantId === 'string' && r.verification && r.history ? r : undefined);
}

// Work Order payments (Phase 8): the financial rail under the economic chain.
import type { WorkOrderPayments, WorkPaymentIntent } from './workPaymentTypes';
const workPaymentsOf = (r: any): WorkOrderPayments | undefined =>
  r && Array.isArray(r?.payments) && r.state ? r : undefined;
export function getWorkOrderPayments(id: string): Promise<ApiResult<WorkOrderPayments>> {
  return request(`/api/work-orders/${encodeURIComponent(id)}/payments`, undefined, workPaymentsOf);
}
export function payWorkOrder(id: string, body: { phone: string; idempotencyKey?: string }): Promise<ApiResult<{ intent: WorkPaymentIntent; reused: boolean; charged: boolean; customerMessage?: string | null; error?: string; detail?: unknown }>> {
  return request(`/api/work-orders/${encodeURIComponent(id)}/pay`, { method: 'POST', body: JSON.stringify(body) }, r =>
    r && r.intent?.id ? r : undefined);
}
export function getMyWorkPayments(): Promise<ApiResult<WorkPaymentIntent[]>> {
  return request('/api/me/work-payments', undefined, r =>
    Array.isArray(r?.payments) ? r.payments : undefined);
}

// Distribution provenance (Phase 11): how this member arrived, plus their
// derived economic activity. Honest null acquisition/provenance when the
// member had no provenance captured at sign-up.
export interface Acquisition {
  id: string;
  userId: string;
  partnerKey?: string | null;
  partnerName?: string | null;
  programKey?: string | null;
  programName?: string | null;
  cohortKey?: string | null;
  cohortName?: string | null;
  inviteCode?: string | null;
  channel?: string | null;
  source?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  referrerId?: string | null;
  createdAt: string;
}
export interface EconomicActivity {
  orders: { bought: { count: number; totalKes: number }; sold: { count: number; totalKes: number } };
  work: { requested: { count: number; totalKes: number }; fulfilled: { count: number; totalKes: number } };
  procurement: { repeatPatterns: number };
  requests: { created: number };
  verifiedCommercialKes: number;
  currency: string;
}
export interface MyAcquisition {
  acquisition: Acquisition | null;
  provenance: Array<{ hop: string; key?: string; name?: string; code?: string; id?: string }> | null;
  activity: EconomicActivity;
}
export function getMyAcquisition(): Promise<ApiResult<MyAcquisition>> {
  return request('/api/me/acquisition', undefined, r =>
    r && typeof r?.activity === 'object' ? r : undefined);
}

// Cohort drill-down (Phase 2): the members of a partner/program/cohort slice,
// each with their derived activity. Derived server-side from real rows only —
// a cohort with no attributed members returns an honest empty list.
export interface CohortMember {
  userId: string;
  handle: string | null;
  displayName: string | null;
  acquisition: Acquisition | null;
  activity: EconomicActivity;
}
export interface CohortSummary {
  filter: { partnerKey: string | null; programKey: string | null; cohortKey: string | null };
  members: number;
  ordersBought: number;
  ordersBoughtKes: number;
  ordersSold: number;
  ordersSoldKes: number;
  workRequested: number;
  workRequestedKes: number;
  workFulfilled: number;
  workFulfilledKes: number;
  repeatPatterns: number;
  requestsCreated: number;
  verifiedCommercialKes: number;
  currency: string;
  note: string;
  rows: CohortMember[];
}
export function getCohortMembers(partnerKey: string, programKey: string | null, cohortKey: string): Promise<ApiResult<CohortSummary>> {
  const qs = new URLSearchParams({ partner: partnerKey, cohort: cohortKey });
  if (programKey) qs.set('program', programKey);
  return request(`/api/ops/attribution/cohort?${qs.toString()}`, undefined, r =>
    r && Array.isArray(r?.rows) ? r : undefined);
}

// Partner distribution (Phase 2): operator-only reads for the partner desk.
// A non-operator caller gets 403 from the server; the surface reports that
// honestly rather than fabricating partner data.
export interface PartnerEconomics {
  partner: { id: string; key: string; name: string; partnerType: string; status: string };
  members: number;
  activity: {
    ordersBought: number; ordersSold: number; workRequested: number;
    workFulfilled: number; repeatPatterns: number; requestsCreated: number;
  };
  grossKes: number;
  basis: string | null;
  shareRate: number | null;
  partnerShareKes: number | null;
  settlements: { pendingKes: number; confirmedKes: number };
  note: string;
}
export interface PartnerView {
  id: string;
  key: string;
  name: string;
  partnerType: string;
  status: string;
  programs: Array<{ id: string; key: string; name: string; status: string; cohorts: Array<{ id: string; key: string; name: string; status: string }> }>;
  agreement: { id: string; shareRate: number; basis: string; status: string } | null;
  economics: PartnerEconomics;
}
export interface JoinLink {
  available: boolean;
  reason?: string;
  url?: string;
  partnerKey: string;
  programKey?: string | null;
  cohortKey?: string | null;
}
export function getPartners(): Promise<ApiResult<PartnerView[]>> {
  return request('/api/ops/partners', undefined, r => Array.isArray(r?.partners) ? r.partners : undefined);
}
export function getPartnerInviteLink(id: string, programKey?: string | null, cohortKey?: string | null): Promise<ApiResult<JoinLink>> {
  const qs = new URLSearchParams();
  if (programKey) qs.set('program', programKey);
  if (cohortKey) qs.set('cohort', cohortKey);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return request(`/api/ops/partners/${encodeURIComponent(id)}/invite${suffix}`, undefined, r => r?.link ? r.link : undefined);
}

// Partner settlement + agreement (Phase 2): finance-gated write actions. The
// server owns the state machine and the derived share — this client sends a
// share rate (0..1) or a period, never a money amount.
export interface PartnerAgreement {
  id: string;
  partnerId: string;
  shareRate: number;
  basis: string;
  status: string;
  effectiveAt: string;
  supersededAt: string | null;
  createdAt: string;
}
export interface PartnerSettlement {
  id: string;
  partnerId: string;
  periodKey: string;
  periodFrom: string | null;
  periodTo: string | null;
  grossKes: number;
  shareRate: number;
  shareKes: number;
  basis: string;
  ledgerId: string;
  status: 'pending' | 'confirmed' | 'refused';
  requestedBy: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  refusedReason: string | null;
  createdAt: string;
  updatedAt: string;
}
const partnerSettlementOf = (r: any): PartnerSettlement | undefined =>
  r && typeof r.id === 'string' && typeof r.shareKes === 'number' && typeof r.grossKes === 'number' ? r : undefined;

export function setPartnerAgreement(id: string, shareRate: number, basis = 'verified_commercial'): Promise<ApiResult<PartnerAgreement>> {
  return request(`/api/ops/partners/${encodeURIComponent(id)}/agreement`, {
    method: 'POST',
    body: JSON.stringify({ shareRate, basis })
  }, r => r?.agreement?.id ? r.agreement : undefined);
}

export function getPartnerSettlements(id: string): Promise<ApiResult<PartnerSettlement[]>> {
  return request(`/api/ops/partners/${encodeURIComponent(id)}/settlements`, undefined, r =>
    Array.isArray(r?.settlements) && r.settlements.every(partnerSettlementOf) ? r.settlements : undefined);
}

export function requestPartnerSettlement(id: string, from?: string | null, to?: string | null): Promise<ApiResult<PartnerSettlement>> {
  return request(`/api/ops/partners/${encodeURIComponent(id)}/settlements`, {
    method: 'POST',
    body: JSON.stringify({ from: from ?? null, to: to ?? null })
  }, r => partnerSettlementOf(r?.settlement));
}

export function confirmPartnerSettlement(settlementId: string, note = ''): Promise<ApiResult<PartnerSettlement>> {
  return request(`/api/ops/settlements/${encodeURIComponent(settlementId)}/confirm`, {
    method: 'POST',
    body: JSON.stringify({ note })
  }, r => partnerSettlementOf(r?.settlement));
}

export function refusePartnerSettlement(settlementId: string, note = ''): Promise<ApiResult<PartnerSettlement>> {
  return request(`/api/ops/settlements/${encodeURIComponent(settlementId)}/refuse`, {
    method: 'POST',
    body: JSON.stringify({ note })
  }, r => partnerSettlementOf(r?.settlement));
}

// ---------------------------------------------------------------------------
// FIELD AGENT — the member's own claims, visits and derived earnings.
//
// Pay is the operator's Decision 5 (docs/DECISIONS.md): KES 150 flat per
// APPROVED visit, settled weekly. No rate, no window, no bonus, no multiplier —
// so none of those appear in these types either. A claim is attribution; a
// visit is the payable act; only an approved visit earns, and only a
// finance-confirmed settlement turns it into money.
// ---------------------------------------------------------------------------
export interface FieldAgentClaim {
  id: string;
  vendorId: string;
  agentId: string;
  claimType: 'menu_upload' | 'full_registration';
  territoryKey: string | null;
  status: string;
  claimedAt: string;
  expiresAt: string | null;
  createdAt: string;
}
/** The stored visit row. It carries NO fee and NO week — both are derived. */
export interface FieldAgentVisitRow {
  id: string;
  agentId: string;
  vendorId: string;
  purpose: 'menu_upload' | 'full_registration';
  status: 'pending' | 'approved' | 'rejected';
  /** The agent's own account of what they saw — the approver reads this. */
  notes: string;
  submittedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  rejectReason: string | null;
  createdAt: string;
}
/** A visit as served on the earnings read: derived fee and week attached. */
export interface FieldAgentVisit {
  visitId: string;
  vendorId: string;
  vendorName: string | null;
  purpose: 'menu_upload' | 'full_registration';
  status: 'pending' | 'approved' | 'rejected';
  notes: string;
  submittedAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  rejectReason: string | null;
  /** The ISO week the visit was APPROVED in (`YYYY-Www`); null unless approved. */
  week: string | null;
  /** KES 150 when approved, 0 otherwise. Derived on read, never stored. */
  feeKes: number;
  /** The direct contact captured at onboarding: who you reach + their number. */
  contactName: string | null;
  contactMethod: string | null;
  businessType: string | null;
  location: string | null;
}
/** One payout week: that week's approved visits x the one flat number. */
export interface FieldAgentWeek {
  week: string;
  visits: number;
  kes: number;
  feeKes: number;
  currency: string;
  settlementId: string | null;
  settlementStatus: 'pending' | 'confirmed' | 'refused' | null;
}
export interface FieldAgentEarnings {
  agentId: string;
  /** The one number, published so the client never hardcodes it. */
  feeKes: number;
  currency: string;
  visits: FieldAgentVisit[];
  approved: number;
  pending: number;
  rejected: number;
  /** approved x feeKes. Derived; nothing is stored as a balance. */
  approvedKes: number;
  /** Approved money in weeks that have no settlement yet. */
  unsettledKes: number;
  weeks: FieldAgentWeek[];
  note: string;
}
/** One weekly payout: that week's approved visits, finance-confirmed. */
export interface FieldAgentSettlement {
  id: string;
  agentId: string;
  /** The ISO week paid (`YYYY-Www`). */
  week: string;
  periodKey: string;
  visits: number;
  feeKes: number;
  amountKes: number;
  ledgerId: string;
  status: 'pending' | 'confirmed' | 'refused';
  confirmedBy: string | null;
  confirmedAt: string | null;
  refusedReason: string | null;
  createdAt: string;
}
export interface FieldAgentOverview {
  claims: FieldAgentClaim[];
  visits: FieldAgentVisitRow[];
  earnings: FieldAgentEarnings;
  settlements: FieldAgentSettlement[];
}
export function getMyFieldAgent(): Promise<ApiResult<FieldAgentOverview>> {
  return request('/api/me/field-agent', undefined, r =>
    r && Array.isArray(r?.claims) && r?.earnings ? r : undefined);
}

/**
 * Record a visit — the payable act. It arrives PENDING and pays nothing until
 * an operator approves it; a rejection carries its reason. One visit per shop
 * per purpose, so the fee cannot be run twice on the same door. `notes` is
 * required because an approver who cannot read what happened cannot approve it.
 */
export function recordFieldVisit(body: {
  vendorId: string;
  purpose?: 'menu_upload' | 'full_registration';
  notes: string;
}): Promise<ApiResult<FieldAgentVisitRow>> {
  return request('/api/me/field-agent/visits', {
    method: 'POST',
    body: JSON.stringify(body)
  }, r => r?.visit?.id ? (r.visit as FieldAgentVisitRow) : undefined);
}

/** Request the weekly settlement for one week of approved visits (finance). */
export function settleFieldAgentWeek(week: string): Promise<ApiResult<FieldAgentSettlement>> {
  return request('/api/me/field-agent/settle', {
    method: 'POST',
    body: JSON.stringify({ week })
  }, r => r?.settlement?.id ? (r.settlement as FieldAgentSettlement) : undefined);
}

/** Who holds this vendor's territory (the active full_registration claim), or null. */
export function getVendorClaim(vendorId: string): Promise<ApiResult<FieldAgentClaim | null>> {
  return request(`/api/vendors/${encodeURIComponent(vendorId)}/claim`, undefined, r =>
    r && ('claim' in r) ? r.claim : undefined);
}

/**
 * Claim a vendor as a field agent — ATTRIBUTION only, first-touch-wins. A
 * claim mints no bounty and opens no window (Decision 5 ended both); it records
 * who brought the shop in. Pay follows an approved visit. The server refuses
 * self-claims and duplicate claims.
 */
export function claimVendor(
  vendorId: string,
  claimType: 'menu_upload' | 'full_registration',
  territoryKey?: string | null
): Promise<ApiResult<FieldAgentClaim>> {
  return request(`/api/vendors/${encodeURIComponent(vendorId)}/claims`, {
    method: 'POST',
    body: JSON.stringify({ claimType, territoryKey: territoryKey ?? null })
  }, r => r?.claim?.id ? (r.claim as FieldAgentClaim) : undefined);
}

/**
 * Onboard a NEW vendor: create the shop, record the territory claim AND the
 * visit the act is, in one step. This is the door-to-door agent's primary act —
 * bring a shop into Brief that has no profile yet (there is no existing vendor
 * to "claim" first). The visit arrives pending and pays KES 150 once approved.
 */
export function onboardVendor(body: {
  displayName: string;
  businessType: string;
  location: string;
  contactMethod?: string | null;
  /** The named person reached at the shop (owner / manager / sourcing runner). */
  contactName?: string | null;
  description?: string;
  claimType?: 'menu_upload' | 'full_registration';
  /** What you saw at the shop. Optional: the server writes an honest default
   *  from the name, type and location you captured in person. */
  notes?: string;
}): Promise<ApiResult<{ vendor: Vendor; claim: FieldAgentClaim; visit: FieldAgentVisitRow }>> {
  return request('/api/me/field-agent/onboard', {
    method: 'POST',
    body: JSON.stringify(body)
  }, r => r?.claim?.id && r?.vendor?.id ? r : undefined);
}

// ---------------------------------------------------------------------------
// PICKUPS — rider routing to onboarded shops. The routing is the product; the
// per-pickup origin fee Decision 5 ended is not, so what is served is a COUNT.
// ---------------------------------------------------------------------------
export interface Pickup {
  id: string;
  originVendorId: string;
  riderId: string;
  assignedBy: string | null;
  destinationTown: string;
  receiverName: string;
  receiverPhone: string;
  notes: string;
  status: 'assigned' | 'picked_up' | 'delivered' | 'cancelled';
  createdAt: string;
  completedAt: string | null;
}
/** A count of real rows, not an amount owed. `currency` is null on purpose. */
export interface PickupOriginStats {
  agentId: string;
  pickupCount: number;
  shops: number;
  currency: null;
  note: string;
}
export interface PickupOrigin {
  vendorId: string;
  shopName: string;
  businessType: string | null;
  location: string | null;
  onboardingAgentId: string;
}
export function getPickupOrigins(): Promise<ApiResult<PickupOrigin[]>> {
  return request('/api/pickups/origins', undefined, r =>
    Array.isArray(r?.origins) ? (r.origins as PickupOrigin[]) : undefined);
}
export function assignPickup(body: {
  originVendorId: string;
  /** Defaults to the caller (self-dispatch) when omitted. */
  riderId?: string;
  destinationTown: string;
  receiverName: string;
  receiverPhone: string;
  notes?: string;
}): Promise<ApiResult<Pickup>> {
  return request('/api/pickups', { method: 'POST', body: JSON.stringify(body) }, r =>
    r?.pickup?.id ? (r.pickup as Pickup) : undefined);
}
export function completePickup(pickupId: string): Promise<ApiResult<Pickup>> {
  return request(`/api/pickups/${encodeURIComponent(pickupId)}/complete`, { method: 'POST', body: '{}' }, r =>
    r?.pickup?.id ? (r.pickup as Pickup) : undefined);
}
export function listMyPickups(): Promise<ApiResult<Pickup[]>> {
  return request('/api/pickups/mine', undefined, r =>
    Array.isArray(r?.pickups) ? (r.pickups as Pickup[]) : undefined);
}
export function getMyPickupOriginStats(): Promise<ApiResult<PickupOriginStats>> {
  return request('/api/me/pickup-origins', undefined, r =>
    r?.stats && typeof r.stats.pickupCount === 'number' ? (r.stats as PickupOriginStats) : undefined);
}

/** A rider a dispatcher can route a pickup to, with the derived reason why. */
export interface Rider {
  id: string;
  handle: string | null;
  displayName: string;
  isSelf: boolean;
  /** Why this person is listed: onboarding_agent | rider | you. */
  reasons: string[];
}
export function getPickupRiders(): Promise<ApiResult<Rider[]>> {
  return request('/api/pickups/riders', undefined, r =>
    Array.isArray(r?.riders) ? (r.riders as Rider[]) : undefined);
}

/** HISTORY ONLY: a payout of the origin fee that Decision 5 ended. Readable,
 *  never written again — the routes that minted these are retired. */
export interface PickupFeeSettlement {
  id: string;
  agentId: string;
  periodKey: string;
  periodFrom: string | null;
  periodTo: string | null;
  pickupCount: number;
  feePerPickupKes: number;
  originFeeKes: number;
  ledgerId: string;
  status: 'pending' | 'confirmed' | 'refused';
  confirmedAt: string | null;
  refusedReason: string | null;
  createdAt: string;
}
export function getMyPickupFeeSettlements(): Promise<ApiResult<PickupFeeSettlement[]>> {
  return request('/api/me/pickup-fee/settlements', undefined, r =>
    Array.isArray(r?.settlements) ? (r.settlements as PickupFeeSettlement[]) : undefined);
}

// ---------------------------------------------------------------------------
// DISCOVER SUMMARY — the tile counts and the featured slot. The old Discover
// screen in preview/src/screens/ hardcoded its "posts" (a fake market with 40
// invented vendors and a borrowed Unsplash photo). This is the same shape with
// rows behind it: a zero means zero, and the featured card carries the rule
// that picked it.
// ---------------------------------------------------------------------------
export interface DiscoverTile {
  key: 'marketplace' | 'shops' | 'events' | 'circles' | 'errands';
  label: string;
  count: number;
  unit: string;
}
export interface DiscoverFeatured {
  kind: 'listing' | 'event';
  id: string;
  title: string;
  description: string | null;
  price: number;
  currency: string;
  type?: string;
  location: string | null;
  startsAt?: string | null;
  mediaUrl: string | null;
  seller?: string | null;
  stock?: number | null;
  group?: string | null;
  /** Decision 6: an event carries no social proof, so the server sends null for
      event rows. A UI must treat "no number" as a real state, not a zero. */
  interest: { label: string; count: number } | null;
  why: string;
}
export interface DiscoverFeedItem {
  kind: 'listing' | 'event';
  flow?: string | null;
  commodity?: string | null;
  origin?: string | null;
  originKind?: string | null;
  destination?: string | null;
  destinationKind?: string | null;
  unit?: string | null;
  minOrder?: number | null;
  id: string;
  title: string;
  description: string | null;
  priceLabel: string | null;
  dateLabel: string | null;
  location: string | null;
  mediaUrl: string | null;
  /** The row's own createdAt (listing) / publishedAt (event). Null = unknown. */
  listedAt?: string | null;
  seller: string | null;
  stock: number | null;
  orderable: boolean | null;
  /** Only ever the contact the SELLER put on their own row. Never defaulted. */
  contact: string | null;
  contactNote: string | null;
  /** Null for event rows — Decision 6 forbids registration counts and every
      other crowd number on events. Only listings carry a settled-order count. */
  interest: { label: string; count: number } | null;
  why: string;
  recurrence?: EventRecurrence | null;
}
export interface DiscoverFlow {
  key: 'bulk' | 'direct' | 'niche' | 'group';
  label: string;
  sub: string;
  subFilters: string[];
  /** Fields the seller must state for a listing to be in this flow at all. */
  requires?: string[];
  /** Why this flow is empty, as a code the surface words. null when it isn't. */
  zeroReason?: 'untagged_only' | 'other_flows_only' | 'nothing_on_the_board' | null;
  listings: number;
  openDemand: number;
}
export interface DiscoverRoute {
  origin: string;
  destination: string;
  flow: string | null;
  listings: number;
  sellers: string[];
  topCommodities: string[];
  commodities: string[];
  commodityUndeclared: number | null;
  minOrderFrom: number | null;
  unit: string | null;
  listingIds: string[];
  openDemand: number;
  openDemandQuantity: number | null;
  openDemandRequestIds: string[];
}
export interface DiscoverGap {
  requestId: string;
  title: string;
  category: string | null;
  quantity: number | null;
  unit: string | null;
  location: string | null;
  requiredBy: string | null;
  requesterType: string | null;
  coverage: 'routed' | 'listing_without_route' | 'no_route_declared';
  destinationsInUse: string[];
}
export interface DiscoverSummary {
  tiles: DiscoverTile[];
  feed: DiscoverFeedItem[];
  flows?: DiscoverFlow[];
  /** 'national' — the board is not filtered by the reader's area. */
  scope?: string | null;
  areaFiltered?: boolean;
  untagged?: number;
  totals?: { activeListings: number; declaredRoutes: number; openPublicDemand: number };
  routes?: DiscoverRoute[];
  unmapped?: DiscoverGap[];
  boardNote?: string;
  featured: DiscoverFeatured | null;
  featuredFrom: string | null;
  counts: { listings: number; events: number; circles: number; errands: number };
  asOf: string | null;
  note: string;
}
export function getDiscoverSummary(): Promise<ApiResult<DiscoverSummary>> {
  return request<DiscoverSummary>('/api/discover/summary', undefined, (r) =>
    r && Array.isArray(r.tiles) ? (r as DiscoverSummary) : undefined);
}

// ---------------------------------------------------------------------------
// SPACE AUDIENCE — follows, broadcasts, insights, templates, pinned offers.
// Every figure is a count of rows somebody wrote; none of it is estimated, and
// there is no sector benchmark to compare against (Brief holds none).
// ---------------------------------------------------------------------------
export interface SpaceAudienceView {
  slug: string;
  followers: number;
  followerList: Array<{ userId: string; displayName: string; since: string }>;
  iAmFollowing: boolean;
  broadcasts: SpaceBroadcast[];
  pastBroadcasts: number;
  templates: SpaceTemplate[];
  insights: SpaceInsights | null;
  canManage: boolean;
  followable: boolean;
}
export function getSpaceAudience(spaceId: string): Promise<ApiResult<SpaceAudienceView>> {
  return request<SpaceAudienceView>(`/api/spaces/${encodeURIComponent(spaceId)}/audience`, undefined, (r) =>
    r && typeof r.followers === 'number' ? (r as SpaceAudienceView) : undefined);
}
export function followSpace(spaceId: string): Promise<ApiResult<{ following: boolean; reused?: boolean; followers: number }>> {
  return request(`/api/spaces/${encodeURIComponent(spaceId)}/follow`, { method: 'POST', body: '{}' }, (r) =>
    typeof r?.followers === 'number' ? r : undefined);
}
export function unfollowSpace(spaceId: string): Promise<ApiResult<{ following: boolean; removed: number; followers: number }>> {
  return request(`/api/spaces/${encodeURIComponent(spaceId)}/follow`, { method: 'DELETE' }, (r) =>
    typeof r?.followers === 'number' ? r : undefined);
}
export function postSpaceBroadcast(
  spaceId: string,
  body: { text: string; kind?: 'update' | 'stock' | 'hours' | 'drop' }
): Promise<ApiResult<{ broadcast: SpaceBroadcast; delivery: { audience: number; notified: number; mutedByPreference: number; channels: Record<string, string>; note: string } }>> {
  return request(`/api/spaces/${encodeURIComponent(spaceId)}/broadcasts`, { method: 'POST', body: JSON.stringify(body) }, (r) =>
    r?.broadcast ? { broadcast: r.broadcast, delivery: r.delivery } : undefined);
}
export function deleteSpaceBroadcast(spaceId: string, broadcastId: string): Promise<ApiResult<{ removed: boolean }>> {
  return request(`/api/spaces/${encodeURIComponent(spaceId)}/broadcasts/${encodeURIComponent(broadcastId)}`, { method: 'DELETE' }, (r) =>
    r?.removed ? { removed: true } : undefined);
}
export function getSpaceTemplates(spaceId: string): Promise<ApiResult<{ templates: SpaceTemplate[] }>> {
  return request(`/api/spaces/${encodeURIComponent(spaceId)}/templates`, undefined, (r) =>
    Array.isArray(r?.templates) ? { templates: r.templates as SpaceTemplate[] } : undefined);
}
export function saveSpaceTemplate(
  spaceId: string,
  body: { label: string; body: string },
  templateId?: string
): Promise<ApiResult<{ template?: SpaceTemplate; templates: SpaceTemplate[] }>> {
  return request(
    templateId
      ? `/api/spaces/${encodeURIComponent(spaceId)}/templates/${encodeURIComponent(templateId)}`
      : `/api/spaces/${encodeURIComponent(spaceId)}/templates`,
    { method: templateId ? 'PATCH' : 'POST', body: JSON.stringify(body) },
    (r) => (r && Array.isArray(r.templates) ? { template: r.template, templates: r.templates } : undefined)
  );
}
export function deleteSpaceTemplate(spaceId: string, templateId: string): Promise<ApiResult<{ removed: boolean; templates: SpaceTemplate[] }>> {
  return request(`/api/spaces/${encodeURIComponent(spaceId)}/templates/${encodeURIComponent(templateId)}`, { method: 'DELETE' }, (r) =>
    Array.isArray(r?.templates) ? { removed: Boolean(r.removed), templates: r.templates } : undefined);
}
/** Pin up to 3 of the space's own active offers. The server validates each id. */
export function setSpaceFeatured(spaceId: string, listingIds: string[]): Promise<ApiResult<{ space: Space }>> {
  return request(`/api/spaces/${encodeURIComponent(spaceId)}/featured`, { method: 'PATCH', body: JSON.stringify({ listingIds }) }, (r) =>
    r?.space ? { space: r.space } : undefined);
}
export function getFollowedSpaces(): Promise<ApiResult<{ spaces: PublicSpace[]; note?: string }>> {
  return request<{ spaces: PublicSpace[]; note?: string }>('/api/spaces/followed/mine', undefined, (r) =>
    Array.isArray(r?.spaces) ? { spaces: r.spaces as PublicSpace[], note: r.note } : undefined);
}
/** One public space by slug — the DIRECTORY card. Reading it records nothing. */
export function getPublicSpace(slugOrId: string): Promise<ApiResult<{ space: PublicSpace }>> {
  return request(`/api/public/spaces/${encodeURIComponent(slugOrId)}`, undefined, (r) => (r?.space ? { space: r.space } : undefined));
}
/**
 * The public PAGE projection: the same rows the server-rendered mirror at
 * /s/:slug paints, offered as data. Reading this records a view, because a page
 * opening is what a view is — and it is the only way the in-app mirror can be
 * counted alongside a shared link.
 */
export function getPublicSpacePage(slugOrId: string): Promise<ApiResult<{ space: SpacePublicPageView }>> {
  return request(`/api/public/spaces/${encodeURIComponent(slugOrId)}/page`, undefined, (r) => (r?.space ? { space: r.space as SpacePublicPageView } : undefined));
}
// ---------------------------------------------------------------------------
// GUARDIANS — a claim that you introduced a shop, and the shop's answer to it.
// The credit is points, converted only inside the rewards pool, so there is no
// payout endpoint here: `/api/referrals/*` owns money.
// ---------------------------------------------------------------------------
export function getGuardianNetwork(): Promise<ApiResult<{ network: GuardianNetwork }>> {
  return request(`/api/guardians/mine`, undefined, (r) => (r?.network?.businesses ? { network: r.network as GuardianNetwork } : undefined));
}
export function claimGuardian(spaceId: string, note?: string): Promise<ApiResult<{ attribution: { id: string; status: string }; note: string }>> {
  return request(`/api/guardians/claim`, { method: 'POST', body: JSON.stringify({ spaceId, note }) }, (r) =>
    r?.attribution?.id ? { attribution: r.attribution, note: r.note } : undefined);
}
export function getSpaceGuardian(spaceId: string): Promise<ApiResult<SpaceGuardian>> {
  return request<SpaceGuardian>(`/api/spaces/${encodeURIComponent(spaceId)}/guardian`, undefined, (r) =>
    r && 'attribution' in r ? (r as SpaceGuardian) : undefined);
}
export function answerGuardian(
  attributionId: string,
  answer: 'confirm' | 'dispute' | 'revoke',
  reason?: string
): Promise<ApiResult<{ attribution: { id: string; status: string }; note?: string }>> {
  return request(`/api/guardians/${encodeURIComponent(attributionId)}/${answer}`, {
    method: 'POST',
    body: JSON.stringify(answer === 'confirm' ? {} : { reason })
  }, (r) => (r?.attribution?.id ? { attribution: r.attribution, note: r.note } : undefined));
}

/** The owner's read of their own public face: the link, what a buyer sees, reports. */
export function getSpacePublicFace(spaceId: string): Promise<ApiResult<SpacePublicFace>> {
  return request<SpacePublicFace>(`/api/spaces/${encodeURIComponent(spaceId)}/public-page`, undefined, (r) =>
    r && typeof r.open === 'boolean' && typeof r.path === 'string' ? (r as SpacePublicFace) : undefined);
}

// ---------------------------------------------------------------------------
// ERRANDS — the lobby board. Posting is open to any member; carrying needs a
// real record (agent role, partner role, an active shop claim, or a pickup
// already assigned to you). The fee is the POSTER'S stated amount: Brief moves
// no money for an errand, and "settled" means both parties confirmed it off
// platform. Ratings are one per person per completed delivery, listed as said —
// no average, no score, no rank is computed from them.
// ---------------------------------------------------------------------------
export interface ErrandStage {
  key: string;
  label: string;
  at: string | null;
  done: boolean;
}
export interface ErrandRating {
  id: string;
  by: string;
  about: 'carrier' | 'poster';
  stars: number;
  note: string | null;
  createdAt: string;
}
export interface ErrandKind {
  id: string;
  label: string;
  blurb: string;
}
export interface Errand {
  id: string;
  what: string;
  /** Which kind of job, as stored on the row. null means "nobody labelled it",
   *  which is a real state and not a value to be guessed into. */
  kind: string | null;
  kindLabel: string | null;
  pickup: string;
  dropoff: string;
  sizeOrWeight: string | null;
  whenNeeded: string | null;
  offeredFeeKes: number | null;
  currency: string;
  note: string;
  status: 'open' | 'accepted' | 'picked_up' | 'delivered' | 'cancelled';
  posterId: string;
  posterName: string;
  acceptedBy: string | null;
  carrierName: string | null;
  carrierBasis: string[];
  settlement: { amountKes: number | null; currency: string; confirmedBy: string[]; confirmedNames: string[]; at: string | null; movedBy: null } | null;
  cancelReason: string | null;
  /** Delivery proof: a photo the carrier or poster attached, or null. */
  pod: { photo: string; by: string; at: string } | null;
  /** Carrier's last reported position, parties-only, with its timestamp. */
  carrierPosition: { lat: number; lon: number; accuracy: number | null; at: string } | null;
  isMine: boolean;
  iAmTheCarrier: boolean;
  iAmThePoster: boolean;
  canRate: boolean;
  canConfirmFee: boolean;
  createdAt: string;
  updatedAt: string;
  history: Array<{ action: string; at: string; by: string }>;
  loop: ErrandStage[];
  ratings: ErrandRating[];
  ratingsNote: string;
}
export interface ErrandEligibility {
  eligible: boolean;
  basis: string[];
  howToJoin: string;
  note: string;
  carriersAround?: number;
}
export interface ErrandBoard {
  open: Errand[];
  mine: Errand[];
  eligibility: ErrandEligibility;
  carriersAround: number;
  stages: Array<{ key: string; label: string }>;
  /** Served by the API so the grid and the store cannot hold two taxonomies. */
  kinds?: ErrandKind[];
}
/** A fee a poster stated on a run that actually completed. Listed as written. */
export interface StatedFee {
  what: string;
  pickup: string;
  dropoff: string;
  sizeOrWeight: string | null;
  offeredFeeKes: number;
  currency: string;
  at: string;
}
export function listStatedFees(): Promise<ApiResult<{ fees: StatedFee[] }>> {
  return request('/api/errands/stated-fees', undefined, (r) =>
    r && Array.isArray(r.fees) ? { fees: r.fees as StatedFee[] } : undefined);
}
export function getErrandBoard(): Promise<ApiResult<ErrandBoard>> {
  return request<ErrandBoard>('/api/errands', undefined, (r) =>
    r && Array.isArray(r.open) && Array.isArray(r.mine) && r.eligibility ? (r as ErrandBoard) : undefined);
}
export function postErrand(body: {
  what: string; pickup: string; dropoff: string;
  whenNeeded?: string | null; offeredFeeKes?: number | null; note?: string; sizeOrWeight?: string | null;
  kind?: string | null;
}): Promise<ApiResult<{ errand: Errand; notified: { notified: number; skippedByPreference: number; channels: Record<string, string>; note: string } }>> {
  return request('/api/errands', { method: 'POST', body: JSON.stringify(body) }, (r) =>
    r?.errand ? { errand: r.errand, notified: r.notified } : undefined);
}
export function errandAction(
  id: string,
  action: 'accept' | 'picked' | 'delivered' | 'cancel' | 'settle',
  body: Record<string, unknown> = {}
): Promise<ApiResult<{ errand: Errand; settled?: boolean; note?: string; eligibility?: ErrandEligibility }>> {
  return request(`/api/errands/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: JSON.stringify(body) }, (r) =>
    r?.errand ? r : undefined);
}
export function attachErrandPod(id: string, body: { photo: string }): Promise<ApiResult<{ errand: Errand }>> {
  return request(`/api/errands/${encodeURIComponent(id)}/pod`, { method: 'POST', body: JSON.stringify(body) }, (r) =>
    r?.errand ? r : undefined);
}
export function shareErrandPosition(id: string, body: { lat: number; lon: number; accuracy?: number | null }): Promise<ApiResult<{ errand: Errand }>> {
  return request(`/api/errands/${encodeURIComponent(id)}/position`, { method: 'POST', body: JSON.stringify(body) }, (r) =>
    r?.errand ? r : undefined);
}
export function rateErrand(id: string, stars: number, note?: string): Promise<ApiResult<{ rating: ErrandRating }>> {
  return request(`/api/errands/${encodeURIComponent(id)}/rate`, { method: 'POST', body: JSON.stringify({ stars, note }) }, (r) =>
    r?.rating ? { rating: r.rating } : undefined);
}
export interface ErrandProviders {
  integrated: Array<{ key: string; name: string; what: string; canDispatchThroughBrief: boolean; agentsOnRecord?: number; deliveredPickups?: number; note: string }>;
  usedHere: Array<{ key: string; name: string; what: string; canDispatchThroughBrief: boolean; dispatchesRecorded: number; waybillsCaptured: number; note: string }>;
  external: Array<{ key: string; name: string; canDispatchThroughBrief: boolean; reason: string }>;
  disclosure: string;
}
export function getErrandProviders(): Promise<ApiResult<ErrandProviders>> {
  return request<ErrandProviders>('/api/errands/providers', undefined, (r) =>
    r && Array.isArray(r.integrated) && Array.isArray(r.external) ? (r as ErrandProviders) : undefined);
}

// ---------------------------------------------------------------------------
// PULSE — "what is moving", derived from real rows on read. Every fact is a
// count/sum over rows that exist; the payload carries no estimate, no trend
// percentage and no "live" claim (it is a snapshot stamped with the newest row).
// ---------------------------------------------------------------------------
export interface PulseFact { id: string; text: string; }
export interface PulseListingSnapshot {
  type: string;
  count: number;
  currency: string;
  minPrice: number;
  avgPrice: number;
  maxPrice: number;
}
export interface Pulse {
  /** Newest real row timestamp among everything considered — NOT a clock. */
  asOf: string | null;
  sections: {
    demand: { open: number; bySeverity: Record<string, number>; collective: number };
    closure: {
      windowDays: number;
      closed: number;
      topCategory: { category: string; closed: number } | null;
    };
    fill: {
      windowDays: number;
      closed: number;
      avgHoursToFill: number | null;
      hoursSampleCount: number;
      avgValue: { amount: number; currency: string; sampleCount: number } | null;
    };
    money: {
      windowDays: number;
      settledOrders: number;
      settledValue: number | null;
      settledCurrency: string | null;
      completedWorkOrders: number;
      deliveredPickups: number;
    };
    listings: { active: number; snapshot: PulseListingSnapshot[] };
    events: {
      open: number;
      newLast24h: { requests: number; events: number; listings: number; orders: number };
    };
  };
  facts: PulseFact[];
  empty: boolean;
  note: string;
}
// ---------------------------------------------------------------------------
// WORLD SIGNAL — what the world is doing, read from a real public provider.
// The server owns the provider call; the client only renders what came back and
// repeats the source, the retrieval time and the gaps it declared. There is no
// client-side fallback text: an unavailable read says it is unavailable.
// ---------------------------------------------------------------------------
export interface WorldFact {
  kind: string;
  text: string;
  value?: number | null;
  unit?: string | null;
  date?: string | null;
  inDays?: number | null;
  chance?: number | null;
  thresholdMm?: number | null;
}
export interface WorldSignal {
  ok?: boolean;
  available: boolean;
  provider: string | null;
  providerLicence?: string | null;
  kind?: string;
  observedAt: string | null;
  horizonDays?: number | null;
  place: string | null;
  placeIsDefault?: boolean;
  defaultPlace?: string;
  resolvedPlace?: { name: string; admin?: string | null; country?: string | null } | null;
  elevationM?: number | null;
  model?: string | null;
  retrievedAt?: string | null;
  ageHours?: number | null;
  fromCache?: boolean;
  stale?: boolean;
  facts: WorldFact[];
  heaviestRain?: { date: string; mm: number; inDays: number | null; chance?: number | null } | null;
  dryRunDays?: number;
  wetDays?: number;
  prices?: { status: string; reason?: string };
  fuel?: { status: string; reason?: string };
  error: string | null;
}
export function getWorld(place?: string | null): Promise<ApiResult<WorldSignal>> {
  const q = place && place.trim() ? `?place=${encodeURIComponent(place.trim().slice(0, 80))}` : '';
  return request<WorldSignal>(`/api/world${q}`, undefined, (r) =>
    r && Array.isArray(r.facts) ? (r as WorldSignal) : undefined);
}

/**
 * The member's planned days, with a weather fact only where the provider's
 * dated forecast lands on one of them. `matched` is empty whenever there is
 * nothing to join, which is the point: this is not a weather feed.
 */
export interface PlannedWeatherMatch {
  date: string;
  dayIndex: number;
  eventTitle: string;
  /** The plan's own identity. `slug` is null when it has no public page. */
  campaignId: string | null;
  slug: string | null;
  eventCount: number;
  startsAt: string | null;
  location: string | null;
  fact: { kind: string; text: string; value: number | null; unit: string | null };
}

export interface PlannedWeather {
  available: boolean;
  matched: PlannedWeatherMatch[];
  plannedDays?: Array<{ date: string; dayIndex: number; events: unknown[] }>;
  unmatchedDays?: number;
  reason: string | null;
  provider: string | null;
  providerLicence?: string | null;
  horizonDays?: number | null;
  note?: string;
}

export function getPlannedWeather(place?: string | null): Promise<ApiResult<PlannedWeather>> {
  const q = place && place.trim() ? `?place=${encodeURIComponent(place.trim().slice(0, 80))}` : '';
  return request<PlannedWeather>(`/api/planned-weather${q}`, undefined, (r) =>
    r && Array.isArray(r.matched) && typeof r.available === 'boolean' ? (r as PlannedWeather) : undefined);
}

export function getPulse(): Promise<ApiResult<Pulse>> {
  return request('/api/pulse', undefined, r =>
    r && Array.isArray(r.facts) && r.sections ? (r as Pulse) : undefined);
}

// ---------------------------------------------------------------------------
// PRECEDENT — "does demand like this actually close?" Counts over real rows
// plus the arithmetic of accepted offer terms. No identities, no budgets.
// ---------------------------------------------------------------------------
export interface PrecedentFill {
  category: string | null;
  windowDays: number;
  closed: number;
  avgHoursToFill: number | null;
  hoursSampleCount: number;
  avgValue: { amount: number; currency: string; sampleCount: number } | null;
  note: string;
}
export interface Precedent {
  category: string | null;
  closure: {
    windowDays: number;
    byCategory: Array<{ category: string; closed: number }>;
  };
  fill: PrecedentFill;
  movement: {
    windowDays: number;
    settledOrders: number;
    settledOrdersKes: number;
    settledCurrency: string | null;
    completedWorkOrders: number;
    deliveredPickups: number;
  };
  note: string;
}
export function getPrecedent(category?: string): Promise<ApiResult<Precedent>> {
  const q = category ? `?category=${encodeURIComponent(category)}` : '';
  return request(`/api/precedent${q}`, undefined, r =>
    r && r.fill && r.closure ? (r as Precedent) : undefined);
}

// ---------------------------------------------------------------------------
// POSITION — the user's derived position in time (decay / missed / open).
// Every number is derived from real rows on read; nothing is stored.
// ---------------------------------------------------------------------------
export interface PositionExpiringQuote {
  quoteId: string;
  requestId: string;
  title: string;
  validUntil: string | null;
  hoursLeft: number;
}
export interface PositionWaitlist {
  entryId: string;
  campaignId: string;
  campaignTitle: string;
  position: number | null;
  status: string;
  offerExpiresAt: string | null;
  hoursLeft: number | null;
}
export interface OfferValue {
  minor: number;
  amount: number;
  currency: string;
}
export interface PositionMissed {
  requestId: string;
  title: string;
  at: string | null;
  /** MY OWN declined offer's derived total, or null when it carried no price. */
  value: OfferValue | null;
  evidence?: { table: string; id: string };
}
export interface PositionMissedValue {
  amount: number;
  currency: string;
  over: string;
  sampleCount: number;
}
export interface PositionNextMove {
  requestId: string;
  title: string;
  category: string | null;
  location: string | null;
  quantity: number | null;
  unit: string | null;
  currency: string;
  severityLabel: string;
  matchCount: number;
  collective: boolean;
  openedAt: string | null;
  ageHours: number | null;
  /** The requester's own stated date, present only while it is still ahead. */
  requiredBy: string | null;
  hoursUntilRequiredBy: number | null;
  myQuote: {
    quoteId: string;
    status: string;
    offerValue: OfferValue | null;
    validUntil: string | null;
    hoursLeft: number | null;
  } | null;
  precedent: {
    closedInWindow: number;
    windowDays: number;
    avgHoursToFill: number | null;
    avgValue: { amount: number; currency: string; sampleCount: number } | null;
  };
  why: string;
  evidence: { table: string; id: string };
}
export interface PositionOpenGap {
  requestId: string;
  title: string;
  category: string | null;
  location: string | null;
  severityLabel: string;
  collective: boolean;
  /** Real precedent: how many requests in this category closed lately (null = never). */
  closesMonthly: number | null;
}
export interface MyPosition {
  decay: {
    expiringQuotes: PositionExpiringQuote[];
    waitlist: PositionWaitlist[];
    overdueInstallments: number;
  };
  missedCapture: {
    count: number;
    recent: PositionMissed[];
    /** Sum of my own declined offers' real totals in the window (null = none). */
    value: PositionMissedValue | null;
  };
  /** The one move worth making, chosen from real rows. null = nothing open. */
  nextMove: PositionNextMove | null;
  open: {
    total: number;
    top: PositionOpenGap[];
  };
  derivedAt: string;
  note: string;
}
export function getMyPosition(): Promise<ApiResult<MyPosition>> {
  return request('/api/me/position', undefined, r =>
    r?.position && r.position.decay && r.position.missedCapture && r.position.open
      ? (r.position as MyPosition)
      : undefined);
}

// ---------------------------------------------------------------------------
// COMMITMENTS — the derived reciprocal-obligation graph (owed to me / I owe).
// ---------------------------------------------------------------------------
export interface Commitment {
  id: string;
  kind: 'quote_honor' | 'delivery' | 'payment' | 'repayment';
  fromParty: string | null;
  toParty: string | null;
  value: { amount: number; currency: string } | null;
  deadline: string | null;
  status: 'open' | 'fulfilled' | 'lapsed';
  evidence: { table: string; id: string };
}
export interface MyCommitments {
  owedByMe: Commitment[];
  owedToMe: Commitment[];
  fulfilled: Commitment[];
  lapsed: Commitment[];
  owedByMeKes: number;
  owedToMeKes: number;
  derivedAt: string;
  note: string;
}
export function getMyCommitments(): Promise<ApiResult<MyCommitments>> {
  return request('/api/me/commitments', undefined, r =>
    r?.commitments && Array.isArray(r.commitments.owedByMe) && Array.isArray(r.commitments.owedToMe)
      ? (r.commitments as MyCommitments)
      : undefined);
}

// ---------------------------------------------------------------------------
// RECIPROCITY — the derived social-debt ledger (who went out of their way).
// ---------------------------------------------------------------------------
export interface ReciprocityEntry {
  id: string;
  kind: 'loan_guarantee' | 'recommendation' | 'delivery_cover';
  fromParty: string | null;
  toParty: string | null;
  value: { amount: number; currency: string } | null;
  status: 'open' | 'fulfilled';
  createdAt: string;
  fulfilledAt: string | null;
  evidence: { table: string; id: string };
  ageDays?: number;
}
export interface MyReciprocity {
  owedToMe: ReciprocityEntry[];
  owedByMe: ReciprocityEntry[];
  fulfilled: ReciprocityEntry[];
  aging: ReciprocityEntry[];
  windowDays: number;
  derivedAt: string;
  note: string;
}
export function getMyReciprocity(): Promise<ApiResult<MyReciprocity>> {
  return request('/api/me/reciprocity', undefined, r =>
    r?.reciprocity && Array.isArray(r.reciprocity.owedToMe) && Array.isArray(r.reciprocity.owedByMe)
      ? (r.reciprocity as MyReciprocity)
      : undefined);
}

// ---------------------------------------------------------------------------
// LIPA MDOGO — the member's own contracts + derived maturity (#3).
// ---------------------------------------------------------------------------
export interface LipaMdogoSchedule {
  index: number;
  dueDate: string;
  amountDue: number;
  paid: number;
  state: 'pending' | 'paid' | 'overdue';
}
export interface LipaMdogoContract {
  id: string;
  status: string;
  asset: { deviceId: string; name: string | null; totalValue: number; downPayment: number; financed: number; termMonths: number };
  lender: { id: string; key: string; name: string };
  vendorId: string | null;
  customerId: string;
  onboardingRiderId: string | null;
  schedule: LipaMdogoSchedule[];
  summary: { totalFinanced: number; totalPaid: number; remaining: number; paidCount: number; overdueCount: number; matured: boolean };
  maturity: 'started' | 'paying' | 'overdue' | 'matured';
  note: string;
}
export function getMyLipaMdogo(): Promise<ApiResult<LipaMdogoContract[]>> {
  return request('/api/me/lipa-mdogo', undefined, r =>
    Array.isArray(r?.contracts) ? r.contracts : undefined);
}

// ---------------------------------------------------------------------------
// TABLE BANKING — the table-banking ledger + calculator (tool for existing groups).
// ---------------------------------------------------------------------------
export interface TableBankingSummary {
  id: string;
  name: string;
  contributionAmount: number;
  welfareContributionAmount: number;
  currency: string;
  members: number;
  cashOnHand: number;
  totalContributed: number;
  totalPaidOut: number;
  loanedOut: number;
  totalRepaid: number;
  nextRecipient: string | null;
  nextRecipientName: string | null;
  membersNotYetContributed: string[];
  membersNotYetReceived: string[];
  activeLoans: Array<{ id: string; borrowerId: string; principal: number; ratePercent: number; remaining: number }>;
  note: string;
}
export interface TableBankingGroup {
  id: string;
  name: string;
  ownerId: string;
  contributionAmount: number;
  welfareContributionAmount: number;
  currency: string;
  cycleDays: number;
  status: string;
  members: Array<{ userId: string; joinedAt: string }>;
  summary?: TableBankingSummary;
}
export interface TableBankingRotation {
  order: Array<{ userId: string; handle: string | null; displayName: string | null; isCurrent: boolean; received: boolean }>;
  currentIndex: number;
  currentMemberId: string | null;
  nextMemberId: string | null;
  note: string;
}
export interface TableBankingMe {
  memberId: string;
  contributedKes: number;
  contributedCount: number;
  receivedKes: number;
  isNext: boolean;
  owesKes: number;
  loans: Array<{ id: string; remaining: number; status: string }>;
}
export interface TableBankingDetail {
  group: TableBankingGroup;
  summary: TableBankingSummary;
  rotation: TableBankingRotation;
  me: TableBankingMe;
}
export function getMyTableBanking(): Promise<ApiResult<TableBankingGroup[]>> {
  return request('/api/me/table-banking', undefined, r => Array.isArray(r?.groups) ? r.groups : undefined);
}
export function getTableBanking(id: string): Promise<ApiResult<TableBankingDetail>> {
  return request(`/api/table-banking/${encodeURIComponent(id)}`, undefined, r =>
    r?.group && r?.summary && r?.rotation ? r : undefined);
}
/** Archive a group (owner-only). Not a delete — history is permanent. Refused
 *  while a loan is outstanding or a payout is pending. */
export function archiveTableBanking(id: string): Promise<ApiResult<TableBankingGroup>> {
  return request(`/api/table-banking/${encodeURIComponent(id)}/archive`, { method: 'POST', body: '{}' }, r =>
    r?.group?.id ? r.group : undefined);
}
export interface TableBankingTemplate {
  id: string;
  label: string;
  description: string;
  defaults: { contributionAmount: number; welfareContributionAmount: number; cycleDays: number; latePenaltyKes: number };
}
export function getTableBankingTemplates(): Promise<ApiResult<TableBankingTemplate[]>> {
  return request('/api/table-banking/templates', undefined, r => Array.isArray(r?.templates) ? r.templates : undefined);
}
export function createTableBanking(body: { name: string; contributionAmount?: number; currency?: string; cycleDays?: number; latePenaltyKes?: number; welfareContributionAmount?: number; template?: string | null }): Promise<ApiResult<TableBankingGroup>> {
  return request('/api/table-banking', { method: 'POST', body: JSON.stringify(body) }, r => r?.group ? r.group : undefined);
}
export function joinTableBanking(id: string): Promise<ApiResult<TableBankingGroup>> {
  return request(`/api/table-banking/${encodeURIComponent(id)}/join`, { method: 'POST', body: '{}' }, r => r?.group ? r.group : undefined);
}
export function recordTableBankingContribution(id: string, body: { amount: number; receiptHash?: string | null; idempotencyKey?: string }): Promise<ApiResult<{ contribution: any; summary: TableBankingSummary }>> {
  return request(`/api/table-banking/${encodeURIComponent(id)}/contributions`, { method: 'POST', body: JSON.stringify(body) }, r => r?.contribution ? r : undefined);
}
export function advanceTableBankingTurn(id: string): Promise<ApiResult<{ rotation: TableBankingRotation }>> {
  return request(`/api/table-banking/${encodeURIComponent(id)}/rotate`, { method: 'POST', body: '{}' }, r => r?.rotation ? r : undefined);
}
export function applyTableBankingLoan(id: string, body: { principal: number; interestType?: 'flat' | 'reducing_balance'; ratePercent?: number; termMonths: number; guarantorsRequired?: number }): Promise<ApiResult<{ loan: any; schedule: any }>> {
  return request(`/api/table-banking/${encodeURIComponent(id)}/loans`, { method: 'POST', body: JSON.stringify(body) }, r => r?.loan ? r : undefined);
}
export function repayTableBankingLoan(loanId: string, body: { amount: number; receiptHash?: string | null; idempotencyKey?: string }): Promise<ApiResult<{ repayment: any; balance: any }>> {
  return request(`/api/table-banking-loans/${encodeURIComponent(loanId)}/repay`, { method: 'POST', body: JSON.stringify(body) }, r => r?.repayment ? r : undefined);
}

// Collective demand — a group places a bulk Request riding the economic chain.
export interface TableBankingCollectiveRequest {
  id: string;
  tableBankingId: string;
  requestId: string;
  placedBy: string;
  aggregateQuantity: number;
  memberBreakdown: Array<{ memberId?: string; name?: string; quantity: number }>;
  placedAt: string;
  request: any | null;
}
export function getTableBankingCollectiveRequests(id: string): Promise<ApiResult<TableBankingCollectiveRequest[]>> {
  return request(`/api/table-banking/${encodeURIComponent(id)}/requests`, undefined, r => Array.isArray(r?.collective) ? r.collective : undefined);
}
export function placeTableBankingCollectiveRequest(id: string, body: Record<string, unknown>): Promise<ApiResult<{ request: any; collective: TableBankingCollectiveRequest }>> {
  return request(`/api/table-banking/${encodeURIComponent(id)}/requests`, { method: 'POST', body: JSON.stringify(body) }, r => r?.request?.id ? r : undefined);
}

// --- WELFARE FUND — the group's own earmarked emergency pool -----------------
// Not insurance: the group's money, paid out by the group's vote. The fund
// balance is DERIVED (contributions minus approved claims), never stored.
export interface WelfareFund {
  tableBankingId: string;
  totalContributed: number;
  paidOut: number;
  balance: number;
  claimCount: number;
  pendingClaims: number;
  note: string;
}
export interface WelfareClaim {
  id: string;
  tableBankingId: string;
  claimantId: string;
  reason: string;
  amount: number;
  status: 'pending' | 'approved' | 'declined';
  votes: Array<{ voterId: string; approve: boolean; at: string }>;
  createdAt: string;
  updatedAt: string;
}
export function getWelfareFund(id: string): Promise<ApiResult<{ fund: WelfareFund; claims: WelfareClaim[] }>> {
  return request(`/api/table-banking/${encodeURIComponent(id)}/welfare`, undefined, r =>
    r?.fund && Array.isArray(r?.claims) ? r : undefined);
}
export function recordWelfareContribution(id: string, body: { amount: number; receiptHash?: string | null; idempotencyKey?: string }): Promise<ApiResult<{ contribution: any; fund: WelfareFund }>> {
  return request(`/api/table-banking/${encodeURIComponent(id)}/welfare/contributions`, { method: 'POST', body: JSON.stringify(body) }, r => r?.contribution ? r : undefined);
}
export function fileWelfareClaim(id: string, body: { reason: string; amount: number }): Promise<ApiResult<{ claim: WelfareClaim; fund: WelfareFund }>> {
  return request(`/api/table-banking/${encodeURIComponent(id)}/welfare/claims`, { method: 'POST', body: JSON.stringify(body) }, r => r?.claim?.id ? r : undefined);
}
export function voteOnWelfareClaim(id: string, claimId: string, approve: boolean): Promise<ApiResult<{ claim: WelfareClaim; fund: WelfareFund }>> {
  return request(`/api/table-banking/${encodeURIComponent(id)}/welfare/claims/${encodeURIComponent(claimId)}/vote`, { method: 'POST', body: JSON.stringify({ approve }) }, r => r?.claim?.id ? r : undefined);
}

// --- MEETING MINUTES — the group's own record of decisions ------------------
export interface TableBankingMinutes {
  id: string;
  tableBankingId: string;
  authorId: string;
  title: string;
  body: string;
  decisions: string[] | null;
  actionItems: string[] | null;
  heldAt: string;
  createdAt: string;
}
export function getTableBankingMinutes(id: string): Promise<ApiResult<TableBankingMinutes[]>> {
  return request(`/api/table-banking/${encodeURIComponent(id)}/minutes`, undefined, r => Array.isArray(r?.minutes) ? r.minutes : undefined);
}
export function recordTableBankingMinutes(id: string, body: { title: string; body: string; decisions?: string[] | null; actionItems?: string[] | null; heldAt?: string | null }): Promise<ApiResult<TableBankingMinutes>> {
  return request(`/api/table-banking/${encodeURIComponent(id)}/minutes`, { method: 'POST', body: JSON.stringify(body) }, r => r?.minutes?.id ? r.minutes : undefined);
}

// --- JOIN INVITES — the treasurer adds a member by phone --------------------
export interface TableBankingInvite {
  id: string;
  tableBankingId: string;
  inviterId: string;
  phone: string;
  name: string | null;
  code: string;
  status: 'pending' | 'accepted';
  message?: string;
  createdAt: string;
  acceptedAt: string | null;
}
export function listTableBankingInvites(id: string): Promise<ApiResult<TableBankingInvite[]>> {
  return request(`/api/table-banking/${encodeURIComponent(id)}/invites`, undefined, r => Array.isArray(r?.invites) ? r.invites : undefined);
}
export function issueJoinInvite(id: string, body: { phone: string; name?: string | null; channel?: 'sms' | 'whatsapp' }): Promise<ApiResult<{ invite: TableBankingInvite; delivery: { ok: boolean; reason?: string } }>> {
  return request(`/api/table-banking/${encodeURIComponent(id)}/invites`, { method: 'POST', body: JSON.stringify(body) }, r => r?.invite?.id ? r : undefined);
}

// --- QUOTE VOTES — the group decides which quote to accept ------------------
export interface GroupQuote {
  quoteId: string;
  requestId: string;
  requestTitle: string;
  requesterId: string;
  status: string;
  vote: { approveCount: number; declineCount: number; total: number };
  quorum: number;
}
export function listTableBankingQuotes(id: string): Promise<ApiResult<GroupQuote[]>> {
  return request(`/api/table-banking/${encodeURIComponent(id)}/quotes`, undefined, r => Array.isArray(r?.quotes) ? r.quotes : undefined);
}
export function voteOnTableBankingQuote(id: string, quoteId: string, approve: boolean): Promise<ApiResult<{ approveCount: number; declineCount: number; total: number }>> {
  return request(`/api/table-banking/${encodeURIComponent(id)}/quotes/${encodeURIComponent(quoteId)}/vote`, { method: 'POST', body: JSON.stringify({ approve }) }, r => typeof r?.vote?.approveCount === 'number' ? r.vote : undefined);
}

// --- TREASURER DASHBOARD — the owner's single derived view ------------------
// ---------------------------------------------------------------------------
// COOPERATIVE OPERATIONS — the operator's read on a group (pool + the group's
// own demand + what settled in Brief). Everything is derived from rows the
// group wrote; the payload also states, in `unavailable`, the figures it will
// not produce. The client renders what came back and adds nothing.
// ---------------------------------------------------------------------------
export interface CoopOperationItem {
  requestId: string;
  placedAt: string | null;
  title: string;
  status: string;
  open: boolean;
  quantity: number | null;
  unit: string | null;
  category: string | null;
  location: string | null;
  quotes: number;
  accepted: boolean;
  acceptedValueKes: number | null;
  acceptedValueCurrency: string | null;
  closedAt: string | null;
}
export interface CoopOperations {
  id: string;
  name: string;
  status: string;
  currency: string;
  cycleDays: number | null;
  members: number;
  callerRole: 'owner' | 'member';
  pool: {
    cashOnHand: number; totalContributed: number; totalPaidOut: number;
    loanedOut: number; totalRepaid: number; perCycle: number; welfarePerCycle: number;
    activeLoans: number; outstandingLoansKes: number; nextRecipientName: string | null;
    notYetContributed: number; notYetReceived: number;
  };
  collective: {
    placed: number; open: number; quoted: number; accepted: number;
    byStatus: Record<string, number>; windowDays: number; items: CoopOperationItem[];
  };
  settledThroughBrief: {
    settlements: number; settledKes: number | null; currency: string | null;
    workOrders: number; workOrdersCompleted: number; windowDays: number; latestAt: string | null;
  };
  memberBusiness: {
    visible: boolean;
    reason: string;
    rows: Array<{
      userId: string; displayName: string | null; joinedAt: string | null;
      publicSpaces: Array<{ id: string; name: string; slug: string | null; liveOffers: number; maintenanceState: string; openItems: number }>;
      noPublicShopfront: string | null;
    }>;
  };
  unavailable: Array<{ key: string; label: string; reason: string }>;
  benchmark: null;
  derivedAt: string;
  note: string;
}
export function getCoopOperations(id: string): Promise<ApiResult<CoopOperations>> {
  return request<CoopOperations>(`/api/table-banking/${encodeURIComponent(id)}/operations`, undefined, (r) =>
    r && r.operations && r.operations.pool ? (r.operations as CoopOperations) : undefined);
}

export interface TreasurerDashboard {
  group: { id: string; name: string };
  summary: TableBankingSummary;
  rotation: { currentMemberId: string | null; nextMemberId: string | null; order: Array<{ userId: string; handle: string | null; displayName: string | null; isCurrent: boolean; received: boolean }> };
  members: Array<{ userId: string; handle: string | null; displayName: string | null; contributed: boolean; received: boolean; owesKes: number }>;
  activeLoans: Array<{ id: string; borrowerId: string; remaining: number; ratePercent: number }>;
  welfare: WelfareFund;
  pendingInvites: number;
  note: string;
}
export function getTreasurerDashboard(id: string): Promise<ApiResult<TreasurerDashboard>> {
  return request(`/api/table-banking/${encodeURIComponent(id)}/treasurer`, undefined, r => r?.dashboard?.summary ? r.dashboard : undefined);
}

// --- PDF EXPORT — minutes as a download (auth via Bearer, not a plain link) -
export async function downloadMinutesPdf(id: string): Promise<{ ok: true; blob: Blob } | { ok: false; error: string }> {
  const token = getSessionToken();
  const res = await fetch(`/api/table-banking/${encodeURIComponent(id)}/minutes.pdf`, {
    headers: token ? { authorization: `Bearer ${token}` } : undefined
  });
  if (!res.ok) {
    let msg = 'Could not export minutes.';
    try { const j = await res.json(); msg = j?.error ?? msg; } catch { /* non-JSON error body */ }
    return { ok: false, error: msg };
  }
  const blob = await res.blob();
  return { ok: true, blob };
}

// ---------------------------------------------------------------------------
// ROLES + INVITES — the membership hierarchy's authority surface.
// ---------------------------------------------------------------------------

/** The caller's own active role assignments (authority, not attribution). */
export function getMyRoles(): Promise<ApiResult<RoleAssignment[]>> {
  return request('/api/me/roles', undefined, (r) =>
    Array.isArray(r?.roles) ? (r.roles as RoleAssignment[]) : undefined);
}

/** Issue a scoped, expiring invite. The server enforces role breadth. */
export function issueInvite(input: IssueInviteInput): Promise<ApiResult<Invite>> {
  return request('/api/invites', { method: 'POST', body: JSON.stringify(input) }, (r) =>
    r?.invite?.code ? (r.invite as Invite) : undefined);
}

/** Redeem an invite — binds the scoped role and captures first-touch attribution. */
export function redeemInvite(code: string, attributionContext?: Record<string, string>): Promise<ApiResult<RedeemInviteResult>> {
  return request('/api/invites/redeem', { method: 'POST', body: JSON.stringify({ code, attributionContext: attributionContext ?? {} }) }, (r) =>
    r?.role?.role ? (r as RedeemInviteResult) : undefined);
}

// ---------------------------------------------------------------------------
// THE MORNING BRIEF — the owner's own read of a past day.
//
// Three calls and no writer except one: the owner's preference. The figures come
// from /api/shop-brief, which reads the rows on every request, so a "day" here
// can be any day the rows reach back to — there is nothing to re-run and no
// report to keep fresh.
// ---------------------------------------------------------------------------

/** A named day, or yesterday when none is given. */
export function getShopBrief(day?: string | null): Promise<ApiResult<ShopBrief>> {
  const q = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? `?day=${day}` : '';
  return request<ShopBrief>(`/api/shop-brief${q}`, undefined, (r) =>
    r && r.brief && typeof r.brief.empty === 'boolean' ? (r.brief as ShopBrief) : undefined);
}

export function getShopBriefPrefs(): Promise<ApiResult<ShopBriefPrefs>> {
  return request<ShopBriefPrefs>('/api/shop-brief/prefs', undefined, (r) =>
    r && r.prefs && typeof r.prefs.enabled === 'boolean' ? (r.prefs as ShopBriefPrefs) : undefined);
}

/**
 * Ask to be told, at an hour you name. The server refuses an enabled brief with
 * no hour, so a screen cannot save the app's own suggestion as somebody's choice.
 */
export function setShopBriefPrefs(input: { enabled: boolean; hour?: number | null }): Promise<ApiResult<ShopBriefPrefs>> {
  return request<ShopBriefPrefs>('/api/shop-brief/prefs', {
    method: 'PUT',
    body: JSON.stringify(input)
  }, (r) => (r && r.prefs ? (r.prefs as ShopBriefPrefs) : undefined));
}

export interface ShopTeamView {
  permissions?: { readCatalog: boolean; editBrand: boolean; manageTeam: boolean; manageMoney: boolean };
  shop: { id: string; name: string; goal: string; image: string | null };
  role: 'owner' | 'manager' | 'staff';
  roster: Array<{ userId: string; name: string; handle: string | null; role: string }>;
  offers: Array<{ id: string; title: string; price: number; currency: string; status: string }>;
}
export function getMyShopTeams(): Promise<ApiResult<{ shops: Array<{ id: string; name: string; image: string | null; role: string }> }>> {
  return request('/api/shop-teams', undefined, r => r && Array.isArray(r.shops) ? r : undefined);
}
export function getShopTeam(id: string): Promise<ApiResult<ShopTeamView>> {
  return request(`/api/spaces/${encodeURIComponent(id)}/team`, undefined, r => r && r.shop && Array.isArray(r.roster) ? r : undefined);
}
export function setShopTeamMember(id: string, handle: string, role: string): Promise<ApiResult<ShopTeamView>> {
  return request(`/api/spaces/${encodeURIComponent(id)}/team/members`, {method:'POST',body:JSON.stringify({handle,role})}, r => r && r.shop && Array.isArray(r.roster) ? r : undefined);
}
export function editShopTeamBrand(id: string, patch: {name: string; goal: string; image: string | null}): Promise<ApiResult<ShopTeamView>> {
  return request(`/api/spaces/${encodeURIComponent(id)}/team/brand`, {method:'PATCH',body:JSON.stringify(patch)}, r => r && r.shop && Array.isArray(r.roster) ? r : undefined);
}

export function getSpaceModes(): Promise<ApiResult<SpaceMode[]>> {
  return request('/api/public/spaces?limit=1', undefined, r => Array.isArray(r?.modes) ? r.modes : undefined);
}

// Public-page moderation is separate from object/source trust reports.
export interface SpaceModerationQueue {
  reports: Array<{ id: string; spaceId: string; spaceName: string; slug: string | null; reason: string; createdAt: string; outcome: 'pending' | 'upheld' | 'dismissed'; handledAt: string | null; handledBy: string | null; moderationReason: string | null; canReview: boolean }>;
  hiddenPages: Array<{ id: string; name: string; slug: string; status: string; holdId: string; hiddenAt: string; canReinstate: boolean }>;
}
export interface SpaceModerationResult {
  actionId: string; spaceId: string; visibility: string; replayed: boolean;
  outcome?: 'upheld' | 'dismissed'; handledAt?: string; reinstatedAt?: string;
}
export function getSpaceModerationQueue(): Promise<ApiResult<SpaceModerationQueue>> {
  return request('/api/ops/space-reports', undefined, r => Array.isArray(r?.reports) && Array.isArray(r?.hiddenPages) ? r as SpaceModerationQueue : undefined);
}
export function reviewSpaceReport(id: string, outcome: 'upheld' | 'dismissed', reason: string, key: string): Promise<ApiResult<SpaceModerationResult>> {
  return request(`/api/ops/space-reports/${encodeURIComponent(id)}/review`, { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify({ outcome, reason }) }, r => typeof r?.actionId === 'string' ? r as SpaceModerationResult : undefined);
}
export function reinstateSpacePage(id: string, holdId: string, reason: string, key: string): Promise<ApiResult<SpaceModerationResult>> {
  return request(`/api/ops/spaces/${encodeURIComponent(id)}/reinstate-page`, { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify({ holdId, reason }) }, r => typeof r?.actionId === 'string' ? r as SpaceModerationResult : undefined);
}

export interface PurposeWorkspace {
  id: string; groupId: string; purpose: 'table_banking' | 'group_buy' | 'events'; name: string; state: string;
  owner: boolean; participation: string; resourceId: string | null; nativeState: string | null;
  config: Record<string, string | number> | null; lifecycle: string[];
  requests: Array<{id: string; userId: string; handle: string}>;
  event?: { title: string; description: string; startsAt: string; endsAt: string; location: string; price: number; publicSlug: string | null } | null;
  buy?: { title: string; stage: string; targetAmount: number; total: number | null; contributions: Array<{id: string; memberRef: string; amount: number; receiptHash: string}>; history: Array<{stage: string; at: string; note: string}> };
  registration?: {id: string; status: string; ticketCode: string} | null;
  registrations?: Array<{id: string; name: string; status: string; ticketCode: string}>;
}
export function getGroupWorkspaces(id: string): Promise<ApiResult<{ purposes: string[]; canCreate: boolean; workspaces: PurposeWorkspace[] }>> {
  return request(`/api/groups/${encodeURIComponent(id)}/workspaces`, undefined, r => Array.isArray(r?.workspaces) ? r : undefined);
}
export function createGroupWorkspace(id: string, body: {purpose: string; name: string; requestId: string}): Promise<ApiResult<PurposeWorkspace>> {
  return request(`/api/groups/${encodeURIComponent(id)}/workspaces`, { method: 'POST', body: JSON.stringify(body) }, r => r?.workspace?.id ? r.workspace : undefined);
}
export function getPurposeWorkspace(id: string): Promise<ApiResult<PurposeWorkspace>> {
  return request(`/api/group-workspaces/${encodeURIComponent(id)}`, undefined, r => r?.workspace?.id ? r.workspace : undefined);
}
export function workspaceCommand(id: string, command: 'setup' | 'activate' | 'participation' | 'participation/decide' | 'actions', body: Record<string, unknown> = {}): Promise<ApiResult<PurposeWorkspace>> {
  return request(`/api/group-workspaces/${encodeURIComponent(id)}/${command}`, { method: command === 'setup' ? 'PATCH' : 'POST', body: JSON.stringify(body) }, r => r?.workspace?.id ? r.workspace : undefined);
}

export function requestGroupAdmission(id: string): Promise<ApiResult<{ requested: boolean }>> {
  return request(`/api/groups/${encodeURIComponent(id)}/admission`, { method: 'POST', body: '{}' }, r => r?.requested === true ? r : undefined);
}
export function groupAdmissions(id: string): Promise<ApiResult<Array<{ id: string; handle: string; createdAt: string }>>> {
  return request(`/api/groups/${encodeURIComponent(id)}/admission`, undefined, r => Array.isArray(r?.requests) ? r.requests : undefined);
}
export function decideGroupAdmission(groupId: string, id: string, approve: boolean, reason: string): Promise<ApiResult<unknown>> {
  return request(`/api/groups/${encodeURIComponent(groupId)}/admission/decide`, { method: 'POST', body: JSON.stringify({ id, approve, reason }) });
}

// ---------------------------------------------------------------------------
// WORKFORCE — a distributed team run from phones (docs/WORKFORCE.md).
//
// Every number here is served by the server and derived from rows: earnings,
// counts, progress and money. The client never sends a fee, a worker id or an
// owner id — identity is the session, and the price of work is the program's
// frozen rate card. Workforce writes are never replayed from the offline
// queue: a claim or a proof submitted twice later is not the same act.
// ---------------------------------------------------------------------------
export type WorkMode = 'home' | 'field';
export interface WorkTemplateField { key: string; label: string; kind: 'text' | 'phone' | 'number' | 'yesno'; required: boolean }
export interface WorkTemplateStep {
  index: number; key: string; label: string; mode: WorkMode; share: number; hours: number; brief: string;
  fields: WorkTemplateField[]; photosMin: number; gps: boolean; consent: boolean;
  gate: { field: string; equals: string; closedAs: string } | null;
}
export interface WorkTemplate { key: string; label: string; summary: string; subjectKind: string; unitNoun: string; mode: WorkMode | 'hybrid'; steps: WorkTemplateStep[] }
export interface WorkTerms { version: string; lines: string[] }
export interface WorkRateCard { currency: 'KES'; unitPriceKes: number; feeBps: number; briefFeeKes: number; workerPoolKes: number; steps: Array<{ key: string; label: string; mode: WorkMode; share: number; feeKes: number }> }
export interface WorkProgramHeadline {
  id: string; workforceId: string; workforceName: string | null; title: string; objective: string;
  templateKey: string; templateLabel: string; unitNoun: string; mode: WorkMode | 'hybrid';
  audience: 'workforce' | 'network'; status: 'draft' | 'open' | 'paused' | 'closed'; deadline: string;
  target: number; unitPriceKes: number; rateCard: WorkRateCard;
  territories: Array<{ id: string; name: string; quota: number | null }>; revision: number;
}
export interface WorkProgramCounts { target: number; inProgress: number; awaitingReview: number; approved: number; rejected: number; notConverted: number; abandoned: number; remaining: number }
export interface WorkProgramMoney { currency: 'KES'; committedKes: number; verifiedKes: number; remainingKes: number; workerKes: number; briefFeeKes: number; note: string }
export interface WorkProgramSummary extends WorkProgramHeadline { counts: WorkProgramCounts; progressPct: number; money: WorkProgramMoney }
export interface WorkProgramDashboard {
  program: WorkProgramHeadline; counts: WorkProgramCounts; progressPct: number; money: WorkProgramMoney;
  funnel: Array<{ stepKey: string; label: string; mode: WorkMode; open: number; assigned: number; submitted: number; approved: number; rejected: number }>;
  coverage: Array<{ territoryId: string; name: string; quota: number | null; approved: number; inProgress: number }>;
  results: Array<{ unitId: string; subjectLabel: string | null; territory: string | null; approvedAt: string }>;
}
export interface WorkCheck { key: string; label: string; status: 'pass' | 'flag' | 'not_checked'; detail: string }
export interface WorkReview { decision: 'approve' | 'return' | 'reject'; reason: string | null; by: string; at: string }
export interface WorkTaskView {
  id: string; status: 'open' | 'assigned' | 'submitted' | 'approved' | 'rejected' | 'released';
  stepIndex: number; stepCount: number; step: WorkTemplateStep; feeKes: number;
  program: { id: string; title: string; templateLabel: string; unitNoun: string; deadline: string; workforceName: string | null };
  territory: { id: string; name: string | null } | null; unitStatus: string; subjectLabel: string | null;
  subject: Record<string, string | number> | null; assignedAt: string | null; dueAt: string | null; returns: number;
  lastReview: WorkReview | null; lastProof: { id: string; attempt: number; submittedAt: string; checks: WorkCheck[]; flags: number } | null;
  reasons?: string[];
}
export interface WorkChecklistItem { key: string; label: string; done: boolean; detail: string }
export interface WorkChecklist { items: WorkChecklistItem[]; readyForActivation: boolean; complete: boolean; doneCount: number; total: number }
export interface WorkerProfile {
  id: string; userId: string; displayName: string; phone: string; modes: WorkMode[];
  device: { smartphone: boolean; gps: boolean }; areas: string[]; languages: string[]; availableDays: number[];
  termsAcceptedVersion: string | null; termsAcceptedAt: string | null; briefings: Array<{ templateKey: string; at: string }>;
}
export interface WorkRecordRow { templateKey: string; templateLabel: string; submitted: number; approved: number; rejected: number; returned: number; inReview: number; decided: number; statement: string; steps: Array<{ stepKey: string; stepLabel: string; approved: number; rejected: number }> }
export interface WorkTrackRecord { userId: string; byTemplate: WorkRecordRow[]; lastActiveAt: string | null; note: string }
export interface WorkEarningsRow { taskId: string; programId: string; programTitle: string; stepLabel: string; subjectLabel: string | null; feeKes: number; state: 'payable' | 'awaiting_outcome' | 'outcome_failed'; unitStatus: string; closedReason: string | null; approvedAt: string; week: string | null; settlementId: string | null; settlementStatus: 'pending' | 'confirmed' | null }
export interface WorkEarnings { currency: 'KES'; rows: WorkEarningsRow[]; weeks: Array<{ week: string; tasks: number; kes: number; unsettledTasks: number; unsettledKes: number; settlements: Array<{ id: string; status: string; amountKes: number }> }>; payableKes: number; awaitingOutcomeKes: number; unsettledKes: number; confirmedKes: number; note: string }
export interface WorkAvailable {
  program: WorkProgramHeadline; firstStep: { label: string; mode: WorkMode; feeKes: number; hours: number };
  remaining: number; eligible: boolean; reasons: string[]; blockers: string[];
  territories: Array<{ id: string; name: string; remaining: number }>;
}
export interface WorkMembership { id: string; name: string; description: string; role: 'owner' | 'supervisor' | 'worker'; status: string; memberId: string | null; joinCode: string | null; onboarding?: WorkChecklist | null; territories?: string[] }
export interface WorkerHome {
  profile: WorkerProfile | null; terms: WorkTerms; memberships: WorkMembership[];
  available: WorkAvailable[]; openSteps: WorkTaskView[]; held: WorkTaskView[]; inReview: WorkTaskView[]; recent: WorkTaskView[];
  today: { submitted: number; approved: number; inReview: number; earnedKes: number };
  earnings: WorkEarnings; record: WorkTrackRecord; limits: { maxHeld: number; maxBatch: number };
}
export interface WorkTerritory { id: string; workforceId: string; name: string; areas: string[]; center: { lat: number; lng: number } | null; radiusKm: number | null; status: string; members: number; approved: number; inProgress: number }
export interface WorkRosterMember {
  memberId: string; userId: string; name: string; handle: string | null; phone: string | null; modes: WorkMode[];
  device: { smartphone: boolean; gps: boolean } | null; role: 'worker' | 'supervisor'; status: 'applied' | 'active' | 'suspended';
  territoryIds: string[]; territories: string[]; supervisorId: string | null; supervisorName: string | null;
  appliedAt: string; activatedAt: string | null; onboarding: WorkChecklist;
  history: Array<{ at: string; actorId: string; action: string; note?: string }>; record: WorkTrackRecord;
}
export interface WorkforceDesk {
  workforce: { id: string; name: string; description: string; joinCode: string | null; partnerId: string | null };
  role: 'owner' | 'supervisor'; territories: WorkTerritory[]; members: WorkRosterMember[];
  counts: { applied: number; readyToActivate: number; active: number; suspended: number; awaitingReview: number };
  programs: WorkProgramSummary[]; templates: WorkTemplate[];
}
export interface WorkProof {
  id: string; taskId: string; attempt: number; fields: Record<string, string | number>; photos: string[];
  location: { lat: number; lng: number; accuracyM: number | null } | null;
  consent: { given: boolean; name: string; words: string | null } | null; note: string | null;
  checks: WorkCheck[]; flags: number; submittedAt: string; review: WorkReview | null;
}
export interface WorkReviewItem {
  taskId: string; programId: string; programTitle: string; templateLabel: string; stepLabel: string; stepIndex: number; stepCount: number;
  mode: WorkMode; fields: Array<{ key: string; label: string }>; worker: { userId: string; name: string; record: string };
  ownSubmission: boolean; territory: string | null; subjectBefore: Record<string, string | number>; proof: WorkProof; previous: WorkReview[];
}
export interface WorkProofInput {
  fields: Record<string, string>; photos: string[];
  location: { lat: number; lng: number; accuracyM: number | null } | null;
  consent: { given: boolean; name: string; words?: string } | null; note?: string;
}
export interface WorkProgramInput {
  title: string; objective?: string; templateKey: string; target: number; unitPriceKes: number; deadline: string;
  audience: 'workforce' | 'network'; territoryIds: string[]; territoryTargets?: Record<string, number> | null;
}

const wid = (s: string) => encodeURIComponent(s);
const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body ?? {}) });

export function getWorkTemplates(): Promise<ApiResult<{ templates: WorkTemplate[]; terms: WorkTerms }>> {
  return request('/api/work-templates', undefined, (r) => (Array.isArray(r?.templates) ? r : undefined));
}
export function getWorkerHome(): Promise<ApiResult<WorkerHome>> {
  return request('/api/me/work', undefined, (r) => (Array.isArray(r?.available) ? (r as WorkerHome) : undefined));
}
export function saveWorkerProfile(body: Partial<Pick<WorkerProfile, 'displayName' | 'phone' | 'modes' | 'device' | 'areas' | 'availableDays' | 'languages'>>): Promise<ApiResult<WorkerProfile>> {
  return request('/api/me/work/profile', { method: 'PUT', body: JSON.stringify(body) }, (r) => r?.profile ?? undefined);
}
export function acceptWorkTerms(version: string): Promise<ApiResult<WorkerProfile>> {
  return request('/api/me/work/terms', post({ version }), (r) => r?.profile ?? undefined);
}
export function acknowledgeWorkBriefing(templateKey: string): Promise<ApiResult<WorkerProfile>> {
  return request('/api/me/work/briefings', post({ templateKey }), (r) => r?.profile ?? undefined);
}
export function joinWorkforce(code: string): Promise<ApiResult<{ id: string; status: string }>> {
  return request('/api/me/work/join', post({ code }), (r) => r?.membership ?? undefined);
}
export function claimWork(programId: string, body: { count: number; territoryId: string | null; idempotencyKey: string }): Promise<ApiResult<WorkTaskView[]>> {
  return request(`/api/work-programs/${wid(programId)}/claim`, post(body), (r) => (Array.isArray(r?.tasks) ? r.tasks : undefined));
}
export function acceptWorkTask(taskId: string): Promise<ApiResult<WorkTaskView>> {
  return request(`/api/work-tasks/${wid(taskId)}/accept`, post({}), (r) => r?.task ?? undefined);
}
export function submitWorkProof(taskId: string, body: WorkProofInput): Promise<ApiResult<{ proof: WorkProof; task: WorkTaskView }>> {
  return request(`/api/work-tasks/${wid(taskId)}/submit`, post(body), (r) => (r?.proof ? r : undefined));
}
export function releaseWorkTask(taskId: string, reason = ''): Promise<ApiResult<{ id: string }>> {
  return request(`/api/work-tasks/${wid(taskId)}/release`, post({ reason }), (r) => r?.task ?? undefined);
}
export function listMyWorkforces(): Promise<ApiResult<WorkMembership[]>> {
  return request('/api/workforces', undefined, (r) => (Array.isArray(r?.workforces) ? r.workforces : undefined));
}
export function createWorkforce(name: string, description = ''): Promise<ApiResult<{ id: string; name: string; joinCode: string }>> {
  return request('/api/workforces', post({ name, description }), (r) => r?.workforce ?? undefined);
}
export function getWorkforceDesk(id: string): Promise<ApiResult<WorkforceDesk>> {
  return request(`/api/workforces/${wid(id)}`, undefined, (r) => (r?.workforce ? (r as WorkforceDesk) : undefined));
}
export function createWorkTerritory(workforceId: string, body: { name: string; areas: string[]; lat?: number | null; lng?: number | null; radiusKm?: number | null }): Promise<ApiResult<WorkTerritory>> {
  return request(`/api/workforces/${wid(workforceId)}/territories`, post(body), (r) => r?.territory ?? undefined);
}
export function workforceMemberAction(workforceId: string, memberId: string, body: { action: string; territoryIds?: string[]; role?: string; reason?: string }): Promise<ApiResult<{ id: string; status: string }>> {
  return request(`/api/workforces/${wid(workforceId)}/members/${wid(memberId)}/actions`, post(body), (r) => r?.member ?? undefined);
}
export function createWorkProgram(workforceId: string, body: WorkProgramInput): Promise<ApiResult<WorkProgramHeadline>> {
  return request(`/api/workforces/${wid(workforceId)}/programs`, post(body), (r) => r?.program ?? undefined);
}
export function changeWorkProgramStatus(programId: string, action: 'publish' | 'pause' | 'resume' | 'close', revision: number): Promise<ApiResult<WorkProgramHeadline>> {
  return request(`/api/work-programs/${wid(programId)}/status`, post({ action, revision }), (r) => r?.program ?? undefined);
}
export function getWorkProgram(programId: string): Promise<ApiResult<WorkProgramDashboard>> {
  return request(`/api/work-programs/${wid(programId)}`, undefined, (r) => (r?.program ? (r as WorkProgramDashboard) : undefined));
}
export function getWorkReviewQueue(workforceId: string): Promise<ApiResult<WorkReviewItem[]>> {
  return request(`/api/workforces/${wid(workforceId)}/review`, undefined, (r) => (Array.isArray(r?.queue) ? r.queue : undefined));
}
export function reviewWorkTask(taskId: string, decision: 'approve' | 'return' | 'reject', reason = ''): Promise<ApiResult<{ task: { status: string }; unit: { status: string } }>> {
  return request(`/api/work-tasks/${wid(taskId)}/review`, post({ decision, reason }), (r) => (r?.task ? r : undefined));
}
export function approveCleanWork(workforceId: string): Promise<ApiResult<{ approved: number }>> {
  return request(`/api/workforces/${wid(workforceId)}/review/approve-clean`, post({}), (r) => (typeof r?.approved === 'number' ? r : undefined));
}
