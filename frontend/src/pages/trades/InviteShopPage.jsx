import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AlertTriangle, ArrowRight, Check, Clock, ShieldCheck, Store, Ticket,
} from "lucide-react";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import { PageSpinner } from "@/components/ui/Spinner";
import { useAuthStore } from "@/stores/authStore";
import { receiptsAPI } from "@/lib/receiptsApi";
import { apiError, spottedDealAPI } from "@/lib/api";

/**
 * A SHOP WITHOUT A PAGE — and the fastest honest way to run it.
 *
 * A claim starts in review. A shopkeeper can unlock the capped probationary
 * state immediately by ringing one server-chosen amount (KSh 1–99) at the shop's
 * own till and submitting that receipt. This is presence evidence at the
 * counter, not a KRA verification: the badge says Probationary owner and trade
 * proofs stay locked until the shop earns its way out.
 */
export default function InviteShopPage() {
  const { slug } = useParams();
  const token = useAuthStore((s) => s.token);
  const me = useAuthStore((s) => s.vendor);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [claim, setClaim] = useState(null);
  const [owned, setOwned] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState("");
  const [challenge, setChallenge] = useState(null);
  const [payload, setPayload] = useState("");
  const [challengeBusy, setChallengeBusy] = useState(false);
  const [challengeError, setChallengeError] = useState("");
  const [contestOpen, setContestOpen] = useState(false);
  const [contestReason, setContestReason] = useState("");
  const [contestError, setContestError] = useState("");
  const [contestBusy, setContestBusy] = useState(false);
  const [answerPayload, setAnswerPayload] = useState("");
  const [answerError, setAnswerError] = useState("");
  const [answerBusy, setAnswerBusy] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const [form, setForm] = useState({ name: "", phone: "", note: "" });

  const shopPin = data?.shop?.pin;

  useEffect(() => {
    let alive = true;
    receiptsAPI.invite(slug)
      .then(({ data: payloadData }) => {
        if (!alive) return;
        setData(payloadData);
        setForm((current) => ({ ...current, name: me?.business_name || "" }));
      })
      .catch((err) => {
        if (alive) setError(err?.response?.status === 404 ? "not-found" : "failed");
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [slug, me?.business_name]);

  useEffect(() => {
    if (!token || !shopPin || typeof receiptsAPI.myMerchants !== "function") {
      setOwned(false);
      return undefined;
    }
    let alive = true;
    receiptsAPI.myMerchants()
      .then(({ data: my }) => {
        if (!alive) return;
        const found = (my.merchants || []).find((row) => row.pin === shopPin);
        if (found) {
          setOwned(true);
          setClaim((current) => current || found);
        }
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [token, shopPin]);

  useEffect(() => {
    if (!challenge) return undefined;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [challenge]);

  const status = claim?.claim_status || data?.shop?.claim_status || "unclaimed";
  const challengeSeconds = useMemo(() => {
    if (challenge?.expires_at) {
      return Math.max(0, Math.floor((new Date(challenge.expires_at).getTime() - clock) / 1000));
    }
    if (challenge?.expires_in_seconds) {
      return Math.max(0, Number(challenge.expires_in_seconds));
    }
    return 0;
  }, [challenge, clock]);

  if (loading) return <PageSpinner label="Opening the shop invite…" />;
  if (error === "not-found") {
    return (
      <EmptyState
        title="This invite is not valid"
        description="The shop may already have a page, or the link was shortened. Ask the customer to share it again."
      />
    );
  }
  if (error || !data) {
    return (
      <EmptyState
        title="The invite didn't load"
        description="The server did not answer. Nothing was changed. Try again in a moment."
      />
    );
  }

  const shop = data.shop;
  const verified = status === "verified";
  const probationary = status === "probationary";
  const contested = status === "contested";
  const pending = status === "pending";

  async function submitClaim(event) {
    event.preventDefault();
    setClaiming(true);
    setClaimError("");
    try {
      const { data: result } = await receiptsAPI.claimMerchant(shop.pin, {
        name: form.name.trim() || shop.name,
        phone: form.phone.trim() || null,
        note: form.note.trim() || null,
      });
      setClaim(result.merchant);
      setOwned(true);
    } catch (err) {
      setClaimError(apiError(err, "That claim could not be sent."));
    } finally {
      setClaiming(false);
    }
  }

  async function startChallenge() {
    setChallengeBusy(true);
    setChallengeError("");
    try {
      const { data: result } = await receiptsAPI.claimChallenge(shop.pin);
      setChallenge(result.challenge);
      if (result.merchant) setClaim(result.merchant);
      setClock(Date.now());
    } catch (err) {
      setChallengeError(apiError(err, "Could not issue a test amount."));
    } finally {
      setChallengeBusy(false);
    }
  }

  async function submitChallenge(event) {
    event.preventDefault();
    if (!payload.trim()) {
      setChallengeError("Paste the receipt link or QR text first.");
      return;
    }
    setChallengeBusy(true);
    setChallengeError("");
    try {
      const { data: result } = await receiptsAPI.claimEvidence(shop.pin, payload.trim());
      setClaim(result.merchant);
      setChallenge(null);
      setPayload("");
    } catch (err) {
      setChallengeError(apiError(err, "That receipt did not answer the test sale."));
    } finally {
      setChallengeBusy(false);
    }
  }

  async function submitContest(event) {
    event.preventDefault();
    setContestBusy(true);
    setContestError("");
    try {
      const { data: result } = await receiptsAPI.contestClaim(shop.pin, {
        reason: contestReason.trim(),
        payload: payload.trim(),
      });
      setClaim(result.merchant);
      setContestOpen(false);
      setContestReason("");
      setPayload("");
    } catch (err) {
      setContestError(apiError(err, "That contest could not be opened."));
    } finally {
      setContestBusy(false);
    }
  }

  async function submitAnswer(event) {
    event.preventDefault();
    setAnswerBusy(true);
    setAnswerError("");
    try {
      const { data: result } = await receiptsAPI.answerContest(shop.pin, answerPayload.trim());
      setClaim(result.merchant);
      setAnswerPayload("");
    } catch (err) {
      setAnswerError(apiError(err, "That receipt did not answer the contest."));
    } finally {
      setAnswerBusy(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-xl px-4 py-8">
      <Link to="/" className="text-micro font-bold text-ink-3 hover:text-ink-1">
        ← Brief
      </Link>

      <section className="mt-4 overflow-hidden rounded-3xl border border-edge-1 bg-surface-1">
        <div className="bg-brand-700 px-5 py-4 text-white">
          <p className="flex items-center gap-2 text-micro font-bold uppercase tracking-[0.16em] text-brand-100">
            <Ticket size={14} aria-hidden="true" />
            {data.receipts > 0
              ? `${data.receipts} receipt${data.receipts === 1 ? "" : "s"} on record`
              : "Waiting for a shop page"}
          </p>
        </div>
        <div className="px-5 py-5">
          <h1 className="text-2xl font-extrabold tracking-tight text-ink-1">{shop.name}</h1>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-3">
            <Store size={13} aria-hidden="true" />
            {shop.region || "Local shop"}
            {shop.pin ? <span className="text-ink-4">· {shop.pin}</span> : null}
          </p>
          <p className="mt-4 text-sm leading-relaxed text-ink-2">
            {data.receipts > 0
              ? `${data.receipts} customer ${data.receipts === 1 ? "receipt was" : "receipts were"} scanned at this shop. Claim the page free to answer them and be found by neighbours.`
              : "A customer tried to log a trade here. Claim the page free so receipts can be confirmed and neighbours can find the shop."}
          </p>

          {owned && claim?.id && (verified || probationary) && <div className="mt-4 rounded-xl border p-3 text-sm"><p>Community-spotted sales: {claim.allow_spotted_deals === false ? "blocked" : "allowed"}</p><button className="underline mt-2" onClick={async () => {try {const next = claim.allow_spotted_deals !== false; const {data: result} = await spottedDealAPI.settings(claim.id, next); setClaim({...claim, allow_spotted_deals: result.allow_spotted_deals});} catch (e) {setClaimError(apiError(e));}}}>{claim.allow_spotted_deals === false ? "Allow future spotted sales" : "Block spotted sales for this shop"}</button><p className="text-xs mt-1">Blocking hides all current spotted listings. Re-enabling may make unexpired eligible listings visible again.</p></div>}

          {verified ? (
            <div className="mt-5 rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-900 dark:border-brand-500/25 dark:bg-brand-500/10 dark:text-brand-100" data-testid="invite-verified">
              This shop already has a verified Brief page. Ask the owner for its link,
              or search the name in Regions.
            </div>
          ) : probationary ? (
            <div className="mt-5 rounded-2xl border border-brand-200 bg-brand-50 px-4 py-4 dark:border-brand-500/25 dark:bg-brand-500/10" data-testid="invite-probationary">
              <p className="flex items-center gap-2 text-sm font-bold text-brand-900 dark:text-brand-100">
                <ShieldCheck size={15} aria-hidden="true" /> Probationary owner
              </p>
              <p className="mt-1 text-xs leading-relaxed text-brand-800 dark:text-brand-200">
                {owned ? "You answered" : "The owner answered"} a test sale at the till.
                The shop can check voucher codes and run one active offer with a maximum
                of five vouchers a week. Confirming trade proofs stays locked until the
                shop is verified.
              </p>
              <p className="mt-2 text-micro text-brand-700 dark:text-brand-300" data-testid="invite-probation-until">
                Trading-history review unlocks after 14 days and three paying customers.
              </p>
              <Button as={Link} to="/receipts" className="mt-3" size="sm" icon={ArrowRight}>
                Open your counter
              </Button>
            </div>
          ) : contested ? (
            <div className="mt-5 space-y-3" data-testid="invite-contested">
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-500/30 dark:bg-amber-500/10">
                <p className="flex items-center gap-2 text-sm font-bold text-amber-900 dark:text-amber-100">
                  <Clock size={15} aria-hidden="true" /> Ownership contested
                </p>
                <p className="mt-1 text-xs leading-relaxed text-amber-800 dark:text-amber-200">
                  New offers are frozen. Vouchers already issued still work. The owner has
                  48 hours to answer with a fresh receipt from this shop.
                </p>
              </div>
              {owned && (
                <form className="space-y-2 rounded-2xl border border-edge-1 bg-surface-0 p-4" onSubmit={submitAnswer} data-testid="invite-contest-answer-form">
                  <label className="block">
                    <span className="mb-1 block text-micro font-bold uppercase tracking-[0.14em] text-ink-4">
                      Answer with a fresh receipt
                    </span>
                    <input
                      value={answerPayload}
                      onChange={(event) => setAnswerPayload(event.target.value)}
                      placeholder="Paste the receipt QR or eTIMS link"
                      className="h-11 w-full rounded-xl border border-edge-2 bg-surface-1 px-3 text-sm text-ink-1"
                      data-testid="invite-contest-answer-payload"
                    />
                  </label>
                  {answerError && <p className="text-xs text-red-600 dark:text-red-400">{answerError}</p>}
                  <Button type="submit" size="sm" loading={answerBusy} disabled={!answerPayload.trim()}>
                    Answer the contest
                  </Button>
                </form>
              )}
            </div>
          ) : pending ? (
            <div className="mt-5 space-y-3" data-testid="invite-pending">
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-500/30 dark:bg-amber-500/10">
                <p className="flex items-center gap-2 text-sm font-bold text-amber-900 dark:text-amber-100">
                  <Check size={15} aria-hidden="true" /> Claim sent
                </p>
                <p className="mt-1 text-xs leading-relaxed text-amber-800 dark:text-amber-200">
                  {owned
                    ? "Ring one test sale to start trading today on probation, or wait for review before the page can publish as verified."
                    : "Brief has this claim. The owner can answer a test sale before the page can publish, or a person can review it."}
                </p>
              </div>

              {owned && (
                challenge ? (
                  <form className="rounded-2xl border border-brand-200 bg-brand-50 p-4 dark:border-brand-500/25 dark:bg-brand-500/10" onSubmit={submitChallenge} data-testid="invite-challenge">
                    <p className="text-micro font-bold uppercase tracking-[0.14em] text-brand-800 dark:text-brand-200">
                      Ring exactly this amount
                    </p>
                    <p className="mt-1 text-3xl font-extrabold tabular-nums text-brand-900 dark:text-brand-100" data-testid="invite-challenge-amount">
                      KSh {Number(challenge.amount_kes).toLocaleString("en-KE")}
                    </p>
                    <p className="mt-1 flex items-center gap-1.5 text-micro text-brand-700 dark:text-brand-300" data-testid="invite-challenge-ttl">
                      <Clock size={12} aria-hidden="true" />
                      {challengeSeconds > 0
                        ? `${Math.floor(challengeSeconds / 60)}:${String(challengeSeconds % 60).padStart(2, "0")} left`
                        : "Expired — ask for a new amount"}
                    </p>
                    <p className="mt-2 text-micro leading-relaxed text-brand-800 dark:text-brand-200">
                      Ring it on the shop&apos;s own till, then paste the receipt link or QR
                      text below. This is presence at the counter, not a KRA verification.
                    </p>
                    <input
                      value={payload}
                      onChange={(event) => setPayload(event.target.value)}
                      placeholder="Paste the receipt QR or eTIMS link"
                      className="mt-3 h-11 w-full rounded-xl border border-brand-200 bg-white px-3 text-sm text-ink-1 dark:border-brand-500/30 dark:bg-surface-1"
                      data-testid="invite-challenge-payload"
                    />
                    {challengeError && <p className="mt-2 text-xs text-red-600 dark:text-red-400" data-testid="invite-challenge-error">{challengeError}</p>}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button type="submit" size="sm" loading={challengeBusy} disabled={!payload.trim()} data-testid="invite-challenge-submit">
                        Submit the test receipt
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={startChallenge} disabled={challengeBusy}>
                        New amount
                      </Button>
                    </div>
                  </form>
                ) : (
                  <div className="rounded-2xl border border-edge-1 bg-surface-0 p-4">
                    <p className="text-sm font-bold text-ink-1">Start selling today</p>
                    <p className="mt-1 text-xs leading-relaxed text-ink-3">
                      Get a random amount between KSh 1 and KSh 99, ring it at the shop&apos;s
                      till, and submit that receipt. The amount expires in ten minutes.
                    </p>
                    {challengeError && <p className="mt-2 text-xs text-red-600 dark:text-red-400" data-testid="invite-challenge-error">{challengeError}</p>}
                    <Button className="mt-3" size="sm" onClick={startChallenge} loading={challengeBusy} data-testid="invite-challenge-start">
                      Get a test amount
                    </Button>
                  </div>
                )
              )}
            </div>
          ) : token ? (
            <form className="mt-5 space-y-3" onSubmit={submitClaim} data-testid="invite-claim-form">
              <p className="text-xs leading-relaxed text-ink-3">
                Claiming does not publish a page immediately. You can unlock probation with
                one test sale, or a person can review the shop details.
              </p>
              <label className="block">
                <span className="mb-1 block text-micro font-bold uppercase tracking-[0.14em] text-ink-4">
                  Your name
                </span>
                <input
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  className="h-11 w-full rounded-xl border border-edge-2 bg-surface-0 px-3 text-sm text-ink-1"
                  data-testid="invite-name"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-micro font-bold uppercase tracking-[0.14em] text-ink-4">
                  Phone at the shop
                </span>
                <input
                  value={form.phone}
                  onChange={(event) => setForm({ ...form, phone: event.target.value })}
                  inputMode="tel"
                  placeholder="07…"
                  className="h-11 w-full rounded-xl border border-edge-2 bg-surface-0 px-3 text-sm text-ink-1"
                  data-testid="invite-phone"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-micro font-bold uppercase tracking-[0.14em] text-ink-4">
                  Anything the reviewer should know
                </span>
                <textarea
                  value={form.note}
                  onChange={(event) => setForm({ ...form, note: event.target.value })}
                  rows={3}
                  className="w-full rounded-xl border border-edge-2 bg-surface-0 px-3 py-2 text-sm text-ink-1"
                  data-testid="invite-note"
                />
              </label>
              {claimError && (
                <p className="text-xs text-red-600 dark:text-red-400" data-testid="invite-error">
                  {claimError}
                </p>
              )}
              <Button type="submit" loading={claiming} icon={ArrowRight} data-testid="invite-claim">
                Claim this shop
              </Button>
            </form>
          ) : (
            <div className="mt-5 rounded-2xl border border-edge-1 bg-surface-0 px-4 py-4">
              <p className="text-sm font-bold text-ink-1">Run this shop?</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-3">
                Sign in, then claim the page. A test sale at the till unlocks probation
                without waiting for a person.
              </p>
              <Button as={Link} to="/auth" className="mt-3" icon={ArrowRight}>
                Sign in to claim
              </Button>
            </div>
          )}

          {!owned && !contestOpen && token && ["pending", "probationary", "verified", "contested"].includes(status) && (
            <button
              type="button"
              onClick={() => setContestOpen(true)}
              className="mt-3 text-micro font-semibold text-ink-4 underline-offset-2 hover:text-ink-2 hover:underline"
              data-testid="invite-contest-open"
            >
              Not your shop? Contest this claim
            </button>
          )}
          {contestOpen && (
            <form className="mt-3 space-y-2 rounded-2xl border border-edge-1 bg-surface-0 p-4" onSubmit={submitContest} data-testid="invite-contest-form">
              <p className="flex items-center gap-1.5 text-xs font-bold text-ink-1">
                <AlertTriangle size={14} aria-hidden="true" /> Contest the current claim
              </p>
              <p className="text-micro leading-relaxed text-ink-4">
                Attach a receipt from this shop. New offers stop; vouchers already issued
                still work. This is not a deletion and the owner can answer.
              </p>
              <textarea
                value={contestReason}
                onChange={(event) => setContestReason(event.target.value)}
                rows={2}
                placeholder="Why is this claim wrong?"
                className="w-full rounded-xl border border-edge-2 bg-surface-1 px-3 py-2 text-sm text-ink-1"
                data-testid="invite-contest-reason"
              />
              <input
                value={payload}
                onChange={(event) => setPayload(event.target.value)}
                placeholder="Receipt QR or eTIMS link"
                className="h-11 w-full rounded-xl border border-edge-2 bg-surface-1 px-3 text-sm text-ink-1"
                data-testid="invite-contest-payload"
              />
              {contestError && <p className="text-xs text-red-600 dark:text-red-400">{contestError}</p>}
              <div className="flex flex-wrap gap-2">
                <Button type="submit" size="sm" loading={contestBusy} disabled={contestReason.trim().length < 8 && !payload.trim()} data-testid="invite-contest-submit">
                  Open a contest
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setContestOpen(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </div>
      </section>

      <p className="mt-4 text-center text-micro text-ink-4">
        {data.receipts > 0
          ? `${data.receipts} verified receipt${data.receipts === 1 ? "" : "s"} counted here. Amounts and buyer names are never shown.`
          : "No receipt details are shown on this page."}
      </p>
    </main>
  );
}
