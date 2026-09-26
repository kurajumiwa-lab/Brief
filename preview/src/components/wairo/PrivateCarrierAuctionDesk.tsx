import React, { useState, useMemo } from 'react';
import {
  Truck,
  Car,
  Bike,
  ShieldCheck,
  CheckCircle2,
  DollarSign,
  Search,
  Plus,
  X,
  Lock,
  ChevronRight,
  Send,
  Radio,
  Sparkles,
  Phone,
  Package,
  Info,
  Clock,
  RefreshCw,
  Zap,
  SlidersHorizontal,
  Award,
  ArrowRight
} from 'lucide-react';
import { soundEngine } from '../../utils/SoundEngine';

export interface CarrierFleetBid {
  id: string;
  carrierName: string;
  isBrandedCorporation: boolean;
  isLogbookVerified: boolean;
  vehicleType: 'Boda Boda (150cc)' | 'Electric Cargo Bike' | 'Town Van (1 Ton)' | 'Pickup 4x4' | 'Light Truck (3 Ton)';
  plateNumber: string;
  driverName: string;
  driverPhone: string;
  trustScore: number; // e.g. 99.2%
  completedDeliveries: number;
  bidPriceKes: number;
  fixedRateKes: number;
  etaMinutes: number;
  insuranceCovered: boolean;
  mathScore: number; // Score = (w1 * priceScore) + (w2 * trustScore) + (w3 * speedScore) + (w4 * logbookBonus)
  breakdown: {
    priceComponent: number;
    trustComponent: number;
    speedComponent: number;
    logbookBonus: number;
  };
}

const REGISTERED_CARRIERS: CarrierFleetBid[] = [
  {
    id: 'carrier-fargo-1',
    carrierName: 'Fargo Courier Kenya Ltd',
    isBrandedCorporation: true,
    isLogbookVerified: true,
    vehicleType: 'Town Van (1 Ton)',
    plateNumber: 'KDF 819B',
    driverName: 'Ezekiel Otieno',
    driverPhone: '0722 *** 119',
    trustScore: 99.4,
    completedDeliveries: 1420,
    bidPriceKes: 480,
    fixedRateKes: 550,
    etaMinutes: 16,
    insuranceCovered: true,
    mathScore: 94.8,
    breakdown: { priceComponent: 32.5, trustComponent: 34.8, speedComponent: 17.5, logbookBonus: 10.0 }
  },
  {
    id: 'carrier-boda-ev-2',
    carrierName: 'GreenWheels Boda Syndicate',
    isBrandedCorporation: false,
    isLogbookVerified: true,
    vehicleType: 'Electric Cargo Bike',
    plateNumber: 'KMDF 302X',
    driverName: 'Brian Kipchumba',
    driverPhone: '0711 *** 490',
    trustScore: 98.7,
    completedDeliveries: 384,
    bidPriceKes: 220,
    fixedRateKes: 260,
    etaMinutes: 12,
    insuranceCovered: true,
    mathScore: 96.2,
    breakdown: { priceComponent: 39.2, trustComponent: 33.5, speedComponent: 13.5, logbookBonus: 10.0 }
  },
  {
    id: 'carrier-g4s-3',
    carrierName: 'G4S Secure Logistics',
    isBrandedCorporation: true,
    isLogbookVerified: true,
    vehicleType: 'Town Van (1 Ton)',
    plateNumber: 'KBZ 991K',
    driverName: 'Peter Kamau',
    driverPhone: '0733 *** 821',
    trustScore: 99.8,
    completedDeliveries: 2890,
    bidPriceKes: 600,
    fixedRateKes: 600,
    etaMinutes: 20,
    insuranceCovered: true,
    mathScore: 91.0,
    breakdown: { priceComponent: 26.0, trustComponent: 35.0, speedComponent: 20.0, logbookBonus: 10.0 }
  },
  {
    id: 'carrier-swift-4',
    carrierName: 'SwiftLink Express Riders',
    isBrandedCorporation: false,
    isLogbookVerified: true,
    vehicleType: 'Boda Boda (150cc)',
    plateNumber: 'KMDJ 812T',
    driverName: 'Moses Waweru',
    driverPhone: '0799 *** 441',
    trustScore: 97.9,
    completedDeliveries: 612,
    bidPriceKes: 200,
    fixedRateKes: 250,
    etaMinutes: 14,
    insuranceCovered: false,
    mathScore: 93.4,
    breakdown: { priceComponent: 40.0, trustComponent: 32.4, speedComponent: 11.0, logbookBonus: 10.0 }
  },
  {
    id: 'carrier-sendy-5',
    carrierName: 'Sendy Partner Fleet',
    isBrandedCorporation: true,
    isLogbookVerified: false,
    vehicleType: 'Pickup 4x4',
    plateNumber: 'KCU 401A',
    driverName: 'Hassan Noor',
    driverPhone: '0720 *** 990',
    trustScore: 96.5,
    completedDeliveries: 510,
    bidPriceKes: 750,
    fixedRateKes: 850,
    etaMinutes: 25,
    insuranceCovered: true,
    mathScore: 82.3,
    breakdown: { priceComponent: 24.1, trustComponent: 33.2, speedComponent: 25.0, logbookBonus: 0.0 }
  }
];

export function PrivateCarrierAuctionDesk({
  onClose,
  onDispatchSelected
}: {
  onClose?: () => void;
  onDispatchSelected?: (carrier: CarrierFleetBid) => void;
}) {
  const [activeTab, setActiveTab] = useState<'auction' | 'branded_fixed' | 'math_formula' | 'carrier_register'>('auction');
  const [cargoType, setCargoType] = useState<string>('Express Parcel');
  const [pickupHub, setPickupHub] = useState<string>('CBD Kencom');
  const [dropoffHub, setDropoffHub] = useState<string>('Westlands Sarit');
  const [weightKg, setWeightKg] = useState<number>(3);
  const [isSimulatingAuction, setIsSimulatingAuction] = useState<boolean>(false);
  const [auctionFinished, setAuctionFinished] = useState<boolean>(true);
  const [selectedCarrier, setSelectedCarrier] = useState<CarrierFleetBid | null>(null);
  const [dispatchSuccessMsg, setDispatchSuccessMsg] = useState<string>('');

  // Formula Weight Configuration Sliders (Default Mathematical Tunings)
  const [priceWeight, setPriceWeight] = useState<number>(40);
  const [trustWeight, setTrustWeight] = useState<number>(35);
  const [speedWeight, setSpeedWeight] = useState<number>(15);
  const [logbookWeight, setLogbookWeight] = useState<number>(10);

  // Dynamically compute mathematical scores based on weights
  const rankedCarriers = useMemo(() => {
    const totalW = priceWeight + trustWeight + speedWeight + logbookWeight || 100;
    const normPriceW = (priceWeight / totalW) * 100;
    const normTrustW = (trustWeight / totalW) * 100;
    const normSpeedW = (speedWeight / totalW) * 100;
    const normLogbookW = (logbookWeight / totalW) * 100;

    const minPrice = 200;
    const minEta = 10;

    return [...REGISTERED_CARRIERS].map(c => {
      const priceScore = (minPrice / c.bidPriceKes) * (normPriceW / 100) * 100;
      const trustScore = (c.trustScore / 100) * (normTrustW / 100) * 100;
      const speedScore = (minEta / Math.max(c.etaMinutes, 10)) * (normSpeedW / 100) * 100;
      const logbookBonus = c.isLogbookVerified ? normLogbookW : 0;
      const finalScore = Number((priceScore + trustScore + speedScore + logbookBonus).toFixed(1));

      return {
        ...c,
        mathScore: finalScore,
        breakdown: {
          priceComponent: Number(priceScore.toFixed(1)),
          trustComponent: Number(trustScore.toFixed(1)),
          speedComponent: Number(speedScore.toFixed(1)),
          logbookBonus: Number(logbookBonus.toFixed(1))
        }
      };
    }).sort((a, b) => b.mathScore - a.mathScore);
  }, [priceWeight, trustWeight, speedWeight, logbookWeight]);

  const handleRunAuction = () => {
    soundEngine.play('tap');
    setIsSimulatingAuction(true);
    setAuctionFinished(false);
    setSelectedCarrier(null);
    setDispatchSuccessMsg('');

    setTimeout(() => {
      soundEngine.play('victory');
      setIsSimulatingAuction(false);
      setAuctionFinished(true);
    }, 1100);
  };

  const handleSelectCarrier = (carrier: CarrierFleetBid) => {
    soundEngine.play('heavyTap');
    setSelectedCarrier(carrier);
    setDispatchSuccessMsg(`Selected ${carrier.carrierName}! 90% M-Pesa escrow locked at KES ${carrier.bidPriceKes}.`);
    onDispatchSelected?.(carrier);
  };

  return (
    <div className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-3xl overflow-hidden shadow-2xl text-[var(--brief-ink)] max-w-4xl mx-auto">
      
      {/* ================= HEADER ================= */}
      <div className="bg-gradient-to-br from-[#0F172A] via-[#1E293B] to-[#0A101D] text-white p-5 sm:p-6 relative">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-[11px] font-mono font-black px-2.5 py-0.5 rounded-full bg-[#00BFEF] text-[var(--brief-ink)] uppercase tracking-wider">
                MATHEMATICAL REVERSE AUCTION
              </span>
              <span className="text-xs text-emerald-200 font-bold flex items-center space-x-1">
                <Truck className="w-3.5 h-3.5 text-emerald-400" />
                <span>Private Carrier Fleets & Silent Bidding</span>
              </span>
            </div>

            <h2 className="text-xl sm:text-2xl font-black mt-2 text-white tracking-tight flex items-center space-x-2">
              <span>Carrier Reverse-Auction Engine</span>
              <Sparkles className="w-5 h-5 text-amber-400" />
            </h2>
            <p className="text-xs text-emerald-200/80 mt-0.5 max-w-xl">
              Competitive bidding without public chat spam. Registered carriers compete algorithmically based on price, trust rating, speed, and verified vehicle logbook ownership.
            </p>
          </div>

          {onClose && (
            <button
              type="button"
              onClick={() => { soundEngine.play('tap'); onClose(); }}
              className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white cursor-pointer transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center space-x-1.5 mt-5 border-t border-white/10 pt-3 overflow-x-auto">
          {[
            { id: 'auction', label: 'Reverse Auction Live', badge: 'Active' },
            { id: 'branded_fixed', label: 'Branded Direct Booking (Fixed Rates)' },
            { id: 'math_formula', label: 'Matching Algorithm Weights' }
          ].map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => { soundEngine.play('tap'); setActiveTab(tab.id as any); }}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap flex items-center space-x-1.5 ${
                activeTab === tab.id
                  ? 'bg-white text-[var(--brief-ink)] shadow-md font-black'
                  : 'bg-white/10 text-white/80 hover:bg-white/20'
              }`}
            >
              <span>{tab.label}</span>
              {tab.badge && (
                <span className="text-[11px] px-1.5 py-0.2 rounded-full font-mono bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30">
                  {tab.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ================= TAB 1: REVERSE AUCTION ================= */}
      {activeTab === 'auction' && (
        <div className="p-5 sm:p-6 space-y-5">
          
          {/* Auction Parameter Controls */}
          <div className="p-4 rounded-2xl bg-gray-50 border border-gray-200 grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
            <div className="space-y-1">
              <label className="font-bold text-gray-700">Cargo Type</label>
              <select
                value={cargoType}
                onChange={(e) => setCargoType(e.target.value)}
                className="w-full bg-white border border-gray-200 rounded-xl px-2.5 py-1.5 text-xs outline-none focus:border-[#0891B2]"
              >
                <option value="Express Parcel">Express Parcel (Documents)</option>
                <option value="Electronics">Electronics / Gadgets</option>
                <option value="Bulky Cartons">Bulky E-Commerce Cartons</option>
                <option value="Farm Produce">Farm Produce Sack</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="font-bold text-gray-700">Pickup Location</label>
              <input
                type="text"
                value={pickupHub}
                onChange={(e) => setPickupHub(e.target.value)}
                className="w-full bg-white border border-gray-200 rounded-xl px-2.5 py-1.5 text-xs outline-none focus:border-[#0891B2]"
              />
            </div>

            <div className="space-y-1">
              <label className="font-bold text-gray-700">Drop-off Location</label>
              <input
                type="text"
                value={dropoffHub}
                onChange={(e) => setDropoffHub(e.target.value)}
                className="w-full bg-white border border-gray-200 rounded-xl px-2.5 py-1.5 text-xs outline-none focus:border-[#0891B2]"
              />
            </div>

            <div className="flex items-end">
              <button
                type="button"
                onClick={handleRunAuction}
                disabled={isSimulatingAuction}
                className="w-full py-2 px-3 rounded-xl bg-[#40916C] hover:bg-[#ff6f3b] text-white font-black text-xs flex items-center justify-center space-x-1.5 shadow-sm cursor-pointer disabled:opacity-50 transition-all"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSimulatingAuction ? 'animate-spin' : ''}`} />
                <span>{isSimulatingAuction ? 'Computing Bids…' : 'Run Silent Auction'}</span>
              </button>
            </div>
          </div>

          {dispatchSuccessMsg && (
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold flex items-center justify-between animate-fadeIn">
              <div className="flex items-center space-x-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>{dispatchSuccessMsg}</span>
              </div>
              <span className="text-[11px] font-mono text-emerald-700">Ref: WRO-AUC-9912</span>
            </div>
          )}

          {/* Auction Bid Ranker List */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-mono text-gray-500 uppercase font-bold text-[11px]">
                Algorithmically Ranked Carrier Bids ({rankedCarriers.length} registered carriers matched)
              </span>
              <span className="text-[11px] text-gray-500">Sorted by Math Match Score</span>
            </div>

            <div className="space-y-2">
              {rankedCarriers.map((carrier, idx) => (
                <div
                  key={carrier.id}
                  className={`p-4 rounded-2xl border transition-all flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 shadow-xs ${
                    idx === 0
                      ? 'bg-gradient-to-r from-blue-50/70 to-emerald-50/70 border-[#0891B2] ring-1 ring-[#0891B2]/20'
                      : 'bg-white border-[var(--brief-line)] hover:border-gray-300'
                  }`}
                >
                  {/* Left: Carrier Identity & Verification */}
                  <div className="space-y-1">
                    <div className="flex items-center space-x-2">
                      <span className="font-mono font-black text-xs text-[var(--brief-ink)]">#{idx + 1}</span>
                      <span className="font-bold text-xs text-[var(--brief-ink)]">{carrier.carrierName}</span>
                      {carrier.isBrandedCorporation && (
                        <span className="text-[11px] font-mono bg-blue-100 text-blue-800 px-1.5 py-0.2 rounded font-bold">
                          CORPORATE FLEET
                        </span>
                      )}
                      {carrier.isLogbookVerified && (
                        <span className="inline-flex items-center space-x-0.5 bg-emerald-100 text-emerald-800 text-[11px] font-mono font-bold px-1.5 py-0.2 rounded">
                          <ShieldCheck className="w-2.5 h-2.5 text-emerald-600" />
                          <span>LOGBOOK VERIFIED</span>
                        </span>
                      )}
                    </div>

                    <div className="flex items-center space-x-2 text-[12px] text-gray-500 font-mono">
                      <span>{carrier.driverName} ({carrier.plateNumber})</span>
                      <span>•</span>
                      <span>{carrier.vehicleType}</span>
                      <span>•</span>
                      <span className="text-emerald-700 font-bold">{carrier.trustScore}% Trust ({carrier.completedDeliveries} drops)</span>
                    </div>
                  </div>

                  {/* Middle: Mathematical Score & Breakdown */}
                  <div className="flex items-center space-x-3 text-right sm:text-right">
                    <div className="space-y-0.5">
                      <div className="flex items-center space-x-1.5 justify-end">
                        <Award className="w-3.5 h-3.5 text-amber-500" />
                        <span className="font-mono font-black text-sm text-[var(--brief-ink)]">
                          {carrier.mathScore}
                        </span>
                        <span className="text-[11px] text-gray-400 font-mono">/100</span>
                      </div>
                      <span className="text-[11px] font-mono text-gray-500 block">
                        Price {carrier.breakdown.priceComponent} | Trust {carrier.breakdown.trustComponent} | Speed {carrier.breakdown.speedComponent} | Owner +{carrier.breakdown.logbookBonus}
                      </span>
                    </div>

                    {/* Right: Price & Dispatch Button */}
                    <div className="space-y-1 text-right shrink-0">
                      <span className="font-mono font-black text-base text-[var(--brief-ink)] block">
                        KES {carrier.bidPriceKes}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleSelectCarrier(carrier)}
                        className={`px-3 py-1.5 rounded-xl font-bold text-xs cursor-pointer transition-all shadow-xs ${
                          idx === 0
                            ? 'bg-[#0891B2] hover:bg-[#1D4ED8] text-white'
                            : 'bg-[color:var(--brief-ink)] hover:bg-[#1E293B] text-white'
                        }`}
                      >
                        Accept Bid
                      </button>
                    </div>
                  </div>

                </div>
              ))}
            </div>
          </div>

        </div>
      )}

      {/* ================= TAB 2: BRANDED FIXED RATES ================= */}
      {activeTab === 'branded_fixed' && (
        <div className="p-5 sm:p-6 space-y-4 text-xs">
          <div className="p-3.5 rounded-2xl bg-blue-50 border border-blue-200 text-blue-900 space-y-1">
            <h4 className="font-bold flex items-center space-x-1.5">
              <ShieldCheck className="w-4 h-4 text-blue-600" />
              <span>Direct Fixed-Rate Booking (Zero Price Surging)</span>
            </h4>
            <p className="text-[12px] leading-relaxed">
              If your organization requires known fixed tariffs and pre-negotiated corporate invoicing, you can book trusted logistics companies directly without entering the reverse-auction bidding pool.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {REGISTERED_CARRIERS.filter(c => c.isBrandedCorporation).map(c => (
              <div key={c.id} className="p-4 rounded-2xl bg-white border border-gray-200 space-y-2 shadow-xs">
                <div className="flex items-start justify-between">
                  <div>
                    <h5 className="font-black text-xs text-[var(--brief-ink)]">{c.carrierName}</h5>
                    <p className="text-[11px] text-gray-500">{c.vehicleType} • Fully Insured Goods-in-Transit</p>
                  </div>
                  <span className="font-mono font-black text-sm text-[var(--brief-ink)]">KES {c.fixedRateKes}</span>
                </div>

                <div className="pt-2 border-t border-gray-100 flex items-center justify-between">
                  <span className="text-[11px] font-mono text-emerald-700 font-bold">★ {c.trustScore}% Trust Score</span>
                  <button
                    type="button"
                    onClick={() => handleSelectCarrier(c)}
                    className="px-3 py-1 rounded-xl bg-[color:var(--brief-ink)] hover:bg-[#1E293B] text-white font-bold text-xs cursor-pointer"
                  >
                    Direct Book
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ================= TAB 3: MATHEMATICAL FORMULA WEIGHTS ================= */}
      {activeTab === 'math_formula' && (
        <div className="p-5 sm:p-6 space-y-5 text-xs">
          <div className="p-4 rounded-2xl bg-gray-900 text-white font-mono space-y-2 shadow-inner">
            <span className="text-[11px] text-[#00BFEF] font-bold uppercase tracking-wider block">
              Algorithmic Objective Function
            </span>
            <p className="text-xs text-gray-300 font-sans leading-relaxed">
              MatchScore = (w_price × (MinPrice / BidPrice)) + (w_trust × (TrustScore / 100)) + (w_speed × (TargetETA / BidETA)) + (w_logbook × OwnerBonus)
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between font-bold">
                <span>Price Competitiveness Weight</span>
                <span className="font-mono text-[#0891B2]">{priceWeight}%</span>
              </div>
              <input
                type="range"
                min="10"
                max="70"
                value={priceWeight}
                onChange={(e) => setPriceWeight(Number(e.target.value))}
                className="w-full cursor-pointer accent-[#0891B2]"
              />
              <p className="text-[11px] text-gray-500">Rewards carriers offering the lowest cost for the shipper.</p>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between font-bold">
                <span>Trust & Completion History Weight</span>
                <span className="font-mono text-[#0891B2]">{trustWeight}%</span>
              </div>
              <input
                type="range"
                min="10"
                max="70"
                value={trustWeight}
                onChange={(e) => setTrustWeight(Number(e.target.value))}
                className="w-full cursor-pointer accent-[#0891B2]"
              />
              <p className="text-[11px] text-gray-500">Rewards carriers with verified 5-star ratings and high successful drop count.</p>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between font-bold">
                <span>Transit Speed & Proximity Weight</span>
                <span className="font-mono text-[#0891B2]">{speedWeight}%</span>
              </div>
              <input
                type="range"
                min="5"
                max="40"
                value={speedWeight}
                onChange={(e) => setSpeedWeight(Number(e.target.value))}
                className="w-full cursor-pointer accent-[#0891B2]"
              />
              <p className="text-[11px] text-gray-500">Rewards drivers nearest to the pickup staging point.</p>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between font-bold">
                <span>Logbook Vehicle Ownership Bonus</span>
                <span className="font-mono text-[#0891B2]">{logbookWeight}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="30"
                value={logbookWeight}
                onChange={(e) => setLogbookWeight(Number(e.target.value))}
                className="w-full cursor-pointer accent-[#0891B2]"
              />
              <p className="text-[11px] text-gray-500">Direct algorithmic boost to independent owners who avoid daily fleet lease debt.</p>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
