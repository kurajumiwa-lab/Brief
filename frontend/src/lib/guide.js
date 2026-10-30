/**
 * The one door between the guide components and the network.
 *
 * It exists for two reasons, both practical:
 *
 *  · **The guide must never take a screen down with it.** It is furniture — a
 *    row of chips under a shelf. If the API client in this build has no
 *    `guideAPI` (a slimmed bundle, a test harness that mocks the module
 *    wholesale), reading the property would throw before any component could
 *    decide to render nothing. So the read happens here, inside a guard.
 *  · **One place to change the contract.** If the suggestion payload ever
 *    moves, it moves in this file and the components keep their shape.
 */
import * as apiModule from "@/lib/api";

function client() {
  try {
    return apiModule?.guideAPI ?? null;
  } catch {
    return null;
  }
}

/**
 * Where to go after this shelf, or `null`.
 *
 * `null` is a legitimate answer — no evidence, no suggestion, no chips — and it
 * is deliberately not distinguished from "the guide isn't in this build".
 */
export async function nextShelf(from) {
  const api = client();
  if (!from || !api?.next) return null;
  try {
    const res = await api.next(from);
    const data = res?.data;
    if (!data || !Array.isArray(data.suggestions) || data.suggestions.length === 0) return null;
    return data;
  } catch {
    // A guide that errors is a guide that is quiet.
    return null;
  }
}

/** Fire-and-forget demand recording. Never awaited by a screen. */
export function rememberSearch(query, shelf, resultCount = 0) {
  const api = client();
  if (!api?.searched) return;
  try {
    api.searched({ query, shelf, result_count: resultCount });
  } catch {
    /* nothing to do, and nothing worth showing */
  }
}

export default { nextShelf, rememberSearch };
