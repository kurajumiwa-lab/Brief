import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import * as briefApi from '../../api/briefApi';
import type { Campaign as ApiCampaign, CampaignType as ApiCampaignType, Registration as ApiRegistration } from '../../api/types';
import type { CircleDetail as ApiCircleDetail } from '../../api/briefApi';
import { bootRoute } from '../../model/core';

// ---------------------------------------------------------------------------
// useCampaignHub -- extracted from App.tsx (Phase 4). Owns this slice of shell state
// + handlers; route-sync/popstate effects STAY in App (they read the returned
// setters). Interface notes are inline; verify with run-suites.sh.
// ---------------------------------------------------------------------------

export interface UseCampaignHubParams {
  publicOrigin: string | null;
  loadObjects: any;
  setObjects: any;
  setPublicOrigin: any;
  showToast: any;
}

export function useCampaignHub(params: UseCampaignHubParams) {
  const {
    loadObjects,
    setObjects,
    setPublicOrigin,
    showToast,
    publicOrigin,
  } = params;

  const [campaignState, setCampaignState] = useState<{
    status: 'idle' | 'loading' | 'ready' | 'error';
    data: ApiCampaign[] | null;
    error: string | null;
  }>({ status: 'idle', data: null, error: null });

  const [openCampaignId, setOpenCampaignId] = useState<string | null>(bootRoute.campaignId);

  const [campaignDetail, setCampaignDetail] = useState<ApiCampaign | null>(null);

  const [campaignRegs, setCampaignRegs] = useState<{
    status: 'idle' | 'loading' | 'ready' | 'error';
    data: ApiRegistration[] | null;
    error: string | null;
  }>({ status: 'idle', data: null, error: null });

  const [campaignBusy, setCampaignBusy] = useState<boolean>(false);

  const [campaignActionError, setCampaignActionError] = useState<string | null>(null);

  const [createStep, setCreateStep] = useState<'closed' | 'form' | 'preview' | 'published'>('closed');

  const [draft, setDraft] = useState<{
    title: string;
    type: ApiCampaignType;
    description: string;
    location: string;
    startsAt: string;
    capacity: string;
    price: string;
    circleId: string;
  }>({
    title: '',
    type: 'popup',
    description: '',
    location: '',
    startsAt: '',
    capacity: '',
    price: '',
    circleId: ''
  });

  const [publishedCampaign, setPublishedCampaign] = useState<ApiCampaign | null>(null);

  const [objectPicker, setObjectPicker] = useState<{
    open: boolean;
    status: 'idle' | 'loading' | 'ready' | 'error';
    data: any[] | null;
    error: string | null;
    selected: { id: string; title: string } | null;
  }>({ open: false, status: 'idle', data: null, error: null, selected: null });

  const loadAttachableObjects = async () => {
    setObjectPicker((p) => ({ ...p, open: true, status: 'loading', error: null }));
    const res = await briefApi.getObjects();
    if (res.ok) {
      setObjectPicker((p) => ({ ...p, status: 'ready', data: res.data, error: null }));
    } else {
      setObjectPicker((p) => ({ ...p, status: 'error', data: null, error: res.error }));
    }
  };

  const [editDraft, setEditDraft] = useState<{
    title: string;
    description: string;
    location: string;
    startsAt: string;
    price: string;
    capacity: string;
  } | null>(null);

  const [campaignCircle, setCampaignCircle] = useState<{
    status: 'idle' | 'loading' | 'ready' | 'error';
    data: ApiCircleDetail | null;
    error: string | null;
  }>({ status: 'idle', data: null, error: null });

  const loadCampaigns = async () => {
    setCampaignState((prev) => ({ ...prev, status: 'loading', error: null }));
    // Config is read alongside the list so share links are correct as soon as
    // a campaign can be shared. A failure here is not fatal: publicOrigin
    // stays null and the share UI reports that honestly.
    briefApi.getConfig().then((c) => {
      if (c.ok) setPublicOrigin(c.data.publicOrigin);
    });
    const res = await briefApi.getCampaigns();
    if (res.ok) {
      setCampaignState({ status: 'ready', data: res.data, error: null });
    } else {
      // No fallback to seeded data. An unreachable server means we say so.
      setCampaignState({ status: 'error', data: null, error: res.error });
    }
  };

  const openCampaign = async (id: string) => {
    setOpenCampaignId(id);
    setCampaignDetail(null);
    setCampaignActionError(null);
    setCampaignRegs({ status: 'loading', data: null, error: null });
    const [detail, regs] = await Promise.all([
      briefApi.getCampaign(id),
      briefApi.getCampaignRegistrations(id)
    ]);
    if (detail.ok) setCampaignDetail(detail.data);
    else setCampaignActionError(detail.error);
    if (regs.ok) setCampaignRegs({ status: 'ready', data: regs.data, error: null });
    else setCampaignRegs({ status: 'error', data: null, error: regs.error });

    // A campaign may be attached to a Circle carrying a Target. The target's
    // progress is derived on the server from settled transactions -- this only
    // reads it. Nothing here writes progress.
    if (detail.ok && detail.data.circleId) {
      setCampaignCircle({ status: 'loading', data: null, error: null });
      const circle = await briefApi.getCircle(detail.data.circleId);
      if (circle.ok) setCampaignCircle({ status: 'ready', data: circle.data, error: null });
      else setCampaignCircle({ status: 'error', data: null, error: circle.error });
    } else {
      setCampaignCircle({ status: 'idle', data: null, error: null });
    }
  };

  const attachObjectToCampaign = async (campaignId: string, objectId: string) => {
    setCampaignBusy(true);
    setCampaignActionError(null);
    const res = await briefApi.updateCampaign(campaignId, { objectId });
    setCampaignBusy(false);
    setObjectPicker((p) => ({ ...p, open: false, selected: null }));
    if (!res.ok) {
      setCampaignActionError(res.error);
      return;
    }
    await openCampaign(campaignId);
    showToast('Item linked');
  };

  const saveCampaignEdit = async (campaign: ApiCampaign) => {
    if (!editDraft) return;
    setCampaignBusy(true);
    setCampaignActionError(null);
    const price = editDraft.price.trim() === '' ? 0 : Number(editDraft.price);
    const capacity = editDraft.capacity.trim() === '' ? null : Number(editDraft.capacity);
    const res = await briefApi.updateCampaign(campaign.id, {
      title: editDraft.title.trim(),
      description: editDraft.description.trim(),
      location: editDraft.location.trim() === '' ? null : editDraft.location.trim(),
      startsAt: editDraft.startsAt.trim() === '' ? null : editDraft.startsAt.trim(),
      price: Number.isFinite(price) ? price : 0,
      ...(campaign.status === 'draft'
        ? { capacity: capacity !== null && Number.isFinite(capacity) ? capacity : null }
        : {})
    });
    setCampaignBusy(false);
    if (!res.ok) {
      setCampaignActionError(res.error);
      return;
    }
    setCampaignDetail(res.data);
    setEditDraft(null);
    loadCampaigns();
    showToast('Saved');
  };

  /**
   * Remove an event from the dashboard.
   *
   * TWO DIFFERENT ACTS, and the server decides which one is available:
   *
   *   nothing depends on it  -> DELETE, and the row is gone
   *   a registration, a ticket or a ledger row exists
   *                          -> WITHDRAW, because deleting it would leave
   *                             other people's records describing an event
   *                             that no longer exists. The seats are released,
   *                             tickets stop working, money is refunded through
   *                             the ledger, and the holders are told - the same
   *                             path the host's own Withdraw button takes.
   *
   * This used to cancel-then-delete, which skipped all of that: a cancelled
   * campaign with live tickets, unrefunded money and nobody told.
   */
  const handleRemoveCampaign = async (campaignId: string) => {
    setCampaignBusy(true);
    setCampaignActionError(null);
    try {
      const allCampaigns = campaignState.data ?? [];
      const c = allCampaigns.find((x) => x.id === campaignId) || campaignDetail;
      const preview = await briefApi.getCampaignWithdrawal(campaignId);

      if (preview.ok && !preview.data.preview.canDelete && preview.data.preview.canWithdraw) {
        const withdrawn = await briefApi.withdrawCampaign(campaignId, 'withdrawn from the campaign dashboard');
        if (!withdrawn.ok) throw new Error(withdrawn.error);
        setCampaignState((prev) => ({
          ...prev,
          data: (prev.data ?? []).map((item) => (item.id === campaignId ? withdrawn.data.campaign : item))
        }));
        setCampaignDetail((prev) => (prev && prev.id === campaignId ? withdrawn.data.campaign : prev));
        const r = withdrawn.data.withdrawal.receipt;
        showToast(
          `Withdrawn - ${r.ticketsVoided} ticket${r.ticketsVoided === 1 ? '' : 's'} stopped, ` +
          `${r.registrationsCancelled} place${r.registrationsCancelled === 1 ? '' : 's'} released, ` +
          `${r.refunded.length} refund${r.refunded.length === 1 ? '' : 's'} recorded` +
          `${r.owed.length ? `, ${r.owed.length} still owed and queued for a person` : ''}, ` +
          `${r.holdersNotified} told. The record stays.`
        );
      } else {
        const removed = await briefApi.deleteCampaign(campaignId);
        if (!removed.ok) throw new Error(removed.error);
        setCampaignState((prev) => ({
          ...prev,
          data: (prev.data ?? []).filter((item) => item.id !== campaignId)
        }));
        if (c?.objectId) {
          setObjects((prev: any[]) => prev.filter((o) => o.id !== c.objectId));
        }
        setOpenCampaignId(null);
        setCampaignDetail(null);
        setEditDraft(null);
        showToast('Event removed - nothing had happened on it yet.');
        void loadObjects();
      }
      void loadCampaigns();
    } catch (e: any) {
      setCampaignActionError(String(e.message || e));
    } finally {
      setCampaignBusy(false);
    }
  };

  const beginEdit = (c: ApiCampaign) => {
    setCampaignActionError(null);
    setEditDraft({
      title: c.title,
      description: c.description,
      location: c.location ?? '',
      startsAt: c.startsAt ? c.startsAt.slice(0, 16) : '',
      price: c.price === 0 ? '' : String(c.price),
      capacity: c.capacity === null ? '' : String(c.capacity)
    });
  };

  const shareCampaign = async (campaign: ApiCampaign) => {
    const link = briefApi.campaignShareLink(campaign.publicSlug, publicOrigin);
    if (!link.available) {
      showToast('No public link configured yet');
      return;
    }
    briefApi.shareCampaign(campaign.id, 'native');
    const url = link.url;
    const nav = typeof navigator !== 'undefined' ? (navigator as any) : null;
    if (nav && typeof nav.share === 'function') {
      try {
        await nav.share({ title: campaign.title, url });
        return;
      } catch {
        // User dismissed the sheet, or the browser refused. Fall through to
        // copy rather than reporting a failure they did not cause.
      }
    }
    if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') {
      try {
        await nav.clipboard.writeText(url);
        showToast('Link copied');
        return;
      } catch {
        // fall through
      }
    }
    showToast(url);
  };

  const copyCampaignLink = async (slug: string, campaignId?: string) => {
    const link = briefApi.campaignShareLink(slug, publicOrigin);
    if (!link.available) {
      showToast('No public link configured yet');
      return;
    }
    if (campaignId) briefApi.shareCampaign(campaignId, 'link');
    const url = link.url;
    const nav = typeof navigator !== 'undefined' ? (navigator as any) : null;
    if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') {
      try {
        await nav.clipboard.writeText(url);
        showToast('Link copied');
        return;
      } catch {
        // fall through
      }
    }
    showToast(url);
  };

  const submitDraft = async () => {
    setCampaignBusy(true);
    setCampaignActionError(null);
    const capacity = draft.capacity.trim() === '' ? null : Number(draft.capacity);
    const price = draft.price.trim() === '' ? 0 : Number(draft.price);
    const res = await briefApi.createCampaign({
      title: draft.title.trim(),
      type: draft.type,
      description: draft.description.trim(),
      location: draft.location.trim() === '' ? null : draft.location.trim(),
      startsAt: draft.startsAt.trim() === '' ? null : draft.startsAt.trim(),
      capacity: capacity !== null && Number.isFinite(capacity) ? capacity : null,
      price: Number.isFinite(price) ? price : 0,
      circleId: draft.circleId === '' ? null : draft.circleId,
      // Attach an existing item when one was chosen. The server checks
      // authority and refuses if the creator may not use it.
      objectId: objectPicker.selected ? objectPicker.selected.id : null
    });
    setCampaignBusy(false);
    if (!res.ok) {
      setCampaignActionError(res.error);
      return null;
    }
    return res.data;
  };

  const publishDraft = async () => {
    const created = await submitDraft();
    if (!created) return;
    setCampaignBusy(true);
    const res = await briefApi.campaignAction(created.id, 'publish');
    setCampaignBusy(false);
    if (!res.ok) {
      setCampaignActionError(res.error);
      return;
    }
    setPublishedCampaign(res.data);
    setCreateStep('published');
    loadCampaigns();
  };

  const confirmPayment = async (campaignId: string, registrationId: string) => {
    setCampaignBusy(true);
    setCampaignActionError(null);
    const res = await briefApi.confirmRegistrationPayment(campaignId, registrationId);
    setCampaignBusy(false);
    if (!res.ok) {
      setCampaignActionError(res.error);
      return;
    }
    await openCampaign(campaignId);
    showToast('Payment confirmed');
  };

  const [updateTitle, setUpdateTitle] = useState('');

  const [updateBody, setUpdateBody] = useState('');

  const [updateBusy, setUpdateBusy] = useState(false);

  const [updateNote, setUpdateNote] = useState<string | null>(null);

  const postUpdate = async (campaignId: string) => {
    if (!updateTitle.trim() || !updateBody.trim() || updateBusy) return;
    setUpdateBusy(true);
    setUpdateNote(null);
    const res = await briefApi.postCampaignUpdate(campaignId, {
      title: updateTitle.trim(),
      body: updateBody.trim()
    });
    setUpdateBusy(false);
    if (!res.ok) {
      setUpdateNote(res.error);
      return;
    }
    setUpdateTitle('');
    setUpdateBody('');
    setUpdateNote('Posted. It is on the public page now.');
  };

  const setRegStatus = async (
    campaignId: string,
    registrationId: string,
    status: 'checked_in' | 'no_show'
  ) => {
    setCampaignBusy(true);
    const res = await briefApi.setRegistrationStatus(campaignId, registrationId, status);
    setCampaignBusy(false);
    if (!res.ok) {
      setCampaignActionError(res.error);
      return;
    }
    // Refetch instead of patching state: the metrics block must move with it.
    openCampaign(campaignId);
  };

  return {
    attachObjectToCampaign,
    beginEdit,
    campaignActionError,
    campaignBusy,
    campaignCircle,
    campaignDetail,
    campaignRegs,
    campaignState,
    confirmPayment,
    copyCampaignLink,
    createStep,
    draft,
    editDraft,
    handleRemoveCampaign,
    loadAttachableObjects,
    loadCampaigns,
    objectPicker,
    openCampaign,
    openCampaignId,
    postUpdate,
    publishDraft,
    publishedCampaign,
    saveCampaignEdit,
    setCampaignActionError,
    setCampaignBusy,
    setCampaignCircle,
    setCampaignDetail,
    setCampaignRegs,
    setCampaignState,
    setCreateStep,
    setDraft,
    setEditDraft,
    setObjectPicker,
    setOpenCampaignId,
    setPublishedCampaign,
    setRegStatus,
    setUpdateBody,
    setUpdateBusy,
    setUpdateNote,
    setUpdateTitle,
    shareCampaign,
    submitDraft,
    updateBody,
    updateBusy,
    updateNote,
    updateTitle,
  };
}
