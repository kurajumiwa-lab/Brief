/**
 * THE API CLIENT — the prototype's door to the real network.
 *
 * Caesar runs in two modes, and both are honest:
 *
 *   · **local** — the seeded network in this browser. No server, works offline,
 *     and every screen still demonstrates the product.
 *   · **live** — the same screens against `/api/social` on the Brief backend:
 *     real accounts, real posts, a real ranking computed by the server.
 *
 * `fetch` is injected rather than reached for globally, so every rule below can
 * be tested without a network — which matters, because the interesting
 * behaviours here are what happens when the network is *bad*: a 401 clears the
 * session instead of leaving a dead token, a 409 carries the server's sentence
 * (the case number of a report you already filed), and a network failure is
 * distinguishable from a refusal.
 */

export class ApiError extends Error {
  constructor(message, { status = 0, detail = null, body = null } = {}) {
    super(message);
    this.name = "ApiError";
    /** 0 means "never reached the server" — offline, not refused. */
    this.status = status;
    this.detail = detail;
    this.body = body;
  }

  get offline() {
    return this.status === 0;
  }
}

/**
 * @param {object} options
 * @param {string} [options.baseUrl] where the API lives; defaults to the dev proxy
 * @param {() => string | null} [options.getToken] current bearer token
 * @param {typeof fetch} [options.fetchImpl]
 */
export function createApi({ baseUrl = "/api", getToken = () => null, fetchImpl = globalThis.fetch } = {}) {
  async function request(path, { method = "GET", body, auth = true, signal, token: explicit } = {}) {
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";

    // An explicit token is how "I already have a Brief login" is checked before
    // it becomes the session; everything else reads the current one.
    const token = explicit ?? (auth ? getToken() : null);
    if (token) headers.Authorization = `Bearer ${token}`;

    let response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers,
        signal,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      // A thrown fetch is a dead connection, not a refusal. Keeping that
      // distinction is what lets the UI say "saved on your device" instead of
      // "you are not allowed".
      throw new ApiError("Could not reach the network.", { status: 0, detail: String(error?.message || error) });
    }

    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { detail: text.slice(0, 200) };
      }
    }

    if (!response.ok) {
      const detail = payload?.detail;
      const message =
        typeof detail === "string"
          ? detail
          : Array.isArray(detail)
            ? detail.map((entry) => entry.msg || entry).join(", ")
            : `Request failed (${response.status})`;
      throw new ApiError(message, { status: response.status, detail, body: payload });
    }

    return payload;
  }

  return {
    baseUrl,

    /* ── identity ─────────────────────────────────────────────────────── */

    register: (account) => request("/social/accounts", { method: "POST", body: account, auth: false }),
    me: (token) => request("/social/me", { token }),

    /* ── circles ──────────────────────────────────────────────────────── */

    circles: () => request("/social/circles"),
    follow: (circleId) => request(`/social/circles/${circleId}/follow`, { method: "POST" }),
    unfollow: (circleId) => request(`/social/circles/${circleId}/follow`, { method: "DELETE" }),

    /* ── posts ────────────────────────────────────────────────────────── */

    feed: ({ circleId, limit } = {}) => {
      const query = new URLSearchParams();
      if (circleId) query.set("circle_id", circleId);
      if (limit) query.set("limit", String(limit));
      const suffix = query.toString() ? `?${query}` : "";
      return request(`/social/feed${suffix}`);
    },
    createPost: (post) => request("/social/posts", { method: "POST", body: post }),
    removePost: (postId) => request(`/social/posts/${postId}`, { method: "DELETE" }),

    /* ── reactions ────────────────────────────────────────────────────── */

    react: (postId, value) => request(`/social/posts/${postId}/reactions`, { method: "POST", body: { value } }),
    withdraw: (postId) => request(`/social/posts/${postId}/reactions`, { method: "DELETE" }),

    /* ── moderation ───────────────────────────────────────────────────── */

    report: (postId, reason, detail) =>
      request(`/social/posts/${postId}/reports`, { method: "POST", body: { reason, detail } }),
    reports: () => request("/social/reports"),

    /* ── blocks ───────────────────────────────────────────────────────── */

    block: (targetId, kind = "block") => request("/social/blocks", { method: "POST", body: { target_id: targetId, kind } }),
    unblock: (targetId, kind = "block") =>
      request(`/social/blocks/${targetId}?kind=${kind}`, { method: "DELETE" }),
    blocks: (kind) => request(`/social/blocks${kind ? `?kind=${kind}` : ""}`),
  };
}

export default createApi;
