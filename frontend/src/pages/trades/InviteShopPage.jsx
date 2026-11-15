import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowRight, Check, Store, Ticket } from "lucide-react";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import { PageSpinner } from "@/components/ui/Spinner";
import { useAuthStore } from "@/stores/authStore";
import { receiptsAPI } from "@/lib/receiptsApi";
import { apiError } from "@/lib/api";

/**
 * A SHOP WITHOUT A PAGE.
 *
 * This is where the WhatsApp invite lands. It is deliberately public: a
 * shopkeeper forwarded the link by a customer can read it without downloading
 * anything. Claiming needs an account, so the shop can be reviewed by a person
 * before it can publish offers or check vouchers.
 */
export default function InviteShopPage() {
  const { slug } = useParams();
  const token = useAuthStore((s) => s.token);
  const me = useAuthStore((s) => s.vendor);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState("");
  const [claimed, setClaimed] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", note: "" });

  useEffect(() => {
    let alive = true;
    receiptsAPI.invite(slug)
      .then(({ data: payload }) => {
        if (!alive) return;
        setData(payload);
        setForm((current) => ({ ...current, name: me?.business_name || "" }));
      })
      .catch((err) => {
        if (alive) setError(err?.response?.status === 404 ? "not-found" : "failed");
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [slug, me?.business_name]);

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
  const pending = claimed || shop.claim_status === "pending";
  const verified = shop.verified;

  const submit = async (event) => {
    event.preventDefault();
    setClaiming(true);
    setClaimError("");
    try {
      await receiptsAPI.claimMerchant(shop.pin, {
        name: form.name.trim() || shop.name,
        phone: form.phone.trim() || null,
        note: form.note.trim() || null,
      });
      setClaimed(true);
    } catch (err) {
      setClaimError(apiError(err, "That claim could not be sent."));
    } finally {
      setClaiming(false);
    }
  };

  return (
    <main className="mx-auto min-h-screen w-full max-w-xl px-4 py-8">
      <Link to="/" className="text-micro font-bold text-ink-3 hover:text-ink-1">
        ← Home Office
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

          {verified ? (
            <div className="mt-5 rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-900 dark:border-brand-500/25 dark:bg-brand-500/10 dark:text-brand-100" data-testid="invite-verified">
              This shop already has a verified Home Office page. Ask the owner for its link,
              or search the name in Regions.
            </div>
          ) : pending ? (
            <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-500/30 dark:bg-amber-500/10" data-testid="invite-pending">
              <p className="flex items-center gap-2 text-sm font-bold text-amber-900 dark:text-amber-100">
                <Check size={15} aria-hidden="true" /> Claim sent
              </p>
              <p className="mt-1 text-xs leading-relaxed text-amber-800 dark:text-amber-200">
                Home Office will check the shop details before the page can publish
                offers or check vouchers. No SMS is sent.
              </p>
            </div>
          ) : token ? (
            <form className="mt-5 space-y-3" onSubmit={submit} data-testid="invite-claim-form">
              <p className="text-xs leading-relaxed text-ink-3">
                Claiming does not publish a page immediately. A person checks the shop
                details first, so a customer cannot claim someone else&apos;s till.
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
                Send this claim for review
              </Button>
            </form>
          ) : (
            <div className="mt-5 rounded-2xl border border-edge-1 bg-surface-0 px-4 py-4">
              <p className="text-sm font-bold text-ink-1">Run this shop?</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-3">
                Sign in, then claim the page. Review protects the shop from a stranger
                claiming its receipts.
              </p>
              <Button as={Link} to="/auth" className="mt-3" icon={ArrowRight}>
                Sign in to claim
              </Button>
            </div>
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
