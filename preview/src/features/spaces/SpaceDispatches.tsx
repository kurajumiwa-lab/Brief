import React, { useState, useEffect } from 'react';
import type { SpaceDispatch, SpaceDispatchStatus } from '../../api/types';
import * as briefApi from '../../api/briefApi';
import { CreateDispatchModal } from './CreateDispatchModal';
import {
  Truck,
  MapPin,
  Phone,
  MessageCircle,
  CheckCircle2,
  Clock,
  Plus,
  ArrowRight,
  Package,
  Info
} from 'lucide-react';
import { soundEngine } from '../../utils/SoundEngine';

export interface SpaceDispatchesProps {
  spaceId: string;
  spaceName?: string;
  onRefresh?: () => void;
  className?: string;
}

export const SpaceDispatches: React.FC<SpaceDispatchesProps> = ({
  spaceId,
  spaceName = 'Space',
  onRefresh,
  className = ''
}) => {
  const [dispatches, setDispatches] = useState<SpaceDispatch[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [createModalOpen, setCreateModalOpen] = useState<boolean>(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  };

  const loadDispatches = async () => {
    if (!spaceId) return;
    setLoading(true);
    try {
      const res = await briefApi.getSpaceDispatches(spaceId);
      if (res.ok && res.data?.dispatches) {
        setDispatches(res.data.dispatches);
      }
    } catch (err) {
      console.error('Failed to load dispatches:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDispatches();
  }, [spaceId]);

  const handleUpdateStatus = async (dispatchId: string, nextStatus: SpaceDispatchStatus) => {
    soundEngine.play('reward');
    try {
      const result = await briefApi.updateSpaceDispatchStatus(spaceId, dispatchId, { status: nextStatus });
      if (!result.ok) { showToast(result.error); return; }
      showToast(`Status updated to ${nextStatus.replace('_', ' ')}`);
      loadDispatches();
      onRefresh?.();
    } catch (err) {
      console.error('Failed to update dispatch status:', err);
    }
  };

  const handleShareTracking = (d: SpaceDispatch) => {
    soundEngine.play('tap');
    const msg = encodeURIComponent(
      `Habari ${d.receiverName}! Parcel from ${spaceName}. Status: ${d.status.replace(/_/g,' ')}. Via ${d.carrierSacco} to ${d.destinationTown} (${d.destinationCounty}). Reference: ${d.waybillRef}${d.orderId ? `. Track: ${window.location.origin}/track?order=${encodeURIComponent(d.orderId)} (use your tracking email)` : ''}${d.conductorContact ? `. Carrier contact: ${d.conductorContact}` : ''}. Asante sana!`
    );
    const phone = d.receiverPhone.replace(/[^\d]/g, '');
    const url = phone ? `https://wa.me/${phone}?text=${msg}` : `https://wa.me/?text=${msg}`;
    if (typeof window !== 'undefined') {
      window.open(url, '_blank');
    }
    showToast(`WhatsApp tracking prepared for ${d.receiverName}`);
  };

  const statusColors: Record<SpaceDispatchStatus, { bg: string; text: string; label: string }> = {
    staged: { bg: 'bg-[color:var(--color-surface-elevated)]', text: 'text-[color:var(--color-warning)]', label: 'Staged at Sacco' },
    in_transit: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'In Transit on Road' },
    ready_at_stage: { bg: 'bg-[color:var(--color-primary-subtle)]', text: 'text-[color:var(--color-text)]', label: 'Ready at Destination Stage' },
    collected: { bg: 'bg-[color:var(--color-surface-elevated)]', text: 'text-[color:var(--color-success)]', label: 'Collected by Receiver' },
    out_for_delivery: { bg:'bg-blue-100', text:'text-blue-800', label:'Out for delivery' },
    delivered: { bg:'bg-green-100', text:'text-green-800', label:'Delivered' },
    cancelled: { bg: 'bg-rose-100', text: 'text-rose-800', label: 'Cancelled' }
  };

  return (
    <section className={`space-y-4 ${className}`}>
      {/* Toast */}
      {toastMsg && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-2xl bg-[color:var(--color-text)] text-white text-xs font-bold shadow-2xl animate-fadeIn border border-white/10">
          {toastMsg}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Truck className="w-4 h-4 text-[color:var(--color-text)]" />
          <h3 className="text-sm font-black uppercase tracking-wider text-[color:var(--color-text)]">
            Inter-County Cargo Dispatches ({dispatches.length})
          </h3>
        </div>
        <button
          type="button"
          onClick={() => {
            soundEngine.play('heavyTap');
            setCreateModalOpen(true);
          }}
          className="px-3 py-1.5 rounded-full bg-[color:var(--color-text)] hover:bg-black text-[color:var(--color-primary)] font-bold text-xs flex items-center space-x-1.5 transition-all cursor-pointer shadow-xs"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Dispatch Parcel</span>
        </button>
      </div>

      {/* Dispatches List */}
      {dispatches.length === 0 ? (
        <div className="p-6 rounded-3xl bg-[color:var(--color-paper)] border border-black/5 text-center space-y-2 shadow-sm">
          <Truck className="w-8 h-8 text-[color:var(--color-text-muted)] mx-auto opacity-40" />
          <p className="text-xs font-bold text-[color:var(--color-text)]">No cargo dispatches recorded yet</p>
          <p className="text-[12px] text-[color:var(--color-text-muted)] max-w-sm mx-auto">
            Connect your home-baked cakes and goods to cross-county distribution stages (2NK, Easy Coach, Mololine).
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {dispatches.map((d) => {
            const sc = statusColors[d.status] || statusColors.in_transit;

            return (
              <div
                key={d.id}
                className="p-4 rounded-3xl bg-[color:var(--color-paper)] border border-black/5 shadow-2xs space-y-3"
              >
                {/* Top Row: Waybill & Status */}
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="text-xs font-black text-[color:var(--color-text)] font-mono">
                        {d.waybillRef}
                      </span>
                      <span className="text-[11px] font-bold text-[color:var(--color-primary)] bg-[color:var(--color-primary-subtle)] px-2 py-0.5 rounded-full">
                        {d.carrierSacco}
                      </span>
                    </div>
                    <p className="text-xs font-bold text-[color:var(--color-text)] mt-1 flex items-center space-x-1">
                      <MapPin className="w-3.5 h-3.5 text-[color:var(--color-success)] inline shrink-0" />
                      <span>{d.destinationTown} ({d.destinationCounty})</span>
                    </p>
                  </div>

                  <span className={`text-[11px] font-extrabold px-2.5 py-1 rounded-full shrink-0 ${sc.bg} ${sc.text}`}>
                    {sc.label}
                  </span>
                </div>

                {/* Receiver details */}
                <div className="p-3 rounded-2xl bg-[color:var(--color-surface)] text-[12px] space-y-1 text-[color:var(--color-text-muted)]">
                  <p>
                    <strong className="text-[color:var(--color-text)]">Receiver:</strong> {d.receiverName} ({d.receiverPhone})
                  </p>
                  {d.conductorContact && (
                    <p>
                      <strong className="text-[color:var(--color-text)]">Conductor Contact:</strong> {d.conductorContact}
                    </p>
                  )}
                  {d.notes && (
                    <p className="italic text-[color:var(--color-text-muted)]">
                      "{d.notes}"
                    </p>
                  )}
                  {d.stageFeeKes > 0 && (
                    <p className="text-[11px] font-mono text-[color:var(--color-text)]">
                      Parcel Stage Fee: KES {d.stageFeeKes.toLocaleString()}
                    </p>
                  )}
                </div>

                {d.orderId && <a href={`/track?order=${encodeURIComponent(d.orderId)}`} className="inline-flex text-xs font-bold text-emerald-700 underline">Tracking & delivery requests →</a>}
                {!['collected','delivered','cancelled'].includes(d.status) && <DispatchUpdate dispatch={d} onSaved={() => {void loadDispatches();onRefresh?.();}} />}
                {/* Actions */}
                <div className="flex items-center justify-between pt-1 gap-2">
                  <button
                    type="button"
                    onClick={() => handleShareTracking(d)}
                    className="px-3 py-1.5 rounded-xl bg-[color:var(--color-surface-elevated)] hover:bg-[color:var(--color-surface-elevated)] text-[color:var(--color-success)] text-[11px] font-bold transition-all cursor-pointer flex items-center space-x-1"
                  >
                    <MessageCircle className="w-3.5 h-3.5 text-[color:var(--color-success)]" />
                    <span>Share WhatsApp Tracking</span>
                  </button>

                  <div className="flex items-center space-x-1.5">
                    {d.status === 'in_transit' && d.deliveryMode !== 'door' && (
                      <button
                        type="button"
                        onClick={() => handleUpdateStatus(d.id, 'ready_at_stage')}
                        className="px-2.5 py-1.5 rounded-xl bg-[color:var(--color-primary-subtle)] hover:bg-[color:var(--color-primary-subtle)] text-[color:var(--color-text)] text-[11px] font-extrabold transition-all cursor-pointer"
                      >
                        Mark Ready at Stage
                      </button>
                    )}
                    {d.status === 'ready_at_stage' && (
                      <button
                        type="button"
                        onClick={() => handleUpdateStatus(d.id, 'collected')}
                        className="px-2.5 py-1.5 rounded-xl bg-[color:var(--color-success)] hover:bg-[color:var(--color-success)] text-white text-[11px] font-bold transition-all cursor-pointer"
                      >
                        Mark Collected
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal */}
      {createModalOpen && (
        <CreateDispatchModal
          isOpen={createModalOpen}
          spaceId={spaceId}
          onClose={() => setCreateModalOpen(false)}
          onDispatchCreated={(dispatch) => {
            showToast(`Waybill ${dispatch.waybillRef} generated!`);
            loadDispatches();
            onRefresh?.();
          }}
        />
      )}
    </section>
  );
};

export default SpaceDispatches;


function DispatchUpdate({dispatch:d,onSaved}:{dispatch:SpaceDispatch;onSaved:()=>void}) {
  const [status,setStatus]=useState(d.status), [location,setLocation]=useState(''), [estimate,setEstimate]=useState('');
  const [busy,setBusy]=useState(false), [error,setError]=useState('');
  const stages:SpaceDispatchStatus[]=d.deliveryMode==='door' ? ['staged','in_transit','out_for_delivery','delivered'] : ['staged','in_transit','ready_at_stage','collected'];
  useEffect(()=>setStatus(d.status),[d.status]);
  return <details className="text-xs"><summary className="cursor-pointer font-bold py-2">Record tracking update</summary><form className="grid gap-2 pt-2" onSubmit={async e=>{e.preventDefault();if(busy)return;setBusy(true);setError('');const r=await briefApi.updateSpaceDispatchStatus(d.spaceId,d.id,{status,location,...(estimate?{estimatedDelivery:new Date(estimate).toISOString()}:{})});setBusy(false);if(r.ok){setLocation('');setEstimate('');onSaved();}else setError(r.error);}}>
    <label>Status<select className="block w-full border rounded-lg p-2" value={status} onChange={e=>setStatus(e.target.value as SpaceDispatchStatus)}>{[...stages.slice(Math.max(0,stages.indexOf(d.status))),'cancelled'].map(s=><option value={s} key={s}>{s.replace(/_/g,' ')}</option>)}</select></label>
    <label>Reported location (optional)<input maxLength={160} className="block w-full border rounded-lg p-2" value={location} onChange={e=>setLocation(e.target.value)} placeholder="Only a location you can confirm"/></label>
    <label>New estimated arrival (optional, your local time)<input type="datetime-local" className="block w-full border rounded-lg p-2" value={estimate} onChange={e=>setEstimate(e.target.value)}/></label>
    {error && <p role="alert" className="text-red-700">{error}</p>}<button disabled={busy} className="rounded-lg border bg-emerald-50 p-2 text-emerald-800 font-bold">{busy?'Saving…':'Save tracking update'}</button><p className="text-[11px] text-gray-500">Records delivery only. Does not fulfil the order, settle payment or trigger a refund.</p>
  </form></details>;
}
