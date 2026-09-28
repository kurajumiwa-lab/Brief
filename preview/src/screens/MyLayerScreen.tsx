import React, { useMemo, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { BadgeCheck } from 'lucide-react';
import { ShieldCheck } from 'lucide-react';
import * as briefApi from '../api/briefApi';
import type { Campaign as ApiCampaign, CampaignType as ApiCampaignType } from '../api/types';
import { SAVED_BUNDLES, SAVED_TABS } from '../ui/names';
import type { BriefObject, ConnectedSource, Destination, GroupCommandResult, MyLayerSection, ObjectRelationship, WorkflowSection , GroupAccess, GroupKnowledgeEntry, ObjectType, Quest, SaveLabel } from '../model/core';
import { SAVE_LABELS, GROUP_MESSAGES, formatSourceDate, getDistanceLabel, getUnansweredQuestions, resolveAction, getBriefRank, runGroupCommand } from "../model/core";

import { Bookmark } from 'lucide-react';
import { Plus } from 'lucide-react';
import { Search } from 'lucide-react';
import { Share2 } from 'lucide-react';
import { Trash2 } from 'lucide-react';
import { Circles } from '../components/Circles';
import { ConnectedGroups } from '../components/ConnectedGroups';
import { CreatorProfilePanel } from '../components/CreatorPanels';
import { MessagesPanel } from '../components/CreatorPanels';
import { MyTickets } from '../components/MyTickets';
import { OpportunitiesPanel } from '../components/CreatorPanels';
import RewardsDesk from '../components/RewardsDesk';
import { SubscriptionsPanel } from '../components/CreatorPanels';
import { VerificationPanel } from '../components/VerificationPanel';


// NOTE: prop type names left as-written in App (types not yet exported): ApiCampaign, ApiCampaignType

// ---------------------------------------------------------------------------
// MY-LAYER SCREEN — extracted from App.tsx (Phase 1: JSX move; shell keeps
// the state, and the colocation pass tightens types afterwards). Section
// switching is verbatim; what each section renders did not change.
// ---------------------------------------------------------------------------

export interface MyLayerScreenProps {
  openGroupId: string | null;
  quests: Quest[];
  sessionUser: briefApi.AuthedUser | null;
  selectedLocation: string;
  setGroups: React.Dispatch<React.SetStateAction<ConnectedSource[]>>;
  setPersonalState: React.Dispatch<React.SetStateAction<briefApi.PersonalState | null>>;
  setRelationships: React.Dispatch<React.SetStateAction<ObjectRelationship[]>>;
  setSavedGroupEntryIds: React.Dispatch<React.SetStateAction<string[]>>;
  activeTab: Destination;
  beginEdit: any;
  campaignBusy: boolean;
  campaignState: {
    status: 'idle' | 'loading' | 'ready' | 'error';
    data: ApiCampaign[] | null;
    error: string | null;
  };
  draft: {
    title: string;
    type: ApiCampaignType;
    description: string;
    location: string;
    startsAt: string;
    capacity: string;
    price: string;
    circleId: string;
  };
  graph: any;
  groupIndex: any;
  groupIndexes: any;
  groups: ConnectedSource[];
  handleCreatePursuit: any;
  handleExecuteProtocolAction: any;
  handleRemoveCampaign: any;
  loadCampaigns: any;
  myContribution: any;
  myLayerSection: MyLayerSection;
  objects: BriefObject[];
  openCampaign: any;
  openGroup: any;
  relationships: ObjectRelationship[];
  savedObjects: any;
  setActiveTab: React.Dispatch<React.SetStateAction<Destination>>;
  setCampaignActionError: React.Dispatch<React.SetStateAction<string | null>>;
  setCampaignBusy: React.Dispatch<React.SetStateAction<boolean>>;
  setCreateStep: React.Dispatch<React.SetStateAction<'closed' | 'form' | 'preview' | 'published'>>;
  setDraft: React.Dispatch<React.SetStateAction<{
    title: string;
    type: ApiCampaignType;
    description: string;
    location: string;
    startsAt: string;
    capacity: string;
    price: string;
    circleId: string;
  }>>;
  setMyLayerSection: React.Dispatch<React.SetStateAction<MyLayerSection>>;
  setObjectPicker: React.Dispatch<React.SetStateAction<{
    open: boolean;
    status: 'idle' | 'loading' | 'ready' | 'error';
    data: any[] | null;
    error: string | null;
    selected: { id: string; title: string } | null;
  }>>;
  setOpenGroupId: React.Dispatch<React.SetStateAction<string | null>>;
  setPublishedCampaign: React.Dispatch<React.SetStateAction<ApiCampaign | null>>;
  setSelectedObjectForDetail: any;
  setWorkflowSection: React.Dispatch<React.SetStateAction<WorkflowSection>>;
  setWorkflowView: React.Dispatch<React.SetStateAction<'queue' | 'screen'>>;
  shareCampaign: any;
  showToast: any;
  visibleGroups: any;
}

export function MyLayerScreen(props: MyLayerScreenProps) {
  const {
    activeTab,
    beginEdit,
    campaignBusy,
    campaignState,
    draft,
    graph,
    groupIndex,
    groupIndexes,
    groups,
    handleCreatePursuit,
    handleExecuteProtocolAction,
    handleRemoveCampaign,
    loadCampaigns,
    myContribution,
    myLayerSection,
    objects,
    openCampaign,
    openGroup,
    relationships,
    savedObjects,
    setActiveTab,
    setCampaignActionError,
    setCampaignBusy,
    setCreateStep,
    setDraft,
    setMyLayerSection,
    setObjectPicker,
    setOpenGroupId,
    setPublishedCampaign,
    setSelectedObjectForDetail,
    setWorkflowSection,
    setWorkflowView,
    shareCampaign,
    showToast,
    visibleGroups,
    openGroupId,
    quests,
    sessionUser,
    selectedLocation,
    setGroups,
    setPersonalState,
    setRelationships,
    setSavedGroupEntryIds,
  } = props;

  // -- colocated from App (ownership pass) -----------------------------------
  const activeSavedBundle = SAVED_BUNDLES.find((b) =>
    (b.sections as readonly string[]).includes(myLayerSection)
  ) ?? SAVED_BUNDLES[0];

  const campaignsLive = (campaignState.data ?? []).filter(
    (c) => c.status === 'published' || c.status === 'live'
  );

  const campaignsDraft = (campaignState.data ?? []).filter((c) => c.status === 'draft');

  const campaignsPast = (campaignState.data ?? []).filter(
    (c) => c.status === 'closed' || c.status === 'completed' || c.status === 'cancelled'
  );

  const savedGroups = useMemo(() => {
    const order: { type: ObjectType; label: string }[] = [
      { type: 'place', label: 'Places' },
      { type: 'service', label: 'Services' },
      { type: 'opportunity', label: 'Opportunities' },
      { type: 'product', label: 'Products' },
      { type: 'experience', label: 'Events' },
      { type: 'knowledge', label: 'Information' },
      { type: 'identity', label: 'Organisations' },
      { type: 'business', label: 'Businesses' },
      { type: 'offer', label: 'Offers' },
      { type: 'news', label: 'News' },
      { type: 'alert', label: 'Alerts' },
      { type: 'announcement', label: 'Announcements' }
    ];

    return order
      .map(({ type, label }) => ({
        label,
        items: savedObjects.filter((obj: any) => obj.type === type)
      }))
      .filter(({ items }) => items.length > 0);
  }, [savedObjects]);

  const handleSetSaveLabel = (object: BriefObject, label: SaveLabel) => {
    setRelationships((prev) =>
      prev.map((r) =>
        r.targetId === object.id && r.verb === 'saved'
          ? { ...r, label: r.label === label ? undefined : label, updatedAt: new Date().toISOString() }
          : r
      )
    );
  };

  const unansweredQuestions = useMemo(
    () => getUnansweredQuestions(groupIndex),
    [groupIndex]
  );

  const handleRevokeGroup = (id: string) => {
    setGroups((prev) =>
      prev.map((g) => (g.id === id ? { ...g, access: 'revoked' as GroupAccess } : g))
    );
    if (openGroupId === id) setOpenGroupId(null);
    showToast('Access revoked. Brief will stop reading this group.');
  };

  const handleSaveGroupEntry = (entry: GroupKnowledgeEntry) => {
    const group = visibleGroups.find((g: any) => g.id === entry.groupId);
    if (!group || !group.permissions?.canRetain) {
      showToast('This group does not allow saving.');
      return;
    }
    setSavedGroupEntryIds((prev) =>
      prev.includes(entry.id) ? prev : [...prev, entry.id]
    );
    showToast('Saved with its source.');
  };

  const handleViewSource = (entry: GroupKnowledgeEntry) => {
    const group = visibleGroups.find((g: any) => g.id === entry.groupId);
    // Brief states where it came from. It does not fabricate a deep link into
    // a platform that may not support one.
    showToast(
      `${entry.source.sourceType} in ${group ? group.name : 'this group'} - ` +
        `${formatSourceDate(entry.source.timestamp)}`
    );
  };

  const myRank = useMemo(() => getBriefRank(myContribution), [myContribution]);

  // §12 — trust/verification + standing, fetched from the real server. The
  // profile header shows only what the server actually records: which
  // verification kinds (phone/email/identity) are approved, and the derived
  // activity standing (hosted/bought/arrived/registered). Nothing invented.
  const [profileVerification, setProfileVerification] = useState<Record<string, 'verified' | 'pending' | 'unverified'> | null>(null);
  const [profileStanding, setProfileStanding] = useState<briefApi.PersonStanding | null>(null);

  React.useEffect(() => {
    if (!sessionUser) return;
    let live = true;
    briefApi.getMyVerification().then((r) => { if (live && r.ok) setProfileVerification(r.data.standing); });
    briefApi.getPersonMe().then((r) => { if (live && r.ok) setProfileStanding(r.data.standing ?? null); });
    return () => { live = false; };
  }, [sessionUser]);

  const pendingCount = useMemo(
    () => quests.filter((q: Quest) => q.status === 'submitted').length,
    [quests]
  );

  const CURRENT_PLAYER_ID = sessionUser?.id ?? '';

  const [commandText, setCommandText] = useState('');

  const [commandResult, setCommandResult] = useState<GroupCommandResult | null>(null);

  const handleRunCommand = (override?: string) => {
    const raw = (override ?? commandText).trim();
    if (raw === '' || !openGroup) return;

    // A bare question is treated as /ask, so members never have to learn
    // command syntax to get an answer.
    const normalised = raw.startsWith('/') ? raw : `/ask ${raw}`;

    const result = runGroupCommand(normalised, {
      entries: groupIndex,
      objects,
      savedObjects,
      now: new Date('2026-08-15T00:00:00Z')
    });

    if (!result) {
      showToast('Unknown command');
      setCommandResult(null);
      return;
    }
    setCommandResult(result);
  };

  const handleUnsave = (object: BriefObject) => {
    setRelationships((prev) =>
      prev.filter(
        (rel) => !(rel.targetId === object.id && rel.verb === 'saved')
      )
    );
    // Durable copy stays in step: the server-side save is removed too.
    void briefApi.unsaveObjectForMe(object.id).then((r) => {
      if (r.ok) setPersonalState((p) => (p ? { ...p, saved: r.data.saved } : p));
    });
    showToast(`Removed "${object.title}" from your saved things.`);
  };

  return (
    <>
{ (
          <div className="max-w-3xl mx-auto px-4 pt-3 pb-1">
            {/* §12 — immersive profile header. Every field is real: the monogram
                comes from the display name, the counts are the actual saved
                objects / groups / matches already held in this screen. Nothing
                here is decorative or invented. */}
            {sessionUser && (
              <section aria-label="Your profile" className="mb-3 overflow-hidden rounded-2xl border border-[var(--brief-line)] bg-[color:var(--color-paper)]">
                <div className="relative h-16 bg-gradient-to-r from-[#40916C] via-[#40916C]/70 to-[#0891B2]/50" aria-hidden="true" />
                <div className="px-4 pb-3.5 -mt-6">
                  <div className="flex items-end gap-3">
                    <div className="h-14 w-14 shrink-0 rounded-2xl border-2 border-[var(--color-paper)] bg-gradient-to-br from-[#40916C] to-[#0891B2] flex items-center justify-center text-[32px] font-black text-[var(--brief-ink)] shadow-lg" aria-hidden="true">
                      {(sessionUser.displayName || sessionUser.handle || '?').charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1 pb-0.5">
                      <h1 className="truncate text-[32px] font-extrabold tracking-tight text-[var(--brief-ink)] leading-tight">
                        {sessionUser.displayName || sessionUser.handle || 'You'}
                      </h1>
                      <p className="truncate text-[12px] font-semibold text-[var(--ink-70)]">
                        {sessionUser.handle ? `@${sessionUser.handle}` : ''}
                        {sessionUser.handle && selectedLocation && selectedLocation !== 'Your area' ? ' · ' : ''}
                        {selectedLocation && selectedLocation !== 'Your area' ? selectedLocation : ''}
                      </p>
                    </div>
                  </div>

                  {/* §12 — trust & verification. Real server standing only: the
                      rank is derived from accepted contribution, and the
                      verified chips are the kinds the server has actually
                      approved. Neither is invented. */}
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5" aria-label="Trust and verification">
                    <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--color-well)] border border-[var(--brief-line)] px-2.5 py-1 text-[11px] font-extrabold text-[var(--brief-ink)]">
                      <ShieldCheck className="h-3 w-3 text-[#0891B2]" aria-hidden="true" />
                      {myRank}
                    </span>
                    {profileVerification && (() => {
                      const kinds: [string, string][] = [['phone', 'Phone'], ['email', 'Email'], ['identity', 'Identity']];
                      const verified = kinds.filter(([k]) => profileVerification[k] === 'verified');
                      if (verified.length === 0) return null;
                      return verified.map(([k, label]) => (
                        <span key={k} className="inline-flex items-center gap-1 rounded-full bg-[color:var(--color-well)] border border-[var(--brief-line)] px-2.5 py-1 text-[11px] font-bold text-[var(--ink-70)]">
                          <BadgeCheck className="h-3 w-3 text-[#059669]" aria-hidden="true" />
                          {label}
                        </span>
                      ));
                    })()}
                  </div>

                  {/* §12 — contribution summary. Every number is real: saved
                      comes from the user's own kept objects; hosted/bought/
                      arrived come from the server's derived standing. */}
                  <div className="mt-3 flex flex-wrap gap-2" aria-label="Contribution summary">
                    {(() => {
                      const stats: { label: string; value: number }[] = [
                        { label: 'saved', value: (savedObjects ?? []).length },
                        { label: 'hosted', value: profileStanding?.hosted ?? 0 },
                        { label: 'arrived', value: profileStanding?.arrived ?? 0 },
                        { label: 'bought', value: profileStanding?.bought ?? 0 }
                      ];
                      if (stats.every((s) => s.value === 0)) return null;
                      return stats.map((s) => (
                        <div key={s.label} className="rounded-xl bg-[color:var(--color-well)] px-3 py-1.5">
                          <p className="text-[14px] font-extrabold text-[var(--brief-ink)] leading-none">{s.value}</p>
                          <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--ink-70)]">{s.label}</p>
                        </div>
                      ));
                    })()}
                  </div>
                </div>
              </section>
            )}
            <div className="flex items-end justify-between gap-2 pb-2">
              <div className="min-w-0">
                <h2 className="text-lg font-extrabold text-[var(--brief-ink)] tracking-tight">
                  Your Layer — Things you've kept
                </h2>
                <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-[var(--ink-70)] mt-0.5">
                  {activeSavedBundle.hint}
                </p>
              </div>
              <span className="text-[11px] font-bold uppercase tracking-[0.14em] bg-[#EFF1F4] text-[var(--ink-60)] px-2.5 py-1 rounded-full">
                {activeSavedBundle.sections.length} screens
              </span>
            </div>
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-2">
              {SAVED_BUNDLES.map((bundle: any) => (
                <button
                  key={bundle.id}
                  onClick={() => setMyLayerSection(bundle.sections[0] as MyLayerSection)}
                  className={`shrink-0 px-3 py-1.5 rounded-full text-[12px] font-extrabold border cursor-pointer transition ${
                    activeSavedBundle.id === bundle.id
                      ? 'bg-[#40916C] text-[var(--accent-ink)] border-[#0891B2]'
                      : 'bg-[color:var(--color-paper)] text-[var(--ink-70)] border-[var(--brief-line)]'
                  }`}
                >
                  {bundle.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5 border-t border-[var(--brief-line)] pt-2">
              {activeSavedBundle.sections.map((id: any) => (
                <button
                  key={id}
                  onClick={() => setMyLayerSection(id as MyLayerSection)}
                  className={`shrink-0 px-2.5 py-1 rounded-lg text-[11px] font-extrabold transition cursor-pointer ${
                    myLayerSection === id
                      ? 'bg-[#40916C] text-[var(--accent-ink)]'
                      : 'text-[var(--ink-70)] hover:text-[var(--brief-ink)] bg-[color:var(--color-well)]'
                  }`}
                >
                  {SAVED_TABS[id]}
                </button>
              ))}
            </div>
          </div>
        )}
        {myLayerSection === 'saved' && (
          <section className="space-y-4">
            <div className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-2">
                <Bookmark className="w-4 h-4 text-[var(--brief-ink)]" />
                <span className="text-[11px] text-[var(--brief-ink)]">
                  Your saved things
                </span>
              </div>

              <h2 className="text-xl font-extrabold">Things you've kept.</h2>

              <p className="text-xs text-[var(--brief-ink)] mt-1">
                {savedObjects.length > 0
                  ? `${savedObjects.length} saved across ${savedGroups.length} ${
                      savedGroups.length === 1 ? 'section' : 'sections'
                    }.`
                  : 'Your saved places, opportunities and useful information.'}
              </p>
            </div>

            {savedGroups.map((group: any) => (
              <div key={group.label}>
                <div className="flex items-baseline gap-2 mb-2 px-1">
                  <h3 className="text-[12px] font-extrabold text-[var(--brief-ink)]">
                    {group.label}
                  </h3>
                  <span className="text-[11px] text-[var(--ink-60)]">
                    {group.items.length}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {group.items.map((obj: any) => {
                    const action = resolveAction(obj);
                    const distance = getDistanceLabel(obj);

                    return (
                      <div
                        key={obj.id}
                        className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] hover:border-[#0891B2] rounded-2xl p-3 transition"
                      >
                        <button
                          onClick={() => setSelectedObjectForDetail(obj)}
                          className="w-full text-left cursor-pointer group"
                        >
                          <div className="flex items-start gap-3">
                            {obj.imageUrl && (
                              <img
                                src={obj.imageUrl}
                                alt=""
                                className="w-12 h-12 rounded-lg object-cover shrink-0"
                              />
                            )}

                            <div className="min-w-0 flex-1">
                              <div className="text-[11px] text-[var(--ink-60)]">
                                {obj.category}
                              </div>
                              <div className="text-xs font-extrabold mt-0.5 line-clamp-2 group-hover:text-[var(--brief-ink)]">
                                {obj.title}
                              </div>
                              {distance && (
                                <div className="text-[11px] text-[var(--ink-60)] mt-1">
                                  {distance}
                                </div>
                              )}
                            </div>
                          </div>
                        </button>

                        <div className="flex items-center gap-2 mt-3">
                          {action.kind === 'internal' || action.kind === 'none' ? (
                            <button
                              onClick={() => setSelectedObjectForDetail(obj)}
                              className="flex-1 py-2 rounded-xl bg-[color:var(--color-paper)] border border-[var(--brief-line)] text-[var(--brief-ink)] font-extrabold text-[12px] cursor-pointer"
                            >
                              View details
                            </button>
                          ) : (
                            <a
                              href={action.href}
                              target={action.kind === 'phone' ? undefined : '_blank'}
                              rel={
                                action.kind === 'phone'
                                  ? undefined
                                  : 'noopener noreferrer'
                              }
                              onClick={() =>
                                handleExecuteProtocolAction(
                                  action.kind === 'phone' ? 'contact' : 'discover',
                                  obj,
                                  { silent: true }
                                )
                              }
                              className="flex-1 py-2 rounded-xl bg-[#40916C] text-[var(--accent-ink)] font-extrabold text-[12px] flex items-center justify-center gap-1.5 cursor-pointer"
                            >
                              {action.label}
                              <ArrowRight className="w-3 h-3" />
                            </a>
                          )}

                          <button
                            onClick={() => handleCreatePursuit(obj.title)}
                            title="Pursue similar"
                            className="p-2 rounded-xl bg-[color:var(--color-paper)] text-[var(--brief-ink)] border border-[var(--brief-line)] hover:border-[#0891B2] cursor-pointer"
                          >
                            <Search className="w-3.5 h-3.5" />
                          </button>

                          <button
                            onClick={() => handleUnsave(obj)}
                            title="Remove from saved"
                            className="p-2 rounded-xl bg-[color:var(--color-paper)] text-[var(--brief-ink)] border border-[var(--brief-line)] hover:border-[#0891B2] cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {/* Why this was saved (prompt 10). Optional: an
                            unlabelled save is a perfectly valid save, so this
                            is a quiet row of toggles, never a required step. */}
                        <div className="flex flex-wrap gap-1 mt-2">
                          {SAVE_LABELS.map((label) => {
                            const active = graph.savedLabel(obj.id) === label;
                            return (
                              <button
                                key={label}
                                onClick={() => handleSetSaveLabel(obj, label)}
                                className={`text-[11px] font-bold px-2 py-0.5 rounded-full border cursor-pointer transition ${
                                  active
                                    ? 'bg-[#40916C] text-[var(--accent-ink)] border-[#0891B2]'
                                    : 'bg-transparent text-[var(--ink-60)] border-[var(--brief-line)] hover:border-[var(--brief-line)]'
                                }`}
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* Activity (prompt 19). Derived from the same relationships,
                not a second history store. Secondary to saved objects. */}
            {(() => {
              const recent = graph.activity(6);
              if (recent.length === 0) return null;

              return (
                <div className="mt-8 pt-5 border-t border-[var(--brief-line)]">
                  <p className="text-[11px] text-[var(--ink-60)] mb-3">
                    Recent activity
                  </p>
                  <div className="space-y-1.5">
                    {recent.map((entry: any) => (
                      <button
                        key={`${entry.object.id}_${entry.verb}`}
                        onClick={() => setSelectedObjectForDetail(entry.object)}
                        className="w-full text-left flex items-center gap-2 py-1.5 cursor-pointer"
                      >
                        <span className="text-[11px] text-[var(--brief-ink)] w-20 shrink-0">
                          {entry.verb}
                        </span>
                        <span className="text-[12px] text-[var(--ink-60)] truncate">
                          {entry.object.title}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })()}

            {savedObjects.length === 0 && (
              <div className="py-14 text-center">
                <Bookmark className="w-8 h-8 mx-auto mb-3 text-[var(--ink-60)]" />
                <p className="font-display text-lg font-semibold text-[var(--brief-ink)]">Nothing kept yet.</p>
                <p className="mt-1 text-xs text-[var(--ink-60)]">
                  Save a place or opportunity and it will sit here, quiet and waiting.
                </p>
              </div>
            )}
          </section>
        )}
        {myLayerSection === 'activity' && (
          <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
            <div>
              <h2 className="text-lg font-extrabold text-[var(--brief-ink)]">My Activity</h2>
              <p className="text-[12px] text-[var(--ink-60)] leading-snug mt-1">
                What you have saved, watched and acted on.
              </p>
            </div>
            {relationships.length === 0 && (
              <p className="text-xs text-[var(--ink-60)]">Nothing yet.</p>
            )}
            <div className="space-y-2">
              {[...relationships]
                .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
                .map((rel) => {
                  const obj = objects.find((o) => o.id === rel.targetId);
                  return (
                    <button
                      key={rel.id}
                      type="button"
                      disabled={!obj}
                      onClick={() => {
                        if (obj) setSelectedObjectForDetail(obj);
                      }}
                      className="w-full bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-2xl p-3 flex items-center gap-3 text-left cursor-pointer disabled:cursor-default disabled:opacity-70"
                    >
                      <span className="text-[11px] text-[var(--brief-ink)] shrink-0">
                        {rel.verb}
                      </span>
                      <p className="text-xs text-[var(--brief-ink)] flex-1 min-w-0 truncate">
                        {obj ? obj.title : rel.targetId}
                      </p>
                      <span className="text-[11px] text-[var(--ink-60)] shrink-0">
                        {rel.updatedAt.slice(0, 10)}
                      </span>
                    </button>
                  );
                })}
            </div>
          </div>
        )}
        {myLayerSection === 'points' && (
          <RewardsDesk
            settledPoints={myContribution.settledPoints}
            rank={myRank}
            accepted={myContribution.accepted}
            pending={pendingCount}
          />
        )}
        {myLayerSection === 'circles' && (
          <div className="max-w-3xl mx-auto px-4 py-6">
            <Circles />
          </div>
        )}
        {myLayerSection === 'groups' && (
          <ConnectedGroups
            visibleGroups={visibleGroups}
            groupIndexes={groupIndexes}
            openGroup={openGroup}
            setOpenGroupId={setOpenGroupId}
            groupIndex={groupIndex}
            unansweredQuestions={unansweredQuestions}
            handleRevokeGroup={handleRevokeGroup}
            handleSaveGroupEntry={handleSaveGroupEntry}
            handleViewSource={handleViewSource}
            commandResult={commandResult}
            setCommandResult={setCommandResult}
            commandText={commandText}
            setCommandText={setCommandText}
            getUnansweredQuestions={getUnansweredQuestions}
            groupMessages={GROUP_MESSAGES}
            formatSourceDate={formatSourceDate}
            handleRunCommand={handleRunCommand}
            setSelectedObjectForDetail={setSelectedObjectForDetail}
          />
        )}
        {myLayerSection === 'tickets' && (
          <MyTickets
            onSell={() => {
              // Selling is a Workflows → Sell act: the money side of the seat
              // lives with the rest of the money, not in the personal layer.
              setActiveTab('workflows');
              setWorkflowView('screen');
              setWorkflowSection('resale');
            }}
            onBrowseEvents={() => {
              setActiveTab('nearby');
            }}
          />
        )}
        {myLayerSection === 'campaigns' && (
          <div className="space-y-4">

            {/* CAMPAIGNS. Create something, publish it, share one link, watch
                who turns up. Every figure below is read from the server. */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg font-extrabold text-[var(--brief-ink)]">Events</h2>
                <p className="text-[12px] text-[var(--ink-60)] leading-snug mt-1">
                  Things you are putting out into the world. Publish once, share
                  one link, see who registered.
                </p>
              </div>
              <button
                onClick={() => {
                  setCampaignActionError(null);
                  setPublishedCampaign(null);
                  setDraft({
                    title: '', type: 'popup', description: '', location: '',
                    startsAt: '', capacity: '', price: '', circleId: ''
                  });
                  setObjectPicker({
                    open: false, status: 'idle', data: null, error: null, selected: null
                  });
                  setCreateStep('form');
                }}
                className="shrink-0 px-3 py-2 rounded-xl bg-[#40916C] text-[var(--accent-ink)] font-extrabold text-[12px] cursor-pointer flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                Create
              </button>
            </div>

            {campaignState.status === 'idle' && (
              <button
                onClick={loadCampaigns}
                className="w-full border border-[var(--brief-line)] rounded-2xl p-4 text-xs font-extrabold text-[var(--brief-ink)] cursor-pointer"
              >
                Load my campaigns
              </button>
            )}

            {campaignState.status === 'loading' && (
              <div className="border border-[var(--brief-line)] rounded-2xl p-8 text-center">
                <p className="text-xs text-[var(--ink-60)]">Loading campaigns...</p>
              </div>
            )}

            {campaignState.status === 'error' && (
              <div className="border border-[var(--brief-line)] bg-[color:var(--color-paper)] rounded-2xl p-4 space-y-2">
                <p className="text-xs text-[var(--brief-ink)] font-extrabold">
                  Couldn't load campaigns. Try again.
                </p>
                <p className="text-[11px] text-[var(--ink-60)] break-words">
                  {campaignState.error}
                </p>
                <button
                  onClick={loadCampaigns}
                  className="px-3 py-1.5 rounded-xl bg-[#40916C] text-[var(--accent-ink)] font-extrabold text-[11px] cursor-pointer"
                >
                  Retry
                </button>
              </div>
            )}

            {campaignState.status === 'ready' && (campaignState.data ?? []).length === 0 && (
              <div className="border border-dashed border-[var(--brief-line)] rounded-2xl p-8 text-center">
                <p className="text-xs text-[var(--ink-60)]">You haven't created a campaign yet.</p>
              </div>
            )}

            {campaignState.status === 'ready' && campaignsLive.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-[11px] text-[var(--ink-60)]">
                  Live
                </h3>
                {campaignsLive.map((c: any) => (
                  <div
                    key={c.id}
                    className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-2xl p-4 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-extrabold text-[var(--brief-ink)] truncate">{c.title}</p>
                        <p className="text-[11px] text-[var(--ink-60)] mt-0.5 truncate">
                          {[c.location, c.startsAt ? c.startsAt.slice(0, 16).replace('T', ' ') : null]
                            .filter(Boolean)
                            .join(' \u00b7 ') || 'No place or time set'}
                        </p>
                      </div>
                      <span className="shrink-0 text-[11px] text-[var(--brief-ink)]">
                        {c.status}
                      </span>
                    </div>

                    {/* Capacity is printed from server values only. */}
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      <span className="text-[12px] text-[var(--brief-ink)]">
                        {c.metrics.slotsTaken}
                        {c.metrics.capacity === null ? ' registered' : ` / ${c.metrics.capacity}`}
                      </span>
                      <span className="text-[12px] text-[var(--brief-ink)]">
                        {c.metrics.currency} {c.metrics.revenueSettled.toLocaleString()} settled
                      </span>
                      {c.metrics.revenuePending > 0 && (
                        <span className="text-[12px] text-[var(--brief-ink)]">
                          {c.metrics.currency} {c.metrics.revenuePending.toLocaleString()} pending
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <button
                        onClick={() => openCampaign(c.id)}
                        className="px-3 py-1.5 rounded-xl bg-[#40916C] text-[var(--accent-ink)] font-extrabold text-[11px] cursor-pointer"
                      >
                        Open
                      </button>
                      <button
                        onClick={() => shareCampaign(c)}
                        className="px-3 py-1.5 rounded-xl border border-[var(--brief-line)] text-[var(--brief-ink)] font-extrabold text-[11px] cursor-pointer flex items-center gap-1"
                      >
                        <Share2 className="w-3 h-3" />
                        Share
                      </button>
                      <button
                        onClick={() => {
                          if (window.confirm('Withdraw or remove this event? People holding a place are released and anyone who paid is refunded.')) {
                            void handleRemoveCampaign(c.id);
                          }
                        }}
                        className="px-3 py-1.5 rounded-xl border border-red-200 bg-red-50 text-red-600 font-extrabold text-[11px] cursor-pointer hover:bg-red-100 transition-colors"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {campaignState.status === 'ready' && campaignsDraft.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-[11px] text-[var(--ink-60)]">
                  Drafts
                </h3>
                {campaignsDraft.map((c: any) => (
                  <div
                    key={c.id}
                    className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-2xl p-4 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-extrabold text-[var(--brief-ink)] truncate">
                        {c.title || 'Untitled'}
                      </p>
                      <p className="text-[11px] text-[var(--ink-60)] mt-0.5">
                        {c.type} - not published
                      </p>
                    </div>
                    <div className="shrink-0 flex items-center gap-1.5">
                      <button
                        onClick={() => { openCampaign(c.id); beginEdit(c); }}
                        className="px-3 py-1.5 rounded-xl border border-[var(--brief-line)] text-[var(--brief-ink)] font-extrabold text-[11px] cursor-pointer"
                      >
                        Edit
                      </button>
                      <button
                        disabled={campaignBusy}
                        onClick={async () => {
                          setCampaignBusy(true);
                          setCampaignActionError(null);
                          const res = await briefApi.campaignAction(c.id, 'publish');
                          setCampaignBusy(false);
                          if (!res.ok) { setCampaignActionError(res.error); showToast(res.error); return; }
                          loadCampaigns();
                          showToast('Published');
                        }}
                        className="px-3 py-1.5 rounded-xl bg-[#40916C] text-[var(--accent-ink)] font-extrabold text-[11px] cursor-pointer disabled:opacity-40"
                      >
                        Publish
                      </button>
                      <button
                        onClick={() => {
                          if (window.confirm('Remove this draft? Nothing has happened on it yet, so nothing is lost.')) {
                            void handleRemoveCampaign(c.id);
                          }
                        }}
                        className="px-3 py-1.5 rounded-xl border border-red-200 bg-red-50 text-red-600 font-extrabold text-[11px] cursor-pointer hover:bg-red-100 transition-colors"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {campaignState.status === 'ready' && campaignsPast.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-[11px] text-[var(--ink-60)]">
                  Finished
                </h3>
                {campaignsPast.map((c: any) => (
                  <div
                    key={c.id}
                    className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-2xl p-3 flex items-center justify-between gap-3"
                  >
                    <p className="text-xs text-[var(--ink-60)] truncate">{c.title}</p>
                    <div className="shrink-0 flex items-center gap-1.5">
                      <button
                        onClick={() => openCampaign(c.id)}
                        className="text-[11px] text-[var(--ink-60)] underline underline-offset-2 cursor-pointer"
                      >
                        {c.status}
                      </button>
                      <button
                        onClick={() => {
                          if (window.confirm('Remove this finished event from your dashboard? The record and its history stay.')) {
                            void handleRemoveCampaign(c.id);
                          }
                        }}
                        className="px-2.5 py-1 rounded-lg border border-red-200 bg-red-50 text-red-600 font-extrabold text-[11px] cursor-pointer hover:bg-red-100 transition-colors"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {myLayerSection === 'mediakit' && (
          <div className="max-w-2xl mx-auto px-4 py-6">
            <CreatorProfilePanel />
          </div>
        )}
        {myLayerSection === 'opportunities' && (
          <div className="max-w-2xl mx-auto px-4 py-6">
            <OpportunitiesPanel />
          </div>
        )}
        {myLayerSection === 'messages' && (
          <div className="max-w-2xl mx-auto px-4 py-6">
            <MessagesPanel />
          </div>
        )}
        {myLayerSection === 'verification' && (
          <div className="max-w-3xl mx-auto px-4 py-6">
            <VerificationPanel />
          </div>
        )}
        {myLayerSection === 'subscriptions' && (
          <div className="max-w-2xl mx-auto px-4 py-6">
            <SubscriptionsPanel />
          </div>
        )}
    </>
  );
}
