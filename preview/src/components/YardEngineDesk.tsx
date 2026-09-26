import React from 'react';
import {
  Briefcase,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock,
  ExternalLink,
  Plus,
  Send,
  Users,
  Wallet,
  X,
  Zap
} from 'lucide-react';
import * as briefApi from '../api/briefApi';
import { CampaignDistribution } from './CampaignDistribution';
import { ImageField } from './ImageField';
import { StandaloneBanner } from './StandaloneBanner';
import type { CampaignShare } from '../api/types';
import whatsappBannerArt from '../assets/shelf/whatsapp-share.webp';

export type YardSection = 'campaigns' | 'matches' | 'distribution' | 'calendar' | 'vendors' | 'ai';

const T = {
  bg: 'var(--color-well)',
  surface: 'var(--brief-ink)',
  line: 'var(--brief-line)',
  ink: 'var(--brief-ink)',
  muted: 'rgba(17,17,17,0.62)',
  faint: 'rgba(17,17,17,0.45)',
  green: 'var(--brief-ink)',
  amber: 'var(--brief-ink)',
  red: 'var(--brief-ink)'
};

function Panel({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4" style={{ color: T.green }} />
        <h2 className="text-[12px] font-bold uppercase tracking-[0.18em]" style={{ color: T.green }}>{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text' }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-semibold" style={{ color: T.muted }}>{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border px-3 py-2.5 text-[13px] outline-none"
        style={{ borderColor: T.line, background: T.bg, color: T.ink }}
      />
    </label>
  );
}

function Button({ children, onClick, disabled = false, tone = 'quiet' }: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'quiet' | 'primary' | 'danger';
}) {
  const style = tone === 'primary'
    ? { background: T.green, color: T.bg, borderColor: T.green }
    : tone === 'danger'
    ? { background: 'transparent', color: T.red, borderColor: `${T.red}66` }
    : { background: T.surface, color: T.green, borderColor: T.line };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-[12px] font-bold transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
      style={style}
    >
      {children}
    </button>
  );
}

function Notice({ message, error = false }: { message: string | null; error?: boolean }) {
  if (!message) return null;
  return <p className="rounded-xl border px-3 py-2 text-[12px]" style={{ borderColor: error ? `${T.red}66` : T.line, color: error ? T.red : T.muted, background: T.surface }}>{message}</p>;
}

function parseList(value: string) {
  return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
}

function CampaignsPanel() {
  const [campaigns, setCampaigns] = React.useState<any[]>([]);
  const [form, setForm] = React.useState({ title: '', budget: '', regions: 'KE', niches: '', serviceType: 'DEDICATED_CAMPAIGN' });
  const [state, setState] = React.useState<'loading' | 'ready'>('loading');
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setState('loading');
    const result = await briefApi.getAdvertiserCampaigns();
    if (result.ok) setCampaigns(result.data);
    else setError(result.error);
    setState('ready');
  }, []);

  React.useEffect(() => { void load(); }, [load]);

  const create = async () => {
    setBusy(true); setError(null); setMessage(null);
    const result = await briefApi.createAdvertiserCampaign({
      title: form.title,
      budget: Number(form.budget),
      targetRegions: parseList(form.regions),
      targetNiches: parseList(form.niches),
      requiredServiceType: form.serviceType
    });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    setForm({ title: '', budget: '', regions: 'KE', niches: '', serviceType: 'DEDICATED_CAMPAIGN' });
    setMessage('Campaign saved.');
    await load();
  };

  const action = async (id: string, kind: 'submit' | 'fund' | 'allocate') => {
    setBusy(true); setError(null); setMessage(null);
    const result = kind === 'submit'
      ? await briefApi.submitAdvertiserCampaign(id)
      : kind === 'fund'
      ? await briefApi.confirmAdvertiserFunding(id)
      : await briefApi.allocateAdvertiserCampaign(id);
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    setMessage(kind === 'allocate' ? 'Matching completed.' : kind === 'fund' ? 'Funding recorded as held.' : 'Campaign submitted.');
    await load();
  };

  const verify = async (matchId: string) => {
    setBusy(true); setError(null); setMessage(null);
    const result = await briefApi.verifyAdvertiserFulfillment(matchId);
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    setMessage(result.data?.settlement?.ok ? 'Fulfilment verified and paid.' : `Fulfilment verified; ${result.data?.settlement?.reason ?? 'settlement pending'}.`);
    await load();
  };

  const retry = async (matchId: string) => {
    setBusy(true); setError(null); setMessage(null);
    const result = await briefApi.retryAdvertiserSettlement(matchId);
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    setMessage(result.data?.ok ? 'Settlement completed.' : `Settlement ${result.data?.reason ?? 'pending'}.`);
    await load();
  };

  return (
    <Panel title="Advertiser campaigns" icon={Briefcase}>
      <div className="rounded-2xl border p-4 space-y-3" style={{ borderColor: T.line, background: T.surface }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Campaign title" value={form.title} onChange={(title) => setForm((old) => ({ ...old, title }))} placeholder="Community showcase" />
          <Field label="Budget" value={form.budget} onChange={(budget) => setForm((old) => ({ ...old, budget }))} placeholder="50000" type="number" />
          <Field label="Regions" value={form.regions} onChange={(regions) => setForm((old) => ({ ...old, regions }))} placeholder="KE, NG" />
          <Field label="Niches" value={form.niches} onChange={(niches) => setForm((old) => ({ ...old, niches }))} placeholder="fashion, events" />
        </div>
        <label className="block space-y-1">
          <span className="text-[11px] font-semibold" style={{ color: T.muted }}>Service tier</span>
          <select value={form.serviceType} onChange={(event) => setForm((old) => ({ ...old, serviceType: event.target.value }))} className="w-full rounded-xl border px-3 py-2.5 text-[13px] outline-none" style={{ borderColor: T.line, background: T.bg, color: T.ink }}>
            <option value="WHATSAPP_STATUS">WhatsApp Status</option>
            <option value="FB_POST">Facebook post</option>
            <option value="DEDICATED_CAMPAIGN">Dedicated campaign</option>
            <option value="EVENT_APPEARANCE">Event appearance</option>
          </select>
        </label>
        <Button tone="primary" disabled={busy || !form.title.trim() || !form.budget} onClick={() => void create()}><Plus className="h-3.5 w-3.5" /> Create campaign</Button>
      </div>

      <Notice message={error} error />
      <Notice message={message} />
      {state === 'loading' && <div className="h-24 animate-pulse rounded-2xl" style={{ background: T.surface }} />}
      {state === 'ready' && campaigns.length === 0 && <div className="rounded-2xl border border-dashed p-6 text-center text-[13px]" style={{ borderColor: T.line, color: T.muted }}>No advertiser campaigns yet.</div>}
      <div className="space-y-3">
        {campaigns.map((campaign) => {
          const budget = campaign.budgetSummary ?? {};
          return (
            <article key={campaign.id} className="rounded-2xl border p-4 space-y-3" style={{ borderColor: T.line, background: T.surface }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold" style={{ color: T.ink }}>{campaign.title}</h3>
                  <p className="mt-1 text-[11px] uppercase tracking-[0.14em]" style={{ color: T.green }}>{campaign.status}</p>
                </div>
                <div className="text-right text-[12px]" style={{ color: T.muted }}>
                  <p>{campaign.currency} {Number(campaign.budget).toLocaleString()}</p>
                  <p>{campaign.matches?.length ?? 0} matches</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl border p-2" style={{ borderColor: T.line }}><p className="text-sm font-semibold" style={{ color: T.ink }}>{budget.funded ?? 0}</p><p className="text-[11px]" style={{ color: T.faint }}>funded</p></div>
                <div className="rounded-xl border p-2" style={{ borderColor: T.line }}><p className="text-sm font-semibold" style={{ color: T.ink }}>{budget.reserved ?? 0}</p><p className="text-[11px]" style={{ color: T.faint }}>reserved</p></div>
                <div className="rounded-xl border p-2" style={{ borderColor: T.line }}><p className="text-sm font-semibold" style={{ color: T.green }}>{budget.remaining ?? campaign.budget}</p><p className="text-[11px]" style={{ color: T.faint }}>remaining</p></div>
              </div>
              <div className="flex flex-wrap gap-2">
                {campaign.status === 'draft' && <Button disabled={busy} onClick={() => void action(campaign.id, 'submit')}><Send className="h-3.5 w-3.5" /> Submit</Button>}
                {campaign.status === 'funding_pending' && <Button disabled={busy} onClick={() => void action(campaign.id, 'fund')}><Wallet className="h-3.5 w-3.5" /> Confirm funds received</Button>}
                {['funded', 'matching'].includes(campaign.status) && <Button tone="primary" disabled={busy} onClick={() => void action(campaign.id, 'allocate')}><Users className="h-3.5 w-3.5" /> Match creators</Button>}
              </div>
              {campaign.matches?.length > 0 && (
                <div className="space-y-2 border-t pt-3" style={{ borderColor: T.line }}>
                  {campaign.matches.slice(0, 5).map((match: any) => (
                    <div key={match.id} className="flex flex-wrap items-center justify-between gap-2 text-[12px]" style={{ color: T.muted }}>
                      <span className="min-w-0 truncate">{match.creator?.fullName ?? match.creatorId}</span>
                      <span style={{ color: match.status === 'accepted' ? T.green : T.amber }}>{match.status}</span>
                      {match.status === 'accepted' && <Button disabled={busy} onClick={() => void verify(match.id)}>Verify fulfilment</Button>}
                      {match.status === 'fulfilled' && match.settlementStatus !== 'paid' && <Button disabled={busy} onClick={() => void retry(match.id)}>Retry settlement</Button>}
                    </div>
                  ))}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </Panel>
  );
}

function MatchesPanel() {
  const [matches, setMatches] = React.useState<any[]>([]);
  const [state, setState] = React.useState<'loading' | 'ready'>('loading');
  const [message, setMessage] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    const result = await briefApi.getMyAdvertiserMatches();
    if (result.ok) setMatches(result.data);
    setState('ready');
  }, []);
  React.useEffect(() => { void load(); }, [load]);

  const respond = async (id: string, accept: boolean) => {
    const result = accept ? await briefApi.acceptAdvertiserMatch(id) : await briefApi.declineAdvertiserMatch(id);
    setMessage(result.ok ? (accept ? 'Offer accepted.' : 'Offer declined.') : result.error);
    await load();
  };

  return (
    <Panel title="Creator matches" icon={Users}>
      <Notice message={message} error={Boolean(message && /failed|not|only|expired/i.test(message))} />
      {state === 'loading' && <div className="h-20 animate-pulse rounded-2xl" style={{ background: T.surface }} />}
      {state === 'ready' && matches.length === 0 && <div className="rounded-2xl border border-dashed p-6 text-center text-[13px]" style={{ borderColor: T.line, color: T.muted }}>No matching offers yet.</div>}
      <div className="space-y-2">
        {matches.map((match) => (
          <article key={match.id} className="rounded-2xl border p-4" style={{ borderColor: T.line, background: T.surface }}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0"><h3 className="text-sm font-semibold" style={{ color: T.ink }}>{match.campaignTitle}</h3><p className="mt-1 text-[12px]" style={{ color: T.muted }}>{match.serviceType} · {match.currency} {Number(match.quotedAmount).toLocaleString()}</p></div>
              <span className="text-[11px] uppercase" style={{ color: match.status === 'accepted' ? T.green : T.amber }}>{match.status}</span>
            </div>
            {match.status === 'proposed' && <div className="mt-3 flex gap-2"><Button tone="primary" onClick={() => void respond(match.id, true)}><Check className="h-3.5 w-3.5" /> Accept</Button><Button tone="danger" onClick={() => void respond(match.id, false)}><X className="h-3.5 w-3.5" /> Decline</Button></div>}
            {match.status === 'fulfilled' && <p className="mt-3 text-[12px]" style={{ color: match.settlementStatus === 'paid' ? T.green : T.amber }}>{match.settlementStatus === 'paid' ? 'Paid' : `Settlement ${match.settlementReason ?? 'pending'}`}</p>}
          </article>
        ))}
      </div>
    </Panel>
  );
}

function DistributionPanel() {
  const [campaigns, setCampaigns] = React.useState<any[]>([]);
  const [briefCampaigns, setBriefCampaigns] = React.useState<any[]>([]);
  const [assets, setAssets] = React.useState<any[]>([]);
  const [form, setForm] = React.useState({ campaignId: '', targetPlatform: 'WHATSAPP_STATUS', baseRedirectUrl: '', mediaAssetUrl: '', copyText: '' });
  const [briefCampaignId, setBriefCampaignId] = React.useState('');
  const [briefShare, setBriefShare] = React.useState<CampaignShare | null>(null);
  const [currentBanner, setCurrentBanner] = React.useState<any | null>(null);
  const [bannerForm, setBannerForm] = React.useState({ headline: '', body: '' });
  const [kit, setKit] = React.useState<any | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    const [campaignsResult, assetsResult, briefCampaignsResult] = await Promise.all([
      briefApi.getAdvertiserCampaigns(),
      briefApi.getAdAssets(),
      briefApi.getCampaigns()
    ]);
    if (campaignsResult.ok) {
      setCampaigns(campaignsResult.data);
      setForm((old) => ({ ...old, campaignId: old.campaignId || campaignsResult.data[0]?.id || '' }));
    }
    if (assetsResult.ok) setAssets(assetsResult.data);
    if (briefCampaignsResult.ok) {
      const published = briefCampaignsResult.data.filter((item) => ['published', 'live'].includes(item.status));
      setBriefCampaigns(published);
      setBriefCampaignId((old) => old || published[0]?.id || '');
    }
  }, []);
  React.useEffect(() => { void load(); }, [load]);

  React.useEffect(() => {
    let live = true;
    if (!briefCampaignId) {
      setBriefShare(null);
      setCurrentBanner(null);
      return () => { live = false; };
    }
    (async () => {
      const [shareResult, bannerResult] = await Promise.all([
        briefApi.getCampaignShare(briefCampaignId),
        briefApi.getCampaignBanner(briefCampaignId)
      ]);
      if (!live) return;
      setBriefShare(shareResult.ok ? shareResult.data : null);
      setCurrentBanner(bannerResult.ok ? bannerResult.data : null);
      const campaign = briefCampaigns.find((item) => item.id === briefCampaignId);
      if (campaign) {
        setBannerForm({
          headline: campaign.title || '',
          body: campaign.description || ''
        });
      }
    })();
    return () => { live = false; };
  }, [briefCampaignId, briefCampaigns]);

  const createStandaloneBanner = async () => {
    if (!briefCampaignId) return;
    setBusy(true); setMessage(null);
    const result = await briefApi.createCampaignBanner(briefCampaignId, {
      headline: bannerForm.headline,
      body: bannerForm.body
    });
    setBusy(false);
    setMessage(result.ok ? (result.data.reused ? 'This campaign already has a standalone banner.' : 'Standalone banner published to the home shelf.') : result.error);
    if (result.ok) setCurrentBanner(result.data.banner);
  };

  const archiveStandaloneBanner = async () => {
    if (!currentBanner?.id) return;
    setBusy(true); setMessage(null);
    const result = await briefApi.archiveCampaignBanner(currentBanner.id);
    setBusy(false);
    setMessage(result.ok ? 'Standalone banner archived.' : result.error);
    if (result.ok) setCurrentBanner(null);
  };

  const create = async () => {
    setBusy(true); setMessage(null);
    const result = await briefApi.createAdAsset({
      advertiserCampaignId: form.campaignId,
      targetPlatform: form.targetPlatform,
      baseRedirectUrl: form.baseRedirectUrl,
      mediaAssetUrl: form.mediaAssetUrl || undefined,
      optimizedCopyText: form.copyText || undefined
    });
    setBusy(false);
    setMessage(result.ok ? 'Asset created. Approve it before issuing the kit.' : result.error);
    if (result.ok) await load();
  };

  const assetAction = async (id: string, action: 'approve' | 'issue' | 'kit') => {
    setBusy(true);
    const result = action === 'approve' ? await briefApi.approveAdAsset(id) : action === 'issue' ? await briefApi.issueAdAsset(id) : await briefApi.getDistributionKit(id);
    setBusy(false);
    setMessage(result.ok ? (action === 'kit' ? 'Distribution kit loaded.' : 'Asset updated.') : result.error);
    if (result.ok && action === 'kit') setKit(result.data);
    else if (result.ok) await load();
  };

  const selectedBriefCampaign = briefCampaigns.find((item) => item.id === briefCampaignId) ?? null;

  return (
    <Panel title="Distribution kits" icon={Send}>
      {/* A first-class path for the product's common action: canonical link →
          WhatsApp intent → standalone banner on the home shelf. */}
      <div className="rounded-2xl border p-4 space-y-3" style={{ borderColor: T.ink, background: T.surface }}>
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 shrink-0 overflow-hidden rounded-xl bg-[#40916C]">
            <img src={whatsappBannerArt} alt="" aria-hidden="true" className="h-full w-full object-cover" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.16em]" style={{ color: T.ink }}>WhatsApp + home shelf</p>
            <h3 className="mt-1 text-[15px] font-extrabold" style={{ color: T.ink }}>Make one real link do more.</h3>
            <p className="mt-1 text-[12px] leading-relaxed" style={{ color: T.muted }}>Choose a published Brief campaign. The server supplies its canonical URL and WhatsApp share intent; you can then publish one standalone banner to the home shelf.</p>
          </div>
        </div>
        {briefCampaigns.length === 0 ? (
          <div className="rounded-xl border border-dashed p-3" style={{ borderColor: T.line }}>
            <p className="text-[12px] font-extrabold" style={{ color: T.ink }}>Publish a Brief campaign first.</p>
            <p className="mt-1 text-[11px] leading-snug" style={{ color: T.muted }}>This path does not accept a guessed URL or an unpublished draft. Use Create to make the real campaign, then return here.</p>
          </div>
        ) : (
          <>
            <label className="block space-y-1">
              <span className="text-[11px] font-semibold" style={{ color: T.muted }}>Published campaign</span>
              <select value={briefCampaignId} onChange={(event) => setBriefCampaignId(event.target.value)} className="w-full rounded-xl border px-3 py-2.5 text-[13px] outline-none" style={{ borderColor: T.line, background: T.bg, color: T.ink }}>
                {briefCampaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.title} · {campaign.status}</option>)}
              </select>
            </label>
            <div className="rounded-xl border p-3" style={{ borderColor: T.line, background: T.bg }}>
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-[12px] font-extrabold" style={{ color: T.ink }}>{selectedBriefCampaign?.title}</p>
                <span className="text-[11px] font-bold uppercase" style={{ color: T.green }}>{selectedBriefCampaign?.status}</span>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <Field label="Banner headline" value={bannerForm.headline} onChange={(headline) => setBannerForm((old) => ({ ...old, headline }))} placeholder="Use the campaign title" />
                <Field label="Banner support text" value={bannerForm.body} onChange={(body) => setBannerForm((old) => ({ ...old, body }))} placeholder="One useful line" />
              </div>
            </div>
            {currentBanner ? (
              <>
                <StandaloneBanner banner={currentBanner} />
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-bold" style={{ color: T.green }}>Live on the home shelf</span>
                  <Button disabled={busy} onClick={() => void archiveStandaloneBanner()}>Archive banner</Button>
                </div>
              </>
            ) : (
              <Button tone="primary" disabled={busy || !briefCampaignId} onClick={() => void createStandaloneBanner()}><Plus className="h-3.5 w-3.5" /> Create standalone banner</Button>
            )}
            {briefShare && (
              <div className="border-t pt-3" style={{ borderColor: T.line }}>
                <p className="mb-2 text-[11px] font-extrabold uppercase tracking-[0.14em]" style={{ color: T.muted }}>Canonical share link</p>
                <CampaignDistribution
                  link={briefShare}
                  title={selectedBriefCampaign?.title ?? 'Brief campaign'}
                  onCopy={() => {
                    if (!briefShare.available) return;
                    void navigator.clipboard?.writeText(briefShare.url);
                    setMessage('Campaign link copied.');
                  }}
                  onShare={(channel) => { void briefApi.shareCampaign(briefCampaignId, channel); }}
                />
              </div>
            )}
          </>
        )}
      </div>

      <div className="rounded-2xl border p-4 space-y-3" style={{ borderColor: T.line, background: T.surface }}>
        <label className="block space-y-1"><span className="text-[11px] font-semibold" style={{ color: T.muted }}>Advertiser campaign</span><select value={form.campaignId} onChange={(event) => setForm((old) => ({ ...old, campaignId: event.target.value }))} className="w-full rounded-xl border px-3 py-2.5 text-[13px] outline-none" style={{ borderColor: T.line, background: T.bg, color: T.ink }}>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.title}</option>)}</select></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Redirect URL" value={form.baseRedirectUrl} onChange={(baseRedirectUrl) => setForm((old) => ({ ...old, baseRedirectUrl }))} placeholder="https://brief.example/c/..." />
          <ImageField
            label="Media"
            hint="The creative for this asset. Upload it, or use a link you have the rights to."
            value={form.mediaAssetUrl || null}
            onChange={(url) => setForm((old) => ({ ...old, mediaAssetUrl: url ?? '' }))}
            compact
          />
        </div>
        <Field label="Copy" value={form.copyText} onChange={(copyText) => setForm((old) => ({ ...old, copyText }))} placeholder="Your approved campaign copy" />
        <div className="flex flex-wrap items-center gap-2"><select value={form.targetPlatform} onChange={(event) => setForm((old) => ({ ...old, targetPlatform: event.target.value }))} className="rounded-xl border px-3 py-2 text-[12px]" style={{ borderColor: T.line, background: T.bg, color: T.ink }}><option value="WHATSAPP_STATUS">WhatsApp Status</option><option value="FB_POST">Facebook</option></select><Button tone="primary" disabled={busy || !form.campaignId || !form.baseRedirectUrl} onClick={() => void create()}><Plus className="h-3.5 w-3.5" /> Create asset</Button></div>
      </div>
      <Notice message={message} />
      <div className="space-y-2">{assets.map((asset) => <article key={asset.id} className="rounded-2xl border p-3" style={{ borderColor: T.line, background: T.surface }}><div className="flex items-center justify-between gap-2"><p className="truncate text-[13px] font-semibold" style={{ color: T.ink }}>{asset.targetPlatform}</p><span className="text-[11px] uppercase" style={{ color: T.green }}>{asset.status}</span></div><p className="mt-1 truncate font-mono text-[11px]" style={{ color: T.faint }}>{asset.uniqueTrackingHash}</p><div className="mt-2 flex flex-wrap gap-2">{asset.status === 'draft' && <Button disabled={busy} onClick={() => void assetAction(asset.id, 'approve')}><Check className="h-3.5 w-3.5" /> Approve</Button>}{asset.status === 'approved' && <Button disabled={busy} onClick={() => void assetAction(asset.id, 'issue')}><Send className="h-3.5 w-3.5" /> Issue kit</Button>}{['approved', 'issued'].includes(asset.status) && <Button disabled={busy} onClick={() => void assetAction(asset.id, 'kit')}><ExternalLink className="h-3.5 w-3.5" /> View kit</Button>}</div></article>)}</div>
      {kit && <div className="rounded-2xl border p-4" style={{ borderColor: T.green, background: T.surface }}><div className="flex items-center justify-between"><h3 className="text-sm font-semibold" style={{ color: T.ink }}>Kit</h3><span className="text-[11px] uppercase" style={{ color: T.green }}>{kit.available ? 'ready' : 'blocked'}</span></div><pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words text-[11px]" style={{ color: T.muted }}>{JSON.stringify(kit, null, 2)}</pre></div>}
    </Panel>
  );
}

function CalendarPanel() {
  const [entries, setEntries] = React.useState<any[]>([]);
  const [form, setForm] = React.useState({ kind: 'campaign', sourceId: '', startsAt: '', endsAt: '' });
  const [message, setMessage] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const load = React.useCallback(async () => { const result = await briefApi.getCalendarEntries(); if (result.ok) setEntries(result.data); }, []);
  React.useEffect(() => { void load(); }, [load]);
  const create = async () => { setBusy(true); const result = await briefApi.createCalendarEntry(form); setBusy(false); setMessage(result.ok ? 'Calendar entry saved.' : result.error); if (result.ok) { setForm({ kind: 'campaign', sourceId: '', startsAt: '', endsAt: '' }); await load(); } };
  const sweep = async () => { setBusy(true); const result = await briefApi.sweepCalendar(); setBusy(false); setMessage(result.ok ? `Sweep: ${JSON.stringify(result.data)}` : result.error); await load(); };

  // --- the wait-list half of capacity --------------------------------------
  // Joining happens on the campaign itself; reading the queue and accepting
  // an offer happened nowhere. Both are real server rows, and the public
  // queue deliberately shows positions and statuses only — no names, no
  // contacts. Accepting requires the entry id plus the attendee reference
  // you were given when you joined (or your signed-in identity).
  const [queueSlug, setQueueSlug] = React.useState('');
  const [queue, setQueue] = React.useState<any[] | null>(null);
  const [queueError, setQueueError] = React.useState<string | null>(null);
  const [acceptId, setAcceptId] = React.useState('');
  const [acceptRef, setAcceptRef] = React.useState('');
  const [acceptBusy, setAcceptBusy] = React.useState(false);
  const [acceptResult, setAcceptResult] = React.useState<string | null>(null);
  const [acceptError, setAcceptError] = React.useState<string | null>(null);
  const loadQueue = async () => {
    const slug = queueSlug.trim();
    if (!slug) return;
    setQueue(null); setQueueError(null);
    const result = await briefApi.getCampaignWaitlist(slug);
    if (result.ok) setQueue(result.data); else setQueueError(result.error);
  };
  const accept = async () => {
    const id = acceptId.trim();
    if (!id) return;
    setAcceptBusy(true); setAcceptResult(null); setAcceptError(null);
    const result = await briefApi.acceptWaitlistOffer(id, acceptRef.trim() || undefined);
    setAcceptBusy(false);
    if (!result.ok) { setAcceptError(result.error); return; }
    const reg = (result.data as any)?.registration;
    setAcceptResult(reg?.ticketCode
      ? `Registered. Your ticket: ${reg.ticketCode}`
      : 'Registered.');
    setAcceptId(''); setAcceptRef('');
    if (queueSlug.trim()) await loadQueue();
  };
  return (
    <Panel title="Calendar and waiting lists" icon={CalendarDays}>
      <div className="rounded-2xl border p-4 space-y-3" style={{ borderColor: T.line, background: T.surface }}>
        <h3 className="text-sm font-semibold" style={{ color: T.ink }}>Wait-list queue</h3>
        <p className="text-[12px] leading-relaxed" style={{ color: T.muted }}>
          When an event is full, joiners queue by position. The queue below shows real positions and offer statuses — never names or contacts.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Campaign slug" value={queueSlug} onChange={setQueueSlug} placeholder="the public event address" />
          <Button disabled={busy || !queueSlug.trim()} onClick={() => void loadQueue()}><Users className="h-3.5 w-3.5" /> Show queue</Button>
        </div>
        {queueError && <p className="text-[12px]" style={{ color: T.muted }}>{queueError}</p>}
        {queue && queue.length === 0 && <p className="text-[12px]" style={{ color: T.muted }}>Nobody is waiting for this one.</p>}
        {queue && queue.length > 0 && (
          <ul className="space-y-1.5">
            {queue.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-2 rounded-xl border px-3 py-2" style={{ borderColor: T.line, background: T.bg }}>
                <span className="text-[12px] font-semibold" style={{ color: T.ink }}>Position {row.position}</span>
                <span className="text-[11px] uppercase" style={{ color: row.status === 'offered' ? T.green : T.muted }}>{row.status}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t pt-3 space-y-2" style={{ borderColor: T.line }}>
          <p className="text-[13px] font-semibold" style={{ color: T.ink }}>Accept an offer</p>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Entry id" value={acceptId} onChange={setAcceptId} placeholder="wl_…" />
            <Field label="Attendee reference" value={acceptRef} onChange={setAcceptRef} placeholder="given when you joined" />
            <Button tone="primary" disabled={acceptBusy || !acceptId.trim()} onClick={() => void accept()}><Check className="h-3.5 w-3.5" /> {acceptBusy ? 'Accepting…' : 'Accept offer'}</Button>
          </div>
          {acceptError && <p className="text-[12px]" style={{ color: T.muted }}>{acceptError}</p>}
          {acceptResult && <p className="text-[12px]" style={{ color: T.green }}>{acceptResult}</p>}
        </div>
      </div>
      <div className="rounded-2xl border p-4 space-y-3" style={{ borderColor: T.line, background: T.surface }}><div className="grid gap-3 sm:grid-cols-2"><label className="block space-y-1"><span className="text-[11px] font-semibold" style={{ color: T.muted }}>Source kind</span><select value={form.kind} onChange={(event) => setForm((old) => ({ ...old, kind: event.target.value }))} className="w-full rounded-xl border px-3 py-2.5 text-[13px]" style={{ borderColor: T.line, background: T.bg, color: T.ink }}><option value="campaign">Brief campaign</option><option value="advertiser_campaign">Advertiser campaign</option></select></label><Field label="Source ID" value={form.sourceId} onChange={(sourceId) => setForm((old) => ({ ...old, sourceId }))} placeholder="camp_..." /><Field label="Starts at" value={form.startsAt} onChange={(startsAt) => setForm((old) => ({ ...old, startsAt }))} placeholder="2026-09-01T10:00:00Z" /><Field label="Ends at" value={form.endsAt} onChange={(endsAt) => setForm((old) => ({ ...old, endsAt }))} placeholder="2026-09-01T18:00:00Z" /></div><div className="flex flex-wrap gap-2"><Button tone="primary" disabled={busy || !form.sourceId || !form.startsAt} onClick={() => void create()}><Plus className="h-3.5 w-3.5" /> Add to calendar</Button><Button disabled={busy} onClick={() => void sweep()}><Clock className="h-3.5 w-3.5" /> Run expiry sweep</Button></div></div>
      <Notice message={message} />
      <div className="space-y-2">{entries.map((entry) => <div key={entry.id} className="flex items-center justify-between gap-3 rounded-2xl border p-3" style={{ borderColor: T.line, background: T.surface }}><div className="min-w-0"><p className="truncate text-[13px] font-semibold" style={{ color: T.ink }}>{entry.title ?? entry.sourceId}</p><p className="text-[11px]" style={{ color: T.muted }}>{entry.startsAt} · {entry.status}</p></div><span className="text-[11px] uppercase" style={{ color: T.green }}>{entry.kind}</span></div>)}</div>
    </Panel>
  );
}

function VendorsPanel() {
  const [vendor, setVendor] = React.useState<any | null>(null);
  const [form, setForm] = React.useState({ displayName: '', description: '' });
  const [services, setServices] = React.useState<string[]>([]);
  const [regions, setRegions] = React.useState('KE');
  const [escrowSupported, setEscrowSupported] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const load = React.useCallback(async () => { const result = await briefApi.getMyVendor(); if (result.ok) setVendor(result.data); }, []);
  React.useEffect(() => { void load(); }, [load]);

  // --- the directory half: every active seller, from the real rows ----------
  // getVendors existed with no caller: the panel could create a profile but
  // never show the market of sellers it was joining. The list is honest about
  // what it is — names and statuses the server publishes, nothing invented.
  const [directory, setDirectory] = React.useState<any[] | null>(null);
  const [directoryError, setDirectoryError] = React.useState<string | null>(null);
  const [editName, setEditName] = React.useState('');
  const [editDescription, setEditDescription] = React.useState('');
  const [editStatus, setEditStatus] = React.useState('active');
  const [editBusy, setEditBusy] = React.useState(false);
  const [editMessage, setEditMessage] = React.useState<string | null>(null);
  const loadDirectory = React.useCallback(async () => {
    setDirectoryError(null);
    const result = await briefApi.getVendors();
    if (result.ok) setDirectory(result.data); else { setDirectory([]); setDirectoryError(result.error); }
  }, []);
  React.useEffect(() => { void loadDirectory(); }, [loadDirectory]);
  React.useEffect(() => {
    if (vendor) { setEditName(vendor.displayName ?? ''); setEditDescription(vendor.description ?? ''); setEditStatus(vendor.status ?? 'active'); }
  }, [vendor]);
  const saveProfile = async () => {
    if (!vendor) return;
    setEditBusy(true); setEditMessage(null);
    const result = await briefApi.updateVendor(vendor.id, {
      displayName: editName.trim() || undefined,
      description: editDescription,
      status: editStatus as any
    });
    setEditBusy(false);
    if (!result.ok) { setEditMessage(result.error); return; }
    setEditMessage('Profile saved.');
    setVendor(result.data);
    await loadDirectory();
  };
  const create = async () => { setBusy(true); const result = await briefApi.createVendor({ displayName: form.displayName, description: form.description, contactMethod: null }); setBusy(false); setMessage(result.ok ? 'Vendor profile created.' : result.error); if (result.ok) { setVendor(result.data); setForm({ displayName: '', description: '' }); } };
  const loadCapabilities = async () => { if (!vendor) return; const result = await briefApi.getVendorCapabilities(vendor.id); if (result.ok && result.data.capabilities) { setServices(result.data.capabilities.services ?? []); setRegions((result.data.capabilities.regions ?? ['KE']).join(', ')); setEscrowSupported(result.data.capabilities.escrowSupported === true); } };
  React.useEffect(() => { void loadCapabilities(); }, [vendor]);
  const save = async () => { if (!vendor) return; setBusy(true); const result = await briefApi.updateVendorCapabilities(vendor.id, { services, regions: parseList(regions), escrowSupported }); setBusy(false); setMessage(result.ok ? 'Vendor capabilities saved.' : result.error); };
  const allServices = ['supplier', 'transport', 'printing', 'pod', 'design'];
  return (
    <Panel title="Vendor syndication" icon={Briefcase}>
      {!vendor ? <div className="rounded-2xl border p-4 space-y-3" style={{ borderColor: T.line, background: T.surface }}><h3 className="text-sm font-semibold" style={{ color: T.ink }}>Create vendor profile</h3><Field label="Business name" value={form.displayName} onChange={(displayName) => setForm((old) => ({ ...old, displayName }))} placeholder="Studio or supplier" /><Field label="Description" value={form.description} onChange={(description) => setForm((old) => ({ ...old, description }))} placeholder="What you provide" /><Button tone="primary" disabled={busy || !form.displayName.trim()} onClick={() => void create()}><Plus className="h-3.5 w-3.5" /> Create profile</Button></div> : <div className="rounded-2xl border p-4 space-y-3" style={{ borderColor: T.line, background: T.surface }}><div><h3 className="text-sm font-semibold" style={{ color: T.ink }}>{vendor.displayName}</h3><p className="mt-1 text-[12px]" style={{ color: T.muted }}>Capability declarations do not self-verify a license.</p></div><div className="flex flex-wrap gap-2">{allServices.map((service) => <button type="button" key={service} onClick={() => setServices((old) => old.includes(service) ? old.filter((item) => item !== service) : [...old, service])} className="rounded-full border px-3 py-1.5 text-[12px] font-semibold" style={{ borderColor: services.includes(service) ? T.green : T.line, color: services.includes(service) ? T.green : T.muted, background: T.bg }}>{service}</button>)}</div><Field label="Regions" value={regions} onChange={setRegions} placeholder="KE, NG" /><label className="flex items-center gap-2 text-[12px]" style={{ color: T.muted }}><input type="checkbox" checked={escrowSupported} onChange={(event) => setEscrowSupported(event.target.checked)} /> Escrow-compatible</label><Button tone="primary" disabled={busy} onClick={() => void save()}><Check className="h-3.5 w-3.5" /> Save capabilities</Button></div>}
      <Notice message={message} />
      {vendor && <div className="rounded-2xl border p-4 space-y-3" style={{ borderColor: T.line, background: T.surface }}><p className="text-[11px] uppercase tracking-[0.14em]" style={{ color: T.faint }}>Your seller profile</p><div className="grid gap-3 sm:grid-cols-2"><Field label="Business name" value={editName} onChange={setEditName} placeholder="Studio or supplier" /><Field label="Description" value={editDescription} onChange={setEditDescription} placeholder="What you provide" /></div><label className="block space-y-1"><span className="text-[11px] font-semibold" style={{ color: T.muted }}>Status</span><select value={editStatus} onChange={(event) => setEditStatus(event.target.value)} className="w-full rounded-xl border px-3 py-2.5 text-[13px]" style={{ borderColor: T.line, background: T.bg, color: T.ink }}><option value="active">active — visible to buyers</option><option value="paused">paused — hidden from browse</option><option value="closed">closed — no longer selling</option></select></label><Button tone="primary" disabled={editBusy || !editName.trim()} onClick={() => void saveProfile()}><Check className="h-3.5 w-3.5" /> {editBusy ? 'Saving…' : 'Save profile'}</Button>{editMessage && <p className="text-[12px]" style={{ color: T.muted }}>{editMessage}</p>}</div>}
      <div className="rounded-2xl border p-4 space-y-2" style={{ borderColor: T.line, background: T.surface }}><div className="flex items-center justify-between"><p className="text-[11px] uppercase tracking-[0.14em]" style={{ color: T.faint }}>Seller directory</p><Button disabled={busy} onClick={() => void loadDirectory()}><Users className="h-3.5 w-3.5" /> Refresh</Button></div>{directoryError && <p className="text-[12px]" style={{ color: T.muted }}>{directoryError}</p>}{directory === null && <p className="text-[12px]" style={{ color: T.muted }}>Loading sellers…</p>}{directory !== null && directory.length === 0 && !directoryError && <p className="text-[12px]" style={{ color: T.muted }}>No sellers yet. The directory fills as vendors create profiles.</p>}{directory !== null && directory.length > 0 && <ul className="space-y-1.5">{directory.map((row) => <li key={row.id} className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2" style={{ borderColor: T.line, background: T.bg }}><div className="min-w-0"><p className="truncate text-[13px] font-semibold" style={{ color: T.ink }}>{row.displayName}</p><p className="truncate text-[11px]" style={{ color: T.muted }}>{row.description || 'No description yet.'}</p></div><span className="shrink-0 text-[11px] uppercase" style={{ color: row.status === 'active' ? T.green : T.muted }}>{row.status}</span></li>)}</ul>}</div>
      {vendor && <div className="rounded-2xl border p-4" style={{ borderColor: T.line, background: T.surface }}><p className="text-[11px] uppercase tracking-[0.14em]" style={{ color: T.faint }}>Performance evidence</p><div className="mt-2 grid grid-cols-3 gap-2 text-center"><div><p className="text-sm font-semibold" style={{ color: T.ink }}>{vendor.activeListingCount ?? 0}</p><p className="text-[11px]" style={{ color: T.faint }}>active listings</p></div><div><p className="text-sm font-semibold" style={{ color: T.ink }}>{vendor.verification?.verifiedCount ?? 0}</p><p className="text-[11px]" style={{ color: T.faint }}>evidence</p></div><div><p className="text-sm font-semibold" style={{ color: T.green }}>{vendor.status ?? 'active'}</p><p className="text-[11px]" style={{ color: T.faint }}>status</p></div></div></div>}
    </Panel>
  );
}

function AiPanel() {
  const [status, setStatus] = React.useState<any | null>(null);
  React.useEffect(() => { briefApi.getAssistStatus().then((result) => { if (result.ok) setStatus(result.data); }); }, []);
  return (
    <Panel title="AI review" icon={Zap}>
      <div className="rounded-2xl border p-4 space-y-3" style={{ borderColor: T.line, background: T.surface }}><div className="flex items-center justify-between"><h3 className="text-sm font-semibold" style={{ color: T.ink }}>Suggestions</h3><span className="text-[11px] uppercase" style={{ color: status?.configured ? T.green : T.amber }}>{status ? (status.configured ? 'ready' : 'provider required') : 'checking'}</span></div><p className="text-[12px] leading-relaxed" style={{ color: T.muted }}>AI can draft copy and explain matches. It cannot publish, verify identity or settle money without an explicit human action.</p>{status?.reason && <p className="text-[11px]" style={{ color: T.faint }}>{status.reason}</p>}</div>
    </Panel>
  );
}

export function YardEngineDesk({ section }: { section: YardSection }) {
  if (section === 'campaigns') return <CampaignsPanel />;
  if (section === 'matches') return <MatchesPanel />;
  if (section === 'distribution') return <DistributionPanel />;
  if (section === 'calendar') return <CalendarPanel />;
  if (section === 'vendors') return <VendorsPanel />;
  return <AiPanel />;
}

export default YardEngineDesk;
