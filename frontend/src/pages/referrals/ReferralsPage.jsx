import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowRight, Check, Clock, Coins, Copy, Link2, ListChecks,
  Pause, Play, Plus, Receipt, Share2, ShieldCheck, Store, Users,
} from "lucide-react";
import Badge from "@/components/ui/Badge";
import Breadcrumbs from "@/components/ui/Breadcrumbs";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import Input from "@/components/ui/Input";
import Modal from "@/components/ui/Modal";
import Select from "@/components/ui/Select";
import Textarea from "@/components/ui/Textarea";
import { PageSpinner } from "@/components/ui/Spinner";
import { toast } from "@/components/ui/Toast";
import { referralAPI, apiError } from "@/lib/api";
import { receiptsAPI } from "@/lib/receiptsApi";
import { priceLabel } from "@/lib/categoryArt";
import { REGIONS, DEFAULT_REGION, regionFromPlace } from "@/config/regions";
import { useAuthStore } from "@/stores/authStore";

const STATUS = {
  pending: { label: "Waiting for a receipt", variant: "amber" },
  qualified: { label: "Verified purchase", variant: "brand" },
  rejected: { label: "Not a new customer", variant: "red" },
};

const EMPTY_FORM = {
  shop_id: "",
  title: "",
  description: "",
  reward_points: "50",
  reward_kes: "100",
  max_referrals: "10",
  region_slug: "",
};

function num(value) {
  return new Intl.NumberFormat("en-KE").format(Number(value || 0));
}

function inviteUrl(path) {
  if (typeof window === "undefined") return path;
  return `${window.location.origin}${path}`;
}

export default function ReferralsPage() {
  const vendor = useAuthStore((s) => s.vendor);
  const [searchParams, setSearchParams] = useSearchParams();
  const [overview, setOverview] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [shops, setShops] = useState([]);
  const [error, setError] = useState("");
  const [claimNote, setClaimNote] = useState("");
  const [busy, setBusy] = useState("");
  const [campaignOpen, setCampaignOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [payTarget, setPayTarget] = useState(null);
  const [payNote, setPayNote] = useState("");
  const claimed = useRef(false);

  const region = useMemo(
    () => regionFromPlace(vendor?.physical_location || "") || DEFAULT_REGION,
    [vendor?.physical_location],
  );

  const load = useCallback(async () => {
    setError("");
    try {
      const [mine, list] = await Promise.all([
        referralAPI.overview(),
        referralAPI.campaigns(region.slug),
      ]);
      setOverview(mine.data);
      setCampaigns(list.data?.campaigns || []);
    } catch (err) {
      setError(apiError(err, "The referral network could not be loaded."));
    }
    try {
      const mine = await receiptsAPI.myMerchants();
      setShops((mine.data?.merchants || []).filter((shop) =>
        ["verified", "probationary"].includes(shop.claim_status)
      ));
    } catch {
      setShops([]);
    }
  }, [region.slug]);

  useEffect(() => { load(); }, [load]);

  const codeInUrl = searchParams.get("code");
  const storedCode = typeof window === "undefined" ? "" : localStorage.getItem("brief-referral-code");
  const claimCode = codeInUrl || storedCode;

  useEffect(() => {
    if (!claimCode || claimed.current) return;
    claimed.current = true;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await referralAPI.claim(claimCode);
        if (cancelled) return;
        localStorage.removeItem("brief-referral-code");
        setClaimNote(
          data.already_linked
            ? "This invitation is already linked to your account."
            : "Invitation linked. It becomes a verified referral only after the receipt engine accepts a receipt from this shop.",
        );
        const next = new URLSearchParams(searchParams);
        next.delete("code");
        setSearchParams(next, { replace: true });
        load();
      } catch (err) {
        if (cancelled) return;
        setClaimNote(apiError(err, "That invitation could not be linked."));
      }
    })();
    return () => { cancelled = true; };
  }, [claimCode, load, searchParams, setSearchParams]);

  const openCampaign = () => {
    setForm({
      ...EMPTY_FORM,
      shop_id: shops[0]?.id || "",
      region_slug: region.slug,
    });
    setCampaignOpen(true);
  };

  const getLink = async (campaign) => {
    setBusy(`link-${campaign.id}`);
    try {
      const { data } = await referralAPI.link(campaign.id);
      setCampaigns((rows) => rows.map((row) =>
        row.id === campaign.id ? { ...row, my_link: data.link } : row
      ));
      toast.success("Your invite link is ready.");
      await load();
    } catch (err) {
      toast.error(apiError(err, "That invite link could not be created."));
    } finally {
      setBusy("");
    }
  };

  const copy = async (path) => {
    const url = inviteUrl(path);
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Invite link copied.");
    } catch {
      toast.error(`Copy this link: ${url}`);
    }
  };

  const share = async (campaign, path) => {
    const url = inviteUrl(path);
    const text = `${campaign.title} — ${campaign.merchant.name}. ${campaign.reward_points ? `Earn ${campaign.reward_points} points` : ""}${campaign.reward_points && campaign.reward_kes ? " and " : ""}${campaign.reward_kes ? `${priceLabel(campaign.reward_kes)} direct from the shop` : ""}. Verified after a real receipt.`;
    try {
      if (navigator.share) await navigator.share({ title: campaign.title, text, url });
      else await copy(path);
    } catch {
      // A dismissed share sheet is not an error worth shouting about.
    }
  };

  const createCampaign = async () => {
    if (!form.shop_id) return toast.error("Choose the shop that funds this campaign.");
    if (form.title.trim().length < 3) return toast.error("Give the invitation a title.");
    const points = Number(form.reward_points || 0);
    const kes = Number(form.reward_kes || 0);
    if (points <= 0 && kes <= 0) return toast.error("Offer points, a cash bounty, or both.");
    setBusy("create");
    try {
      await referralAPI.createCampaign({
        shop_id: form.shop_id,
        title: form.title.trim(),
        description: form.description.trim() || null,
        region_slug: form.region_slug || region.slug,
        reward_points: points,
        reward_kes: kes,
        max_referrals: Number(form.max_referrals || 1),
      });
      setCampaignOpen(false);
      toast.success("Campaign funded. Share the first invitation.");
      await load();
    } catch (err) {
      toast.error(apiError(err, "The campaign could not be created."));
    } finally {
      setBusy("");
    }
  };

  const setStatus = async (campaign) => {
    const next = campaign.status === "active" ? "paused" : "active";
    setBusy(`status-${campaign.id}`);
    try {
      await referralAPI.setStatus(campaign.id, next);
      toast.success(next === "active" ? "Campaign resumed." : "Campaign paused.");
      await load();
    } catch (err) {
      toast.error(apiError(err, "The campaign could not be updated."));
    } finally {
      setBusy("");
    }
  };

  const markPaid = async () => {
    if (!payTarget) return;
    if (payNote.trim().length < 3) {
      return toast.error("Add a payment reference or note so the record is not just a claim.");
    }
    setBusy(`pay-${payTarget.id}`);
    try {
      await referralAPI.markPaid(payTarget.id, payNote.trim() || null);
      toast.success("Recorded as paid directly. No platform money moved.");
      setPayTarget(null);
      setPayNote("");
      await load();
    } catch (err) {
      toast.error(apiError(err, "The payment note could not be saved."));
    } finally {
      setBusy("");
    }
  };

  if (!overview && !error) return <PageSpinner label="Reading the referral network…" />;
  if (!overview && error) {
    return (
      <div className="mx-auto max-w-md py-10 text-center">
        <p className="text-sm font-semibold text-ink-1">The referral network could not be loaded</p>
        <p className="mt-1 text-2xs text-ink-3">{error}</p>
        <Button className="mt-4" variant="secondary" onClick={load}>Try again</Button>
      </div>
    );
  }

  const summary = overview?.summary || {};
  const shareable = campaigns.filter((campaign) => !campaign.is_mine);
  const owned = overview?.campaigns || [];
  const links = overview?.links || [];
  const referrals = overview?.referrals || [];
  const received = overview?.received || [];

  return (
    <div className="space-y-5">
      <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Referral network" }]} />

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-micro font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">
            One network · three economic engines
          </p>
          <h1 className="text-2xl font-bold text-ink-1 tracking-tight">Referral network</h1>
          <p className="text-2xs text-ink-3 mt-1 max-w-2xl">
            Introduce a real new customer to a shop you trust. You are paid when their purchase is verified — not when a link is clicked.
          </p>
        </div>
        {shops.length > 0 && (
          <Button size="sm" icon={Plus} onClick={openCampaign}>
            Fund an invitation
          </Button>
        )}
      </header>

      <nav aria-label="Economic engines" className="grid gap-2 sm:grid-cols-3">
        <EngineDoor to="/receipts" icon={Receipt} title="Receipt rewards"
          sub="Scan a shop receipt, earn points, redeem a deal." />
        <EngineDoor icon={Users} title="Referral network" sub="Introduce a new customer. Verify with a receipt."
          active />
        <EngineDoor to="/tasks" icon={ListChecks} title="Local work"
          sub="Claim a task, submit proof, get paid directly." />
      </nav>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-2xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300" role="alert">
          {error}
        </div>
      )}
      {claimNote && (
        <div className="flex items-start gap-2 rounded-xl border border-edge-2 bg-surface-0 px-3 py-2 text-2xs text-ink-2">
          <Check size={15} className="text-tech-600 shrink-0 mt-0.5" />
          <span>{claimNote}</span>
        </div>
      )}

      <section aria-label="Your referral record" className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat label="Waiting for a receipt" value={num(summary.pending)} hint="A claim is not a purchase" icon={Clock} />
        <Stat label="Verified referrals" value={num(summary.qualified)} hint="Receipt accepted at the shop" icon={ShieldCheck} />
        <Stat label="Points earned" value={num(summary.points_earned)} hint="Points are not money" icon={Coins} />
        <Stat label="Bounties due to you" value={priceLabel(summary.bounty_due_kes || 0)} hint="The shop pays you directly" icon={Store} />
      </section>

      <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
        <section className="space-y-3" aria-label="Campaigns">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-ink-1">Campaigns near you</h2>
              <p className="text-2xs text-ink-3 mt-0.5">A shop funds the reward. The network verifies the purchase.</p>
            </div>
            <Badge variant="outline" size="xs">{shareable.length} open</Badge>
          </div>

          {shareable.length === 0 ? (
            <EmptyState icon={Users} tone="brand" title="No campaigns in this region yet"
              description="When a merchant funds a referral campaign, it appears here. You can also ask a shop you trust to fund one." />
          ) : (
            <div className="space-y-2">
              {shareable.map((campaign) => (
                <CampaignCard
                  key={campaign.id}
                  campaign={campaign}
                  busy={busy}
                  onGetLink={getLink}
                  onCopy={copy}
                  onShare={share}
                />
              ))}
            </div>
          )}
        </section>

        <div className="space-y-5">
          <section className="space-y-2" aria-label="Your invite links">
            <h2 className="text-sm font-bold text-ink-1">Your invitation links</h2>
            {links.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-edge-2 p-4 text-2xs text-ink-3">
                No link yet. Get one from a campaign and share it in the WhatsApp group where the shop is already known.
              </div>
            ) : (
              <div className="space-y-2">
                {links.map((link) => (
                  <div key={link.code} className="glass rounded-2xl p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-2xs font-semibold text-ink-1 truncate">{link.campaign_title}</p>
                        <p className="text-micro text-ink-4">{link.merchant_name}</p>
                      </div>
                      <Badge variant={link.campaign_status === "active" ? "brand" : "gray"} size="xs">
                        {link.campaign_status}
                      </Badge>
                    </div>
                    <div className="mt-2 flex items-center gap-1.5 rounded-xl bg-surface-2 px-2 py-1.5">
                      <Link2 size={13} className="text-ink-4 shrink-0" />
                      <code className="text-2xs font-semibold text-ink-1 tracking-wide">{link.code}</code>
                      <span className="ml-auto text-micro text-ink-4">
                        {link.counts.qualified} verified · {link.counts.pending} waiting
                      </span>
                      <button type="button" onClick={() => copy(link.path)} aria-label="Copy invite link"
                        className="p-1 rounded-md text-ink-3 hover:text-ink-1 hover:bg-surface-3">
                        <Copy size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-edge-2 bg-surface-0 p-4" aria-label="How verification works">
            <div className="flex items-center gap-2">
              <ShieldCheck size={16} className="text-tech-600" />
              <h2 className="text-sm font-bold text-ink-1">What counts as a referral</h2>
            </div>
            <ol className="mt-2 space-y-1.5 text-2xs text-ink-2 list-decimal pl-4">
              <li>The person opens your link before they shop.</li>
              <li>They submit a receipt at the shop that funds the campaign.</li>
              <li>The receipt engine verifies it. Only then is the referral qualified.</li>
              <li>Points land in the points ledger; a cash bounty is paid by the shop directly.</li>
            </ol>
            <p className="mt-2 text-micro text-ink-4">
              A screenshot, a promise or a link click never qualifies. The platform never holds the cash.
            </p>
          </section>
        </div>
      </div>

      <section className="space-y-2" aria-label="Your referrals">
        <h2 className="text-sm font-bold text-ink-1">People you introduced</h2>
        {referrals.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-edge-2 p-4 text-2xs text-ink-3">
            Nothing yet. Share a campaign link; a pending row appears as soon as someone links it.
          </div>
        ) : (
          <div className="grid gap-2 lg:grid-cols-2">
            {referrals.map((referral) => <ReferralCard key={referral.id} referral={referral} />)}
          </div>
        )}
      </section>

      {(shops.length > 0 || owned.length > 0) && (
        <section className="space-y-3" aria-label="Your funded campaigns">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-ink-1">Your shop campaigns</h2>
              <p className="text-2xs text-ink-3 mt-0.5">You fund the reward. You see exactly which purchase verified it.</p>
            </div>
            <Button size="sm" variant="secondary" icon={Plus} onClick={openCampaign} disabled={shops.length === 0}>
              New campaign
            </Button>
          </div>

          {owned.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-edge-2 p-4 text-2xs text-ink-3">
              You run a verified shop. Fund a campaign to turn trusted introductions into measured new customers.
            </div>
          ) : (
            <div className="grid gap-2 lg:grid-cols-2">
              {owned.map((campaign) => (
                <OwnerCampaignCard
                  key={campaign.id}
                  campaign={campaign}
                  busy={busy}
                  onStatus={setStatus}
                />
              ))}
            </div>
          )}

          <div className="space-y-2">
            <h3 className="text-sm font-bold text-ink-1">People who came in</h3>
            {received.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-edge-2 p-4 text-2xs text-ink-3">
                No one has linked a campaign yet. When they do, the row stays pending until their receipt verifies.
              </div>
            ) : (
              <div className="grid gap-2 lg:grid-cols-2">
                {received.map((referral) => (
                  <ReceivedCard
                    key={referral.id}
                    referral={referral}
                    busy={busy}
                    onPay={() => { setPayTarget(referral); setPayNote(""); }}
                  />
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      <Modal
        open={campaignOpen}
        onClose={() => setCampaignOpen(false)}
        title="Fund an invitation"
        description="You promise the reward. A verified receipt at your shop is the only thing that releases it."
        footer={(
          <>
            <Button variant="secondary" onClick={() => setCampaignOpen(false)}>Cancel</Button>
            <Button onClick={createCampaign} loading={busy === "create"} disabled={!shops.length}>
              Create campaign
            </Button>
          </>
        )}
      >
        {shops.length === 0 ? (
          <div className="text-2xs text-ink-2">
            You need a claimed shop first. <Link to="/receipts" className="font-semibold text-brand-700 dark:text-brand-300 underline">Claim your shop in Receipts</Link>.
          </div>
        ) : (
          <div className="space-y-3">
            <Select
              label="Shop that funds this campaign"
              value={form.shop_id}
              onChange={(e) => setForm((f) => ({ ...f, shop_id: e.target.value }))}
              options={shops.map((shop) => ({ value: shop.id, label: `${shop.name} · ${shop.claim_status}` }))}
            />
            <Input
              label="Invitation title"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="Bring a new customer to our chemist"
              maxLength={160}
              required
            />
            <Textarea
              label="What should people know?"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="A new customer who buys anything from the shop counts. Show them the deal at the counter."
              rows={3}
              maxLength={2000}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Points per verified referral" type="number" min="0" max="10000"
                value={form.reward_points}
                onChange={(e) => setForm((f) => ({ ...f, reward_points: e.target.value }))}
                hint="Points are a reward, never cash." />
              <Input label="Cash bounty (KSh)" type="number" min="0" max="100000" prefix="KSh"
                value={form.reward_kes}
                onChange={(e) => setForm((f) => ({ ...f, reward_kes: e.target.value }))}
                hint="You pay this directly. Wasta never holds it." />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Invitation places" type="number" min="1" max="500"
                value={form.max_referrals}
                onChange={(e) => setForm((f) => ({ ...f, max_referrals: e.target.value }))}
                hint="Each place is one new person." />
              <Select label="Region"
                value={form.region_slug}
                onChange={(e) => setForm((f) => ({ ...f, region_slug: e.target.value }))}
                options={REGIONS.filter((r) => r.country === "KE").map((r) => ({ value: r.slug, label: r.name }))}
              />
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(payTarget)}
        onClose={() => setPayTarget(null)}
        title="Mark bounty paid"
        description="This is a note on a direct payment between you and the person. It does not move money through Wasta."
        footer={(
          <>
            <Button variant="secondary" onClick={() => setPayTarget(null)}>Cancel</Button>
            <Button onClick={markPaid} loading={busy === `pay-${payTarget?.id}`}
              disabled={payNote.trim().length < 3}>Record as paid</Button>
          </>
        )}
      >
        {payTarget && (
          <div className="space-y-3">
            <div className="rounded-xl bg-surface-2 p-3 text-2xs text-ink-2">
              <p><span className="font-semibold text-ink-1">{payTarget.referred.name}</span> was introduced by <span className="font-semibold text-ink-1">{payTarget.referrer?.name}</span>.</p>
              <p className="mt-1">Bounty: <span className="font-bold text-ink-1">{priceLabel(payTarget.bounty_kes)}</span> · Receipt verified at {payTarget.merchant_name}.</p>
            </div>
            <Input label="M-Pesa reference or note" value={payNote}
              onChange={(e) => setPayNote(e.target.value)} maxLength={255} required
              hint="Required. Wasta did not see the payment; this is your record of it."
              placeholder="e.g. Send Money QK72…" />
          </div>
        )}
      </Modal>
    </div>
  );
}

function EngineDoor({ to, icon: Icon, title, sub, active = false }) {
  const body = (
    <>
      <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${active ? "bg-brand-600 text-white" : "bg-surface-2 text-ink-2"}`}>
        <Icon size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-ink-1">{title}</span>
        <span className="block text-micro text-ink-3 mt-0.5">{sub}</span>
      </span>
      {to && <ArrowRight size={14} className="text-ink-4 shrink-0" />}
    </>
  );
  if (!to) {
    return <div className="glass rounded-2xl p-3 flex items-center gap-3 border-brand-200 dark:border-brand-500/30" aria-current="page">{body}</div>;
  }
  return <Link to={to} className="glass glass-hover rounded-2xl p-3 flex items-center gap-3">{body}</Link>;
}

function Stat({ label, value, hint, icon: Icon }) {
  return (
    <div className="glass rounded-2xl p-3">
      <div className="flex items-center gap-1.5 text-ink-4">
        <Icon size={13} />
        <span className="text-micro font-semibold uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-1 text-lg font-bold text-ink-1 tabular-nums">{value}</p>
      <p className="text-micro text-ink-4">{hint}</p>
    </div>
  );
}

function RewardLine({ campaign }) {
  const parts = [];
  if (campaign.reward_points) parts.push(`${num(campaign.reward_points)} points`);
  if (campaign.reward_kes) parts.push(`${priceLabel(campaign.reward_kes)} direct`);
  return (
    <div className="flex flex-wrap gap-1.5">
      {parts.map((part) => <Badge key={part} variant="brand" size="xs">{part}</Badge>)}
      <Badge variant="outline" size="xs">{campaign.remaining_referrals} of {campaign.max_referrals} places left</Badge>
    </div>
  );
}

function CampaignCard({ campaign, busy, onGetLink, onCopy, onShare }) {
  return (
    <article className="glass rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-micro font-semibold uppercase tracking-wide text-ink-4">{campaign.merchant.name}</p>
          <h3 className="text-sm font-bold text-ink-1 mt-0.5">{campaign.title}</h3>
          {campaign.description && <p className="text-2xs text-ink-3 mt-1 leading-relaxed">{campaign.description}</p>}
        </div>
        <Badge variant={campaign.status === "active" ? "brand" : "gray"} size="xs">{campaign.status}</Badge>
      </div>

      <div className="mt-3"><RewardLine campaign={campaign} /></div>

      {campaign.my_link ? (
        <div className="mt-3 flex items-center gap-1.5 rounded-xl bg-surface-2 px-2 py-1.5">
          <Link2 size={13} className="text-ink-4 shrink-0" />
          <code className="text-2xs font-semibold text-ink-1 tracking-wide">{campaign.my_link.code}</code>
          <button type="button" onClick={() => onCopy(campaign.my_link.path)} aria-label="Copy invite link"
            className="ml-auto p-1 rounded-md text-ink-3 hover:text-ink-1 hover:bg-surface-3">
            <Copy size={14} />
          </button>
          <button type="button" onClick={() => onShare(campaign, campaign.my_link.path)} aria-label="Share invite"
            className="p-1 rounded-md text-ink-3 hover:text-ink-1 hover:bg-surface-3">
            <Share2 size={14} />
          </button>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" icon={Link2} loading={busy === `link-${campaign.id}`}
            disabled={campaign.remaining_referrals <= 0 || campaign.status !== "active"}
            onClick={() => onGetLink(campaign)}>
            {campaign.remaining_referrals <= 0 ? "Campaign full" : "Get my link"}
          </Button>
          <span className="text-micro text-ink-4">Only a verified receipt qualifies.</span>
        </div>
      )}
    </article>
  );
}

function OwnerCampaignCard({ campaign, busy, onStatus }) {
  return (
    <article className="glass rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-micro font-semibold uppercase tracking-wide text-ink-4">{campaign.merchant.name}</p>
          <h3 className="text-sm font-bold text-ink-1 mt-0.5">{campaign.title}</h3>
        </div>
        <Badge variant={campaign.status === "active" ? "brand" : "gray"} size="xs">{campaign.status}</Badge>
      </div>
      <div className="mt-3"><RewardLine campaign={campaign} /></div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <MiniStat label="Waiting" value={campaign.stats.pending} />
        <MiniStat label="Verified" value={campaign.stats.qualified} />
        <MiniStat label="Budget" value={campaign.budget_kes ? priceLabel(campaign.budget_kes) : `${num(campaign.budget_points)} pts`} />
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-micro text-ink-4">
          {campaign.stats.bounty_due_kes > 0
            ? `${priceLabel(campaign.stats.bounty_due_kes)} bounty due`
            : campaign.stats.reward_points_awarded
              ? `${num(campaign.stats.reward_points_awarded)} points awarded`
              : "No rewards released yet"}
        </span>
        <Button size="xs" variant="secondary" icon={campaign.status === "active" ? Pause : Play}
          loading={busy === `status-${campaign.id}`} onClick={() => onStatus(campaign)}>
          {campaign.status === "active" ? "Pause" : "Resume"}
        </Button>
      </div>
    </article>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="rounded-xl bg-surface-2 px-2 py-1.5">
      <p className="text-micro text-ink-4">{label}</p>
      <p className="text-2xs font-bold text-ink-1 tabular-nums">{value}</p>
    </div>
  );
}

function statusBadge(referral) {
  const config = STATUS[referral.status] || { label: referral.status, variant: "gray" };
  return <Badge variant={config.variant} size="xs">{config.label}</Badge>;
}

function ReferralCard({ referral }) {
  return (
    <article className="glass rounded-2xl p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink-1 truncate">{referral.referred.name}</p>
          <p className="text-micro text-ink-4">@{referral.referred.handle} · {referral.campaign_title}</p>
        </div>
        {statusBadge(referral)}
      </div>
      {referral.status === "qualified" ? (
        <p className="mt-2 text-2xs text-ink-2">
          {referral.reward_points ? <span className="font-semibold">{num(referral.reward_points)} points earned.</span> : null}
          {referral.reward_points && referral.bounty_kes ? " " : ""}
          {referral.bounty_kes ? `${priceLabel(referral.bounty_kes)} bounty ${referral.bounty_status === "paid" ? "paid" : "due from the shop"}.` : ""}
        </p>
      ) : (
        <p className="mt-2 text-2xs text-ink-3">
          {referral.status === "rejected" ? referral.rejected_reason : "Waiting for a verified receipt at the shop."}
        </p>
      )}
      <p className="mt-1 text-micro text-ink-4">Invited {new Date(referral.created_at).toLocaleDateString("en-KE")}</p>
    </article>
  );
}

function ReceivedCard({ referral, busy, onPay }) {
  return (
    <article className="glass rounded-2xl p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink-1 truncate">{referral.referred.name}</p>
          <p className="text-micro text-ink-4">Introduced by {referral.referrer?.name || "a member"} · {referral.campaign_title}</p>
        </div>
        {statusBadge(referral)}
      </div>

      {referral.status === "qualified" && (
        <div className="mt-2 rounded-xl bg-surface-2 p-2 text-2xs text-ink-2">
          <div className="flex items-center justify-between gap-2">
            <span>Receipt total</span>
            <span className="font-semibold text-ink-1">{priceLabel(referral.evidence?.receipt_total || 0)}</span>
          </div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <span>Cash bounty</span>
            <span className="font-semibold text-ink-1">{priceLabel(referral.bounty_kes)}</span>
          </div>
        </div>
      )}

      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-micro text-ink-4">
          {referral.status === "qualified"
            ? (referral.bounty_status === "paid" ? `Paid ${referral.bounty_marked_at ? new Date(referral.bounty_marked_at).toLocaleDateString("en-KE") : ""}` : "Pay the person directly")
            : "Not payable yet"}
        </span>
        {referral.status === "qualified" && referral.bounty_kes > 0 && referral.bounty_status !== "paid" && (
          <Button size="xs" icon={Check} loading={busy === `pay-${referral.id}`} onClick={onPay}>
            Mark paid
          </Button>
        )}
      </div>
    </article>
  );
}
