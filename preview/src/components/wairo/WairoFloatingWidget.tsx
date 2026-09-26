import React, { useState } from 'react';
import { 
  Bike, 
  X, 
  Smartphone, 
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  MapPin,
  Sparkles,
  Search,
  Clock,
  Plus
} from 'lucide-react';
import { WairoMiniApp } from './WairoMiniApp';
import { LiveTelemetryModal } from './LiveTelemetryModal';
import { LocationModal } from './LocationModal';
import { DispatchModal } from './DispatchModal';
import { EmbedSDKModal } from './EmbedSDKModal';
import { UssdSimulatorDesk } from '../offline/UssdSimulatorDesk';
import { InterCountyDesk } from './InterCountyDesk';
import { PrivateCarrierAuctionDesk } from './PrivateCarrierAuctionDesk';
import { OfflineSyncQueueDesk } from '../offline/OfflineSyncQueueDesk';
import { WairoBookmark } from './WairoBookmark';
import { MetalTag } from '../ui/MetalTag';
import { LOCATIONS, INITIAL_ACTIVE_DELIVERY, WairoLocation, WairoDelivery } from './wairoData';
import { playSound } from './wairoAudio';
import { soundEngine } from '../../utils/SoundEngine';

export interface WairoFloatingWidgetProps {
  initialLocation?: WairoLocation;
  triggerMode?: 'bookmark' | 'edge' | 'both';
}

export const WairoFloatingWidget: React.FC<WairoFloatingWidgetProps> = ({
  initialLocation = LOCATIONS[0],
  triggerMode = 'bookmark'
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isQuickSheetOpen, setIsQuickSheetOpen] = useState(false);
  const [isFullPhoneMode, setIsFullPhoneMode] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<WairoLocation>(initialLocation);
  const [activeDelivery, setActiveDelivery] = useState<WairoDelivery>(INITIAL_ACTIVE_DELIVERY);

  // Modals
  const [isTelemetryOpen, setIsTelemetryOpen] = useState(false);
  const [isLocationModalOpen, setIsLocationModalOpen] = useState(false);
  const [isDispatchModalOpen, setIsDispatchModalOpen] = useState(false);
  const [isSDKModalOpen, setIsSDKModalOpen] = useState(false);
  const [isUssdOpen, setIsUssdOpen] = useState(false);
  const [isInterCountyOpen, setIsInterCountyOpen] = useState(false);
  const [isCarrierAuctionOpen, setIsCarrierAuctionOpen] = useState(false);
  const [isOfflineSyncOpen, setIsOfflineSyncOpen] = useState(false);

  const handleSelectLocation = (loc: WairoLocation) => {
    setSelectedLocation(loc);
    setActiveDelivery(prev => ({
      ...prev,
      destination: loc.fullName,
      locationId: loc.id,
      etaMinutes: loc.etaMins,
    }));
  };

  const openMiniAppDrawer = () => {
    setIsQuickSheetOpen(false);
    playSound('open');
    setIsOpen(true);
  };

  return (
    <aside aria-label="Wairo Kenyan Marketplace Logistics Companion" data-wairo-widget="true">
      
      {/* ================= TOP-RIGHT FLOATING WAIRO BOOKMARK KNOB ================= */}
      {(triggerMode === 'bookmark' || triggerMode === 'both') && !isOpen && !isQuickSheetOpen && (
        <div style={{ position: 'fixed', top: 12, right: 16, zIndex: 30 }}>
          <WairoBookmark 
            status={activeDelivery.status.toUpperCase()}
            location={selectedLocation.name}
            onTap={() => {
              soundEngine.play('heavyTap');
              playSound('open');
              setIsInterCountyOpen(true);
            }}
          />
        </div>
      )}

      {/* ================= RIGHT-EDGE PILL (WHEN TRIGGER MODE IS 'EDGE' OR 'BOTH') ================= */}
      {(triggerMode === 'edge' || triggerMode === 'both') && !isOpen && !isQuickSheetOpen && (
        <div 
          style={{ 
            position: 'fixed', 
            right: 0, 
            top: '48%', 
            transform: 'translateY(-50%)', 
            zIndex: 42 
          }}
        >
          <button
            type="button"
            onClick={() => {
              playSound('open');
              setIsQuickSheetOpen(true);
            }}
            title="Open Wairo Courier & Errands Companion"
            style={{
              boxShadow: '0px 8px 24px rgba(0, 0, 0, 0.06), 0px 2px 6px rgba(0, 0, 0, 0.04)'
            }}
            className="group flex items-center bg-white/95 hover:bg-white text-[var(--brief-ink)] pl-3.5 pr-2.5 py-3 rounded-l-2xl border-l border-y border-r-0 border-[var(--brief-line)] backdrop-blur-md transition-all duration-300 ease-out hover:scale-[1.02] active:scale-[0.98] hover:border-[#40916C]/40 cursor-pointer"
          >
            <div className="w-8 h-8 rounded-xl bg-[var(--color-well)] group-hover:bg-[#FFF3EC] flex items-center justify-center mr-2.5 shrink-0 transition-colors">
              <Bike className="w-4 h-4 text-[#40916C]" />
            </div>

            <div className="flex flex-col items-start text-left pr-1">
              <div className="flex items-center space-x-1.5 mb-0.5">
                <span className="text-[12px] font-black uppercase tracking-wider text-[var(--brief-ink)]">
                  WAIRO
                </span>
                <span className="text-[11px] font-mono font-bold px-1.5 py-0.2 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/70">
                  90/10 Payout
                </span>
              </div>
              
              <span className="text-xs font-extrabold text-[var(--ink-85)] leading-snug">
                Courier & Errands
              </span>
              
              <div className="flex items-center space-x-1.5 mt-1 text-[11px] font-mono text-[var(--ink-55)]">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                <span className="truncate max-w-[130px]">
                  Courier & Errands Only • {selectedLocation.name}
                </span>
              </div>
            </div>

            <div className="ml-1.5 text-[var(--ink-40)] group-hover:text-[#40916C] group-hover:-translate-x-0.5 transition-all">
              <ChevronLeft className="w-4 h-4" />
            </div>
          </button>
        </div>
      )}

      {/* ================= WAIRO QUICK BOTTOM SHEET ================= */}
      {isQuickSheetOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex flex-col justify-end p-3 animate-fadeIn"
          onClick={() => setIsQuickSheetOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg mx-auto rounded-[28px] p-6 text-white shadow-2xl animate-slideUp"
            style={{
              background: 'linear-gradient(135deg, #B8621F 0%, #8B4513 100%)',
              boxShadow: '0 20px 48px rgba(0, 0, 0, 0.4)'
            }}
          >
            {/* Top Badge & Close */}
            <div className="flex items-center justify-between">
              <div className="px-3 py-1 rounded-lg bg-white/20 text-white text-[11px] font-black tracking-wider uppercase">
                WAIRO · 90/10 PAYOUT
              </div>

              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={openMiniAppDrawer}
                  title="Open Full MiniApp Companion"
                  className="px-2.5 py-1 rounded-full bg-white/20 hover:bg-white/30 text-white text-[12px] font-bold flex items-center space-x-1 cursor-pointer transition-colors"
                >
                  <Smartphone className="w-3.5 h-3.5" />
                  <span>MiniApp</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsQuickSheetOpen(false)}
                  className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Title & Status */}
            <div className="mt-4 space-y-1">
              <h2 className="text-2xl sm:text-3xl font-black text-white">
                Courier & Errands
              </h2>
              <div className="flex items-center space-x-2 text-xs text-white/80">
                <span className="w-2 h-2 rounded-full bg-[#2ECC71] animate-pulse" />
                <span>Active: {activeDelivery.trackingId} • {activeDelivery.status.toUpperCase()}</span>
                <span>•</span>
                <span>{selectedLocation.name} (ETA: {activeDelivery.etaMinutes}m)</span>
              </div>
            </div>

            {/* Action Tags */}
            <div className="mt-6 grid grid-cols-3 gap-2">
              <MetalTag
                label="Track Live"
                icon={<Search className="w-3.5 h-3.5" />}
                material="copper"
                selected={true}
                onTap={() => {
                  setIsQuickSheetOpen(false);
                  setIsTelemetryOpen(true);
                }}
              />
              <MetalTag
                label="Dispatch"
                icon={<Plus className="w-3.5 h-3.5" />}
                material="copper"
                onTap={() => {
                  setIsQuickSheetOpen(false);
                  setIsDispatchModalOpen(true);
                }}
              />
              <MetalTag
                label="Location"
                icon={<MapPin className="w-3.5 h-3.5" />}
                material="copper"
                onTap={() => {
                  setIsQuickSheetOpen(false);
                  setIsLocationModalOpen(true);
                }}
              />
            </div>

            {/* Secondary Services Strip */}
            <div className="mt-3 pt-3 border-t border-white/15 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsQuickSheetOpen(false);
                  setIsInterCountyOpen(true);
                }}
                className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold text-left flex items-center justify-between cursor-pointer transition-colors"
              >
                <span>Inter-County Cargo</span>
                <span className="text-[11px] text-white/70">90% Payout →</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsQuickSheetOpen(false);
                  setIsCarrierAuctionOpen(true);
                }}
                className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold text-left flex items-center justify-between cursor-pointer transition-colors"
              >
                <span>Carrier Auction</span>
                <span className="text-[11px] text-white/70">Math Engine →</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= EXPANDED SLIDE-OUT DRAWER ================= */}
      {isOpen && !isFullPhoneMode && (
        <div 
          style={{ 
            position: 'fixed', 
            right: '12px', 
            top: '60px', 
            bottom: '72px', 
            zIndex: 45,
            boxShadow: '0px 20px 48px rgba(0, 0, 0, 0.12), 0px 4px 12px rgba(0, 0, 0, 0.06)'
          }} 
          className="w-[94vw] sm:w-[410px] rounded-3xl flex flex-col overflow-hidden border border-[var(--brief-line)] bg-white animate-in slide-in-from-right-4 duration-300"
        >
          <div className="relative w-full h-full flex flex-col">
            
            {/* Top drawer header controls */}
            <div className="absolute top-3 right-3 z-50 flex items-center space-x-1.5 bg-white/90 backdrop-blur-md border border-[var(--brief-line)] p-1 rounded-full shadow-sm">
              <button
                type="button"
                onClick={() => setIsFullPhoneMode(true)}
                title="Expand to Full Smartphone View"
                className="text-gray-500 hover:text-[var(--brief-ink)] p-1 rounded-full hover:bg-gray-100 transition-colors cursor-pointer"
              >
                <Smartphone className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  playSound('click');
                  setIsOpen(false);
                }}
                title="Close Wairo Companion"
                className="text-gray-500 hover:text-[var(--brief-ink)] p-1 rounded-full hover:bg-gray-100 transition-colors cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <WairoMiniApp 
              onOpenTelemetry={() => setIsTelemetryOpen(true)}
              onOpenLocationModal={() => setIsLocationModalOpen(true)}
              onOpenDispatchModal={() => setIsDispatchModalOpen(true)}
              onOpenSDKModal={() => setIsSDKModalOpen(true)}
              onOpenUssdSim={() => setIsUssdOpen(true)}
              onOpenInterCounty={() => setIsInterCountyOpen(true)}
              onOpenCarrierAuction={() => setIsCarrierAuctionOpen(true)}
              onOpenOfflineSync={() => setIsOfflineSyncOpen(true)}
              selectedLocation={selectedLocation}
              activeDelivery={activeDelivery}
              isMiniView={true}
              onCloseMiniView={() => setIsOpen(false)}
            />
          </div>
        </div>
      )}

      {/* ================= FULL MODAL SMARTPHONE VIEW ================= */}
      {isOpen && isFullPhoneMode && (
        <div 
          style={{ position: 'fixed', inset: 0, zIndex: 50 }} 
          className="bg-black/80 backdrop-blur-md flex items-center justify-center p-4"
        >
          <div className="relative w-[380px] sm:w-[412px] h-[780px] sm:h-[840px] bg-[var(--brief-ink)] rounded-[48px] p-3 shadow-2xl border-4 border-gray-800 ring-8 ring-black/40 flex flex-col">
            
            {/* Top Close / Dock back */}
            <button
              type="button"
              onClick={() => setIsFullPhoneMode(false)}
              className="absolute -top-10 right-0 px-3.5 py-1 bg-white/10 hover:bg-white/20 text-white rounded-full text-xs font-semibold flex items-center space-x-1 cursor-pointer transition-colors"
            >
              <span>Dock to Right Edge Tab</span>
              <X className="w-3.5 h-3.5" />
            </button>

            <div className="relative w-full h-full rounded-[40px] overflow-hidden bg-[#F3F5F4]">
              <WairoMiniApp 
                onOpenTelemetry={() => setIsTelemetryOpen(true)}
                onOpenLocationModal={() => setIsLocationModalOpen(true)}
                onOpenDispatchModal={() => setIsDispatchModalOpen(true)}
                onOpenSDKModal={() => setIsSDKModalOpen(true)}
                onOpenUssdSim={() => setIsUssdOpen(true)}
                onOpenInterCounty={() => setIsInterCountyOpen(true)}
                onOpenCarrierAuction={() => setIsCarrierAuctionOpen(true)}
                onOpenOfflineSync={() => setIsOfflineSyncOpen(true)}
                selectedLocation={selectedLocation}
                activeDelivery={activeDelivery}
              />
            </div>
          </div>
        </div>
      )}

      {/* ================= INTEGRATED MODALS ================= */}
      <LiveTelemetryModal 
        isOpen={isTelemetryOpen} 
        onClose={() => setIsTelemetryOpen(false)}
        activeDelivery={activeDelivery}
        selectedLocation={selectedLocation}
      />

      <LocationModal 
        isOpen={isLocationModalOpen}
        onClose={() => setIsLocationModalOpen(false)}
        selectedLocation={selectedLocation}
        onSelectLocation={handleSelectLocation}
      />

      <DispatchModal 
        isOpen={isDispatchModalOpen}
        onClose={() => setIsDispatchModalOpen(false)}
        onDispatchSuccess={(newOrder) => {
          setActiveDelivery(newOrder);
          const found = LOCATIONS.find(l => l.id === newOrder.locationId);
          if (found) setSelectedLocation(found);
        }}
        currentLocation={selectedLocation}
      />

      <EmbedSDKModal 
        isOpen={isSDKModalOpen}
        onClose={() => setIsSDKModalOpen(false)}
      />

      {/* ================= USSD / SMS SIMULATOR MODAL ================= */}
      {isUssdOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 60 }} className="bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="w-full max-w-3xl my-auto">
            <UssdSimulatorDesk onClose={() => setIsUssdOpen(false)} />
          </div>
        </div>
      )}

      {/* ================= INTER-COUNTY CARGO MODAL ================= */}
      {isInterCountyOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 60 }} className="bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="w-full max-w-3xl my-auto">
            <InterCountyDesk onClose={() => setIsInterCountyOpen(false)} />
          </div>
        </div>
      )}

      {/* ================= CARRIER REVERSE AUCTION MODAL ================= */}
      {isCarrierAuctionOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 60 }} className="bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="w-full max-w-3xl my-auto">
            <PrivateCarrierAuctionDesk onClose={() => setIsCarrierAuctionOpen(false)} />
          </div>
        </div>
      )}

      {/* ================= OFFLINE SYNC QUEUE MODAL ================= */}
      {isOfflineSyncOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 60 }} className="bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="w-full max-w-3xl my-auto">
            <OfflineSyncQueueDesk onClose={() => setIsOfflineSyncOpen(false)} />
          </div>
        </div>
      )}
    </aside>
  );
};

export { WairoBookmark } from './WairoBookmark';

