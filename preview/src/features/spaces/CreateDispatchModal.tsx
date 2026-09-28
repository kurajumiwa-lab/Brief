import React, { useState } from 'react';
import type { SpaceDispatch, SpaceDispatchCreate } from '../../api/types';
import * as briefApi from '../../api/briefApi';
import { Truck, X, MapPin, Phone, User, Tag, Sparkles } from 'lucide-react';
import { soundEngine } from '../../utils/SoundEngine';

export interface CreateDispatchModalProps {
  isOpen: boolean;
  spaceId: string;
  orderId?: string | null;
  defaultReceiverName?: string;
  defaultReceiverPhone?: string;
  defaultNotes?: string;
  onClose: () => void;
  onDispatchCreated: (dispatch: SpaceDispatch) => void;
}

const COMMON_COUNTIES = [
  'Nakuru',
  'Mombasa',
  'Kisumu',
  'Eldoret / Uasin Gishu',
  'Nyeri',
  'Kiambu',
  'Machakos',
  'Meru',
  'Kakamega',
  'Kisii',
  'Kericho',
  'Nanyuki / Laikipia',
  'Kilifi / Malindi'
];

const POPULAR_CARRIERS = [
  '2NK Sacco',
  'Easy Coach',
  'Mololine Shuttle',
  'Transline Galaxy',
  'Guardian Coach',
  'North Rift Shuttle',
  '4NTE Sacco',
  'Modern Coast',
  'Great Rift Shuttle',
  'Direct Boda / Local Rider'
];

export const CreateDispatchModal: React.FC<CreateDispatchModalProps> = ({
  isOpen,
  spaceId,
  orderId = null,
  defaultReceiverName = '',
  defaultReceiverPhone = '',
  defaultNotes = '',
  onClose,
  onDispatchCreated
}) => {
  const [linkedOrder, setLinkedOrder] = useState(orderId || '');
  const [deliveryMode, setDeliveryMode] = useState<'stage'|'door'>('stage');
  const [estimatedDelivery, setEstimatedDelivery] = useState('');
  const [waybill, setWaybill] = useState('');
  const [quantity, setQuantity] = useState('');
  const [error, setError] = useState('');
  const [destinationCounty, setDestinationCounty] = useState<string>('Nakuru');
  const [destinationTown, setDestinationTown] = useState<string>('Nakuru Town Stage');
  const [carrierSacco, setCarrierSacco] = useState<string>('2NK Sacco');
  const [receiverName, setReceiverName] = useState<string>(defaultReceiverName);
  const [receiverPhone, setReceiverPhone] = useState<string>(defaultReceiverPhone);
  const [conductorContact, setConductorContact] = useState<string>('');
  const [stageFeeKes, setStageFeeKes] = useState<string>('300');
  const [notes, setNotes] = useState<string>(defaultNotes || 'Fragile parcel, handle with care');
  const [submitting, setSubmitting] = useState<boolean>(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!destinationCounty.trim() || !destinationTown.trim() || !receiverName.trim() || !receiverPhone.trim() || submitting) {
      return;
    }

    setSubmitting(true);
    setError('');
    soundEngine.play('reward');
    try {
      const res = await briefApi.createSpaceDispatch(spaceId, {
        orderId: linkedOrder.trim() || null,
        deliveryMode,
        estimatedDelivery: estimatedDelivery ? new Date(estimatedDelivery).toISOString() : null,
        waybillRef: waybill.trim() || undefined,
        quantity: quantity ? Number(quantity) : null,
        destinationCounty: destinationCounty.trim(),
        destinationTown: destinationTown.trim(),
        carrierSacco: carrierSacco.trim(),
        receiverName: receiverName.trim(),
        receiverPhone: receiverPhone.trim(),
        conductorContact: conductorContact.trim(),
        stageFeeKes: Number(stageFeeKes || 0),
        notes: notes.trim()
      });

      if (res.ok && res.data?.dispatch) {
        onDispatchCreated(res.data.dispatch);
        onClose();
      } else if (!res.ok) setError(res.error);
    } catch (err) {
      setError('Dispatch could not be saved. Please retry.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-fadeIn">
      <div className="w-full max-w-md bg-[color:var(--color-paper)] rounded-3xl shadow-2xl overflow-y-auto max-h-[90dvh] animate-scaleIn border border-black/5">
        {/* Header */}
        <div className="p-5 bg-[color:var(--color-surface)] flex items-center justify-between border-b border-black/5">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-xl bg-[color:var(--color-text)] text-[color:var(--color-primary)] flex items-center justify-center font-bold">
              <Truck className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-black text-[color:var(--color-text)]">
                WAIRO Cargo Dispatch
              </h3>
              <p className="text-[11px] text-[color:var(--color-text-muted)]">
                Inter-County Matatu Sacco & Courier Waybill
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-full text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)] hover:bg-black/5 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-3.5">
          {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
          <details className="text-xs space-y-2" open={Boolean(orderId)}>
            <summary className="cursor-pointer font-bold">Order tracking & delivery details</summary>
            <label className="block">Order number (optional)<input maxLength={128} value={linkedOrder} onChange={e=>setLinkedOrder(e.target.value)} className="block w-full border rounded-lg p-2 mt-1" placeholder="ord_…" /></label>
            <p className="text-[11px]">Link this seller’s order to enable customer tracking. Repeat with the same order number for a split shipment.</p>
            <label className="block">Delivery type<select value={deliveryMode} onChange={e=>setDeliveryMode(e.target.value as 'stage'|'door')} className="block w-full border rounded-lg p-2 mt-1"><option value="stage">Stage pickup</option><option value="door">Door delivery</option></select></label>
            <label className="block">Carrier waybill (optional)<input maxLength={100} value={waybill} onChange={e=>setWaybill(e.target.value)} className="block w-full border rounded-lg p-2 mt-1" placeholder="Leave blank for a Wairo dispatch reference" /></label>
            <label className="block">Estimated arrival (optional, your local time)<input type="datetime-local" value={estimatedDelivery} onChange={e=>setEstimatedDelivery(e.target.value)} className="block w-full border rounded-lg p-2 mt-1" /></label>
            <label className="block">Item quantity in this shipment (optional)<input type="number" min="1" step="1" disabled={!linkedOrder.trim()} value={quantity} onChange={e=>setQuantity(e.target.value)} className="block w-full border rounded-lg p-2 mt-1" /></label>
          </details>
          {/* Destination */}
          <div className="space-y-1.5">
            <label className="text-[12px] font-bold text-[color:var(--color-text)] flex items-center space-x-1">
              <MapPin className="w-3.5 h-3.5 text-[color:var(--color-primary)]" />
              <span>Destination Stage</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={destinationCounty}
                onChange={(e) => setDestinationCounty(e.target.value)}
                className="px-3 py-2 rounded-xl bg-[color:var(--color-surface)] text-xs border border-black/5 focus:outline-none"
              >
                {COMMON_COUNTIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <input
                type="text"
                placeholder="Town / Stage (e.g. KFA Stage)"
                value={destinationTown}
                onChange={(e) => setDestinationTown(e.target.value)}
                className="px-3 py-2 rounded-xl bg-[color:var(--color-surface)] text-xs border border-black/5 focus:outline-none"
                required
              />
            </div>
          </div>

          {/* Carrier Sacco */}
          <div className="space-y-1.5">
            <label className="text-[12px] font-bold text-[color:var(--color-text)]">Carrier / Matatu Sacco</label>
            <select
              value={carrierSacco}
              onChange={(e) => setCarrierSacco(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-[color:var(--color-surface)] text-xs border border-black/5 focus:outline-none"
            >
              {POPULAR_CARRIERS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {/* Receiver Info */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-[12px] font-bold text-[color:var(--color-text)]">Receiver Name</label>
              <input
                type="text"
                placeholder="e.g. Mary Wanjiku"
                value={receiverName}
                onChange={(e) => setReceiverName(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-[color:var(--color-surface)] text-xs border border-black/5 focus:outline-none"
                required
              />
            </div>
            <div className="space-y-1">
              <label className="text-[12px] font-bold text-[color:var(--color-text)]">Receiver Phone</label>
              <input
                type="tel"
                placeholder="e.g. 254712345678"
                value={receiverPhone}
                onChange={(e) => setReceiverPhone(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-[color:var(--color-surface)] text-xs border border-black/5 focus:outline-none"
                required
              />
            </div>
          </div>

          {/* Conductor & Fee */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-[12px] font-bold text-[color:var(--color-text)]">Conductor Contact (Optional)</label>
              <input
                type="tel"
                placeholder="e.g. 254722000111"
                value={conductorContact}
                onChange={(e) => setConductorContact(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-[color:var(--color-surface)] text-xs border border-black/5 focus:outline-none"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[12px] font-bold text-[color:var(--color-text)]">Stage Parcel Fee (KES)</label>
              <input
                type="number"
                placeholder="300"
                value={stageFeeKes}
                onChange={(e) => setStageFeeKes(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-[color:var(--color-surface)] text-xs border border-black/5 focus:outline-none"
              />
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1">
            <label className="text-[12px] font-bold text-[color:var(--color-text)]">Parcel Notes</label>
            <input
              type="text"
              placeholder="e.g. 2-Tier Birthday Cake, handle with care"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-[color:var(--color-surface)] text-xs border border-black/5 focus:outline-none"
            />
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 rounded-2xl bg-[color:var(--color-text)] hover:bg-black text-[color:var(--color-primary)] font-black text-xs transition-all shadow-md cursor-pointer flex items-center justify-center space-x-1.5"
            >
              <Truck className="w-4 h-4" />
              <span>{submitting ? 'Generating Waybill...' : 'Generate Waybill & Dispatch'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateDispatchModal;
