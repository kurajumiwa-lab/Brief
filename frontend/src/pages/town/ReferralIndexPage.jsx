import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowRight, BadgeCheck, Coins, ExternalLink, Filter, Link2, Plus, Search,
  ShieldCheck, Sparkles, Users,
} from "lucide-react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Textarea from "@/components/ui/Textarea";
import { PageSpinner } from "@/components/ui/Spinner";
import { toast } from "@/components/ui/Toast";
import { useAuthStore } from "@/stores/authStore";
import { apiError } from "@/lib/api";
import { townAPI } from "@/lib/townApi";
import { formatKes } from "@/lib/receipts";
import { cn } from "@/lib/utils";

const CATEGORIES = [
  { value: "", label: "All categories" },
  { value: "ride_hailing", label: "Ride-hailing" },
  { value: "transport", label: "Transport" },
  { value: "betting", label: "Betting" },
  { value: "retail", label: "Retail" },
  { value: "services", label: "Local services" },
  { value: "other", label: "Other" },
];

const VERIFY_COPY = {
  verified: "Verified by an operator",
  pending: "Verification in review",
  unverified: "Unverified listing",
  rejected: "Rejected by an operator",
};

function parseShare() {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("share") || "";
}

function ListingCard({ listing, onSelect, onShare, sharing }) {
  const hasBounty = Number(listing.bounty_kes || 0) > 0;
  return (
    <Card className={cn("p-4", listing.sponsored && "border-amber-300 dark:border-amber-500/40")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            {listing.sponsored && (
              <Badge variant="amber" dot>
                <Sparkles size={10} aria-hidden="true" /> Sponsored
              </Badge>
            )}
            <Badge variant={listing.verification_status === "verified" ? "brand" : "outline"}>
              {listing.verification_status === "verified" && <BadgeCheck size={10} aria-hidden="true" />}
              {VERIFY_COPY[listing.verification_status] || listing.verification_status}
            </Badge>
            <span className="text-micro font-semibold uppercase tracking-wide text-ink-4">
              {CATEGORIES.find((category) => category.value === listing.category)?.label || listing.category}
            </span>
          </div>
          <h3 className="mt-1 text-sm font-extrabold leading-snug text-ink-1">{listing.title}</h3>
          <p className="mt-0.5 text-2xs text-ink-3">{listing.provider} · {listing.region_slug}</p>
        </div>
        {hasBounty && (
          <div className="shrink-0 text-right">
            <p className="digital text-base font-extrabold text-brand-700 dark:text-brand-300">{formatKes(listing.bounty_kes)}</p>
            <p className="text-2xs font-semibold uppercase tracking-wide text-ink-4">bounty, direct</p>
          </div>
        )}
      </div>

      {listing.description && <p className="mt-2 line-clamp-2 text-2xs leading-relaxed text-ink-3">{listing.description}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2 text-micro text-ink-4">
        <span className="inline-flex items-center gap-1"><ShieldCheck size={11} /> Needs Level {listing.trust_level_required}</span>
        <span className="inline-flex items-center gap-1"><Users size={11} /> {listing.stats?.verified || 0} verified</span>
        {listing.stats?.clicks > 0 && <span>{listing.stats.clicks} clicks</span>}
        {!listing.eligible && <Badge variant="outline">Locked at your level</Badge>}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => onSelect(listing)}>
          How to claim <ArrowRight size={13} />
        </Button>
        <Button size="sm" variant="secondary" icon={Link2} loading={sharing === listing.id} onClick={() => onShare(listing)}>
          Share my link
        </Button>
        {listing.referral_url && (
          <a
            href={listing.referral_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-ink-3 hover:bg-surface-2"
          >
            Provider <ExternalLink size={12} />
          </a>
        )}
      </div>
    </Card>
  );
}

export default function ReferralIndexPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const token = useAuthStore((s) => s.token);
  const [query, setQuery] = useState(params.get("q") || "");
  const [category, setCategory] = useState(params.get("category") || "");
  const [data, setData] = useState(null);
  const [mine, setMine] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [shareCode, setShareCode] = useState(params.get("share") || parseShare());
  const [shareLink, setShareLink] = useState("");
  const [sharing, setSharing] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    provider: "", category: "ride_hailing", title: "", referral_code: "", referral_url: "",
    offer_terms: "", region_slug: "nyanza", bounty_kes: "100", budget_kes: "5000",
    trust_level_required: "1", verification_method: "transaction_ref",
  });
  const [claim, setClaim] = useState({ proof_type: "transaction_ref", proof_reference: "", screenshot_url: "" });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const request = token ? townAPI.listings : townAPI.publicListings;
      const { data: payload } = await request({ q: query || undefined, category: category || undefined, limit: 40 });
      setData(payload);
      if (token) {
        const { data: minePayload } = await townAPI.mine();
        setMine(minePayload);
      }
    } catch (err) {
      setError(apiError(err, "The referral index could not be loaded"));
    } finally {
      setLoading(false);
    }
  }, [token, query, category]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const claimId = params.get("claim");
    if (!claimId || selected) return;
    const found = [...(data?.sponsored || []), ...(data?.results || [])]
      .find((row) => row.id === claimId);
    if (found) setSelected(found);
  }, [data, params, selected]);

  async function share(listing) {
    if (!token) {
      navigate(`/auth?mode=login&next=${encodeURIComponent(location.pathname + location.search)}`);
      return;
    }
    setSharing(listing.id);
    try {
      const { data: payload } = await townAPI.shareListing(listing.id);
      const link = `${window.location.origin}/referral-index/go/${payload.share.code}`;
      setShareLink(link);
      setShareCode(payload.share.code);
      const copied = await navigator.clipboard
        ?.writeText(link)
        .then(() => true)
        .catch(() => false);
      toast.success(
        copied
          ? "Share link copied. A bounty is due only after an operator verifies the action."
          : "Share link ready below — copy it to send.",
      );
    } catch (err) {
      toast.error(apiError(err, "Could not create a share link"));
    } finally {
      setSharing(null);
    }
  }

  async function submitClaim() {
    if (!token) {
      navigate(`/auth?mode=login&next=${encodeURIComponent(location.pathname + location.search)}`);
      return;
    }
    if (!selected) return;
    setSubmitting(true);
    try {
      const body = {
        proof_type: claim.proof_type,
        proof_reference: claim.proof_reference || null,
        code_used: selected.referral_code || null,
        share_code: shareCode || null,
        proof_payload: claim.screenshot_url ? { screenshot_url: claim.screenshot_url } : {},
      };
      await townAPI.claimListing(selected.id, body);
      toast.success("Submitted. The conversion stays pending until an operator verifies it.");
      setSelected(null);
      setClaim({ proof_type: "transaction_ref", proof_reference: "", screenshot_url: "" });
      load();
    } catch (err) {
      toast.error(apiError(err, "The referral could not be submitted"));
    } finally {
      setSubmitting(false);
    }
  }

  async function createListing() {
    setSubmitting(true);
    try {
      const body = {
        ...form,
        bounty_kes: Number(form.bounty_kes) || 0,
        budget_kes: Number(form.budget_kes) || 0,
        trust_level_required: Number(form.trust_level_required) || 1,
      };
      await townAPI.createListing(body);
      toast.success("Listing created. It starts unverified until an operator reviews it.");
      setCreateOpen(false);
      setForm({ ...form, title: "", referral_code: "", referral_url: "", offer_terms: "" });
      load();
    } catch (err) {
      toast.error(apiError(err, "The listing could not be created"));
    } finally {
      setSubmitting(false);
    }
  }

  const categories = useMemo(() => {
    const enabled = data?.categories;
    if (!Array.isArray(enabled)) return CATEGORIES;
    return CATEGORIES.filter((option) => !option.value || enabled.includes(option.value));
  }, [data]);

  const listings = useMemo(() => [
    ...(data?.sponsored || []),
    ...(data?.results || []),
  ], [data]);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow">Referrals</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-ink-1">Introductions, with proof</h1>
          <p className="mt-1.5 max-w-lg text-xs leading-relaxed text-ink-3">
            Codes and links for Uber, Ena Coach, betting platforms and local businesses.
            A click is not a conversion. A bounty is due only after an operator verifies the
            qualifying action, and the funder pays it directly.
          </p>
        </div>
        {token && (
          <Button size="sm" icon={Plus} onClick={() => setCreateOpen((open) => !open)}>
            Post a listing
          </Button>
        )}
      </header>

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-4" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search Uber, coach, shop, code…"
            className="pl-9"
          />
        </div>
        <Select value={category} onChange={(event) => setCategory(event.target.value)} className="w-auto">
          {categories.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </Select>
        <Button size="sm" variant="secondary" icon={Filter} onClick={load}>Apply</Button>
      </div>

      {data?.ranking && (
        <p className="rounded-xl border border-edge-1 bg-surface-0 px-3 py-2 text-2xs leading-relaxed text-ink-3">
          <span className="font-semibold text-ink-2">{data.ranking.sponsored_label}</span> results are paid
          placements, capped at {data.ranking.sponsored_slots} and always labelled. Organic order: {data.ranking.organic_order}.
        </p>
      )}

      {shareLink && (
        <div className="rounded-xl border border-brand-200 bg-brand-50/50 px-3 py-2 dark:border-brand-500/30 dark:bg-brand-500/10">
          <p className="text-2xs font-bold uppercase tracking-wide text-brand-700 dark:text-brand-300">Your share link</p>
          <p className="mt-0.5 break-all text-2xs text-ink-2">{shareLink}</p>
          <p className="mt-1 text-2xs text-ink-4">Code {shareCode}. The funder pays any bounty directly.</p>
        </div>
      )}

      {createOpen && (
        <Card className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-extrabold text-ink-1">New referral listing</p>
            <Badge variant="outline">Starts unverified</Badge>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Provider" value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} placeholder="Uber" />
            <Select label="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {categories.filter((option) => option.value).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </Select>
            <Input label="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="sm:col-span-2" />
            <Input label="Referral code" value={form.referral_code} onChange={(e) => setForm({ ...form, referral_code: e.target.value })} />
            <Input label="Referral link" value={form.referral_url} onChange={(e) => setForm({ ...form, referral_url: e.target.value })} placeholder="https://" />
            <Input label="Bounty (KES)" type="number" value={form.bounty_kes} onChange={(e) => setForm({ ...form, bounty_kes: e.target.value })} />
            <Input label="Budget (KES)" type="number" value={form.budget_kes} onChange={(e) => setForm({ ...form, budget_kes: e.target.value })} />
            <Select label="Minimum trust level" value={form.trust_level_required} onChange={(e) => setForm({ ...form, trust_level_required: e.target.value })}>
              {[1, 2, 3, 4, 5].map((level) => <option key={level} value={level}>Level {level}</option>)}
            </Select>
            <Select label="Verification method" value={form.verification_method} onChange={(e) => setForm({ ...form, verification_method: e.target.value })}>
              <option value="transaction_ref">Transaction reference</option>
              <option value="manual">Manual review</option>
              <option value="provider_api">Provider API (when connected)</option>
              <option value="merchant_confirmation">Merchant confirmation</option>
            </Select>
            <Textarea label="Offer conditions" rows={3} className="sm:col-span-2" value={form.offer_terms} onChange={(e) => setForm({ ...form, offer_terms: e.target.value })} />
          </div>
          <Button loading={submitting} onClick={createListing}>Create listing</Button>
        </Card>
      )}

      {loading ? (
        <PageSpinner label="Opening the index…" />
      ) : error ? (
        <EmptyState icon={Users} tone="danger" title="The index is down" description={error} action={<Button size="sm" onClick={load}>Try again</Button>} />
      ) : listings.length === 0 ? (
        <EmptyState icon={Users} title="No listings match" description="Try another provider or category, or post the first listing for your town." />
      ) : (
        <div className="space-y-3">
          {listings.map((listing) => (
            <ListingCard key={`${listing.id}-${listing.sponsored ? "s" : "o"}`} listing={listing} onSelect={setSelected} onShare={share} sharing={sharing} />
          ))}
        </div>
      )}

      {selected && (
        <Card className="space-y-3 border-brand-200 p-4 dark:border-brand-500/30">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-extrabold text-ink-1">{selected.title}</p>
              <p className="text-2xs text-ink-3">Claim the action after the provider confirms it. An operator reviews the evidence.</p>
            </div>
            <Button size="xs" variant="ghost" onClick={() => setSelected(null)}>Close</Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Select label="Proof type" value={claim.proof_type} onChange={(e) => setClaim({ ...claim, proof_type: e.target.value })}>
              <option value="transaction_ref">Transaction reference</option>
              <option value="screenshot">Screenshot (operator review only)</option>
              <option value="provider_api">Provider API reference</option>
              <option value="merchant_confirmation">Merchant confirmation</option>
            </Select>
            <Input label="Reference" value={claim.proof_reference} onChange={(e) => setClaim({ ...claim, proof_reference: e.target.value })} placeholder="Trip, account or ticket no." />
            {claim.proof_type === "screenshot" && (
              <Input label="Screenshot URL" value={claim.screenshot_url} onChange={(e) => setClaim({ ...claim, screenshot_url: e.target.value })} className="sm:col-span-2" />
            )}
            <Input label="Share code (optional)" value={shareCode} onChange={(e) => setShareCode(e.target.value)} />
          </div>
          <div className="rounded-xl border border-edge-1 bg-surface-0 px-3 py-2 text-2xs leading-relaxed text-ink-3">
            A screenshot alone is never verification. The bounty is paid by the funder directly;
            the platform records the obligation but holds no money.
          </div>
          <Button loading={submitting} onClick={submitClaim}>Submit for verification</Button>
        </Card>
      )}

      {mine?.listings?.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-extrabold text-ink-1">Your listings</h2>
            <Link to="/merchant" className="inline-flex items-center gap-1 text-2xs font-semibold text-brand-700 dark:text-brand-300">
              For shop owners <ArrowRight size={12} />
            </Link>
          </div>
          <div className="divide-y divide-edge-1 overflow-hidden rounded-2xl border border-edge-1 bg-surface-1">
            {mine.listings.map((listing) => (
              <div key={listing.id} className="flex items-center justify-between gap-2 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-ink-1">{listing.title}</p>
                  <p className="text-micro text-ink-4">{listing.provider} · {VERIFY_COPY[listing.verification_status]}</p>
                </div>
                <Badge variant={listing.verification_status === "verified" ? "brand" : "outline"}>
                  {listing.verification_status}
                </Badge>
              </div>
            ))}
          </div>
        </section>
      )}

      <p className="flex items-center justify-center gap-1.5 text-center text-micro text-ink-4">
        <Coins size={11} aria-hidden="true" />
        Bounties are direct payments. No platform wallet, no unredeemed balance counted as profit.
      </p>
    </div>
  );
}
