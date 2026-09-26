import React from 'react';
import { ArrowRight, Bookmark, Building2, CheckCircle2, ExternalLink, Eye, FolderPlus, MapPin, Search, Share2, ShieldCheck, User, X } from 'lucide-react';
import type { BriefObject, IngestionCandidate, ObjectType, Pursuit, Source , Destination, MyLayerSection } from '../model/core';
import * as briefApi from '../api/briefApi';
import type { Campaign as ApiCampaign, CampaignType as ApiCampaignType, Registration as ApiRegistration } from '../api/types';
import type { CircleDetail as ApiCircleDetail } from '../api/briefApi';
import { CollectionPage } from '../components/CollectionPage';
import { CollectionsSurface } from '../components/CollectionsSurface';
import { NotificationCenter } from '../components/NotificationCenter';
import { EntityPage } from '../components/EntityPage';
import { FollowingSurface } from '../components/FollowingSurface';
import { LocationPage } from '../components/LocationPage';
import { MenuSheet } from '../components/MenuSheet';
import { AwaitingPayment } from '../components/AwaitingPayment';
import { CampaignDistribution } from '../components/CampaignDistribution';
import { CollectionPicker } from '../components/CollectionPicker';
import { RelatedContent } from '../components/RelatedContent';
import { TeaReader } from '../components/TeaReader';
import { DESTINATION_STATE_LABELS, REPORT_REASONS, buildKeyFacts, buildMapsHref, buildTelHref, getActionNote, getAppearanceReasons, getCorroborationLabel, getDestinationAccess, getDestinationState, getDestinationVendors, getDistanceLabel, getFreshness, getLifecycleBadge, getObjectTypeMeta, getPublishedLine, getReasonChip, getRelatedHeading, getSourceChip, getSourceKindChip, getSuggestedActions, getVendorDestinations, getVendorOfferings, isDestinationObject, objectFromServer, resolveAction, trustStateOf } from '../model/core';

// ---------------------------------------------------------------------------
// OVERLAYS SHELL -- the full-screen sheets that float above every tab:
// campaign dashboard, campaign create wizard, capture flow, tea sheet and the
// object detail sheet. Extracted from App.tsx (Phase 3); blocks are VERBATIM,
// gates unchanged. State ownership stays in App (route-sync rules).
// ---------------------------------------------------------------------------

export interface OverlaysShellProps {
  chooseCity: any;
  collectionRouteId: string | null;
  collectionsOpen: boolean;
  entityPageId: string | null;
  followOne: any;
  followingOpen: boolean;
  handleMenuSelect: any;
  menuOpen: boolean;
  selectedLocation: string;
  setActiveTab: React.Dispatch<React.SetStateAction<Destination>>;
  setCollectionsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  notificationsOpen: boolean;
  notifUnread: number;
  setNotificationsOpen: any;
  setNotifUnread: any;
  setCollectionRouteId: any;
  setEntityPageId: React.Dispatch<React.SetStateAction<string | null>>;
  setFollowingOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setMyLayerSection: React.Dispatch<React.SetStateAction<MyLayerSection>>;
  attachObjectToCampaign: any;
  beginEdit: any;
  campaignActionError: string | null;
  campaignBusy: boolean;
  campaignCircle: {     status: 'idle' | 'loading' | 'ready' | 'error';     data: ApiCircleDetail | null;     error: string | null;   };
  campaignDetail: ApiCampaign | null;
  campaignRegs: {     status: 'idle' | 'loading' | 'ready' | 'error';     data: ApiRegistration[] | null;     error: string | null;   };
  captureMode: 'quick' | 'direct';
  captureOpen: any;
  capturePreview: IngestionCandidate | null;
  captureText: string;
  collectionPickerFor: string | null;
  confirmPayment: any;
  copyCampaignLink: any;
  createStep: 'closed' | 'form' | 'preview' | 'published';
  detailGraph: briefApi.GraphEdge[] | null;
  directLocation: string;
  directTitle: string;
  directType: ObjectType;
  dismissOverlay: any;
  draft: {     title: string;     type: ApiCampaignType;     description: string;     location: string;     startsAt: string;     capacity: string;     price: string;     circleId: string;   };
  editDraft: {     title: string;     description: string;     location: string;     startsAt: string;     price: string;     capacity: string;   } | null;
  graph: any;
  handleCaptureCancel: any;
  handleCaptureConfirm: any;
  handleCaptureParse: any;
  handleConfirmObject: any;
  handleCreatePursuit: any;
  handleDirectPost: any;
  handleExecuteProtocolAction: any;
  handlePivotToType: any;
  handleRemoveCampaign: any;
  handleReportObject: any;
  handleShare: any;
  handleToggleWatch: any;
  loadAttachableObjects: any;
  loadCampaigns: any;
  loadPersonal: any;
  locationName: string | null;
  objectCheckBusy: string | null;
  objectPicker: {     open: boolean;     status: 'idle' | 'loading' | 'ready' | 'error';     data: any[] | null;     error: string | null;     selected: { id: string; title: string } | null;   };
  objects: BriefObject[];
  openCampaign: any;
  openCampaignId: string | null;
  openLocationPage: any;
  personalState: briefApi.PersonalState | null;
  postUpdate: any;
  publicOrigin: string | null;
  publishDraft: any;
  publishedCampaign: ApiCampaign | null;
  pursuitResults: any;
  pursuits: Pursuit[];
  relatedObjects: any;
  relatedToSavedIds: any;
  reportForObject: string | null;
  saveCampaignEdit: any;
  savedIdSet: any;
  selectedObjectForDetail: BriefObject | null;
  selectedTeaSlug: string | null;
  sessionUser: briefApi.AuthedUser | null;
  setCampaignActionError: React.Dispatch<React.SetStateAction<string | null>>;
  setCampaignBusy: React.Dispatch<React.SetStateAction<boolean>>;
  setCampaignCircle: React.Dispatch<React.SetStateAction<{     status: 'idle' | 'loading' | 'ready' | 'error';     data: ApiCircleDetail | null;     error: string | null;   }>>;
  setCampaignDetail: React.Dispatch<React.SetStateAction<ApiCampaign | null>>;
  setCaptureMode: React.Dispatch<React.SetStateAction<'quick' | 'direct'>>;
  setCapturePreview: React.Dispatch<React.SetStateAction<IngestionCandidate | null>>;
  setCaptureText: React.Dispatch<React.SetStateAction<string>>;
  setCollectionPickerFor: React.Dispatch<React.SetStateAction<string | null>>;
  setCreateStep: React.Dispatch<React.SetStateAction<'closed' | 'form' | 'preview' | 'published'>>;
  setDirectCategory: React.Dispatch<React.SetStateAction<string>>;
  setDirectLocation: React.Dispatch<React.SetStateAction<string>>;
  setDirectTitle: React.Dispatch<React.SetStateAction<string>>;
  setDirectType: React.Dispatch<React.SetStateAction<ObjectType>>;
  setDraft: React.Dispatch<React.SetStateAction<{     title: string;     type: ApiCampaignType;     description: string;     location: string;     startsAt: string;     capacity: string;     price: string;     circleId: string;   }>>;
  setEditDraft: React.Dispatch<React.SetStateAction<{     title: string;     description: string;     location: string;     startsAt: string;     price: string;     capacity: string;   } | null>>;
  setObjectPicker: React.Dispatch<React.SetStateAction<{     open: boolean;     status: 'idle' | 'loading' | 'ready' | 'error';     data: any[] | null;     error: string | null;     selected: { id: string; title: string } | null;   }>>;
  setOpenCampaignId: React.Dispatch<React.SetStateAction<string | null>>;
  setRegStatus: any;
  setReportForObject: React.Dispatch<React.SetStateAction<string | null>>;
  setSelectedObjectForDetail: any;
  setUpdateBody: React.Dispatch<React.SetStateAction<string>>;
  setUpdateTitle: React.Dispatch<React.SetStateAction<string>>;
  shareCampaign: any;
  showToast: any;
  sources: Source[];
  tuneObject: any;
  updateBody: string;
  updateBusy: boolean;
  updateNote: string | null;
  updateTitle: string;
  watchedIds: any;
}

// §9 — the trust tier's badge colours, shared across the object detail.
// community = green (human corroboration), cross-source = cyan, single source
// = muted. Unverified renders nothing. Same tiers as trustStateOf in core.
const TRUST_TONE: Record<string, { glyph: string; bg: string; fg: string }> = {
  green: { glyph: '✓', bg: '#059669', fg: 'var(--color-paper)' },
  cyan: { glyph: '●', bg: '#0891B2', fg: 'var(--color-paper)' },
  muted: { glyph: '◉', bg: 'rgba(10, 14, 20,0.14)', fg: '#0D1117' }
};

export function OverlaysShell(props: OverlaysShellProps) {
  const {
    attachObjectToCampaign,
    beginEdit,
    campaignActionError,
    campaignBusy,
    campaignCircle,
    campaignDetail,
    campaignRegs,
    captureMode,
    captureOpen,
    capturePreview,
    captureText,
    collectionPickerFor,
    confirmPayment,
    copyCampaignLink,
    createStep,
    detailGraph,
    directLocation,
    directTitle,
    directType,
    dismissOverlay,
    draft,
    editDraft,
    graph,
    handleCaptureCancel,
    handleCaptureConfirm,
    handleCaptureParse,
    handleConfirmObject,
    handleCreatePursuit,
    handleDirectPost,
    handleExecuteProtocolAction,
    handlePivotToType,
    handleRemoveCampaign,
    handleReportObject,
    handleShare,
    handleToggleWatch,
    loadAttachableObjects,
    loadCampaigns,
    loadPersonal,
    locationName,
    objectCheckBusy,
    objectPicker,
    objects,
    openCampaign,
    openCampaignId,
    openLocationPage,
    personalState,
    postUpdate,
    publicOrigin,
    publishDraft,
    publishedCampaign,
    pursuitResults,
    pursuits,
    relatedObjects,
    relatedToSavedIds,
    reportForObject,
    saveCampaignEdit,
    savedIdSet,
    selectedObjectForDetail,
    selectedTeaSlug,
    sessionUser,
    setCampaignActionError,
    setCampaignBusy,
    setCampaignCircle,
    setCampaignDetail,
    setCaptureMode,
    setCapturePreview,
    setCaptureText,
    setCollectionPickerFor,
    setCreateStep,
    setDirectCategory,
    setDirectLocation,
    setDirectTitle,
    setDirectType,
    setDraft,
    setEditDraft,
    setObjectPicker,
    setOpenCampaignId,
    setRegStatus,
    setReportForObject,
    setSelectedObjectForDetail,
    setUpdateBody,
    setUpdateTitle,
    shareCampaign,
    showToast,
    sources,
    tuneObject,
    updateBody,
    updateBusy,
    updateNote,
    updateTitle,
    watchedIds,
    chooseCity,
    collectionRouteId,
    collectionsOpen,
    entityPageId,
    followOne,
    followingOpen,
    handleMenuSelect,
    menuOpen,
    selectedLocation,
    setActiveTab,
    setCollectionsOpen,
    notificationsOpen,
    notifUnread,
    setNotificationsOpen,
    setNotifUnread,
    setCollectionRouteId,
    setEntityPageId,
    setFollowingOpen,
    setMyLayerSection,
  } = props;
  return (
    <>
      {openCampaignId && (
        <div
          className="fixed inset-0 z-50 bg-[rgba(10, 14, 20, 0.85)] backdrop-blur-md flex flex-col justify-end sm:justify-center items-center p-0 sm:p-4 overflow-hidden"
          onClick={() => {
            setOpenCampaignId(null);
            setCampaignDetail(null);
            setEditDraft(null);
            setCampaignCircle({ status: 'idle', data: null, error: null });
          }}
        >
          <div
            className="w-full max-w-lg max-h-[92vh] sm:max-h-[85vh] flex flex-col bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden mb-safe"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-[var(--brief-line)] shrink-0 flex items-start justify-between gap-3 bg-[color:var(--color-paper)]">
              <div className="min-w-0">
                <h2 className="text-base font-extrabold text-[var(--brief-ink)] truncate">
                  {campaignDetail ? campaignDetail.title : 'Campaign'}
                </h2>
                {campaignDetail && (
                  <p className="text-[11px] text-[var(--ink-60)] mt-0.5">
                    {campaignDetail.type} &middot; {campaignDetail.status}
                  </p>
                )}
              </div>
              <button
                onClick={() => {
                  setOpenCampaignId(null);
                  setCampaignDetail(null);
                  setEditDraft(null);
                }}
                className="shrink-0 p-1.5 rounded-full hover:bg-[#EFF1F4] text-[var(--ink-60)] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable Content Body */}
            <div className="p-4 sm:p-5 overflow-y-auto flex-1 space-y-4">
              {campaignActionError && (
                <div className="border border-red-200 bg-red-50 text-red-700 rounded-xl p-3">
                  <p className="text-[12px] font-bold break-words">
                    {campaignActionError}
                  </p>
                </div>
              )}

              {!campaignDetail && !campaignActionError && (
                <p className="text-xs text-[var(--ink-60)] py-6 text-center">Loading campaign...</p>
              )}

              {campaignDetail && editDraft && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-[11px] text-[var(--ink-60)] mb-1">Title</label>
                    <input
                      value={editDraft.title}
                      onChange={(e) => setEditDraft((d) => (d ? { ...d, title: e.target.value } : d))}
                      className="w-full bg-[color:var(--color-paper)] text-[var(--brief-ink)] text-xs rounded-xl px-3 py-2.5 border border-[var(--brief-line)] focus:border-[#0891B2] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[var(--ink-60)] mb-1">Description</label>
                    <textarea
                      value={editDraft.description}
                      onChange={(e) => setEditDraft((d) => (d ? { ...d, description: e.target.value } : d))}
                      rows={2}
                      className="w-full bg-[color:var(--color-paper)] text-[var(--brief-ink)] text-xs rounded-xl px-3 py-2.5 border border-[var(--brief-line)] focus:border-[#0891B2] focus:outline-none resize-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[var(--ink-60)] mb-1">When</label>
                    <input
                      type="datetime-local"
                      value={editDraft.startsAt}
                      onChange={(e) => setEditDraft((d) => (d ? { ...d, startsAt: e.target.value } : d))}
                      className="w-full bg-[color:var(--color-paper)] text-[var(--brief-ink)] text-xs rounded-xl px-3 py-2.5 border border-[var(--brief-line)] focus:border-[#0891B2] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[var(--ink-60)] mb-1">Where</label>
                    <input
                      value={editDraft.location}
                      onChange={(e) => setEditDraft((d) => (d ? { ...d, location: e.target.value } : d))}
                      className="w-full bg-[color:var(--color-paper)] text-[var(--brief-ink)] text-xs rounded-xl px-3 py-2.5 border border-[var(--brief-line)] focus:border-[#0891B2] focus:outline-none"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] text-[var(--ink-60)] mb-1">Spots</label>
                      <input
                        inputMode="numeric"
                        disabled={campaignDetail.status !== 'draft'}
                        value={editDraft.capacity}
                        onChange={(e) => setEditDraft((d) => (d ? { ...d, capacity: e.target.value } : d))}
                        placeholder="Unlimited"
                        className="w-full bg-[color:var(--color-paper)] text-[var(--brief-ink)] text-xs rounded-xl px-3 py-2.5 border border-[var(--brief-line)] focus:border-[#0891B2] focus:outline-none disabled:opacity-40"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-[var(--ink-60)] mb-1">Price (KES)</label>
                      <input
                        inputMode="numeric"
                        value={editDraft.price}
                        onChange={(e) => setEditDraft((d) => (d ? { ...d, price: e.target.value } : d))}
                        placeholder="Free"
                        className="w-full bg-[color:var(--color-paper)] text-[var(--brief-ink)] text-xs rounded-xl px-3 py-2.5 border border-[var(--brief-line)] focus:border-[#0891B2] focus:outline-none"
                      />
                    </div>
                  </div>
                  {campaignDetail.status !== 'draft' && (
                    <p className="text-[11px] text-[var(--ink-60)] leading-snug">
                      Spots cannot change after publishing. People have already
                      registered against this number.
                    </p>
                  )}
                </div>
              )}

              {campaignDetail && !editDraft && (
                <>
                  {campaignDetail.status !== 'draft' && (
                    <CampaignDistribution
                      compact
                      link={briefApi.campaignShareLink(campaignDetail.publicSlug, publicOrigin)}
                      title={campaignDetail.title}
                      onCopy={() => copyCampaignLink(campaignDetail.publicSlug, campaignDetail.id)}
                      onShare={(ch) => briefApi.shareCampaign(campaignDetail.id, ch)}
                      onNativeShare={() => shareCampaign(campaignDetail)}
                    />
                  )}

                  <button
                    onClick={() => beginEdit(campaignDetail)}
                    className="w-full py-2.5 rounded-xl border border-[var(--brief-line)] text-[var(--brief-ink)] font-extrabold text-[12px] cursor-pointer hover:bg-[color:var(--color-well)]"
                  >
                    Edit details
                  </button>

                  {campaignDetail.status === 'draft' && (
                    <button
                      disabled={campaignBusy}
                      onClick={async () => {
                        setCampaignBusy(true);
                        setCampaignActionError(null);
                        const res = await briefApi.campaignAction(campaignDetail.id, 'publish');
                        setCampaignBusy(false);
                        if (!res.ok) { setCampaignActionError(res.error); return; }
                        setCampaignDetail(res.data);
                        loadCampaigns();
                        showToast('Published');
                      }}
                      className="w-full py-3 rounded-xl bg-[#40916C] text-[var(--accent-ink)] font-extrabold text-xs cursor-pointer disabled:opacity-40 hover:bg-[#000000]"
                    >
                      {campaignBusy ? 'Publishing...' : 'Publish'}
                    </button>
                  )}

                  {/* PEOPLE */}
                  <div className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-2xl p-4 space-y-2">
                    <h3 className="text-[11px] text-[var(--ink-60)]">
                      People
                    </h3>
                    <p className="text-xl font-extrabold text-[var(--brief-ink)]">
                      {campaignDetail.metrics.slotsTaken}
                      {campaignDetail.metrics.capacity !== null && (
                        <span className="text-[var(--ink-60)]"> / {campaignDetail.metrics.capacity}</span>
                      )}
                    </p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                      {([
                        ['Registered', campaignDetail.metrics.registrations],
                        ['Checked in', campaignDetail.metrics.checkedIn],
                        [
                          'Remaining',
                          campaignDetail.metrics.remaining === null
                            ? 'Unlimited'
                            : campaignDetail.metrics.remaining
                        ],
                        ['No-show', campaignDetail.metrics.noShows]
                      ] as [string, string | number][]).map(([label, value]) => (
                        <div key={label} className="flex items-baseline justify-between gap-2">
                          <span className="text-[11px] text-[var(--ink-60)]">{label}</span>
                          <span className="text-[12px] text-[var(--ink-60)]">{value}</span>
                        </div>
                      ))}
                    </div>
                    {campaignDetail.metrics.capacity !== null &&
                      campaignDetail.metrics.remaining === 0 && (
                        <p className="text-[11px] font-extrabold text-[var(--brief-ink)]">Full</p>
                      )}
                  </div>

                  {/* MONEY */}
                  <div className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-2xl p-4 space-y-2">
                    <h3 className="text-[11px] text-[var(--ink-60)]">
                      Money
                    </h3>
                    {campaignDetail.price === 0 ? (
                      <p className="text-[12px] text-[var(--ink-60)]">
                        This is a free campaign. No money is collected.
                      </p>
                    ) : (
                      <>
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-[11px] text-[var(--ink-60)]">Settled</span>
                          <span className="text-sm font-extrabold text-[var(--brief-ink)]">
                            {campaignDetail.metrics.currency}{' '}
                            {campaignDetail.metrics.revenueSettled.toLocaleString()}
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-[11px] text-[var(--ink-60)]">Pending</span>
                          <span className="text-sm font-extrabold text-[var(--brief-ink)]">
                            {campaignDetail.metrics.currency}{' '}
                            {campaignDetail.metrics.revenuePending.toLocaleString()}
                          </span>
                        </div>
                        <p className="text-[11px] text-[var(--ink-60)] leading-snug">
                          Pending is money that has not arrived.
                        </p>
                      </>
                    )}
                  </div>

                  {/* CAMPAIGN */}
                  <div className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-2xl p-4 space-y-1">
                    <h3 className="text-[11px] text-[var(--ink-60)]">
                      Campaign
                    </h3>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[11px] text-[var(--ink-60)]">Page loads</span>
                      <span className="text-[12px] text-[var(--ink-60)]">
                        {campaignDetail.metrics.views}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[11px] text-[var(--ink-60)]">Different devices</span>
                      <span className="text-[12px] text-[var(--ink-60)]">
                        {campaignDetail.metrics.viewers === null
                          ? 'Not enough data'
                          : campaignDetail.metrics.viewers}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[11px] text-[var(--ink-60)]">Times you shared</span>
                      <span className="text-[12px] text-[var(--ink-60)]">
                        {campaignDetail.metrics.shares}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[11px] text-[var(--ink-60)]">Started registering</span>
                      <span className="text-[12px] text-[var(--ink-60)]">
                        {campaignDetail.metrics.registrationsStarted}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[11px] text-[var(--ink-60)]">Page load to registration</span>
                      <span className="text-[12px] text-[var(--ink-60)]">
                        {campaignDetail.metrics.conversionPct === null
                          ? 'Not enough data'
                          : `${campaignDetail.metrics.conversionPct}%`}
                      </span>
                    </div>
                    <p className="text-[11px] text-[var(--ink-60)] leading-snug pt-1">
                      Different devices is a rough count, not people. Times you shared counts your own taps, not how many people saw it.
                    </p>
                  </div>

                  {/* WHAT PEOPLE ARE GETTING */}
                  {campaignDetail.object && (
                    <div className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-2xl p-4 space-y-1">
                      <h3 className="text-[11px] text-[var(--ink-60)]">
                        What people get
                      </h3>
                      <p className="text-xs text-[var(--brief-ink)]">{campaignDetail.object.title}</p>
                      {campaignDetail.object.summary && (
                        <p className="text-[11px] text-[var(--ink-60)] leading-snug">
                          {campaignDetail.object.summary}
                        </p>
                      )}
                      <p className="text-[11px] text-[var(--ink-60)] pt-0.5">
                        {campaignDetail.object.type}
                        {campaignDetail.ownsObject === false && ' \u00b7 existing item'}
                      </p>
                      {campaignDetail.ownsObject === false && (
                        <p className="text-[11px] text-[var(--ink-60)] leading-snug">
                          Publishing the campaign does not change it.
                        </p>
                      )}

                      {!objectPicker.open ? (
                        <button
                          disabled={campaignBusy}
                          onClick={loadAttachableObjects}
                          className="text-[11px] text-[var(--brief-ink)] underline underline-offset-2 cursor-pointer disabled:opacity-40 pt-1"
                        >
                          Link a different item
                        </button>
                      ) : (
                        <div className="bg-[color:var(--color-well)] border border-[var(--brief-line)] rounded-xl p-2 space-y-1 max-h-44 overflow-y-auto mt-1">
                          {objectPicker.status === 'loading' && (
                            <p className="text-[12px] text-[var(--ink-60)] p-2">Loading your items...</p>
                          )}
                          {objectPicker.status === 'error' && (
                            <p className="text-[12px] text-[var(--brief-ink)] p-2">
                              Couldn't load your items. {objectPicker.error}
                            </p>
                          )}
                          {objectPicker.status === 'ready' &&
                            (objectPicker.data ?? []).length === 0 && (
                              <p className="text-[12px] text-[var(--ink-60)] p-2">
                                Nothing else to link yet.
                              </p>
                            )}
                          {objectPicker.status === 'ready' &&
                            (objectPicker.data ?? []).slice(0, 25).map((o: any) => (
                              <button
                                key={o.id}
                                disabled={campaignBusy}
                                onClick={() => attachObjectToCampaign(campaignDetail.id, o.id)}
                                className="w-full text-left px-2 py-2 rounded-lg hover:bg-[color:var(--color-paper)] cursor-pointer disabled:opacity-40"
                              >
                                <p className="text-[12px] text-[var(--brief-ink)] truncate">{o.title}</p>
                                <p className="text-[11px] text-[var(--ink-60)]">
                                  {o.type}
                                </p>
                              </button>
                            ))}
                          <button
                            onClick={() => setObjectPicker((p) => ({ ...p, open: false }))}
                            className="w-full text-[11px] text-[var(--ink-60)] py-1 cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* TARGET */}
                  {campaignCircle.status === 'loading' && (
                    <div className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-2xl p-4 space-y-1">
                      <h3 className="text-[11px] text-[var(--ink-60)]">
                        Target
                      </h3>
                      <p className="text-[12px] text-[var(--ink-60)]">Loading target...</p>
                    </div>
                  )}

                  {campaignCircle.status === 'error' && (
                    <div className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-2xl p-4 space-y-1">
                      <h3 className="text-[11px] text-[var(--ink-60)]">
                        Target
                      </h3>
                      <p className="text-[12px] text-[var(--brief-ink)]">Target unavailable.</p>
                      <p className="text-[11px] text-[var(--ink-60)] break-words">
                        {campaignCircle.error}
                      </p>
                    </div>
                  )}

                  {campaignCircle.status === 'ready' &&
                    campaignCircle.data &&
                    !(
                      campaignCircle.data.circle.targetValue !== null &&
                      campaignCircle.data.circle.targetValue > 0
                    ) && (
                      <div className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-2xl p-4 space-y-1">
                        <h3 className="text-[11px] text-[var(--ink-60)]">
                          Target
                        </h3>
                        <p className="text-[12px] text-[var(--brief-ink)]">
                          {campaignCircle.data.circle.name}
                        </p>
                        <p className="text-[11px] text-[var(--ink-60)]">
                          No target set on this circle.
                        </p>
                      </div>
                    )}

                  {campaignCircle.status === 'ready' &&
                    campaignCircle.data &&
                    campaignCircle.data.circle.targetValue !== null &&
                    campaignCircle.data.circle.targetValue > 0 && (
                      <div className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-2xl p-4 space-y-2">
                        <h3 className="text-[11px] text-[var(--ink-60)]">
                          Target
                        </h3>
                        <p className="text-xs text-[var(--brief-ink)]">
                          {campaignCircle.data.circle.goal || campaignCircle.data.circle.name}
                        </p>
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-sm font-extrabold text-[var(--brief-ink)]">
                            {campaignCircle.data.circle.currentValue.toLocaleString()}
                          </span>
                          <span className="text-[11px] text-[var(--ink-60)]">
                            of {campaignCircle.data.circle.targetValue.toLocaleString()}
                          </span>
                        </div>
                        {campaignCircle.data.circle.progressPct !== null && (
                          <p className="text-[11px] text-[var(--brief-ink)]">
                            {Math.round(campaignCircle.data.circle.progressPct)}%
                          </p>
                        )}
                        <div className="h-1.5 rounded-full bg-[color:var(--brief-line)] overflow-hidden">
                          <div
                            className="h-full bg-[#40916C]"
                            style={{
                              width: `${Math.min(100, campaignCircle.data.circle.progressPct ?? 0)}%`
                            }}
                          />
                        </div>
                        <p className="text-[11px] text-[var(--ink-60)] leading-snug">
                          Progress comes from settled transactions in
                          {' '}{campaignCircle.data.circle.name}, not from this campaign.
                        </p>
                      </div>
                    )}

                  {/* POST AN UPDATE (T3): the organiser's words land on the
                      public page — the loop supporters read. */}
                  <div className="space-y-2">
                    <h3 className="text-[11px] text-[var(--ink-60)]">
                      Post an update
                    </h3>
                    <input
                      value={updateTitle}
                      onChange={(e) => setUpdateTitle(e.target.value)}
                      placeholder="Update title (e.g. Halfway there)"
                      aria-label="update title"
                      className="w-full bg-[color:var(--color-paper)] text-[var(--brief-ink)] text-xs rounded-xl px-3 py-2.5 border border-[var(--brief-line)] focus:border-[#0891B2] focus:outline-none"
                    />
                    <textarea
                      value={updateBody}
                      onChange={(e) => setUpdateBody(e.target.value)}
                      placeholder="What the people supporting this should know"
                      aria-label="update body"
                      rows={3}
                      className="w-full bg-[color:var(--color-paper)] text-[var(--brief-ink)] text-xs rounded-xl px-3 py-2.5 border border-[var(--brief-line)] focus:border-[#0891B2] focus:outline-none resize-none"
                    />
                    <button
                      type="button"
                      disabled={updateBusy || !updateTitle.trim() || !updateBody.trim()}
                      onClick={() => void postUpdate(campaignDetail.id)}
                      className="px-4 py-2 rounded-xl bg-[#40916C] text-[var(--accent-ink)] text-[12px] font-extrabold cursor-pointer disabled:opacity-40"
                    >
                      {updateBusy ? 'Posting…' : 'Post update'}
                    </button>
                    {updateNote && <p className="text-[11px] text-[var(--ink-60)] break-words">{updateNote}</p>}
                  </div>

                  {/* REGISTRATIONS */}
                  <div className="space-y-2">
                    <h3 className="text-[11px] text-[var(--ink-60)]">
                      Registrations
                    </h3>

                    {campaignRegs.status === 'loading' && (
                      <p className="text-[12px] text-[var(--ink-60)]">Loading people...</p>
                    )}

                    {campaignRegs.status === 'error' && (
                      <div className="border border-[var(--brief-line)] bg-[color:var(--color-paper)] rounded-xl p-3 space-y-1">
                        <p className="text-[12px] text-[var(--brief-ink)]">Couldn't load registrations.</p>
                        <p className="text-[11px] text-[var(--ink-60)] break-words">
                          {campaignRegs.error}
                        </p>
                      </div>
                    )}

                    {campaignRegs.status === 'ready' &&
                      (campaignRegs.data ?? []).length === 0 && (
                        <p className="text-[12px] text-[var(--ink-60)]">
                          Nobody has registered yet.
                        </p>
                      )}

                    {campaignRegs.status === 'ready' && campaignDetail.price > 0 && (
                      <AwaitingPayment
                        registrations={campaignRegs.data ?? []}
                        currency={campaignDetail.metrics.currency}
                        price={campaignDetail.price}
                        busy={campaignBusy}
                        onConfirmPayment={(regId) => confirmPayment(campaignDetail.id, regId)}
                      />
                    )}

                    {campaignRegs.status === 'ready' &&
                      (campaignRegs.data ?? []).map((r) => (
                        <div
                          key={r.id}
                          className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-xl p-3 flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <p className="text-xs text-[var(--brief-ink)] truncate">
                              {r.name || r.attendeeRef}
                            </p>
                            <p className="text-[11px] text-[var(--ink-60)] mt-0.5">
                              {r.status.replace('_', ' ')}
                            </p>
                          </div>
                          {(r.status === 'registered' || r.status === 'confirmed') && (
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                disabled={campaignBusy}
                                onClick={() => setRegStatus(campaignDetail.id, r.id, 'checked_in')}
                                className="px-2.5 py-1.5 rounded-lg bg-[#40916C] text-[var(--accent-ink)] font-extrabold text-[11px] cursor-pointer disabled:opacity-40"
                              >
                                Check in
                              </button>
                              <button
                                disabled={campaignBusy}
                                onClick={() => setRegStatus(campaignDetail.id, r.id, 'no_show')}
                                className="px-2.5 py-1.5 rounded-lg border border-[var(--brief-line)] text-[var(--ink-60)] font-extrabold text-[11px] cursor-pointer disabled:opacity-40"
                              >
                                No-show
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                  </div>

                  {(campaignDetail.status === 'published' || campaignDetail.status === 'live') && (
                    <button
                      disabled={campaignBusy}
                      onClick={async () => {
                        setCampaignBusy(true);
                        const res = await briefApi.campaignAction(campaignDetail.id, 'close');
                        setCampaignBusy(false);
                        if (!res.ok) { setCampaignActionError(res.error); return; }
                        setCampaignDetail(res.data);
                        loadCampaigns();
                      }}
                      className="w-full py-2.5 rounded-xl border border-[var(--brief-line)] text-[var(--ink-60)] font-extrabold text-[12px] cursor-pointer disabled:opacity-40"
                    >
                      Close campaign
                    </button>
                  )}
                </>
              )}
            </div>

            {/* Sticky Action Footer */}
            {campaignDetail && editDraft && (
              <div className="p-4 pb-safe pb-8 sm:pb-4 border-t border-[var(--brief-line)] bg-[color:var(--color-paper)] shrink-0 space-y-2">
                <div className="flex items-center gap-2">
                  <button
                    disabled={campaignBusy}
                    onClick={() => setEditDraft(null)}
                    className="flex-1 py-3 rounded-xl border border-[var(--brief-line)] text-[var(--brief-ink)] font-extrabold text-xs cursor-pointer disabled:opacity-40 hover:bg-[color:var(--color-well)] transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    disabled={campaignBusy || editDraft.title.trim() === ''}
                    onClick={() => saveCampaignEdit(campaignDetail)}
                    className="flex-[2] py-3 rounded-xl bg-[#40916C] text-[var(--accent-ink)] font-extrabold text-xs cursor-pointer disabled:opacity-40 hover:bg-[#000000] transition-colors shadow-xs"
                  >
                    {campaignBusy ? 'Saving...' : 'Save'}
                  </button>
                </div>
                <button
                  disabled={campaignBusy}
                  onClick={() => {
                    if (window.confirm('Cancel and remove this event?')) {
                      void handleRemoveCampaign(campaignDetail.id);
                    }
                  }}
                  className="w-full py-2.5 rounded-xl border border-red-200 bg-red-50 text-red-600 font-extrabold text-[12px] cursor-pointer hover:bg-red-100 transition-colors disabled:opacity-40"
                >
                  Cancel & Remove Event
                </button>
              </div>
            )}

            {campaignDetail && !editDraft && (
              <div className="p-4 pb-safe pb-8 sm:pb-4 border-t border-[var(--brief-line)] bg-[color:var(--color-paper)] shrink-0 flex items-center gap-2">
                <button
                  disabled={campaignBusy}
                  onClick={() => {
                    if (window.confirm('Cancel and remove this event?')) {
                      void handleRemoveCampaign(campaignDetail.id);
                    }
                  }}
                  className="w-full py-2.5 rounded-xl border border-red-200 bg-red-50 text-red-600 font-extrabold text-[12px] cursor-pointer hover:bg-red-100 transition-colors disabled:opacity-40"
                >
                  Cancel & Remove Event
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      {createStep !== 'closed' && (
        <div
          className="fixed inset-0 z-50 bg-[rgba(10, 14, 20, 0.85)] backdrop-blur-md flex flex-col justify-end sm:justify-center items-center p-0 sm:p-4 overflow-hidden"
          onClick={() => { if (!campaignBusy) setCreateStep('closed'); }}
        >
          <div
            className="w-full max-w-lg max-h-[92vh] sm:max-h-[85vh] flex flex-col bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden mb-safe"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 sm:p-5 border-b border-[var(--brief-line)] shrink-0 flex items-start justify-between gap-3 bg-[color:var(--color-paper)]">
              <h2 className="text-base font-extrabold text-[var(--brief-ink)]">
                {createStep === 'form'
                  ? 'Create'
                  : createStep === 'preview'
                  ? 'Preview'
                  : 'Published'}
              </h2>
              <button
                onClick={() => { if (!campaignBusy) setCreateStep('closed'); }}
                className="shrink-0 p-1.5 rounded-full hover:bg-[#EFF1F4] text-[var(--ink-60)] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 sm:p-5 overflow-y-auto flex-1 space-y-4">
              {campaignActionError && (
                <div className="border border-red-200 bg-red-50 text-red-700 rounded-xl p-3">
                  <p className="text-[11px] font-bold break-words">
                    {campaignActionError}
                  </p>
                </div>
              )}

              {createStep === 'form' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-[11px] text-[var(--ink-60)] mb-1">What is it</label>
                    <div className="flex flex-wrap gap-1.5">
                      {(['popup', 'session', 'drop', 'event'] as ApiCampaignType[]).map((t) => (
                        <button
                          key={t}
                          onClick={() => setDraft((d) => ({ ...d, type: t }))}
                          className={`px-3 py-1.5 rounded-full text-[12px] font-extrabold border cursor-pointer transition ${
                            draft.type === t
                              ? 'bg-[#40916C] text-[var(--accent-ink)] border-[#0891B2]'
                              : 'bg-[color:var(--color-paper)] text-[var(--ink-70)] border-[var(--brief-line)]'
                          }`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] text-[var(--ink-60)] mb-1">Title</label>
                    <input
                      value={draft.title}
                      onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                      placeholder="Saturday plant sale"
                      className="w-full bg-[color:var(--color-paper)] text-[var(--brief-ink)] text-xs rounded-xl px-3 py-2.5 border border-[var(--brief-line)] focus:border-[#0891B2] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] text-[var(--ink-60)] mb-1">Description</label>
                    <textarea
                      value={draft.description}
                      onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                      rows={2}
                      placeholder="One or two lines. What should people expect?"
                      className="w-full bg-[color:var(--color-paper)] text-[var(--brief-ink)] text-xs rounded-xl px-3 py-2.5 border border-[var(--brief-line)] focus:border-[#0891B2] focus:outline-none resize-none"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] text-[var(--ink-60)] mb-1">
                      What people get
                    </label>
                    {objectPicker.selected ? (
                      <div className="flex items-center justify-between gap-2 bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-xl px-3 py-2.5">
                        <p className="text-xs text-[var(--brief-ink)] truncate">
                          {objectPicker.selected.title}
                        </p>
                        <button
                          onClick={() =>
                            setObjectPicker((p) => ({ ...p, selected: null, open: false }))
                          }
                          className="shrink-0 text-[11px] text-[var(--ink-60)] underline underline-offset-2 cursor-pointer"
                        >
                          Remove
                        </button>
                      </div>
                    ) : !objectPicker.open ? (
                      <button
                        onClick={loadAttachableObjects}
                        className="w-full text-left bg-[color:var(--color-paper)] border border-dashed border-[var(--brief-line)] rounded-xl px-3 py-2.5 text-[12px] text-[var(--ink-60)] cursor-pointer"
                      >
                        Something new &middot; tap to link an existing item instead
                      </button>
                    ) : (
                      <div className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-xl p-2 space-y-1 max-h-44 overflow-y-auto">
                        {objectPicker.status === 'loading' && (
                          <p className="text-[12px] text-[var(--ink-60)] p-2">Loading your items...</p>
                        )}
                        {objectPicker.status === 'error' && (
                          <p className="text-[12px] text-[var(--brief-ink)] p-2">
                            Couldn't load your items. {objectPicker.error}
                          </p>
                        )}
                        {objectPicker.status === 'ready' &&
                          (objectPicker.data ?? []).length === 0 && (
                            <p className="text-[12px] text-[var(--ink-60)] p-2">
                              Nothing to link yet. Carry on and describe it above.
                            </p>
                          )}
                        {objectPicker.status === 'ready' &&
                          (objectPicker.data ?? []).slice(0, 25).map((o: any) => (
                            <button
                              key={o.id}
                              onClick={() =>
                                setObjectPicker((p) => ({
                                  ...p,
                                  selected: { id: o.id, title: o.title },
                                  open: false
                                }))
                              }
                              className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-[color:var(--color-paper)] cursor-pointer"
                            >
                              <p className="text-[12px] text-[var(--brief-ink)] truncate">{o.title}</p>
                              <p className="text-[11px] text-[var(--ink-60)]">
                                {o.type}
                              </p>
                            </button>
                          ))}
                        <button
                          onClick={() => setObjectPicker((p) => ({ ...p, open: false }))}
                          className="w-full text-[11px] text-[var(--ink-60)] underline underline-offset-2 cursor-pointer py-1"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-[11px] text-[var(--ink-60)] mb-1">When</label>
                    <input
                      type="datetime-local"
                      value={draft.startsAt}
                      onChange={(e) => setDraft((d) => ({ ...d, startsAt: e.target.value }))}
                      className="w-full bg-[color:var(--color-paper)] text-[var(--brief-ink)] text-xs rounded-xl px-3 py-2.5 border border-[var(--brief-line)] focus:border-[#0891B2] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] text-[var(--ink-60)] mb-1">Where</label>
                    <input
                      value={draft.location}
                      onChange={(e) => setDraft((d) => ({ ...d, location: e.target.value }))}
                      placeholder="Kilimani, Nairobi"
                      className="w-full bg-[color:var(--color-paper)] text-[var(--brief-ink)] text-xs rounded-xl px-3 py-2.5 border border-[var(--brief-line)] focus:border-[#0891B2] focus:outline-none"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] text-[var(--ink-60)] mb-1">Spots</label>
                      <input
                        inputMode="numeric"
                        value={draft.capacity}
                        onChange={(e) => setDraft((d) => ({ ...d, capacity: e.target.value }))}
                        placeholder="Unlimited"
                        className="w-full bg-[color:var(--color-paper)] text-[var(--brief-ink)] text-xs rounded-xl px-3 py-2.5 border border-[var(--brief-line)] focus:border-[#0891B2] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-[var(--ink-60)] mb-1">Price (KES)</label>
                      <input
                        inputMode="numeric"
                        value={draft.price}
                        onChange={(e) => setDraft((d) => ({ ...d, price: e.target.value }))}
                        placeholder="Free"
                        className="w-full bg-[color:var(--color-paper)] text-[var(--brief-ink)] text-xs rounded-xl px-3 py-2.5 border border-[var(--brief-line)] focus:border-[#0891B2] focus:outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}

              {createStep === 'preview' && (
                <div className="space-y-3">
                  <p className="text-[12px] text-[var(--ink-60)]">
                    This is what people will see. Nothing is public yet.
                  </p>
                  <div className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-2xl p-4 space-y-1.5">
                    <p className="text-[11px] text-[var(--ink-60)]">{draft.type}</p>
                    <p className="text-sm font-extrabold text-[var(--brief-ink)]">{draft.title}</p>
                    {draft.description && (
                      <p className="text-[12px] text-[var(--ink-60)] leading-snug">{draft.description}</p>
                    )}
                    <div className="pt-1 space-y-0.5">
                      {draft.startsAt && (
                        <p className="text-[11px] text-[var(--brief-ink)]">
                          {draft.startsAt.replace('T', ' ')}
                        </p>
                      )}
                      {draft.location && (
                        <p className="text-[11px] text-[var(--brief-ink)]">{draft.location}</p>
                      )}
                      <p className="text-[11px] text-[var(--brief-ink)]">
                        {draft.price.trim() === '' || Number(draft.price) === 0
                          ? 'Free'
                          : `KES ${draft.price}`}
                        {draft.capacity.trim() !== '' && ` \u00b7 ${draft.capacity} spots`}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {createStep === 'published' && publishedCampaign && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-[var(--brief-ink)] shrink-0" />
                    <p className="text-xs font-extrabold text-[var(--brief-ink)]">
                      {publishedCampaign.title} is {publishedCampaign.status}
                    </p>
                  </div>
                  <p className="text-[12px] text-[var(--ink-60)]">
                    Share this link anywhere. Anyone who opens it can register.
                  </p>
                  {(() => {
                    const link = briefApi.campaignShareLink(
                      publishedCampaign.publicSlug,
                      publicOrigin
                    );
                    return (
                      <CampaignDistribution
                        link={link}
                        title={publishedCampaign.title}
                        onCopy={() =>
                          copyCampaignLink(publishedCampaign.publicSlug, publishedCampaign.id)
                        }
                        onShare={(ch) => briefApi.shareCampaign(publishedCampaign.id, ch)}
                        onNativeShare={() => shareCampaign(publishedCampaign)}
                      />
                    );
                  })()}
                  <button
                    onClick={() => { setCreateStep('closed'); openCampaign(publishedCampaign.id); }}
                    className="w-full text-[11px] text-[var(--ink-60)] underline underline-offset-2 cursor-pointer"
                  >
                    Open campaign
                  </button>
                </div>
              )}
            </div>

            {/* Sticky Action Footer */}
            {createStep === 'form' && (
              <div className="p-4 pb-safe pb-8 sm:pb-4 border-t border-[var(--brief-line)] bg-[color:var(--color-paper)] shrink-0">
                <button
                  disabled={draft.title.trim() === ''}
                  onClick={() => { setCampaignActionError(null); setCreateStep('preview'); }}
                  className="w-full py-3 rounded-xl bg-[#40916C] text-[var(--accent-ink)] font-extrabold text-xs cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#000000] transition-colors"
                >
                  Preview
                </button>
              </div>
            )}

            {createStep === 'preview' && (
              <div className="p-4 pb-safe pb-8 sm:pb-4 border-t border-[var(--brief-line)] bg-[color:var(--color-paper)] shrink-0 flex items-center gap-2">
                <button
                  disabled={campaignBusy}
                  onClick={() => setCreateStep('form')}
                  className="px-4 py-3 rounded-xl border border-[var(--brief-line)] text-[var(--brief-ink)] font-extrabold text-xs cursor-pointer disabled:opacity-40 hover:bg-[color:var(--color-well)]"
                >
                  Back
                </button>
                <button
                  disabled={campaignBusy}
                  onClick={publishDraft}
                  className="flex-1 py-3 rounded-xl bg-[#40916C] text-[var(--accent-ink)] font-extrabold text-xs cursor-pointer disabled:opacity-40 hover:bg-[#000000]"
                >
                  {campaignBusy ? 'Publishing...' : 'Publish'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      {captureOpen && (
        <div
          className="fixed inset-0 z-50 bg-[rgba(10, 14, 20, 0.85)] backdrop-blur-md flex flex-col justify-end sm:justify-center items-center p-0 sm:p-4 overflow-hidden"
          onClick={handleCaptureCancel}
        >
          <div
            className="w-full max-w-lg max-h-[92vh] sm:max-h-[85vh] flex flex-col bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden mb-safe"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 sm:p-5 border-b border-[var(--brief-line)] shrink-0 flex items-start justify-between gap-3 bg-[color:var(--color-paper)]">
              <div>
                <h2 className="text-xl font-extrabold text-[var(--brief-ink)]">
                  {captureMode === 'quick' ? 'Drop something here.' : 'Create news or post.'}
                </h2>
                <p className="text-[12px] text-[var(--ink-60)] mt-1">
                  {captureMode === 'quick'
                    ? 'A message, link, listing, event, opportunity or anything worth keeping.'
                    : 'Publish updates, news bulletins, opportunities or stories directly into Brief.'}
                </p>
              </div>
              <button
                onClick={handleCaptureCancel}
                className="p-2 rounded-full bg-[rgba(238, 241, 245, 0.80)] text-[var(--brief-ink)] border border-[var(--brief-line)] shrink-0 hover:bg-[#EFF1F4] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 sm:p-5 overflow-y-auto flex-1 space-y-4 pb-safe pb-8 sm:pb-5">
              {/* Mode switcher */}
              <div className="flex rounded-xl bg-[#EFF1F4] p-1 gap-1">
                <button
                  type="button"
                  onClick={() => { setCaptureMode('quick'); setCapturePreview(null); }}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-extrabold transition cursor-pointer ${
                    captureMode === 'quick' ? 'bg-[color:var(--color-paper)] text-[var(--brief-ink)] shadow-xs' : 'text-[var(--ink-60)] hover:text-[var(--brief-ink)]'
                  }`}
                >
                  Quick Capture
                </button>
                <button
                  type="button"
                  onClick={() => { setCaptureMode('direct'); setCapturePreview(null); }}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-extrabold transition cursor-pointer ${
                    captureMode === 'direct' ? 'bg-[color:var(--color-paper)] text-[var(--brief-ink)] shadow-xs' : 'text-[var(--ink-60)] hover:text-[var(--brief-ink)]'
                  }`}
                >
                  Post News / Update
                </button>
              </div>

              {captureMode === 'quick' ? (
                <>
                  <textarea
                    value={captureText}
                    onChange={(e) => {
                      setCaptureText(e.target.value);
                      setCapturePreview(null);
                    }}
                    rows={5}
                    placeholder="Paste or type anything (e.g. news update, meetup announcement, listing...)"
                    className="w-full bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-xl px-3 py-2.5 text-xs text-[var(--brief-ink)] placeholder:text-[var(--ink-60)] outline-none focus:border-[#0891B2] resize-none"
                  />

                  {!capturePreview && (
                    <button
                      onClick={handleCaptureParse}
                      disabled={captureText.trim() === ''}
                      className={`w-full py-3 rounded-xl font-extrabold text-xs transition ${
                        captureText.trim() === ''
                          ? 'bg-[color:var(--color-paper)] text-[var(--ink-60)] cursor-not-allowed border border-[var(--brief-line)]'
                          : 'bg-[#40916C] text-[var(--accent-ink)] cursor-pointer hover:bg-[#000000]'
                      }`}
                    >
                      Read it
                    </button>
                  )}

                  {/* Confirmation step. Brief shows exactly what it understood and
                      waits -- nothing is saved until the user agrees. */}
                  {capturePreview && (
                    <div className="space-y-3">
                      {!capturePreview.isObjectWorthy ? (
                        <div className="border border-[var(--brief-line)] bg-[color:var(--color-well)] rounded-xl p-3">
                          <p className="text-[12px] font-bold text-[var(--brief-ink)]">
                            Brief could not make an object from this.
                          </p>
                          <p className="text-[11px] text-[var(--ink-60)] mt-1">
                            {capturePreview.rejectionReason}
                          </p>
                          <p className="text-[11px] text-[var(--ink-60)] mt-1">
                            Nothing was saved.
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              setCaptureMode('direct');
                              setDirectTitle(captureText.slice(0, 60));
                            }}
                            className="mt-2.5 inline-flex items-center text-[12px] font-extrabold text-[var(--brief-ink)] underline cursor-pointer"
                          >
                            Create directly as news or post instead →
                          </button>
                        </div>
                      ) : (
                        <div className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-xl p-3 space-y-2">
                          <p className="text-[11px] text-[var(--brief-ink)] font-bold uppercase tracking-wider">
                            {getObjectTypeMeta(capturePreview.draft.type).label}
                          </p>
                          <p className="text-sm font-extrabold text-[var(--brief-ink)] leading-snug">
                            {capturePreview.draft.title}
                          </p>

                          {capturePreview.extracted
                            .filter((f) => f.field !== 'title')
                            .map((f) => (
                              <div
                                key={f.field}
                                className="flex items-baseline justify-between gap-3"
                              >
                                <span className="text-[11px] text-[var(--ink-60)]">
                                  {f.field}
                                </span>
                                <span className="text-[11px] text-[var(--ink-60)] truncate">
                                  {f.value}
                                </span>
                              </div>
                            ))}

                          {capturePreview.duplicates.length > 0 && (
                            <p className="text-[11px] text-[var(--brief-ink)]">
                              Possible duplicate of{' '}
                              {capturePreview.duplicates[0].item.title}
                            </p>
                          )}

                          <p className="text-[11px] text-[var(--ink-60)]">
                            Unverified. Saved as your own capture.
                          </p>
                        </div>
                      )}

                      <div className="flex gap-2">
                        <button
                          onClick={handleCaptureCancel}
                          className="flex-1 py-2.5 rounded-xl bg-[color:var(--color-paper)] border border-[var(--brief-line)] text-[var(--ink-60)] font-bold text-[12px] cursor-pointer"
                        >
                          Discard
                        </button>
                        {capturePreview.isObjectWorthy && (
                          <button
                            onClick={() => void handleCaptureConfirm()}
                            className="flex-[2] py-2.5 rounded-xl bg-[#40916C] text-[var(--accent-ink)] font-extrabold text-[12px] cursor-pointer hover:bg-[#000000]"
                          >
                            Save to Brief
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                /* Direct Post / News Creation */
                <div className="space-y-3">
                  <div>
                    <label className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--ink-60)] mb-1">
                      Post Type
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {([
                        ['knowledge', 'News / Bulletin', 'News'],
                        ['community', 'Community Post', 'Community'],
                        ['experience', 'Event / Meetup', 'Event'],
                        ['opportunity', 'Opportunity', 'Opportunity'],
                        ['service', 'Service Offer', 'Service']
                      ] as [ObjectType, string, string][]).map(([typeVal, label, catVal]) => (
                        <button
                          key={typeVal}
                          type="button"
                          onClick={() => {
                            setDirectType(typeVal);
                            setDirectCategory(catVal);
                          }}
                          className={`px-2.5 py-1 rounded-lg text-[12px] font-extrabold transition cursor-pointer border ${
                            directType === typeVal
                              ? 'bg-[#40916C] text-[var(--accent-ink)] border-[#0891B2]'
                              : 'bg-[color:var(--color-well)] text-[var(--ink-70)] border-[var(--brief-line)] hover:text-[var(--brief-ink)]'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--ink-60)] mb-1">
                      Title / Headline <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={directTitle}
                      onChange={(e) => setDirectTitle(e.target.value)}
                      placeholder="e.g. Community Tech Meetup this Saturday"
                      className="w-full bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-xl px-3 py-2 text-xs text-[var(--brief-ink)] placeholder:text-[var(--ink-60)] outline-none focus:border-[#0891B2]"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--ink-60)] mb-1">
                      Post Details / Content <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      value={captureText}
                      onChange={(e) => setCaptureText(e.target.value)}
                      rows={4}
                      placeholder="Write your news or post details here..."
                      className="w-full bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-xl px-3 py-2 text-xs text-[var(--brief-ink)] placeholder:text-[var(--ink-60)] outline-none focus:border-[#0891B2] resize-none"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-extrabold uppercase tracking-wider text-[var(--ink-60)] mb-1">
                      Location / Venue (Optional)
                    </label>
                    <input
                      type="text"
                      value={directLocation}
                      onChange={(e) => setDirectLocation(e.target.value)}
                      placeholder="e.g. Alchemist Bar, Westlands, Nairobi"
                      className="w-full bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-xl px-3 py-2 text-xs text-[var(--brief-ink)] placeholder:text-[var(--ink-60)] outline-none focus:border-[#0891B2]"
                    />
                  </div>

                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={handleCaptureCancel}
                      className="flex-1 py-2.5 rounded-xl bg-[color:var(--color-paper)] border border-[var(--brief-line)] text-[var(--ink-60)] font-bold text-[12px] cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={!directTitle.trim() || !captureText.trim()}
                      onClick={() => void handleDirectPost()}
                      className={`flex-[2] py-2.5 rounded-xl font-extrabold text-[12px] transition ${
                        !directTitle.trim() || !captureText.trim()
                          ? 'bg-[color:var(--brief-line)] text-[var(--ink-60)] cursor-not-allowed'
                          : 'bg-[#40916C] text-[var(--accent-ink)] cursor-pointer hover:bg-[#000000]'
                      }`}
                    >
                      Publish to Brief
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {selectedTeaSlug && (
        <TeaReader slug={selectedTeaSlug} onClose={dismissOverlay} />
      )}
      {selectedObjectForDetail && (
        <div
          className="fixed inset-0 z-50 bg-[rgba(10, 14, 20, 0.85)] backdrop-blur-md flex flex-col justify-end sm:justify-center items-center p-0 sm:p-4 overflow-hidden"
          onClick={dismissOverlay}
        >
          <div
            className="w-full max-w-2xl max-h-[92vh] sm:max-h-[88vh] flex flex-col bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-t-3xl sm:rounded-3xl overflow-hidden shadow-2xl mb-safe"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="overflow-y-auto flex-1 pb-safe pb-8 sm:pb-5">
              {/* Hero — the cover photo, or the first real gallery image when
                  a news story has photos but no cover. */}
              {(() => {
                const heroUrl = selectedObjectForDetail.imageUrl
                  ?? selectedObjectForDetail.gallery?.[0]?.url
                  ?? null;
                if (!heroUrl) return null;
                return (
                  <div className="relative h-56 sm:h-72">
                    <img
                      src={heroUrl}
                      alt={selectedObjectForDetail.title}
                      className="w-full h-full object-cover"
                    />

                    {/* §16 — the top action bar: save, share, close. Save and
                        share ride the hero so the primary actions are always
                        one thumb away; close (back) stays top-right. */}
                    <div className="absolute top-4 right-4 flex items-center gap-2">
                      <button
                        onClick={() => handleExecuteProtocolAction('save', selectedObjectForDetail)}
                        aria-label="Save"
                        className="p-2 rounded-full bg-[rgba(238, 241, 245, 0.80)] text-[var(--brief-ink)] border border-[var(--brief-line)] hover:border-[#0891B2]"
                      >
                        <Bookmark className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleShare(selectedObjectForDetail)}
                        aria-label="Share"
                        className="p-2 rounded-full bg-[rgba(238, 241, 245, 0.80)] text-[var(--brief-ink)] border border-[var(--brief-line)] hover:border-[#0891B2]"
                      >
                        <Share2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setSelectedObjectForDetail(null)}
                        aria-label="Close"
                        className="p-2 rounded-full bg-[rgba(238, 241, 245, 0.80)] text-[var(--brief-ink)] border border-[var(--brief-line)] hover:border-[#DC2626]"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    <div className="absolute bottom-4 left-4 flex gap-2">
                      <span className="text-[11px] font-extrabold px-3 py-1 rounded-full bg-[rgba(238, 241, 245, 0.85)] text-[var(--brief-ink)] border border-[var(--brief-line)]">
                        {selectedObjectForDetail.category}
                      </span>

                      {(() => {
                        const t = trustStateOf(selectedObjectForDetail);
                        const tone = TRUST_TONE[t.tone];
                        if (!t.label || !tone) return null;
                        return (
                          <span className="text-[11px] font-extrabold px-3 py-1 rounded-full" style={{ background: tone.bg, color: tone.fg }}>
                            {tone.glyph} {t.label}
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                );
              })()}

              {/* Gallery — the object's other REAL source photos, opened in a
                  new tab. Never fabricated; only rows the server projected. */}
              {(() => {
                const heroUrl = selectedObjectForDetail.imageUrl
                  ?? selectedObjectForDetail.gallery?.[0]?.url
                  ?? null;
                const rest = (selectedObjectForDetail.gallery ?? [])
                  .filter((img) => img.url !== heroUrl);
                if (rest.length === 0) return null;
                return (
                  <div className="grid grid-cols-3 gap-2 px-5 pt-4">
                    {rest.slice(0, 6).map((img) => (
                      <a
                        key={img.url}
                        href={img.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={img.alt ?? 'Photo'}
                        className="block aspect-square overflow-hidden rounded-xl border border-[var(--brief-line)] transition-transform hover:scale-[1.02]"
                      >
                        <img
                          src={img.url}
                          alt={img.alt ?? ''}
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      </a>
                    ))}
                  </div>
                );
              })()}

              {/* Without a hero image the close button and chips disappeared
                  entirely, leaving backdrop-click as the only way out. This is
                  the same control set, laid out for an imageless record. */}
              {!selectedObjectForDetail.imageUrl && !selectedObjectForDetail.gallery?.[0]?.url && (
                <div className="flex items-center justify-between gap-2 p-4 border-b border-[var(--brief-line)]">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-extrabold px-3 py-1 rounded-full bg-[rgba(238, 241, 245, 0.85)] text-[var(--brief-ink)] border border-[var(--brief-line)]">
                      {selectedObjectForDetail.category}
                    </span>

                    {(() => {
                      const t = trustStateOf(selectedObjectForDetail);
                      const tone = TRUST_TONE[t.tone];
                      if (!t.label || !tone) return null;
                      return (
                        <span className="text-[11px] font-extrabold px-3 py-1 rounded-full" style={{ background: tone.bg, color: tone.fg }}>
                          {tone.glyph} {t.label}
                        </span>
                      );
                    })()}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleExecuteProtocolAction('save', selectedObjectForDetail)}
                      aria-label="Save"
                      className="p-2 rounded-full bg-[rgba(238, 241, 245, 0.80)] text-[var(--brief-ink)] border border-[var(--brief-line)] hover:border-[#0891B2]"
                    >
                      <Bookmark className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleShare(selectedObjectForDetail)}
                      aria-label="Share"
                      className="p-2 rounded-full bg-[rgba(238, 241, 245, 0.80)] text-[var(--brief-ink)] border border-[var(--brief-line)] hover:border-[#0891B2]"
                    >
                      <Share2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={dismissOverlay}
                      aria-label="Close"
                      className="p-2 rounded-full bg-[rgba(238, 241, 245, 0.80)] text-[var(--brief-ink)] border border-[var(--brief-line)] hover:border-[#DC2626]"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              )}

              {/* Details */}
              <div className="p-5 space-y-5">

                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[11px] text-[var(--ink-60)]">
                      {getObjectTypeMeta(selectedObjectForDetail.type).label}
                    </span>
                  </div>

                  <h2 className="text-2xl font-extrabold text-[var(--brief-ink)]">
                    {selectedObjectForDetail.title}
                  </h2>

                  {/* §16 — the at-a-glance meta line: distance · location ·
                      freshness. All real, all optional; nothing renders when
                      the server didn't compute it. */}
                  {(() => {
                    const dist = getDistanceLabel(selectedObjectForDetail);
                    const place = selectedObjectForDetail.locationName
                      ?? selectedObjectForDetail.metadata?.area
                      ?? selectedObjectForDetail.metadata?.county
                      ?? null;
                    const fresh = getFreshness(selectedObjectForDetail);
                    const bits = [dist, place, fresh?.label].filter(Boolean);
                    if (bits.length === 0) return null;
                    return (
                      <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] font-semibold text-[var(--ink-70)]">
                        {bits.map((b, i) => (
                          <span key={i} className="inline-flex items-center gap-2">
                            {i > 0 && <span aria-hidden="true" className="text-[var(--ink-40)]">·</span>}
                            {b}
                          </span>
                        ))}
                      </p>
                    );
                  })()}

                  <p className="text-sm text-[var(--brief-ink)] mt-2 leading-relaxed">
                    {selectedObjectForDetail.summary}
                  </p>

                  {/* News detail — publisher, publication time, relevant
                      location, and the prominent "Read original" action.
                      Headline + concise summary only: the full article lives
                      at the original link, never reproduced here. */}
                  {selectedObjectForDetail.type === 'news' && (
                    <div className="mt-4 space-y-3">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-semibold text-[var(--ink-60)]">
                        {(() => {
                          const publisher = selectedObjectForDetail.sourceNames?.[0]
                            ?? (selectedObjectForDetail.sourceCount
                              ? `${selectedObjectForDetail.sourceCount} ${selectedObjectForDetail.sourceCount === 1 ? 'source' : 'sources'}`
                              : null);
                          if (!publisher) return null;
                          return <span>From {publisher}</span>;
                        })()}
                        {(() => {
                          const stamp = selectedObjectForDetail.publishedAt
                            ?? selectedObjectForDetail.createdAt;
                          const published = getPublishedLine(selectedObjectForDetail);
                          if (!stamp) return null;
                          const d = new Date(stamp);
                          if (!Number.isFinite(d.getTime())) return null;
                          const absolute = d.toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short' });
                          return (
                            <span>
                              {published ? `${published} · ` : ''}{absolute}
                            </span>
                          );
                        })()}
                        {(() => {
                          const place = selectedObjectForDetail.locationName
                            ?? selectedObjectForDetail.metadata?.area
                            ?? selectedObjectForDetail.metadata?.county;
                          if (!place) return null;
                          return <span>· {place}</span>;
                        })()}
                      </div>

                      {(() => {
                        const readUrl = selectedObjectForDetail.sourceUrl
                          ?? (selectedObjectForDetail.actionType === 'external'
                            ? selectedObjectForDetail.actionUrl
                            : null);
                        if (!readUrl) return null;
                        return (
                          <a
                            href={readUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 rounded-full bg-[#40916C] px-5 py-2.5 text-[13px] font-extrabold text-[var(--accent-ink)] transition-opacity hover:opacity-90"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            Read original
                          </a>
                        );
                      })()}
                    </div>
                  )}
                </div>

                {/* Facts -- generated from metadata, empty fields omitted */}
                {(() => {
                  const facts = buildKeyFacts(selectedObjectForDetail);
                  if (facts.length === 0) return null;
                  return (
                    <div className="grid grid-cols-2 gap-3">
                      {facts.map((fact) => (
                        <div
                          key={fact.key}
                          className="bg-[color:var(--color-well)] border border-[var(--brief-line)] rounded-xl p-3"
                        >
                          <div className="text-[11px] text-[var(--ink-60)]">
                            {fact.label}
                          </div>
                          <div className="text-xs font-bold mt-1">
                            {fact.value}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {/* Location & contact */}
                {(selectedObjectForDetail.locationName ||
                  selectedObjectForDetail.creatorName ||
                  selectedObjectForDetail.metadata?.contactPhone) && (
                  <div className="bg-[color:var(--color-well)] border border-[var(--brief-line)] rounded-xl p-3 space-y-3">
                    {selectedObjectForDetail.locationName && (
                      <div className="flex items-start gap-2">
                        <MapPin className="w-4 h-4 text-[var(--brief-ink)] shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <div className="text-[11px] text-[var(--ink-60)]">
                            Location
                          </div>
                          <div className="text-xs font-bold">
                            {selectedObjectForDetail.locationName}
                          </div>
                          {resolveAction(selectedObjectForDetail).kind !== 'map' && (
                            <a
                              href={buildMapsHref(
                                selectedObjectForDetail.locationName
                              )}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-[11px] font-extrabold text-[var(--brief-ink)] mt-1 hover:underline"
                            >
                              Open in Maps
                              <ArrowRight className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                      </div>
                    )}

                    {selectedObjectForDetail.creatorName && (
                      <div className="flex items-start gap-2">
                        <User className="w-4 h-4 text-[var(--brief-ink)] shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <div className="text-[11px] text-[var(--ink-60)]">
                            {selectedObjectForDetail.type === 'product'
                              ? 'Seller'
                              : selectedObjectForDetail.type === 'service'
                              ? 'Provider'
                              : selectedObjectForDetail.type === 'opportunity'
                              ? 'Offered by'
                              : 'Listed by'}
                          </div>
                          <div className="text-xs font-bold">
                            {selectedObjectForDetail.creatorName}
                          </div>
                        </div>
                      </div>
                    )}

                    {selectedObjectForDetail.metadata?.contactPhone && (
                      <div className="flex items-start gap-2">
                        <Building2 className="w-4 h-4 text-[var(--brief-ink)] shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <div className="text-[11px] text-[var(--ink-60)]">
                            Contact
                          </div>
                          <a
                            href={buildTelHref(
                              selectedObjectForDetail.metadata.contactPhone
                            )}
                            className="text-xs font-bold text-[var(--brief-ink)] hover:underline"
                          >
                            {selectedObjectForDetail.metadata.contactPhone}
                          </a>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* About this information (trust layer). One quiet block
                    answering: who said this, how recently, across how many
                    sources, is it still current, and has it been corrected.
                    Corroboration is shown as corroboration — never as truth. */}
                {(() => {
                  const subject = selectedObjectForDetail;
                  const fresh = getFreshness(subject);
                  const sourceChip = getSourceChip(subject);
                  const sourceKind = getSourceKindChip(subject);
                  const corroboration = getCorroborationLabel(subject);
                  const published = getPublishedLine(subject);
                  const life = getLifecycleBadge(subject);
                  const corrections = Array.isArray(subject.corrections) && subject.corrections.length > 0
                    ? subject.corrections
                    : null;
                  const hasTrust =
                    subject.isVerified ||
                    Boolean(fresh) ||
                    Boolean(subject.sourceUrl) ||
                    Boolean(sourceChip) ||
                    Boolean(published) ||
                    Boolean(corroboration) ||
                    Boolean(life) ||
                    Boolean(corrections) ||
                    (subject.openReportCount ?? 0) > 0;

                  if (!hasTrust) return null;

                  const CORRECTION_LABELS: Record<string, string> = {
                    title: 'Title',
                    type: 'Type',
                    summary: 'Summary',
                    category: 'Category',
                    locationName: 'Location',
                    venue: 'Venue',
                    organizer: 'Organizer',
                    dateCanonical: 'Date',
                    eventStart: 'Start time',
                    eventEnd: 'End time',
                    deadlineCanonical: 'Deadline',
                    operatingHours: 'Hours',
                    price: 'Price',
                    statusBadge: 'Status'
                  };

                  return (
                    <div className="bg-[color:var(--color-well)] border border-[var(--brief-line)] rounded-xl px-4 py-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <ShieldCheck className="w-4 h-4 text-[var(--brief-ink)] shrink-0" />
                        <span className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-[var(--ink-60)]">
                          About this information
                        </span>
                        {(() => {
                          const t = trustStateOf(subject);
                          const tone = TRUST_TONE[t.tone];
                          if (!t.label || !tone) return null;
                          return (
                            <span className="text-[11px] font-extrabold px-2 py-0.5 rounded-full shrink-0 uppercase" style={{ background: tone.bg, color: tone.fg }}>
                              {tone.glyph} {t.label}
                            </span>
                          );
                        })()}
                      </div>

                      {/* Provider — stated when known, absence stated plainly. */}
                      <p className="text-[11px] font-bold text-[var(--ink-70)]">
                        {subject.creatorName ? `Provider: ${subject.creatorName}` : 'Provider not stated'}
                      </p>

                      {/* Source — real names, never internal ids. */}
                      {subject.sourceNames && subject.sourceNames.length > 0 && (
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[11px] font-bold text-[var(--ink-80)] truncate">
                            From {subject.sourceNames.slice(0, 3).join(', ')}
                          </span>
                          {sourceKind && (
                            <span className="shrink-0 rounded-full bg-[color:var(--color-paper)] border border-[var(--brief-line)] px-1.5 py-0.5 text-[11px] font-bold text-[var(--ink-70)]">
                              {sourceKind}
                            </span>
                          )}
                          {sourceChip && sourceChip !== `Source · ${subject.sourceNames[0]}` && (
                            <span className="shrink-0 text-[11px] font-bold text-[var(--ink-60)]">
                              {sourceChip}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Published — publication age, separate from event time. */}
                      {published && (
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[11px] font-bold text-[var(--ink-70)]">
                            {published}
                          </span>
                          <span className="text-[11px] text-[var(--ink-60)]">
                            {new Date(subject.publishedAt ?? subject.createdAt).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </span>
                        </div>
                      )}

                      {/* Verification freshness — when this was last checked. */}
                      {fresh && (
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[11px] font-bold text-[var(--ink-70)]">
                            {fresh.label}
                          </span>
                          <span className="text-[11px] text-[var(--ink-60)]">
                            checked {fresh.verifiedOn}
                          </span>
                        </div>
                      )}

                      {/* Corroboration — a count, explicitly not certainty. */}
                      {corroboration && (
                        <p className="text-[11px] font-bold text-[var(--ink-70)]">
                          {corroboration}
                        </p>
                      )}

                      {/* Current status for time-sensitive content. */}
                      {life && (
                        <p className={`text-[11px] font-extrabold ${life.expired ? 'text-[#DC2626]' : 'text-[var(--ink-70)]'}`}>
                          {life.label}
                        </p>
                      )}

                      {/* Operator corrections: original fact + corrected value. */}
                      {corrections && (
                        <div className="space-y-1 border-t border-[rgba(220, 225, 232, 0.70)] pt-2">
                          {corrections.map((c) => (
                            <p key={c.id} className="text-[11px] text-[var(--ink-70)] leading-snug">
                              Corrected {CORRECTION_LABELS[c.field] ?? c.field}
                              {c.originalValue !== null && c.originalValue !== c.correctedValue
                                ? <> — was “{c.originalValue}”, now “{c.correctedValue}”</>
                                : <> to “{c.correctedValue}”</>}
                            </p>
                          ))}
                        </div>
                      )}

                      {/* Under review: an open user report flags this object. */}
                      {(subject.openReportCount ?? 0) > 0 && (
                        <p className="text-[11px] font-bold text-[#DC2626]">
                          Reported for review
                        </p>
                      )}

                      <p className="text-[11px] text-[var(--ink-60)] leading-snug">
                        Verification records when this was last checked. It is
                        not a guarantee of accuracy.
                      </p>

                      {subject.sourceUrl && (
                        <a
                          href={subject.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[var(--brief-ink)] underline underline-offset-2"
                        >
                          <ExternalLink className="w-3 h-3" />
                          Source
                        </a>
                      )}
                    </div>
                  );
                })()}

                {/* "You can..." (prompt 8). Only actions the data supports. */}
                {(() => {
                  const suggestions = getSuggestedActions(selectedObjectForDetail);
                  const extras = suggestions.filter((a) => a.kind !== 'primary');
                  if (extras.length === 0) return null;

                  return (
                    <div className="space-y-2">
                      <p className="text-[11px] text-[var(--ink-60)]">
                        You can
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {extras.map((a) => (
                          <a
                            key={a.key}
                            href={a.href}
                            target={a.key === 'call' ? undefined : '_blank'}
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-[12px] font-bold px-3 py-1.5 rounded-full bg-[color:var(--color-paper)] border border-[var(--brief-line)] text-[var(--brief-ink)]"
                          >
                            {a.label}
                          </a>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* Actions */}
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <button
                      onClick={() =>
                        handleExecuteProtocolAction(
                          'save',
                          selectedObjectForDetail
                        )
                      }
                      className="flex-1 py-3 rounded-xl bg-[color:var(--color-paper)] border border-[var(--brief-line)] text-[var(--brief-ink)] font-extrabold text-xs flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <Bookmark className="w-4 h-4" />
                      Save
                    </button>

                    {(() => {
                      const action = resolveAction(selectedObjectForDetail);
                      const primaryClass =
                        'flex-[2] py-3 rounded-xl bg-[#40916C] text-[var(--accent-ink)] font-extrabold text-xs flex items-center justify-center gap-2 cursor-pointer';

                      // Stays in Brief: pivot the stream sideways.
                      if (action.kind === 'internal') {
                        return (
                          <button
                            onClick={() =>
                              handlePivotToType(selectedObjectForDetail)
                            }
                            className={primaryClass}
                          >
                            {action.label}
                            <ArrowRight className="w-4 h-4" />
                          </button>
                        );
                      }

                      // Real destination -> real link.
                      if (action.kind !== 'none') {
                        const newTab = action.kind !== 'phone';
                        return (
                          <a
                            href={action.href}
                            target={newTab ? '_blank' : undefined}
                            rel={newTab ? 'noopener noreferrer' : undefined}
                            onClick={() =>
                              handleExecuteProtocolAction(
                                action.kind === 'phone' ? 'contact' : 'discover',
                                selectedObjectForDetail,
                                { silent: true }
                              )
                            }
                            className={primaryClass}
                          >
                            {action.label}
                            <ArrowRight className="w-4 h-4" />
                          </a>
                        );
                      }

                      // No route -> say so plainly. Don't fake a transaction.
                      return (
                        <div className="flex-[2] py-3 rounded-xl bg-[color:var(--color-paper)] border border-dashed border-[var(--brief-line)] text-[var(--ink-60)] font-extrabold text-xs flex items-center justify-center gap-2">
                          {action.label} unavailable
                        </div>
                      );
                    })()}
                  </div>

                  <p className="text-[11px] text-[var(--ink-60)] text-center">
                    {getActionNote(selectedObjectForDetail)}
                  </p>

                  {/* Secondary doors (prompts 11/18/21). Subordinate to the
                      primary action, and only rendered where data supports
                      them. Watch records intent; it does not poll anything. */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleShare(selectedObjectForDetail)}
                      className="flex-1 py-2.5 rounded-xl bg-[color:var(--color-paper)] border border-[var(--brief-line)] text-[var(--ink-60)] font-bold text-[12px] flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Share2 className="w-3.5 h-3.5" />
                      Share
                    </button>

                    <button
                      onClick={() =>
                        handleCreatePursuit(selectedObjectForDetail.title)
                      }
                      className="flex-1 py-2.5 rounded-xl bg-[color:var(--color-paper)] border border-[var(--brief-line)] text-[var(--ink-60)] font-bold text-[12px] flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Search className="w-3.5 h-3.5" />
                      Pursue
                    </button>

                    <button
                      onClick={() => handleToggleWatch(selectedObjectForDetail)}
                      className={`flex-1 py-2.5 rounded-xl border font-bold text-[12px] flex items-center justify-center gap-1.5 cursor-pointer ${
                        watchedIds.has(selectedObjectForDetail.id)
                          ? 'bg-[color:var(--color-paper)] border-[var(--brief-line)] text-[var(--brief-ink)]'
                          : 'bg-[color:var(--color-paper)] border-[var(--brief-line)] text-[var(--ink-60)]'
                      }`}
                    >
                      <Eye className="h-3.5 w-3.5" />
                      {watchedIds.has(selectedObjectForDetail.id) ? 'Watching' : 'Watch'}
                    </button>

                    <button
                      onClick={() => setCollectionPickerFor(selectedObjectForDetail.id)}
                      className="flex-1 py-2.5 rounded-xl bg-[color:var(--color-paper)] border border-[#0891B2]/50 text-[#40916C] font-bold text-[12px] flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <FolderPlus className="w-3.5 h-3.5" />
                      Add to collection
                    </button>
                  </div>

                  {/* Add-to-collection picker (Collections brief). Renders
                      inside the object modal so organizing never leaves the
                      object. */}
                  {collectionPickerFor === selectedObjectForDetail.id && (
                    <div className="mt-3">
                      <CollectionPicker
                        objectId={selectedObjectForDetail.id}
                        onChanged={() => void loadPersonal()}
                      />
                    </div>
                  )}

                  {/* §17 — community confirmation, the three-way crowd check.
                      "Is this still accurate?" with three honest answers:
                      Confirm (a real server confirmation), Not accurate (opens
                      the report reasons), and Not sure (declines to weigh in —
                      no record, nothing invented). The "Confirmed by N people"
                      readout is the object's real derived count. */}
                  <div className="rounded-2xl border border-[var(--brief-line)] bg-[color:var(--color-well)] p-3 space-y-2.5">
                    <p className="text-[12px] font-extrabold text-[var(--brief-ink)]">Is this still accurate?</p>
                    {/* Primary confirm is full-width; the two declinations sit
                        beside each other. No cramped 3-across grid. */}
                    <button
                      onClick={() => void handleConfirmObject(selectedObjectForDetail)}
                      disabled={objectCheckBusy === selectedObjectForDetail.id}
                      className="w-full py-2.5 rounded-xl bg-[#40916C] text-[var(--accent-ink)] text-[13px] font-extrabold cursor-pointer disabled:opacity-50"
                    >
                      {objectCheckBusy === selectedObjectForDetail.id ? 'Recording…' : 'Yes, accurate'}
                    </button>
                    <div className="flex items-center justify-between gap-2">
                      <button
                        onClick={() => setReportForObject(reportForObject === selectedObjectForDetail.id ? null : selectedObjectForDetail.id)}
                        aria-expanded={reportForObject === selectedObjectForDetail.id}
                        className={`flex-1 py-2.5 rounded-xl border text-[12px] font-bold cursor-pointer ${
                          reportForObject === selectedObjectForDetail.id
                            ? 'bg-[color:var(--color-paper)] border-[#DC2626] text-[#DC2626]'
                            : 'bg-[color:var(--color-paper)] border-[var(--brief-line)] text-[var(--ink-70)]'
                        }`}
                      >
                        Not accurate
                      </button>
                      <button
                        onClick={() => setReportForObject(null)}
                        className="flex-1 py-2.5 rounded-xl bg-[color:var(--color-paper)] border border-[var(--brief-line)] text-[var(--ink-60)] text-[12px] font-bold cursor-pointer"
                      >
                        Not sure
                      </button>
                    </div>
                    {(selectedObjectForDetail.confirmationCount ?? 0) > 0 && (
                      <p className="text-center text-[11px] font-bold text-[#059669]">
                        Confirmed by {selectedObjectForDetail.confirmationCount} {selectedObjectForDetail.confirmationCount === 1 ? 'person' : 'people'}
                      </p>
                    )}
                    {reportForObject === selectedObjectForDetail.id && (
                      <div className="flex flex-wrap gap-1.5">
                        {REPORT_REASONS.map((reason) => (
                          <button
                            key={reason.id}
                            onClick={() => void handleReportObject(selectedObjectForDetail, reason.id)}
                            disabled={objectCheckBusy === selectedObjectForDetail.id}
                            className="px-3 py-1.5 rounded-full border border-[var(--brief-line)] text-[12px] font-bold text-[var(--ink-70)] cursor-pointer disabled:opacity-50"
                          >
                            {reason.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {watchedIds.has(selectedObjectForDetail.id) && (
                    <p className="text-[11px] text-[var(--ink-60)] text-center">
                      Brief will track changes to this record. Alerts are not live yet.
                    </p>
                  )}

                  {/* Personal Brief tuning — explicit controls the user said
                      out loud, persisted, always reversible. Shown only for a
                      signed-in caller with the personal layer loaded. */}
                  {sessionUser && personalState && (() => {
                    const rel = personalState.relevance;
                    const { sourceId: detailSourceId } = selectedObjectForDetail;
                    const buttons: { kind: 'more' | 'less' | 'not_interested' | 'hide_source'; label: string; active: boolean }[] = [
                      { kind: 'more', label: 'More like this', active: rel.more.includes(selectedObjectForDetail.id) },
                      { kind: 'less', label: 'Less like this', active: rel.less.includes(selectedObjectForDetail.id) },
                      { kind: 'not_interested', label: 'Not interested', active: rel.notInterested.includes(selectedObjectForDetail.id) },
                      ...(detailSourceId
                        ? [{ kind: 'hide_source' as const, label: 'Hide this source', active: rel.hiddenSources.includes(detailSourceId) }]
                        : [])
                    ];
                    if (buttons.length === 0) return null;
                    return (
                      <div className="border-t border-[rgba(220, 225, 232, 0.70)] pt-3 mt-1">
                        <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-[var(--ink-60)] mb-2">
                          Tune this in your Brief
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {buttons.map((b) => (
                            <button
                              key={b.kind}
                              onClick={() => void tuneObject(b.kind, selectedObjectForDetail)}
                              className={`px-2.5 py-1.5 rounded-full border text-[11px] font-bold cursor-pointer transition ${
                                b.active
                                  ? 'bg-[#40916C] text-[var(--accent-ink)] border-[#0891B2]'
                                  : 'bg-[color:var(--color-paper)] text-[var(--ink-70)] border-[var(--brief-line)] hover:border-[#0891B2]'
                              }`}
                            >
                              {b.active ? `✓ ${b.label}` : b.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* Why this appeared (prompt 7). Every reason is computed
                    from real state, so none of them can be untrue. */}
                {(() => {
                  const reasons = getAppearanceReasons(selectedObjectForDetail, {
                    pursuits,
                    pursuitResults,
                    savedIds: savedIdSet,
                    watchedIds,
                    relatedToSavedIds
                  });
                  if (reasons.length === 0) return null;

                  return (
                    <details className="group">
                      <summary className="text-[11px] text-[var(--ink-60)] cursor-pointer list-none">
                        Why this appeared
                      </summary>
                      <div className="mt-2 space-y-1">
                        {reasons.map((r) => (
                          <p key={r.key} className="text-[11px] text-[var(--ink-60)]">
                            {r.label}
                          </p>
                        ))}
                      </div>
                    </details>
                  );
                })()}

                {/* LOCAL ACTIVITY GRAPH — related content for this object.
                    Every section is a REAL relationship (structured venue /
                    organizer / business fields, provenance, or persisted
                    relationship rows); the server never keyword-matches and
                    weak links never serialize. The location edge links into
                    the public /explore/:name surface. */}
                {detailGraph && (
                  <div className="mt-6 pt-5 border-t border-[var(--brief-line)]">
                    <RelatedContent
                      edges={detailGraph}
                      onOpenObject={(raw) => {
                        if (!raw?.id) return;
                        const local = objects.find((o) => o.id === String(raw.id));
                        setSelectedObjectForDetail(local ?? objectFromServer(raw));
                      }}
                      onOpenLocation={openLocationPage}
                    />
                  </div>
                )}


                {/* WHAT'S HERE (rework 4/5). The destination detail becomes a
                    mini directory: who is trading, what they sell, and a hop
                    into each vendor. Everything is read from stated graph
                    edges; when a destination has no linked vendors we say so
                    rather than inventing a line-up. */}
                {isDestinationObject(selectedObjectForDetail) && (() => {
                  const dest = selectedObjectForDetail;
                  const vendors = getDestinationVendors(dest, objects);
                  const state = getDestinationState(dest);
                  const access = getDestinationAccess(dest);
                  return (
                    <div className="mt-6 pt-5 border-t border-[var(--brief-line)]">
                      <div className="flex items-center justify-between gap-3 mb-3">
                        <div>
                          <p className="text-[11px] text-[var(--brief-ink)]">
                            {DESTINATION_STATE_LABELS[state]}
                          </p>
                          <h3 className="text-sm font-extrabold mt-1">
                            What's here
                          </h3>
                        </div>
                        {access && (
                          <span className="text-[11px] font-extrabold text-[var(--brief-ink)] border border-[var(--brief-line)] rounded-full px-2 py-0.5">
                            {access}
                          </span>
                        )}
                      </div>

                      {vendors.length === 0 ? (
                        <p className="text-xs text-[var(--ink-60)]">
                          Vendor information unavailable. Brief only lists
                          traders that are actually linked to this destination.
                        </p>
                      ) : (
                        <>
                          <p className="text-[12px] text-[var(--brief-ink)] mb-2">
                            {vendors.length}{' '}
                            {vendors.length === 1 ? 'vendor' : 'vendors'} listed
                            here
                          </p>
                          <div className="space-y-2">
                            {vendors.map((vendor) => {
                              const offerings = getVendorOfferings(vendor, objects);
                              return (
                                <div
                                  key={vendor.id}
                                  className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-2xl p-3"
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-2">
                                        <p className="text-xs font-extrabold text-[var(--brief-ink)] truncate">
                                          {vendor.title}
                                        </p>
                                        {vendor.isVerified && (
                                          <span className="shrink-0 text-[11px] font-extrabold px-1.5 py-0.5 rounded-full bg-[#40916C] text-[var(--accent-ink)]">
                                            VERIFIED
                                          </span>
                                        )}
                                      </div>
                                      <p className="text-[11px] text-[var(--ink-60)] mt-0.5">
                                        {vendor.category}
                                      </p>
                                    </div>
                                    <button
                                      onClick={() => setSelectedObjectForDetail(vendor)}
                                      className="shrink-0 text-[11px] font-extrabold text-[var(--brief-ink)] cursor-pointer"
                                    >
                                      View vendor
                                    </button>
                                  </div>

                                  {/* What they sell, only where real records exist. */}
                                  {offerings.length > 0 && (
                                    <div className="mt-2 space-y-1">
                                      {offerings.map((item) => (
                                        <button
                                          key={item.id}
                                          onClick={() => setSelectedObjectForDetail(item)}
                                          className="w-full flex items-center justify-between gap-3 text-left cursor-pointer"
                                        >
                                          <span className="text-[11px] text-[var(--brief-ink)] truncate">
                                            {item.title}
                                          </span>
                                          {typeof item.metadata?.price === 'number' && (
                                            <span className="shrink-0 text-[11px] text-[var(--brief-ink)]">
                                              {item.metadata.currency || 'KES'}{' '}
                                              {item.metadata.price.toLocaleString()}
                                            </span>
                                          )}
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })()}

                {/* VENDOR VIEW (rework 6/7). Opening an identity shows what
                    it sells and where it can be found, so a trader discovered
                    at one popup leads to the next one instead of a dead end.
                    Contact routes through the object's own stated action --
                    Brief never invents a phone number or a shop URL. */}
                {selectedObjectForDetail.type === 'identity' && (() => {
                  const vendor = selectedObjectForDetail;
                  const offerings = getVendorOfferings(vendor, objects);
                  const appearsAt = getVendorDestinations(vendor, objects);
                  if (offerings.length === 0 && appearsAt.length === 0) return null;
                  return (
                    <div className="mt-6 pt-5 border-t border-[var(--brief-line)]">
                      {appearsAt.length > 0 && (
                        <div className="mb-4">
                          <p className="text-[11px] text-[var(--brief-ink)]">
                            Find them at
                          </p>
                          <div className="mt-2 space-y-1.5">
                            {appearsAt.map((dest) => {
                              const state = getDestinationState(dest);
                              return (
                                <button
                                  key={dest.id}
                                  onClick={() => setSelectedObjectForDetail(dest)}
                                  className="w-full text-left bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-2xl p-3 cursor-pointer"
                                >
                                  <div className="flex items-center gap-2">
                                    {(state === 'live' || state === 'today') && (
                                      <span className="w-1.5 h-1.5 rounded-full bg-[#40916C] shrink-0" />
                                    )}
                                    <span className="text-xs text-[var(--brief-ink)] truncate">
                                      {dest.title}
                                    </span>
                                  </div>
                                  <span className="text-[11px] text-[var(--ink-60)]">
                                    {DESTINATION_STATE_LABELS[state]}
                                    {dest.locationName ? ` - ${dest.locationName}` : ''}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {offerings.length > 0 && (
                        <div>
                          <p className="text-[11px] text-[var(--brief-ink)]">
                            What they offer
                          </p>
                          <div className="mt-2 space-y-1.5">
                            {offerings.map((item) => (
                              <button
                                key={item.id}
                                onClick={() => setSelectedObjectForDetail(item)}
                                className="w-full flex items-center justify-between gap-3 bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-2xl p-3 text-left cursor-pointer"
                              >
                                <span className="min-w-0">
                                  <span className="block text-xs text-[var(--brief-ink)] truncate">
                                    {item.title}
                                  </span>
                                  <span className="block text-[11px] text-[var(--ink-60)]">
                                    {item.category}
                                  </span>
                                </span>
                                {typeof item.metadata?.price === 'number' && (
                                  <span className="shrink-0 text-[12px] font-extrabold text-[var(--brief-ink)]">
                                    {item.metadata.currency || 'KES'}{' '}
                                    {item.metadata.price.toLocaleString()}
                                  </span>
                                )}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Related */}
                {relatedObjects.length > 0 && (
                  <div className="mt-6 pt-5 border-t border-[var(--brief-line)]">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="text-[11px] text-[var(--brief-ink)]">
                          Continue exploring
                        </p>
                        <h3 className="text-sm font-extrabold mt-1">
                          {getRelatedHeading(
                            selectedObjectForDetail,
                            relatedObjects
                          )}
                        </h3>
                      </div>

                      <span className="text-[11px] text-[var(--ink-60)] shrink-0">
                        {relatedObjects.length} nearby
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {relatedObjects.map(({ item: related, reason }: any) => {
                        const chip = getReasonChip(reason);
                        const distance = getDistanceLabel(related);

                        return (
                          <button
                            key={related.id}
                            onClick={() => setSelectedObjectForDetail(related)}
                            className="text-left bg-[color:var(--color-well)] border border-[var(--brief-line)] hover:border-[#0891B2] rounded-xl p-3 transition group cursor-pointer"
                          >
                            <div className="flex items-start gap-3">
                              {related.imageUrl && (
                                <img
                                  src={related.imageUrl}
                                  alt=""
                                  className="w-14 h-14 rounded-lg object-cover shrink-0"
                                />
                              )}

                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <p className="text-[11px] text-[var(--ink-60)]">
                                    {related.category}
                                  </p>
                                  {chip && (
                                    <span className="text-[11px] font-extrabold px-1.5 py-0.5 rounded-full border border-[var(--brief-line)] text-[var(--brief-ink)]">
                                      {chip}
                                    </span>
                                  )}
                                </div>

                                <p className="text-xs font-extrabold mt-1 line-clamp-2 group-hover:text-[var(--brief-ink)]">
                                  {related.title}
                                </p>

                                {related.locationName && (
                                  <p className="text-[11px] text-[var(--brief-ink)] mt-1 truncate">
                                    {related.locationName}
                                  </p>
                                )}

                                {distance && (
                                  <p className="text-[11px] text-[var(--ink-60)] mt-0.5">
                                    {distance}
                                  </p>
                                )}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      <MenuSheet
        open={menuOpen}
        onClose={dismissOverlay}
        onSelect={handleMenuSelect}
        onSelectCity={chooseCity}
        selectedLocation={selectedLocation}
        unread={notifUnread}
        canOperate={briefApi.isOperator(sessionUser)}
      />
      {entityPageId && (
        <EntityPage
          entityId={entityPageId}
          authed={Boolean(sessionUser)}
          origin={publicOrigin}
          onClose={dismissOverlay}
          onOpenObject={(raw) => {
            if (!raw?.id) return;
            const local = objects.find((o) => o.id === String(raw.id));
            setSelectedObjectForDetail(local ?? objectFromServer(raw));
          }}
          onOpenLocation={openLocationPage}
          onRequireAuth={() => showToast('Sign in to follow this.')}
          onFollowChanged={() => void loadPersonal()}
        />
      )}
      {followingOpen && (
        <FollowingSurface
          authed={Boolean(sessionUser)}
          onClose={dismissOverlay}
          onOpenObject={(raw) => {
            if (!raw?.id) return;
            const local = objects.find((o) => o.id === String(raw.id));
            setSelectedObjectForDetail(local ?? objectFromServer(raw));
          }}
          onOpenEntity={(id) => {
            setFollowingOpen(false);
            setEntityPageId(id);
          }}
          onRequireAuth={() => showToast('Sign in to follow this.')}
          onFollowChanged={() => void loadPersonal()}
        />
      )}
      {locationName && (
        <LocationPage
          name={locationName}
          authed={Boolean(sessionUser)}
          followedLocations={personalState?.interests?.locations ?? []}
          onClose={dismissOverlay}
          onOpenObject={(raw) => {
            if (!raw?.id) return;
            const local = objects.find((o) => o.id === String(raw.id));
            setSelectedObjectForDetail(local ?? objectFromServer(raw));
          }}
          onOpenLocation={openLocationPage}
          onRequireAuth={() => showToast('Sign in to follow this area.')}
          onFollowLocation={(loc) => {
            if (!sessionUser) { showToast('Sign in to follow this area.'); return; }
            void followOne('location', loc);
          }}
        />
      )}
      {collectionsOpen && (
        <CollectionsSurface
          authed={Boolean(sessionUser)}
          savedCount={(personalState?.saved ?? []).length}
          onClose={dismissOverlay}
          onOpenObject={(raw) => {
            if (!raw?.id) return;
            const local = objects.find((o) => o.id === String(raw.id));
            setSelectedObjectForDetail(local ?? objectFromServer(raw));
          }}
          onOpenSaved={() => {
            setCollectionsOpen(false);
            setActiveTab('mylayer');
            setMyLayerSection('saved');
          }}
          onChanged={() => void loadPersonal()}
        />
      )}
{notificationsOpen && (
        <NotificationCenter
          authed={Boolean(sessionUser)}
          onClose={dismissOverlay}
          onChanged={setNotifUnread}
          onOpen={(n) => {
            const dest = n.dest ?? null;
            if (dest?.startsWith('object:')) {
              const id = dest.slice('object:'.length);
              const local = objects.find((o) => o.id === String(id));
              setNotificationsOpen(false);
              if (local) {
                setSelectedObjectForDetail(local);
                return;
              }
              // Not on the device's loaded feed: open the existing detail
              // endpoint so the deep link still lands on the real object.
              void briefApi.getObject(id).then((res) => {
                if (res.ok) setSelectedObjectForDetail(objectFromServer(res.data));
              });
              return;
            }
            if (dest === 'shopbrief') {
              // The morning brief is printed on the street of the owner's own
              // shopfronts, which is a real route in the shell — so the tap has
              // somewhere to go instead of a shrug.
              setNotificationsOpen(false);
              window.location.hash = 'spaces';
              return;
            }
            if (dest?.startsWith('entity:')) {
              setNotificationsOpen(false);
              setEntityPageId(dest.slice('entity:'.length));
              return;
            }
            if (dest?.startsWith('location:')) {
              setNotificationsOpen(false);
              openLocationPage(dest.slice('location:'.length));
              return;
            }
            if (dest?.startsWith('collection:')) {
              setNotificationsOpen(false);
              setCollectionRouteId(dest.slice('collection:'.length));
              return;
            }
            // No server destination: close instead of inventing a page.
            setNotificationsOpen(false);
          }}
        />
      )}

      {collectionRouteId && (
        <CollectionPage
          collectionId={collectionRouteId}
          mode="public"
          onClose={dismissOverlay}
          onOpenObject={(raw) => {
            if (!raw?.id) return;
            const local = objects.find((o) => o.id === String(raw.id));
            setSelectedObjectForDetail(local ?? objectFromServer(raw));
          }}
        />
      )}
    </>
  );
}
