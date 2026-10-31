/**
 * WHY A REQUEST FAILED — one classification, every screen.
 *
 * A shop front that failed to load used to print the API's own sentence as its
 * headline:
 *
 *     The database is reachable but its tables do not exist yet.
 *
 * That string is a *diagnostic for whoever runs the deployment*. On a customer's
 * phone it is alarming, it says nothing about the vendor they were looking for,
 * and — worse — it was printed above "No vendor answers to @ogallo", which was
 * untrue: the vendor existed, their shelf rendered one tab away, and the only
 * thing actually broken was a migration nobody had run.
 *
 * So: classify first, then write. Every failure has a `kind`, a headline a person
 * can read, a description that says what it means *for them*, and the server's
 * original text kept separately in `technical` where it can be disclosed but
 * never used as a title.
 *
 * `retryable` is a promise, not a mood: a retry is offered only when repeating
 * the request could plausibly work. A 404 will not become a 200 by asking again.
 */

export const FAILURE_KIND = {
  OFFLINE: "offline",
  TIMEOUT: "timeout",
  AUTH: "auth",
  FORBIDDEN: "forbidden",
  NOT_FOUND: "not_found",
  RATE_LIMITED: "rate_limited",
  INVALID: "invalid",
  SCHEMA: "schema",
  SERVER: "server",
  UNKNOWN: "unknown",
};

/** The backend's own words about a failure. Logs and support, never a headline. */
export function apiDetail(err) {
  const data = err?.response?.data;
  const detail = data?.detail;
  if (typeof detail === "string" && detail.trim()) return detail.trim();
  if (Array.isArray(detail) && detail.length) {
    const first = detail[0];
    const where = Array.isArray(first?.loc) ? first.loc.slice(-1)[0] : null;
    return where ? `${where}: ${first.msg}` : first.msg || null;
  }
  if (typeof data === "string" && data.trim()) return data.slice(0, 300);
  return null;
}

/**
 * Is this a deployment whose database schema is behind its code?
 *
 * The backend tags that class of failure `code: "schema_out_of_date"` because the
 * exception type alone cannot tell a missing table from a missing column. When
 * the tag is absent (an older API, a proxy error page) the status still carries
 * the signal: a 503 whose text mentions the schema.
 */
function isSchemaFailure(status, data) {
  if (status !== 503) return false;
  if (data?.code === "schema_out_of_date") return true;
  const text = `${data?.detail || ""} ${data?.hint || ""} ${data?.error || ""}`;
  return /schema|tables? do(es)? not exist|does not exist|relation|column/i.test(text);
}

const STATUS_TITLE = {
  400: "That request was rejected",
  401: "Your session ended",
  403: "This account isn't allowed to see that",
  404: "Nothing lives at this address",
  409: "That conflicts with something already recorded",
  413: "That file is too large to send",
  422: "Some of those details need fixing",
  429: "That's a lot of requests at once",
};

/**
 * @param {any}    err      an axios error (or anything thrown)
 * @param {object} context  { subject } — what was being loaded, as a noun phrase
 *                          ("@ogallo", "your shelf", "the network feed")
 * @returns {{kind,status,title,description,technical,retryable}}
 */
export function describeFailure(err, { subject = "that page" } = {}) {
  const status = err?.response?.status || 0;
  const data = err?.response?.data;
  const technical = apiDetail(err) || err?.message || null;

  // ── no response at all ────────────────────────────────────────────────
  if (!status) {
    if (err?.isTimeout || err?.code === "ECONNABORTED") {
      return {
        kind: FAILURE_KIND.TIMEOUT,
        status: 0,
        title: "The server didn't answer in time",
        description:
          "It may have been starting up. Nothing was changed — try again in a moment.",
        technical,
        retryable: true,
      };
    }
    return {
      kind: FAILURE_KIND.OFFLINE,
      status: 0,
      title: "You're not connected",
      description: `Brief couldn't reach the network to load ${subject}. Your saved data is untouched; try again when you're back online.`,
      technical,
      retryable: true,
    };
  }

  // ── reachable, but broken server-side ─────────────────────────────────
  if (isSchemaFailure(status, data)) {
    return {
      kind: FAILURE_KIND.SCHEMA,
      status,
      title: "The server's database is missing part of its schema",
      description:
        "This is a deployment fault, not a problem with what you asked for. The operator needs to run the database migrations; then retry and this will load.",
      technical,
      retryable: true,
    };
  }

  if (status >= 500) {
    return {
      kind: FAILURE_KIND.SERVER,
      status,
      title: "The server hit a problem",
      description: `Brief answered, but couldn't build ${subject} (${status}). Nothing was changed — retrying is safe.`,
      technical,
      retryable: true,
    };
  }

  // ── the request itself ────────────────────────────────────────────────
  if (status === 401) {
    return {
      kind: FAILURE_KIND.AUTH,
      status,
      title: STATUS_TITLE[401],
      description: "You were signed out, or the session expired. Sign in again — your account and records are untouched.",
      technical,
      retryable: false,
    };
  }
  if (status === 403) {
    return {
      kind: FAILURE_KIND.FORBIDDEN,
      status,
      title: STATUS_TITLE[403],
      description: `You're signed in, but this account doesn't have access to ${subject}.`,
      technical,
      retryable: false,
    };
  }
  if (status === 404) {
    return {
      kind: FAILURE_KIND.NOT_FOUND,
      status,
      title: STATUS_TITLE[404],
      description: `${capitalise(subject)} ${subject === "that page" ? "may have moved or never existed" : "wasn't found"}. The handle may have changed, or the business may have left the network.`,
      technical,
      retryable: false,
    };
  }
  if (status === 429) {
    return {
      kind: FAILURE_KIND.RATE_LIMITED,
      status,
      title: STATUS_TITLE[429],
      description: "Brief is pacing requests to keep the network up for everyone. Give it a moment, then retry.",
      technical,
      retryable: true,
    };
  }
  if (status === 400 || status === 422) {
    return {
      kind: FAILURE_KIND.INVALID,
      status,
      title: STATUS_TITLE[status] || "That request was rejected",
      description: technical || "The server didn't accept those values.",
      technical,
      retryable: false,
    };
  }

  return {
    kind: FAILURE_KIND.UNKNOWN,
    status,
    title: `Brief answered ${status}`,
    description: `Couldn't load ${subject}. Nothing was changed — retrying is safe.`,
    technical,
    retryable: true,
  };
}

function capitalise(text = "") {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * A single sentence for a toast or an inline caption. Never the server's prose
 * when the server is the thing that broke.
 */
export function failureSentence(err, fallback = "Something went wrong") {
  const problem = describeFailure(err);
  if (problem.kind === FAILURE_KIND.INVALID) return problem.description;
  if (problem.kind === FAILURE_KIND.UNKNOWN && problem.status < 500) return fallback;
  return problem.title;
}
