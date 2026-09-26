import React, { useState } from 'react';
import { 
  BookOpen, 
  Truck, 
  Coins, 
  ShieldCheck, 
  CheckCircle2, 
  X, 
  ArrowRight, 
  Sparkles, 
  Phone, 
  Building2, 
  Clock, 
  ChevronRight,
  Zap,
  Navigation,
  MapPin,
  Check,
  Repeat
} from 'lucide-react';
import { soundEngine } from '../../utils/SoundEngine';

export interface CBCTextbookBundle {
  id: string;
  grade: string;
  title: string;
  subtitle: string;
  curriculum: string;
  supplier: string;
  retailPriceKes: number;
  bulkPriceKes: number;
  discountPercent: number;
  booksIncluded: string[];
  stockCount: number;
  verifiedBadge: string;
}

export const SAMPLE_CBC_BUNDLES: CBCTextbookBundle[] = [
  {
    id: 'cbc-g7',
    grade: 'Grade 7',
    title: 'CBC Grade 7 Core Curriculum Starter Pack',
    subtitle: 'KLB Topmark & Oxford Approved CBC Textbooks',
    curriculum: 'KICD Approved · CBC 2026 Edition',
    supplier: 'Textbook Centre & Westlands Book Depot (Verified Supplier Till: 541289)',
    retailPriceKes: 7200,
    bulkPriceKes: 5180,
    discountPercent: 28,
    booksIncluded: [
      'Mathematics Activities Gr 7 (KLB)',
      'Integrated Science Coursebook Gr 7',
      'English Literacy & Skills Reader Gr 7',
      'Kiswahili Fasaha Gr 7 (Oxford)',
      'Social Studies & Citizenship Gr 7',
      'Agriculture & Nutrition Gr 7'
    ],
    stockCount: 42,
    verifiedBadge: 'PTA VERIFIED'
  },
  {
    id: 'cbc-g8',
    grade: 'Grade 8',
    title: 'CBC Grade 8 Junior School Full Suite',
    subtitle: 'Complete 8-Subject Book Pack with Laboratory Manual',
    curriculum: 'KICD Approved · Junior Secondary 2026',
    supplier: 'Nairobi Publishers Guild (Verified Paybill: 247247 · Acc: CBC8-WAIRO)',
    retailPriceKes: 8500,
    bulkPriceKes: 6120,
    discountPercent: 28,
    booksIncluded: [
      'Pre-Technical Studies & ICT Gr 8',
      'Integrated Science & Lab Manual Gr 8',
      'Mathematics Advanced Track Gr 8',
      'English & Set Books Anthology Gr 8',
      'Kiswahili Sanifu Gr 8',
      'Social Studies & History Gr 8',
      'Health Education & Physical Wellness Gr 8'
    ],
    stockCount: 35,
    verifiedBadge: 'BULK ACCREDITED'
  },
  {
    id: 'cbc-g4',
    grade: 'Grade 4',
    title: 'CBC Grade 4 Primary Foundational Bundle',
    subtitle: 'Primary Literacy, Numeracy & Indigenous Languages',
    curriculum: 'KICD Approved · Upper Primary',
    supplier: 'Machakos Education Supplies (Till: 893120)',
    retailPriceKes: 4200,
    bulkPriceKes: 3020,
    discountPercent: 28,
    booksIncluded: [
      'Mathematics Activities Gr 4',
      'Science & Technology Gr 4',
      'English Activities Gr 4',
      'Kiswahili Mufti Gr 4',
      'Creative Arts & Music Gr 4'
    ],
    stockCount: 68,
    verifiedBadge: 'PARENT RECOMMENDED'
  }
];

export const FARGO_DROP_POINTS = [
  'Fargo Machakos Town (Posta Mall Hub)',
  'Fargo Nairobi CBD (Haile Selassie Ave)',
  'Fargo Westlands (Sarit Centre Staging)',
  'Fargo Mombasa (Digo Road Station)',
  'Fargo Kisumu (Mega City Mall Hub)',
  'Fargo Nakuru (Kenyatta Ave Posta)',
  'Fargo Eldoret (Rupa Mills Complex)',
  'Fargo Thika (Commercial Street)',
  'Fargo Nyeri (Kanisa Road Station)',
  'Fargo Meru (Tom Mboya Street)',
  'Fargo Kisii (Hospital Road Hub)',
  'Fargo Kitui (Kalawa Road Branch)'
];

export interface CBCTextbookBundleCheckoutModalProps {
  isOpen: boolean;
  initialBundleId?: string;
  onClose: () => void;
  onOrderSuccess?: (order: {
    bundleId: string;
    grade: string;
    totalAmountKes: number;
    deliveryLocation: string;
    paymentMethod: string;
    wairoTrackingCode: string;
    mpesaReceipt: string;
  }) => void;
}

export const CBCTextbookBundleCheckoutModal: React.FC<CBCTextbookBundleCheckoutModalProps> = ({
  isOpen,
  initialBundleId = 'cbc-g7',
  onClose,
  onOrderSuccess
}) => {
  const [selectedBundleId, setSelectedBundleId] = useState<string>(initialBundleId);
  const [quantity, setQuantity] = useState<number>(1);
  const [deliveryType, setDeliveryType] = useState<'fargo_pickup' | 'lori_backhaul' | 'wairo_gate' | 'wairo_door' | 'sendy_express' | 'bolt_rapid' | 'pickup'>('fargo_pickup');
  const [selectedFargoPoint, setSelectedFargoPoint] = useState<string>(FARGO_DROP_POINTS[0]);
  const [deliveryWard, setDeliveryWard] = useState<string>('Machakos Town (Gate 4)');
  const [parentName, setParentName] = useState<string>('Madam Beatrice Mwangi');
  const [parentPhone, setParentPhone] = useState<string>('0722 849 102');
  const [paymentSource, setPaymentSource] = useState<'mpesa' | 'circle_table_bank'>('circle_table_bank');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [completedOrder, setCompletedOrder] = useState<any | null>(null);

  if (!isOpen) return null;

  const currentBundle = SAMPLE_CBC_BUNDLES.find(b => b.id === selectedBundleId) || SAMPLE_CBC_BUNDLES[0];
  const deliveryFeeKes = deliveryType === 'fargo_pickup'
    ? 50
    : deliveryType === 'lori_backhaul'
    ? 80
    : deliveryType === 'wairo_gate'
    ? 120
    : deliveryType === 'wairo_door'
    ? 250
    : deliveryType === 'sendy_express'
    ? 450
    : deliveryType === 'bolt_rapid'
    ? 380
    : 0;

  const itemsSubtotalKes = currentBundle.bulkPriceKes * quantity;
  const totalAmountKes = itemsSubtotalKes + deliveryFeeKes;
  const totalSavingsKes = (currentBundle.retailPriceKes - currentBundle.bulkPriceKes) * quantity;

  const handleExecuteCheckout = () => {
    soundEngine.play('heavyTap');
    setIsProcessing(true);

    setTimeout(() => {
      soundEngine.play('victory');
      soundEngine.triggerHaptic([30, 40, 60]);
      setIsProcessing(false);

      const tracking = `WAIRO-${Math.floor(100000 + Math.random() * 900000)}`;
      const mpesaRef = `QKJ${Math.floor(100000 + Math.random() * 900000)}B`;
      const locationText = deliveryType === 'fargo_pickup' ? selectedFargoPoint : deliveryWard;

      const orderData = {
        bundleId: currentBundle.id,
        grade: currentBundle.grade,
        bundleTitle: currentBundle.title,
        totalAmountKes,
        deliveryLocation: locationText,
        deliveryType,
        paymentMethod: paymentSource === 'circle_table_bank' ? 'Circle Table Bank (Circle Payout)' : 'Direct M-Pesa STK',
        wairoTrackingCode: tracking,
        mpesaReceipt: mpesaRef,
        parentName,
        parentPhone,
        date: 'Today, ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };

      setCompletedOrder(orderData);
      onOrderSuccess?.(orderData);
    }, 900);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-fadeIn"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl bg-[color:var(--color-paper)] rounded-[28px] overflow-hidden shadow-2xl text-[var(--brief-ink)] animate-slideUp my-auto max-h-[92vh] flex flex-col"
      >
        {/* ================= MODAL HEADER ================= */}
        <div className="p-5 sm:p-6 bg-gradient-to-r from-[#1E293B] via-[#0F172A] to-[var(--brief-ink)] text-white space-y-3 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <span className="px-2.5 py-0.5 rounded-full bg-[#B8621F] text-white text-[11px] font-black uppercase tracking-wider">
                1-CLICK BULK DESK
              </span>
              <span className="text-xs text-amber-300 font-bold flex items-center space-x-1">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span>PTA Wholesale Direct</span>
              </span>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white cursor-pointer transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div>
            <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white flex items-center space-x-2">
              <span>CBC Textbooks & WAIRO Freight</span>
            </h2>
            <p className="text-xs text-stone-300 mt-0.5">
              Verified curriculum book packs with Fargo KES 50 pickup counters and Lori Systems 50% backhaul heavy freight.
            </p>
          </div>

          {/* Bundle Selector Pills */}
          {!completedOrder && (
            <div className="flex items-center space-x-2 overflow-x-auto pt-2 border-t border-white/10">
              {SAMPLE_CBC_BUNDLES.map(b => {
                const isSelected = b.id === selectedBundleId;
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => {
                      soundEngine.play('tap');
                      setSelectedBundleId(b.id);
                    }}
                    className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer whitespace-nowrap flex items-center space-x-1.5 ${
                      isSelected
                        ? 'bg-[#B8621F] text-white shadow-md'
                        : 'bg-white/10 hover:bg-white/20 text-stone-300'
                    }`}
                  >
                    <BookOpen className="w-3 h-3" />
                    <span>{b.grade}</span>
                    <span className="text-[11px] opacity-80">(-{b.discountPercent}%)</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ================= MODAL BODY / SCROLLABLE ================= */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-5">
          
          {/* STATE 1: COMPLETED ORDER RECEIPT */}
          {completedOrder ? (
            <div className="space-y-5 animate-fadeIn">
              <div className="p-5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-center space-y-2">
                <div className="w-12 h-12 rounded-full bg-emerald-500 text-white flex items-center justify-center mx-auto shadow-md">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-black text-[var(--brief-ink)]">
                  CBC Order Confirmed & Dispatched!
                </h3>
                <p className="text-xs text-[var(--brief-muted)]">
                  Paid KES {completedOrder.totalAmountKes.toLocaleString()} via {completedOrder.paymentMethod}
                </p>
              </div>

              {/* Physical Receipt Card */}
              <div className="p-5 rounded-2xl bg-white shadow-sm space-y-3 font-mono text-xs">
                <div className="flex items-center justify-between border-b pb-2">
                  <span className="text-gray-500 font-bold uppercase">WAIRO Waybill:</span>
                  <span className="font-black text-[#B8621F]">{completedOrder.wairoTrackingCode}</span>
                </div>
                <div className="flex items-center justify-between border-b pb-2">
                  <span className="text-gray-500 font-bold uppercase">M-Pesa Receipt:</span>
                  <span className="font-bold text-gray-800">{completedOrder.mpesaReceipt}</span>
                </div>
                <div className="flex items-center justify-between border-b pb-2">
                  <span className="text-gray-500 font-bold uppercase">Bundle Pack:</span>
                  <span className="font-bold text-right truncate max-w-[200px]">{completedOrder.bundleTitle}</span>
                </div>
                <div className="flex items-center justify-between border-b pb-2">
                  <span className="text-gray-500 font-bold uppercase">Collection Point:</span>
                  <span className="font-bold text-right truncate max-w-[200px]">{completedOrder.deliveryLocation}</span>
                </div>
                <div className="flex items-center justify-between pt-1 text-sm font-black">
                  <span>TOTAL PAID:</span>
                  <span className="text-[#10B981]">KES {completedOrder.totalAmountKes.toLocaleString()}</span>
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-[color:var(--brief-ink)] text-white flex items-center justify-between">
                <div className="flex items-center space-x-2.5">
                  <Truck className="w-5 h-5 text-[#00BFEF] animate-bounce" />
                  <div>
                    <span className="text-xs font-black block">
                      {completedOrder.deliveryType === 'fargo_pickup' 
                        ? 'Fargo 200+ Network Dispatch' 
                        : completedOrder.deliveryType === 'lori_backhaul'
                        ? 'Lori Systems 10-Ton Return Haulage'
                        : 'WAIRO Express Assigned'}
                    </span>
                    <span className="text-[11px] text-cyan-300">
                      {completedOrder.deliveryType === 'fargo_pickup' 
                        ? 'Next-Morning Pickup Ready at Station' 
                        : completedOrder.deliveryType === 'lori_backhaul'
                        ? 'Coastal Corridor Freight Manifest Active'
                        : 'Courier Partner in Transit'}
                    </span>
                  </div>
                </div>
                <span className="text-[11px] font-mono font-bold bg-white/20 px-2 py-1 rounded">
                  Waybill Verified
                </span>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="w-full py-3.5 rounded-2xl bg-[#B8621F] hover:bg-[#9B5118] text-white font-black text-sm shadow-md transition-transform active:scale-95 cursor-pointer"
              >
                Done & Return to Shelf
              </button>
            </div>
          ) : (
            <>
              {/* Selected Bundle Overview Card */}
              <div className="p-4 rounded-2xl bg-white shadow-sm space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <span className="text-[11px] font-black uppercase tracking-wider text-[#B8621F] block">
                      {currentBundle.curriculum}
                    </span>
                    <h3 className="text-base font-black text-[var(--brief-ink)] leading-tight mt-0.5">
                      {currentBundle.title}
                    </h3>
                    <p className="text-xs text-[var(--brief-muted)] mt-0.5">
                      {currentBundle.supplier}
                    </p>
                  </div>
                  <span className="text-[11px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                    Save KES {totalSavingsKes.toLocaleString()}
                  </span>
                </div>

                {/* Price Display */}
                <div className="flex items-baseline space-x-2 pt-1 border-t border-black/[0.04]">
                  <span className="text-2xl font-black text-[#10B981]">
                    KES {currentBundle.bulkPriceKes.toLocaleString()}
                  </span>
                  <span className="text-xs font-semibold text-gray-400 line-through">
                    KES {currentBundle.retailPriceKes.toLocaleString()}
                  </span>
                  <span className="text-[11px] font-bold text-[#B8621F]">
                    (Wholesale PTA Rate)
                  </span>
                </div>

                {/* Included Books Accordion preview */}
                <div className="bg-[#F9F8F6] rounded-xl p-3 space-y-1.5 text-xs">
                  <span className="font-bold text-[12px] text-[var(--brief-muted)] uppercase tracking-wider block">
                    {currentBundle.booksIncluded.length} Textbooks in this Bundle:
                  </span>
                  <ul className="space-y-1 text-[var(--brief-muted)] pl-1">
                    {currentBundle.booksIncluded.map((book, idx) => (
                      <li key={idx} className="flex items-center space-x-1.5 text-[11.5px]">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span className="truncate">{book}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Step 1: Delivery Location & Multi-Tier Mode */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-black uppercase tracking-wider text-[var(--brief-ink)] flex items-center space-x-1.5">
                    <span>1. Delivery Tier & Backhaul Arbitrage</span>
                  </label>
                  <span className="text-[11px] text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                    Fargo KES 50 • Lori -50%
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {/* Option 1: Fargo Courier Pickup Point Arbitrage (KES 50) */}
                  <button
                    type="button"
                    onClick={() => { soundEngine.play('tap'); setDeliveryType('fargo_pickup'); }}
                    className={`p-3 rounded-xl text-left transition-all cursor-pointer flex flex-col justify-between ring-2 ${
                      deliveryType === 'fargo_pickup'
                        ? 'bg-[#0B6E6E] text-white ring-[#0B6E6E] shadow-sm'
                        : 'bg-white hover:bg-emerald-50/50 text-[var(--brief-muted)] ring-emerald-400/40 shadow-xs'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <MapPin className="w-4 h-4 mb-1 text-emerald-300" />
                      <span className="text-[11px] font-black uppercase px-1.5 py-0.5 rounded bg-amber-400 text-stone-900">
                        TOP PICK
                      </span>
                    </div>
                    <div>
                      <span className="text-xs font-black block">Fargo Drop Point</span>
                      <span className="text-[11px] font-bold opacity-90">KES 50 (200+ Hubs)</span>
                    </div>
                  </button>

                  {/* Option 2: Lori Systems Backhaul Freight (-50% Return Pallet) */}
                  <button
                    type="button"
                    onClick={() => { soundEngine.play('tap'); setDeliveryType('lori_backhaul'); }}
                    className={`p-3 rounded-xl text-left transition-all cursor-pointer flex flex-col justify-between ring-2 ${
                      deliveryType === 'lori_backhaul'
                        ? 'bg-[#1D4ED8] text-white ring-[#1D4ED8] shadow-sm'
                        : 'bg-white hover:bg-blue-50/50 text-[var(--brief-muted)] ring-blue-400/40 shadow-xs'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <Repeat className="w-4 h-4 mb-1 text-cyan-300" />
                      <span className="text-[11px] font-black uppercase px-1.5 py-0.5 rounded bg-cyan-300 text-blue-950">
                        -50% LORI
                      </span>
                    </div>
                    <div>
                      <span className="text-xs font-black block">Lori Backhaul 🚛</span>
                      <span className="text-[11px] font-bold opacity-90">+KES 80 (Heavy Pallet)</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => { soundEngine.play('tap'); setDeliveryType('wairo_gate'); }}
                    className={`p-3 rounded-xl text-left transition-all cursor-pointer flex flex-col justify-between ${
                      deliveryType === 'wairo_gate'
                        ? 'bg-[#B8621F] text-white shadow-sm'
                        : 'bg-white hover:bg-white/80 text-[var(--brief-muted)] shadow-xs'
                    }`}
                  >
                    <Building2 className="w-4 h-4 mb-1" />
                    <div>
                      <span className="text-xs font-bold block">Town Gate Desk</span>
                      <span className="text-[11px] opacity-80">+KES 120 (SACCO)</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => { soundEngine.play('tap'); setDeliveryType('wairo_door'); }}
                    className={`p-3 rounded-xl text-left transition-all cursor-pointer flex flex-col justify-between ${
                      deliveryType === 'wairo_door'
                        ? 'bg-[#B8621F] text-white shadow-sm'
                        : 'bg-white hover:bg-white/80 text-[var(--brief-muted)] shadow-xs'
                    }`}
                  >
                    <Truck className="w-4 h-4 mb-1" />
                    <div>
                      <span className="text-xs font-bold block">Door Delivery</span>
                      <span className="text-[11px] opacity-80">+KES 250</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => { soundEngine.play('tap'); setDeliveryType('sendy_express'); }}
                    className={`p-3 rounded-xl text-left transition-all cursor-pointer flex flex-col justify-between ${
                      deliveryType === 'sendy_express'
                        ? 'bg-emerald-700 text-white shadow-sm'
                        : 'bg-white hover:bg-white/80 text-[var(--brief-muted)] shadow-xs'
                    }`}
                  >
                    <ShieldCheck className="w-4 h-4 mb-1 text-emerald-300" />
                    <div>
                      <span className="text-xs font-bold block">Sendy Express ⚡</span>
                      <span className="text-[11px] opacity-80">+KES 450 (Insured)</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => { soundEngine.play('tap'); setDeliveryType('bolt_rapid'); }}
                    className={`p-3 rounded-xl text-left transition-all cursor-pointer flex flex-col justify-between ${
                      deliveryType === 'bolt_rapid'
                        ? 'bg-amber-600 text-white shadow-sm'
                        : 'bg-white hover:bg-white/80 text-[var(--brief-muted)] shadow-xs'
                    }`}
                  >
                    <Zap className="w-4 h-4 mb-1 text-amber-200" />
                    <div>
                      <span className="text-xs font-bold block">Bolt Instant 🚀</span>
                      <span className="text-[11px] opacity-80">+KES 380 (Rapid GPS)</span>
                    </div>
                  </button>
                </div>

                {/* Fargo Point Selector or Ward Input */}
                {deliveryType === 'fargo_pickup' ? (
                  <div className="p-3 rounded-2xl bg-emerald-50/70 border border-emerald-200 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-emerald-900 flex items-center space-x-1">
                        <MapPin className="w-3.5 h-3.5 text-emerald-700" />
                        <span>Select Nearest Fargo Drop-Off Station:</span>
                      </span>
                      <span className="text-[11px] font-mono text-emerald-700 font-bold">
                        200+ Nationwide Hubs
                      </span>
                    </div>
                    <select
                      value={selectedFargoPoint}
                      onChange={(e) => setSelectedFargoPoint(e.target.value)}
                      className="w-full bg-white border border-emerald-300 rounded-xl px-3 py-2 text-xs font-bold text-[var(--brief-ink)] outline-none focus:border-emerald-600"
                    >
                      {FARGO_DROP_POINTS.map(fp => (
                        <option key={fp} value={fp}>{fp}</option>
                      ))}
                    </select>
                    <p className="text-[11px] text-emerald-800 leading-tight">
                      💡 <b>Pickup-Point Arbitrage:</b> Instead of KES 250+ home delivery, collect your package safely at Fargo Courier counter for just KES 50.
                    </p>
                  </div>
                ) : deliveryType === 'lori_backhaul' ? (
                  <div className="p-3 rounded-2xl bg-blue-50/70 border border-blue-200 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-blue-900 flex items-center space-x-1">
                        <Repeat className="w-3.5 h-3.5 text-blue-700" />
                        <span>Lori Systems Backhaul Heavy Corridor Hub:</span>
                      </span>
                      <span className="text-[11px] font-mono text-blue-700 font-bold">
                        50% Off Return Rate
                      </span>
                    </div>
                    <input
                      type="text"
                      value={deliveryWard}
                      onChange={(e) => setDeliveryWard(e.target.value)}
                      placeholder="School Depot / Port CFS / Highway Hub"
                      className="w-full bg-white border border-blue-300 rounded-xl px-3 py-2 text-xs font-bold text-[var(--brief-ink)] outline-none focus:border-blue-600"
                    />
                    <p className="text-[11px] text-blue-800 leading-tight">
                      🚛 <b>Backhaul Arbitrage:</b> Leverages empty returning 10-ton trucks on the Nairobi ⇄ Mombasa/Kisumu corridors at 50% wholesale savings.
                    </p>
                  </div>
                ) : (
                  <div className="p-3 rounded-xl bg-white shadow-xs flex items-center space-x-2">
                    <span className="text-xs font-bold text-gray-500">Destination Ward:</span>
                    <input
                      type="text"
                      value={deliveryWard}
                      onChange={(e) => setDeliveryWard(e.target.value)}
                      className="flex-1 text-xs font-bold text-[var(--brief-ink)] bg-transparent outline-none focus:text-[#B8621F]"
                    />
                  </div>
                )}
              </div>

              {/* Step 2: Payment Method (Circle Balance vs Direct M-Pesa) */}
              <div className="space-y-2.5">
                <label className="text-xs font-black uppercase tracking-wider text-[var(--brief-ink)] flex items-center justify-between">
                  <span>2. Payment Source</span>
                  <span className="text-[11px] text-emerald-600 font-bold">Encrypted & Instant</span>
                </label>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => { soundEngine.play('tap'); setPaymentSource('circle_table_bank'); }}
                    className={`p-3 rounded-xl text-left transition-all cursor-pointer flex flex-col justify-between ${
                      paymentSource === 'circle_table_bank'
                        ? 'bg-[#4C1D95] text-white shadow-sm'
                        : 'bg-white hover:bg-white/80 text-[var(--brief-muted)] shadow-xs'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <Coins className="w-4 h-4 text-amber-300" />
                      <span className="text-[11px] font-black uppercase bg-amber-400/20 text-amber-300 px-1.5 py-0.5 rounded">
                        Available
                      </span>
                    </div>
                    <div className="mt-2">
                      <span className="text-xs font-black block">Circle Table Bank</span>
                      <span className="text-[11px] text-purple-200">Cycle 5 Payout Balance</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => { soundEngine.play('tap'); setPaymentSource('mpesa'); }}
                    className={`p-3 rounded-xl text-left transition-all cursor-pointer flex flex-col justify-between ${
                      paymentSource === 'mpesa'
                        ? 'bg-[#008751] text-white shadow-sm'
                        : 'bg-white hover:bg-white/80 text-[var(--brief-muted)] shadow-xs'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black">M-PESA</span>
                      <span className="text-[11px] font-black uppercase bg-white/20 text-white px-1.5 py-0.5 rounded">
                        Instant
                      </span>
                    </div>
                    <div className="mt-2">
                      <span className="text-xs font-black block">Direct STK Push</span>
                      <span className="text-[11px] text-emerald-200">Safaricom Secure</span>
                    </div>
                  </button>
                </div>
              </div>

              {/* Order Summary & Submit Bar */}
              <div className="p-4 rounded-2xl bg-stone-100 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-600">Subtotal ({quantity} bundle):</span>
                  <span className="font-mono font-bold">KES {itemsSubtotalKes.toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-600">
                    {deliveryType === 'fargo_pickup' 
                      ? 'Fargo 200+ Pickup Station:' 
                      : deliveryType === 'lori_backhaul'
                      ? 'Lori Backhaul Pallet (-50% Return):'
                      : 'Freight & Logistics:'}
                  </span>
                  <span className="font-mono font-bold text-emerald-700">
                    KES {deliveryFeeKes.toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm font-black border-t border-gray-200 pt-2">
                  <span>Total Due:</span>
                  <span className="text-emerald-700 font-mono text-base">
                    KES {totalAmountKes.toLocaleString()}
                  </span>
                </div>

                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={handleExecuteCheckout}
                  className="w-full py-3.5 rounded-2xl bg-[color:var(--brief-ink)] hover:bg-black text-white font-black text-xs uppercase tracking-wider flex items-center justify-center space-x-2 shadow-lg cursor-pointer transition-all active:scale-[0.99] disabled:opacity-50"
                >
                  {isProcessing ? (
                    <div className="flex items-center space-x-2">
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Securing CBC Bundle & Assigning Lori/Fargo Freight Carrier...</span>
                    </div>
                  ) : (
                    <>
                      <span>1-Click Authorize & Dispatch (KES {totalAmountKes.toLocaleString()})</span>
                      <ArrowRight className="w-4 h-4 text-[#40916C]" />
                    </>
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
