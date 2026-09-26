import React, { useState } from 'react';
import {
  Truck,
  Car,
  Bike,
  MapPin,
  Clock,
  ShieldCheck,
  Package,
  ArrowRight,
  Sparkles,
  Phone,
  CheckCircle2,
  DollarSign,
  Search,
  Plus,
  X,
  FileText,
  Lock,
  ChevronRight,
  Send,
  Radio,
  Zap,
  Navigation,
  Check,
  Layers,
  Repeat
} from 'lucide-react';
import { soundEngine } from '../../utils/SoundEngine';

export type DeliveryTier = 'standard_peer' | 'sendy_express' | 'bolt_instant' | 'fargo_pickup' | 'lori_backhaul';

export interface InterCountyRoute {
  id: string;
  driverName: string;
  driverPhone: string;
  vehicleType: 'Car Trunk' | 'Van / Pickup' | 'Motorbike (Long Range)' | 'Light Truck';
  plateNumber: string;
  hasLogbookVerified: boolean;
  tier: DeliveryTier;
  partnerBrand?: 'Fargo Courier' | 'Sendy' | 'Bolt' | 'WAIRO' | 'Lori Systems';
  insuranceCoverKes?: number;
  slaGuarantee?: string;
  isBackhaul?: boolean;
  backhaulDiscountPct?: number;
  fromCounty: string;
  fromHub: string;
  toCounty: string;
  toHub: string;
  departureDate: string;
  departureTime: string;
  availableCapacityKg: number;
  pricePerKgKes: number;
  baseFeeKes: number;
  status: 'scheduled' | 'boarding' | 'in_transit' | 'completed';
  reputationRating: number;
  totalTrips: number;
}

export interface ParcelBooking {
  id: string;
  senderName: string;
  senderPhone: string;
  recipientName: string;
  recipientPhone: string;
  itemDescription: string;
  weightKg: number;
  routeId: string;
  tier: DeliveryTier;
  partnerBrand?: string;
  fromCounty: string;
  toCounty: string;
  feeKes: number;
  escrowStatus: 'held_in_escrow' | 'in_transit' | 'delivered_and_released';
  pinCode: string;
}

const INITIAL_ROUTES: InterCountyRoute[] = [
  {
    id: 'route-lori-msa-backhaul',
    driverName: 'Lori Systems 10-Ton Return Haulage',
    driverPhone: 'Lori Freight Control (+254 700 567 400)',
    vehicleType: 'Light Truck',
    plateNumber: 'KCU 849T (Lori Backhaul)',
    hasLogbookVerified: true,
    tier: 'lori_backhaul',
    partnerBrand: 'Lori Systems',
    isBackhaul: true,
    backhaulDiscountPct: 50,
    insuranceCoverKes: 500000,
    slaGuarantee: 'Backhaul Return Arbitrage (50% Off Heavy Freight)',
    fromCounty: 'Nairobi',
    fromHub: 'Lori Freight Terminal (Mombasa Rd Depot)',
    toCounty: 'Mombasa',
    toHub: 'Mombasa Port CFS / Coastal Schools Depot',
    departureDate: 'Tonight, 10:00 PM (Return Trip)',
    departureTime: '22:00',
    availableCapacityKg: 8500,
    pricePerKgKes: 12,
    baseFeeKes: 600,
    status: 'scheduled',
    reputationRating: 4.99,
    totalTrips: 920
  },
  {
    id: 'route-fargo-nationwide-0',
    driverName: 'Fargo Courier 200+ Drop-Point Network',
    driverPhone: 'Fargo Central Station (020 444 8000)',
    vehicleType: 'Van / Pickup',
    plateNumber: 'FARGO-47-COUNTY',
    hasLogbookVerified: true,
    tier: 'fargo_pickup',
    partnerBrand: 'Fargo Courier',
    insuranceCoverKes: 150000,
    slaGuarantee: 'Next-Morning Counter Pickup at 200+ Stations (KES 50 Arbitrage)',
    fromCounty: 'Nairobi',
    fromHub: 'Fargo Central Hub (Haile Selassie Ave)',
    toCounty: 'Mombasa',
    toHub: 'Fargo Digo Road Counter (200+ Points)',
    departureDate: 'Daily 6:00 PM Freight Consolidation',
    departureTime: '18:00',
    availableCapacityKg: 2500,
    pricePerKgKes: 10,
    baseFeeKes: 50,
    status: 'scheduled',
    reputationRating: 4.99,
    totalTrips: 1850
  },
  {
    id: 'route-sendy-msa-1',
    driverName: 'Sendy Freight Partner (3-Ton Van)',
    driverPhone: 'Sendy Dispatch (+254 709 *** 000)',
    vehicleType: 'Van / Pickup',
    plateNumber: 'KDB 910S (Sendy Fleet)',
    hasLogbookVerified: true,
    tier: 'sendy_express',
    partnerBrand: 'Sendy',
    insuranceCoverKes: 250000,
    slaGuarantee: 'Same-Day 4hr Express Delivery',
    fromCounty: 'Nairobi',
    fromHub: 'Sendy Central Hub (Mombasa Rd)',
    toCounty: 'Mombasa',
    toHub: 'Sendy Nyali Fulfillment Gate',
    departureDate: 'Today, 8:00 PM (Night Express)',
    departureTime: '20:00',
    availableCapacityKg: 850,
    pricePerKgKes: 35,
    baseFeeKes: 850,
    status: 'scheduled',
    reputationRating: 4.98,
    totalTrips: 340
  },
  {
    id: 'route-bolt-nkr-2',
    driverName: 'Bolt Business Express Courier',
    driverPhone: 'Bolt Rapid Dispatch (Live GPS)',
    vehicleType: 'Car Trunk',
    plateNumber: 'KDG 312B (Bolt Express)',
    hasLogbookVerified: true,
    tier: 'bolt_instant',
    partnerBrand: 'Bolt',
    insuranceCoverKes: 100000,
    slaGuarantee: 'Instant Dispatch (Within 25 mins)',
    fromCounty: 'Nairobi',
    fromHub: 'Nairobi Kencom Direct Pickup',
    toCounty: 'Nakuru',
    toHub: 'Nakuru CBD Direct Doorstep',
    departureDate: 'Immediate Dispatch (Live GPS)',
    departureTime: 'Immediate',
    availableCapacityKg: 75,
    pricePerKgKes: 40,
    baseFeeKes: 950,
    status: 'boarding',
    reputationRating: 4.97,
    totalTrips: 215
  },
  {
    id: 'route-msa-1',
    driverName: 'Captain James Mwaura',
    driverPhone: '0722 *** 891',
    vehicleType: 'Car Trunk',
    plateNumber: 'KDG 492A',
    hasLogbookVerified: true,
    tier: 'standard_peer',
    partnerBrand: 'WAIRO',
    fromCounty: 'Nairobi',
    fromHub: 'CBD Kencom / Railways Hub',
    toCounty: 'Mombasa',
    toHub: 'Nyali Cinemax Drop-point',
    departureDate: 'Today, 6:00 PM',
    departureTime: '18:00',
    availableCapacityKg: 35,
    pricePerKgKes: 25,
    baseFeeKes: 500,
    status: 'scheduled',
    reputationRating: 4.95,
    totalTrips: 84
  },
  {
    id: 'route-ksm-2',
    driverName: 'Otieno Collins (Kisumu Express)',
    driverPhone: '0711 *** 420',
    vehicleType: 'Van / Pickup',
    plateNumber: 'KCS 109W',
    hasLogbookVerified: true,
    tier: 'standard_peer',
    partnerBrand: 'WAIRO',
    fromCounty: 'Nairobi',
    fromHub: 'Westlands Sarit Hub',
    toCounty: 'Kisumu',
    toHub: 'Mega City Mall Hub',
    departureDate: 'Tomorrow, 5:30 AM',
    departureTime: '05:30',
    availableCapacityKg: 220,
    pricePerKgKes: 20,
    baseFeeKes: 650,
    status: 'scheduled',
    reputationRating: 4.91,
    totalTrips: 142
  },
  {
    id: 'route-eld-3',
    driverName: 'Kiprono David',
    driverPhone: '0703 *** 772',
    vehicleType: 'Car Trunk',
    plateNumber: 'KDH 881L',
    hasLogbookVerified: true,
    tier: 'standard_peer',
    partnerBrand: 'WAIRO',
    fromCounty: 'Nairobi',
    fromHub: 'Industrial Area Enterprise Rd',
    toCounty: 'Eldoret',
    toHub: 'Rupa Mills Complex Hub',
    departureDate: 'Tomorrow, 7:00 AM',
    departureTime: '07:00',
    availableCapacityKg: 50,
    pricePerKgKes: 22,
    baseFeeKes: 550,
    status: 'scheduled',
    reputationRating: 4.88,
    totalTrips: 63
  },
  {
    id: 'route-nkr-4',
    driverName: 'Wanjohi Evans',
    driverPhone: '0798 *** 314',
    vehicleType: 'Motorbike (Long Range)',
    plateNumber: 'KMDG 501M',
    hasLogbookVerified: false,
    tier: 'standard_peer',
    partnerBrand: 'WAIRO',
    fromCounty: 'Nairobi',
    fromHub: 'Kangemi / Uthiru Staging',
    toCounty: 'Nakuru',
    toHub: 'Nakuru CBD Posta',
    departureDate: 'Today, 2:00 PM',
    departureTime: '14:00',
    availableCapacityKg: 15,
    pricePerKgKes: 30,
    baseFeeKes: 400,
    status: 'boarding',
    reputationRating: 4.79,
    totalTrips: 29
  }
];

export function InterCountyDesk({
  onClose,
  onBookingComplete
}: {
  onClose?: () => void;
  onBookingComplete?: (booking: ParcelBooking) => void;
}) {
  const [activeTab, setActiveTab] = useState<'routes' | 'post_trip' | 'my_bookings' | 'logbook_info'>('routes');
  const [routes, setRoutes] = useState<InterCountyRoute[]>(INITIAL_ROUTES);
  const [selectedRoute, setSelectedRoute] = useState<InterCountyRoute | null>(null);

  // Filter state
  const [filterCounty, setFilterCounty] = useState<string>('All');
  const [selectedTierFilter, setSelectedTierFilter] = useState<'all' | 'lori_backhaul' | 'fargo_pickup' | 'sendy_express' | 'bolt_instant' | 'standard_peer'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Booking modal form state
  const [isBookingOpen, setIsBookingOpen] = useState(false);
  const [senderName, setSenderName] = useState('Dennis Kimani');
  const [senderPhone, setSenderPhone] = useState('0712345678');
  const [recipientName, setRecipientName] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [itemDescription, setItemDescription] = useState('');
  const [weightKg, setWeightKg] = useState<number>(5);

  // Post Trip form state
  const [driverNameInput, setDriverNameInput] = useState('');
  const [plateInput, setPlateInput] = useState('');
  const [vehicleTypeInput, setVehicleTypeInput] = useState<'Car Trunk' | 'Van / Pickup' | 'Motorbike (Long Range)' | 'Light Truck'>('Car Trunk');
  const [fromCountyInput, setFromCountyInput] = useState('Nairobi');
  const [fromHubInput, setFromHubInput] = useState('CBD Kencom');
  const [toCountyInput, setToCountyInput] = useState('Mombasa');
  const [toHubInput, setToHubInput] = useState('Nyali Centre');
  const [departureDateInput, setDepartureDateInput] = useState('Tomorrow, 6:00 AM');
  const [capacityKgInput, setCapacityKgInput] = useState<number>(40);
  const [hasLogbookInput, setHasLogbookInput] = useState(true);

  // Active bookings list
  const [bookings, setBookings] = useState<ParcelBooking[]>([
    {
      id: 'BKG-LORI-8821',
      senderName: 'Nairobi Publishers Guild',
      senderPhone: '0722119933',
      recipientName: 'Coast Secondary Schools Consortium (Mombasa)',
      recipientPhone: '0711994422',
      itemDescription: 'CBC Grade 7 & 8 Textbook Bulk Pallet (120 Packs - Lori Backhaul)',
      weightKg: 450,
      routeId: 'route-lori-msa-backhaul',
      tier: 'lori_backhaul',
      partnerBrand: 'Lori Systems 10-Ton Return',
      fromCounty: 'Nairobi',
      toCounty: 'Mombasa',
      feeKes: 6000,
      escrowStatus: 'in_transit',
      pinCode: '8914'
    },
    {
      id: 'BKG-FARGO-102',
      senderName: 'Madam Beatrice Mwangi',
      senderPhone: '0722849102',
      recipientName: 'Machakos PTA Secretary',
      recipientPhone: '0721998877',
      itemDescription: 'CBC Grade 7 Book Bundles (Fargo Drop Arbitrage)',
      weightKg: 12,
      routeId: 'route-fargo-nationwide-0',
      tier: 'fargo_pickup',
      partnerBrand: 'Fargo Courier 200+ Points',
      fromCounty: 'Nairobi',
      toCounty: 'Machakos',
      feeKes: 170,
      escrowStatus: 'held_in_escrow',
      pinCode: '6192'
    },
    {
      id: 'BKG-7712',
      senderName: 'Dennis Kimani',
      senderPhone: '0712345678',
      recipientName: 'Fatma Ali',
      recipientPhone: '0722119933',
      itemDescription: 'Electronics & Spare Parts (Box)',
      weightKg: 8,
      routeId: 'route-msa-1',
      tier: 'standard_peer',
      partnerBrand: 'WAIRO SACCO',
      fromCounty: 'Nairobi',
      toCounty: 'Mombasa',
      feeKes: 700,
      escrowStatus: 'held_in_escrow',
      pinCode: '7419'
    }
  ]);

  const [enteredPin, setEnteredPin] = useState('');
  const [pinSuccessMsg, setPinSuccessMsg] = useState('');

  // Filtered routes
  const filteredRoutes = routes.filter(r => {
    if (filterCounty !== 'All' && r.toCounty !== filterCounty && r.fromCounty !== filterCounty) {
      return false;
    }
    if (selectedTierFilter !== 'all' && r.tier !== selectedTierFilter) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        r.toCounty.toLowerCase().includes(q) ||
        r.fromCounty.toLowerCase().includes(q) ||
        r.driverName.toLowerCase().includes(q) ||
        r.plateNumber.toLowerCase().includes(q) ||
        (r.partnerBrand && r.partnerBrand.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const handleOpenBooking = (route: InterCountyRoute) => {
    soundEngine.play('heavyTap');
    setSelectedRoute(route);
    setIsBookingOpen(true);
  };

  const handleConfirmBooking = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRoute) return;
    soundEngine.play('victory');

    const totalFee = selectedRoute.baseFeeKes + (weightKg * selectedRoute.pricePerKgKes);
    const newPin = Math.floor(1000 + Math.random() * 9000).toString();

    const newBooking: ParcelBooking = {
      id: `BKG-${Math.floor(1000 + Math.random() * 9000)}`,
      senderName,
      senderPhone,
      recipientName: recipientName || 'Recipient',
      recipientPhone: recipientPhone || '0700000000',
      itemDescription: itemDescription || 'General Cargo',
      weightKg,
      routeId: selectedRoute.id,
      tier: selectedRoute.tier,
      partnerBrand: selectedRoute.partnerBrand || 'WAIRO',
      fromCounty: selectedRoute.fromCounty,
      toCounty: selectedRoute.toCounty,
      feeKes: totalFee,
      escrowStatus: 'held_in_escrow',
      pinCode: newPin
    };

    setBookings(prev => [newBooking, ...prev]);
    setIsBookingOpen(false);
    setActiveTab('my_bookings');
    onBookingComplete?.(newBooking);
  };

  const handlePostTrip = (e: React.FormEvent) => {
    e.preventDefault();
    soundEngine.play('victory');

    const newRoute: InterCountyRoute = {
      id: `route-${Date.now()}`,
      driverName: driverNameInput || 'Registered Driver',
      driverPhone: '0712 *** 000',
      vehicleType: vehicleTypeInput,
      plateNumber: plateInput || 'KDA 000X',
      hasLogbookVerified: hasLogbookInput,
      tier: 'standard_peer',
      partnerBrand: 'WAIRO',
      fromCounty: fromCountyInput,
      fromHub: fromHubInput,
      toCounty: toCountyInput,
      toHub: toHubInput,
      departureDate: departureDateInput,
      departureTime: '06:00',
      availableCapacityKg: capacityKgInput,
      pricePerKgKes: 25,
      baseFeeKes: 500,
      status: 'scheduled',
      reputationRating: 5.0,
      totalTrips: 1
    };

    setRoutes(prev => [newRoute, ...prev]);
    setActiveTab('routes');
  };

  const handleVerifyDeliveryPin = (bookingId: string) => {
    const booking = bookings.find(b => b.id === bookingId);
    if (!booking) return;

    if (enteredPin === booking.pinCode) {
      soundEngine.play('victory');
      setPinSuccessMsg(`PIN Verified! KES ${booking.feeKes * 0.9} released to driver M-Pesa immediately.`);
      setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, escrowStatus: 'delivered_and_released' } : b));
      setEnteredPin('');
    } else {
      soundEngine.play('defeat');
      setPinSuccessMsg('Invalid 4-Digit PIN. Please check recipient SMS.');
    }
  };

  return (
    <div className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-3xl overflow-hidden shadow-2xl text-[var(--brief-ink)] max-w-4xl mx-auto">
      
      {/* ================= HEADER ================= */}
      <div className="bg-gradient-to-br from-[#0F172A] via-[#1E293B] to-[#0A101D] text-white p-5 sm:p-6 relative">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-[11px] font-mono font-black px-2.5 py-0.5 rounded-full bg-[#00BFEF] text-[var(--brief-ink)] uppercase tracking-wider">
                INTER-COUNTY CROSS-DOCKING
              </span>
              <span className="text-xs text-emerald-200 font-bold flex items-center space-x-1">
                <Truck className="w-3.5 h-3.5 text-amber-400" />
                <span>Nairobi • Mombasa • Nakuru • Kisumu • Eldoret</span>
              </span>
            </div>

            <h2 className="text-xl sm:text-2xl font-black mt-2 text-white tracking-tight flex items-center space-x-2">
              <span>Long-Distance Traveler & Cargo Matching</span>
              <Sparkles className="w-5 h-5 text-[#40916C]" />
            </h2>
            <p className="text-xs text-emerald-200/80 mt-0.5 max-w-xl">
              WAIRO multi-tier freight ecosystem: Lori Systems 50% backhaul arbitrage, Fargo KES 50 pickup counters, Sendy Freight, and Bolt Rapid.
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

        {/* Tier Badges Banner */}
        <div className="mt-4 pt-3 border-t border-white/10 flex items-center space-x-2 overflow-x-auto text-[12px] font-bold">
          <span className="text-gray-400 text-[11px] uppercase tracking-wider">Integrated Tiers:</span>
          <span className="px-2.5 py-0.5 rounded-full bg-blue-500/25 text-cyan-300 border border-cyan-400/40 flex items-center space-x-1 shrink-0">
            <Repeat className="w-3 h-3 text-cyan-400" />
            <span>Lori Systems Backhaul (50% Off Return Trip)</span>
          </span>
          <span className="px-2.5 py-0.5 rounded-full bg-[#0B6E6E]/40 text-emerald-300 border border-emerald-400/40 flex items-center space-x-1 shrink-0">
            <MapPin className="w-3 h-3 text-emerald-300" />
            <span>Fargo 200+ Points (KES 50 Arbitrage)</span>
          </span>
          <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center space-x-1 shrink-0">
            <ShieldCheck className="w-3 h-3" />
            <span>Sendy Freight</span>
          </span>
          <span className="px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center space-x-1 shrink-0">
            <Zap className="w-3 h-3" />
            <span>Bolt Instant Rapid</span>
          </span>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center space-x-1.5 mt-4 overflow-x-auto">
          {[
            { id: 'routes', label: 'Available Routes', count: routes.length },
            { id: 'post_trip', label: 'Post Your Trip (Earn 90%)' },
            { id: 'my_bookings', label: 'My Cargo Bookings', count: bookings.length },
            { id: 'logbook_info', label: 'Logbook & Arbitrage Model' }
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
              {tab.count !== undefined && (
                <span className={`text-[11px] px-1.5 py-0.2 rounded-full font-mono ${
                  activeTab === tab.id ? 'bg-[#40916C] text-white' : 'bg-white/20 text-white'
                }`}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ================= TAB 1: AVAILABLE ROUTES ================= */}
      {activeTab === 'routes' && (
        <div className="p-5 sm:p-6 space-y-4">
          
          {/* Controls Bar: Tier Filter, County Filter & Search */}
          <div className="space-y-2.5">
            {/* Express & Arbitrage Tier Switcher */}
            <div className="flex items-center space-x-1.5 overflow-x-auto pb-1">
              {[
                { id: 'all', label: 'All Fleet Tiers' },
                { id: 'lori_backhaul', label: 'Lori Backhaul 50% Off 🚛 (Empty Return)' },
                { id: 'fargo_pickup', label: 'Fargo 200+ Points 📦 (KES 50)' },
                { id: 'sendy_express', label: 'Sendy Express ⚡ (Insured)' },
                { id: 'bolt_instant', label: 'Bolt Instant 🚀 (Rapid GPS)' },
                { id: 'standard_peer', label: 'Standard SACCO & Peer' }
              ].map(t => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => { soundEngine.play('tap'); setSelectedTierFilter(t.id as any); }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                    selectedTierFilter === t.id
                      ? 'bg-[#00BFEF] text-[var(--brief-ink)] font-black shadow-xs'
                      : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center justify-between">
              <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 sm:pb-0">
                {['All', 'Mombasa', 'Kisumu', 'Nakuru', 'Eldoret'].map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => { soundEngine.play('tap'); setFilterCounty(c); }}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                      filterCounty === c
                        ? 'bg-[color:var(--brief-ink)] text-white'
                        : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>

              <div className="relative">
                <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Search Lori, Fargo, Sendy, Bolt, plate..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 pr-3 py-1.5 bg-gray-50 border border-gray-200 rounded-xl text-xs outline-none focus:border-[#0891B2] w-full sm:w-56"
                />
              </div>
            </div>
          </div>

          {/* Routes Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {filteredRoutes.map((route) => {
              const isLori = route.tier === 'lori_backhaul';
              const isFargo = route.tier === 'fargo_pickup';
              const isSendy = route.tier === 'sendy_express';
              const isBolt = route.tier === 'bolt_instant';

              return (
                <div
                  key={route.id}
                  className={`border rounded-2xl p-4 transition-all shadow-xs space-y-3 relative group ${
                    isLori
                      ? 'bg-blue-50/60 border-blue-400 hover:border-blue-600 ring-1 ring-blue-400/40'
                      : isFargo
                      ? 'bg-emerald-50/60 border-emerald-400 hover:border-emerald-600 ring-1 ring-emerald-400/30'
                      : isSendy
                      ? 'bg-emerald-50/30 border-emerald-300 hover:border-emerald-500'
                      : isBolt
                      ? 'bg-amber-50/40 border-amber-300 hover:border-amber-500'
                      : 'bg-white border-[var(--brief-line)] hover:border-[#00BFEF]'
                  }`}
                >
                  {/* Header row: Driver info & Tier badge */}
                  <div className="flex items-start justify-between">
                    <div className="space-y-0.5">
                      <div className="flex items-center space-x-1.5">
                        <span className="font-bold text-xs text-[var(--brief-ink)]">{route.driverName}</span>
                        {isLori && (
                          <span className="bg-blue-600 text-white text-[11px] font-mono font-black px-1.5 py-0.5 rounded flex items-center space-x-1">
                            <Repeat className="w-2.5 h-2.5" />
                            <span>LORI BACKHAUL -50%</span>
                          </span>
                        )}
                        {isFargo && (
                          <span className="bg-[#0B6E6E] text-white text-[11px] font-mono font-black px-1.5 py-0.5 rounded">
                            FARGO 200+ POINTS
                          </span>
                        )}
                        {isSendy && (
                          <span className="bg-emerald-600 text-white text-[11px] font-mono font-black px-1.5 py-0.5 rounded">
                            SENDY EXPRESS
                          </span>
                        )}
                        {isBolt && (
                          <span className="bg-amber-500 text-white text-[11px] font-mono font-black px-1.5 py-0.5 rounded">
                            BOLT RAPID
                          </span>
                        )}
                        {route.hasLogbookVerified && (
                          <span className="inline-flex items-center space-x-0.5 bg-emerald-50 text-emerald-700 text-[11px] font-mono font-bold px-1.5 py-0.5 rounded border border-emerald-200" title="Verified Logbook">
                            <ShieldCheck className="w-2.5 h-2.5 text-emerald-600" />
                            <span>LOGBOOK VERIFIED</span>
                          </span>
                        )}
                      </div>
                      <div className="flex items-center space-x-2 text-[11px] text-gray-500 font-mono">
                        <span>{route.plateNumber}</span>
                        <span>•</span>
                        <span>{route.vehicleType}</span>
                        <span>•</span>
                        <span className="text-amber-600 font-bold">★ {route.reputationRating}</span>
                      </div>
                    </div>

                    <div className="text-right">
                      <span className="text-xs font-black font-mono text-[var(--brief-ink)] bg-white px-2 py-1 rounded-lg border border-gray-200 block">
                        KES {route.baseFeeKes}+
                      </span>
                      <span className="text-[11px] text-gray-500 font-mono">
                        KES {route.pricePerKgKes}/kg
                      </span>
                    </div>
                  </div>

                  {/* Route Path Indicator */}
                  <div className="p-2.5 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-between text-xs">
                    <div className="space-y-0.5">
                      <span className="text-[11px] font-mono text-gray-400 uppercase block">From</span>
                      <span className="font-bold text-[var(--brief-ink)]">{route.fromCounty}</span>
                      <span className="text-[11px] text-gray-500 block truncate max-w-[120px]">{route.fromHub}</span>
                    </div>

                    <ArrowRight className="w-4 h-4 text-[#00BFEF] shrink-0" />

                    <div className="space-y-0.5 text-right">
                      <span className="text-[11px] font-mono text-gray-400 uppercase block">To</span>
                      <span className="font-bold text-[var(--brief-ink)]">{route.toCounty}</span>
                      <span className="text-[11px] text-gray-500 block truncate max-w-[120px]">{route.toHub}</span>
                    </div>
                  </div>

                  {/* Route Meta: Departure & Capacity */}
                  <div className="flex items-center justify-between text-xs text-gray-600 pt-1 border-t border-gray-100 font-mono">
                    <div className="flex items-center space-x-1">
                      <Clock className="w-3.5 h-3.5 text-gray-400" />
                      <span className="text-[12px] font-bold text-gray-700">{route.departureDate}</span>
                    </div>

                    <div className="flex items-center space-x-1">
                      <Package className="w-3.5 h-3.5 text-emerald-600" />
                      <span className="text-[12px] font-black text-emerald-700">{route.availableCapacityKg} kg space</span>
                    </div>
                  </div>

                  {/* SLA guarantee or Insurance text */}
                  {route.slaGuarantee && (
                    <div className="p-1.5 rounded-lg bg-blue-50/70 text-blue-900 text-[11px] font-mono flex items-center justify-between">
                      <span className="font-bold">⚡ SLA: {route.slaGuarantee}</span>
                      {route.insuranceCoverKes && (
                        <span className="text-emerald-700 font-bold">Insured up to KES {route.insuranceCoverKes.toLocaleString()}</span>
                      )}
                    </div>
                  )}

                  {/* Booking Action Button */}
                  <button
                    type="button"
                    onClick={() => handleOpenBooking(route)}
                    className="w-full py-2.5 rounded-xl bg-[color:var(--brief-ink)] hover:bg-black text-white text-xs font-bold uppercase tracking-wider flex items-center justify-center space-x-1.5 cursor-pointer transition-transform active:scale-[0.99] shadow-xs"
                  >
                    <span>Book Freight Slot ({route.partnerBrand || 'WAIRO'})</span>
                    <ChevronRight className="w-3.5 h-3.5 text-[#00BFEF]" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ================= TAB 2: POST YOUR TRIP ================= */}
      {activeTab === 'post_trip' && (
        <div className="p-5 sm:p-6 space-y-5">
          <div className="p-4 rounded-2xl bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 flex items-start justify-between gap-3">
            <div className="space-y-1">
              <span className="text-[11px] font-mono font-bold text-[#40916C] uppercase tracking-wider">
                COMMISSION TRANSPARENCY
              </span>
              <h4 className="text-sm font-black text-[var(--brief-ink)]">
                Earn 90% Commission on Empty Trunk Space
              </h4>
              <p className="text-xs text-gray-600 leading-relaxed">
                Traveling to Mombasa, Kisumu, Nakuru, or Eldoret? Carry vetted boxes and parcels. Get paid directly to your M-Pesa upon recipient PIN verification.
              </p>
            </div>
            <div className="p-3 rounded-2xl bg-[#40916C] text-white font-mono font-black text-center shrink-0">
              <span className="text-lg block leading-none">90%</span>
              <span className="text-[11px] uppercase tracking-wider">PAYOUT</span>
            </div>
          </div>

          <form onSubmit={handlePostTrip} className="space-y-3 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="font-bold text-gray-700">Driver / Vehicle Owner Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Samuel Kimani"
                  value={driverNameInput}
                  onChange={(e) => setDriverNameInput(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs outline-none focus:border-[#0891B2]"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-gray-700">Vehicle Registration Plate</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. KDF 123A"
                  value={plateInput}
                  onChange={(e) => setPlateInput(e.target.value.toUpperCase())}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-mono uppercase outline-none focus:border-[#0891B2]"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="font-bold text-gray-700">Origin County & Staging Hub</label>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    required
                    placeholder="From County"
                    value={fromCountyInput}
                    onChange={(e) => setFromCountyInput(e.target.value)}
                    className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs outline-none focus:border-[#0891B2]"
                  />
                  <input
                    type="text"
                    placeholder="Staging Hub"
                    value={fromHubInput}
                    onChange={(e) => setFromHubInput(e.target.value)}
                    className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs outline-none focus:border-[#0891B2]"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-gray-700">Destination County & Drop Hub</label>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    required
                    placeholder="To County"
                    value={toCountyInput}
                    onChange={(e) => setToCountyInput(e.target.value)}
                    className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs outline-none focus:border-[#0891B2]"
                  />
                  <input
                    type="text"
                    placeholder="Drop Hub"
                    value={toHubInput}
                    onChange={(e) => setToHubInput(e.target.value)}
                    className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs outline-none focus:border-[#0891B2]"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="font-bold text-gray-700">Vehicle Type</label>
                <select
                  value={vehicleTypeInput}
                  onChange={(e) => setVehicleTypeInput(e.target.value as any)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs outline-none focus:border-[#0891B2]"
                >
                  <option value="Car Trunk">Private Car Boot (Trunk)</option>
                  <option value="Van / Pickup">Pickup Bed / Commercial Van</option>
                  <option value="Motorbike (Long Range)">Motorbike (Rear Rack)</option>
                  <option value="Light Truck">Light Truck / Canter</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-gray-700">Departure Time</label>
                <input
                  type="text"
                  placeholder="e.g. Tomorrow, 6:00 AM"
                  value={departureDateInput}
                  onChange={(e) => setDepartureDateInput(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs outline-none focus:border-[#0891B2]"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-gray-700">Available Space (kg)</label>
                <input
                  type="number"
                  min="5"
                  max="2000"
                  value={capacityKgInput}
                  onChange={(e) => setCapacityKgInput(Number(e.target.value))}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-mono outline-none focus:border-[#0891B2]"
                />
              </div>
            </div>

            <div className="p-3 bg-gray-50 border border-gray-200 rounded-2xl flex items-center justify-between">
              <div className="space-y-0.5">
                <span className="font-bold text-gray-800 text-xs block">I Own this Vehicle (Logbook Verified)</span>
                <span className="text-[11px] text-gray-500">Verified owners receive 5-star priority ranking & instant escrow release.</span>
              </div>
              <input
                type="checkbox"
                checked={hasLogbookInput}
                onChange={(e) => setHasLogbookInput(e.target.checked)}
                className="w-4 h-4 accent-emerald-600 cursor-pointer"
              />
            </div>

            <button
              type="submit"
              className="w-full py-3 rounded-2xl bg-[color:var(--brief-ink)] hover:bg-black text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center space-x-2 shadow-md cursor-pointer transition-all"
            >
              <Send className="w-4 h-4 text-[#00BFEF]" />
              <span>Publish Inter-County Route</span>
            </button>
          </form>
        </div>
      )}

      {/* ================= TAB 3: MY BOOKINGS ================= */}
      {activeTab === 'my_bookings' && (
        <div className="p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black uppercase tracking-wider text-[var(--brief-ink)]">
              Active Cross-County Parcel Escrows
            </h3>
            <span className="text-[11px] font-mono text-gray-500">4-Digit PIN Release Active</span>
          </div>

          {bookings.map((b) => (
            <div
              key={b.id}
              className="p-4 rounded-2xl bg-white border border-[var(--brief-line)] space-y-3 shadow-xs"
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="font-mono font-black text-xs text-[var(--brief-ink)]">{b.id}</span>
                    <span className="text-[11px] bg-blue-50 text-[#0891B2] font-bold px-2 py-0.5 rounded border border-blue-200">
                      {b.fromCounty} ➔ {b.toCounty}
                    </span>
                    {b.partnerBrand && (
                      <span className="text-[11px] font-mono font-bold bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded border border-emerald-200">
                        {b.partnerBrand}
                      </span>
                    )}
                  </div>
                  <p className="font-bold text-xs mt-1 text-[var(--brief-ink)]">{b.itemDescription}</p>
                  <p className="text-[11px] text-gray-500">Weight: {b.weightKg} kg • Fee: KES {b.feeKes}</p>
                </div>

                <div className="text-right">
                  <span className={`text-[11px] font-mono font-bold px-2 py-1 rounded-full uppercase ${
                    b.escrowStatus === 'delivered_and_released'
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-amber-100 text-amber-800'
                  }`}>
                    {b.escrowStatus === 'delivered_and_released' ? 'Delivered & Released' : 'Held in Escrow'}
                  </span>
                </div>
              </div>

              {/* 4-digit PIN verification card */}
              <div className="p-3 rounded-xl bg-gray-50 border border-gray-200 flex flex-col sm:flex-row items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <span className="text-[11px] font-mono text-gray-500 uppercase block font-bold">
                    Recipient Drop-off Release PIN:
                  </span>
                  <div className="flex items-center space-x-2">
                    <span className="text-base font-black font-mono tracking-widest text-[var(--brief-ink)] bg-white px-3 py-1 rounded-lg border border-gray-300">
                      {b.pinCode}
                    </span>
                    <span className="text-[11px] text-gray-500">Share with driver or Fargo/Lori agent upon parcel collection</span>
                  </div>
                </div>

                {b.escrowStatus !== 'delivered_and_released' && (
                  <div className="flex items-center space-x-1.5 w-full sm:w-auto">
                    <input
                      type="text"
                      maxLength={4}
                      placeholder="Enter PIN"
                      value={enteredPin}
                      onChange={(e) => setEnteredPin(e.target.value)}
                      className="w-24 bg-white border border-gray-300 rounded-xl px-2.5 py-1.5 font-mono text-xs text-center outline-none focus:border-[#0891B2]"
                    />
                    <button
                      type="button"
                      onClick={() => handleVerifyDeliveryPin(b.id)}
                      className="px-3 py-1.5 rounded-xl bg-[#059669] hover:bg-[#15803D] text-white font-bold text-xs cursor-pointer shadow-xs whitespace-nowrap"
                    >
                      Release Escrow
                    </button>
                  </div>
                )}
              </div>

              {pinSuccessMsg && (
                <div className="p-2 rounded-lg bg-emerald-50 text-emerald-800 text-[12px] font-bold">
                  {pinSuccessMsg}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ================= TAB 4: LOGBOOK & ARBITRAGE INFO ================= */}
      {activeTab === 'logbook_info' && (
        <div className="p-5 sm:p-6 space-y-4 text-xs">
          
          {/* Lori Backhaul Arbitrage Spotlight */}
          <div className="p-4 rounded-2xl bg-blue-50 border border-blue-300 text-blue-950 space-y-2">
            <h4 className="font-black text-sm flex items-center space-x-1.5 text-blue-900">
              <Repeat className="w-4 h-4 text-blue-700" />
              <span>Lori Systems Backhaul Capacity Arbitrage (50% Off Return Trips)</span>
            </h4>
            <p className="text-[12px] text-blue-900 leading-relaxed">
              Trucks delivering goods from Nairobi to Mombasa return empty <b>40–60% of the time</b>. Lori Systems' API tracks live available backhaul capacity across heavy freight corridors. Brief's WAIRO module offers bulk textbook palettes and agricultural freight heading to coastal schools and businesses at discounted return rates. You pay Lori the 50% backhaul rate, parents and traders save massively, and WAIRO retains the spread.
            </p>
          </div>

          {/* Fargo Pickup Point Arbitrage Spotlight */}
          <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-300 text-emerald-950 space-y-2">
            <h4 className="font-black text-sm flex items-center space-x-1.5 text-emerald-900">
              <MapPin className="w-4 h-4 text-emerald-700" />
              <span>Fargo Pickup-Point Arbitrage (KES 50 Nationwide Model)</span>
            </h4>
            <p className="text-[12px] text-emerald-900 leading-relaxed">
              Instead of expensive door-to-door delivery (KES 250 - 450), Brief & Wairo partner with Fargo Courier's 200+ nationwide stations. Fargo charges a consolidated wholesale rate of <b>KES 30 per parcel</b>. You pay only <b>KES 50</b>, the platform retains <b>KES 20 spread</b>, and parents save over KES 200 vs home delivery. A true win-win!
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-950 space-y-2">
            <h4 className="font-black text-sm flex items-center space-x-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>Why We Reward Vehicle Ownership in Kenya</span>
            </h4>
            <p className="text-[12px] text-emerald-900 leading-relaxed">
              In standard ride-hailing and gig delivery models, middleman vehicle leasing companies drain over 40% of courier earnings. Brief & Wairo prioritize independent drivers who own their motorbikes, cars, or vans.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono">
            <div className="p-3.5 rounded-xl bg-gray-50 border border-gray-200 space-y-1">
              <span className="font-bold text-[var(--brief-ink)] block">1. 90% Direct Payout</span>
              <p className="text-[11px] text-gray-600 font-sans">You keep KES 90 out of every KES 100 paid by shippers.</p>
            </div>

            <div className="p-3.5 rounded-xl bg-gray-50 border border-gray-200 space-y-1">
              <span className="font-bold text-[var(--brief-ink)] block">2. 200+ Fargo Hubs</span>
              <p className="text-[11px] text-gray-600 font-sans">Collect or drop at any verified Fargo counter nationwide.</p>
            </div>

            <div className="p-3.5 rounded-xl bg-gray-50 border border-gray-200 space-y-1">
              <span className="font-bold text-[var(--brief-ink)] block">3. 50% Lori Backhaul</span>
              <p className="text-[11px] text-gray-600 font-sans">Leverage empty returning 10-ton lorries on heavy corridors.</p>
            </div>
          </div>
        </div>
      )}

      {/* ================= BOOKING MODAL ================= */}
      {isBookingOpen && selectedRoute && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-5 space-y-4 shadow-2xl border border-gray-200 text-xs">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[11px] font-mono text-[#00BFEF] font-bold uppercase">Booking Parcel Transport</span>
                <h3 className="font-black text-base text-[var(--brief-ink)]">{selectedRoute.fromCounty} ➔ {selectedRoute.toCounty}</h3>
                <span className="text-[11px] font-mono text-gray-500">Tier: {selectedRoute.partnerBrand || 'WAIRO Standard'}</span>
              </div>
              <button
                type="button"
                onClick={() => setIsBookingOpen(false)}
                className="w-7 h-7 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleConfirmBooking} className="space-y-3">
              <div className="space-y-1">
                <label className="font-bold text-gray-700">Parcel Description</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 2 Cartons of avocado, Spare parts box"
                  value={itemDescription}
                  onChange={(e) => setItemDescription(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs outline-none focus:border-[#0891B2]"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="font-bold text-gray-700">Estimated Weight (kg)</label>
                  <input
                    type="number"
                    min="1"
                    max={selectedRoute.availableCapacityKg}
                    value={weightKg}
                    onChange={(e) => setWeightKg(Number(e.target.value))}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs outline-none focus:border-[#0891B2]"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-gray-700">Calculated Fee</label>
                  <div className="w-full bg-gray-100 border border-gray-200 rounded-xl px-3 py-2 text-xs font-mono font-bold text-[var(--brief-ink)]">
                    KES {selectedRoute.baseFeeKes + (weightKg * selectedRoute.pricePerKgKes)}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="font-bold text-gray-700">Recipient Name</label>
                  <input
                    type="text"
                    required
                    placeholder="Recipient Name"
                    value={recipientName}
                    onChange={(e) => setRecipientName(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs outline-none focus:border-[#0891B2]"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-gray-700">Recipient Phone</label>
                  <input
                    type="tel"
                    required
                    placeholder="07..."
                    value={recipientPhone}
                    onChange={(e) => setRecipientPhone(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs outline-none focus:border-[#0891B2]"
                  />
                </div>
              </div>

              {selectedRoute.tier === 'lori_backhaul' && (
                <div className="p-2.5 rounded-xl bg-blue-50 border border-blue-300 text-blue-950 text-[12px] space-y-1">
                  <div className="flex items-center space-x-1 font-bold text-blue-900">
                    <Repeat className="w-3.5 h-3.5 text-blue-700" />
                    <span>Lori Systems Backhaul Empty Return Capacity Active</span>
                  </div>
                  <p>50% discounted freight rate applied. Goods insured up to KES 500,000 across the Northern Corridor.</p>
                </div>
              )}

              {selectedRoute.tier === 'fargo_pickup' && (
                <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-950 text-[12px] space-y-1">
                  <div className="flex items-center space-x-1 font-bold text-emerald-900">
                    <MapPin className="w-3.5 h-3.5 text-emerald-700" />
                    <span>Fargo 200+ Counter Pickup Arbitrage (KES 50)</span>
                  </div>
                  <p>Recipient collects at the nearest Fargo branch counter. Safe, fast, and saves KES 200+ vs home delivery.</p>
                </div>
              )}

              {selectedRoute.tier === 'sendy_express' && (
                <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-[12px] space-y-1">
                  <div className="flex items-center space-x-1 font-bold">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Sendy Express Goods in Transit Insurance Active</span>
                  </div>
                  <p>Covers parcel loss or damage up to KES 250,000 under Sendy Kenya Commercial Logistics Policy.</p>
                </div>
              )}

              {selectedRoute.tier === 'bolt_instant' && (
                <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-[12px] space-y-1">
                  <div className="flex items-center space-x-1 font-bold">
                    <Navigation className="w-3.5 h-3.5 text-amber-600" />
                    <span>Bolt Rapid Live Telemetry & GPS Link</span>
                  </div>
                  <p>Recipient receives live SMS tracking link with driver coordinates and 25-minute pickup SLA.</p>
                </div>
              )}

              <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 text-[12px] space-y-1">
                <div className="flex items-center space-x-1 font-bold">
                  <Lock className="w-3.5 h-3.5 text-blue-600" />
                  <span>Escrow Hold via M-Pesa</span>
                </div>
                <p>Funds remain securely in escrow until recipient gives the driver, Lori agent, or Fargo counter the 4-digit PIN upon arrival.</p>
              </div>

              <button
                type="submit"
                className="w-full py-2.5 rounded-2xl bg-[#00BFEF] hover:bg-[#00a8d6] text-[var(--brief-ink)] font-black text-xs shadow-md cursor-pointer transition-all"
              >
                Confirm Booking & Deposit Escrow
              </button>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
