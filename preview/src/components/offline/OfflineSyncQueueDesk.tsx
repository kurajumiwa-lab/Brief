import React, { useState, useEffect } from 'react';
import {
  Database,
  Radio,
  RefreshCw,
  CheckCircle2,
  Clock,
  Send,
  Zap,
  Lock,
  ArrowRight,
  ShieldCheck,
  Plus,
  X,
  Copy,
  Layers,
  Sparkles,
  Award
} from 'lucide-react';
import { soundEngine } from '../../utils/SoundEngine';

export interface OfflineActionRecord {
  id: string;
  idempotencyKey: string;
  category: 'wairo_logistics' | 'duka_sales' | 'circle_ledger';
  title: string;
  details: string;
  amountKes?: number;
  timestamp: string;
  status: 'queued_locally' | 'syncing' | 'reconciled';
  serverReceiptId?: string;
}

const INITIAL_QUEUE: OfflineActionRecord[] = [
  {
    id: 'act-1',
    idempotencyKey: 'IDEMP-WRO-99104',
    category: 'wairo_logistics',
    title: 'Drop-off PIN Confirmation #WRO-9821',
    details: 'Recipient PIN 4821 entered at CBD Kencom staging. KES 225 M-Pesa release pending sync.',
    amountKes: 225,
    timestamp: '10:14 AM',
    status: 'queued_locally'
  },
  {
    id: 'act-2',
    idempotencyKey: 'IDEMP-DUKA-44120',
    category: 'duka_sales',
    title: 'Duka Cash Sale: 2x Unga & Cooking Oil',
    details: 'Customer paid KES 480 cash. Local inventory stock decremented by 2 units.',
    amountKes: 480,
    timestamp: '10:18 AM',
    status: 'queued_locally'
  },
  {
    id: 'act-3',
    idempotencyKey: 'IDEMP-CIRCLE-88194',
    category: 'circle_ledger',
    title: 'Merry-Go-Round Cash Table Contribution',
    details: 'Recorded KES 5,500 contribution for Cycle 5 (Grace Wanjiku pot).',
    amountKes: 5500,
    timestamp: '10:22 AM',
    status: 'reconciled',
    serverReceiptId: 'MPESA-QKM881942A'
  }
];

export function OfflineSyncQueueDesk({
  onClose,
  onActionSynced
}: {
  onClose?: () => void;
  onActionSynced?: (action: OfflineActionRecord) => void;
}) {
  const [activeTab, setActiveTab] = useState<'queue' | 'add_action' | 'storage_inspect' | 'sw_architecture'>('queue');
  const [networkMode, setNetworkMode] = useState<'online' | 'flaky_2g' | 'offline' | 'reconnecting'>('offline');
  const [queue, setQueue] = useState<OfflineActionRecord[]>(INITIAL_QUEUE);
  const [isDraining, setIsDraining] = useState<boolean>(false);
  const [syncStatusMsg, setSyncStatusMsg] = useState<string>('');

  // New offline action form state
  const [newCategory, setNewCategory] = useState<'wairo_logistics' | 'duka_sales' | 'circle_ledger'>('wairo_logistics');
  const [newTitle, setNewTitle] = useState<string>('Delivery Hand-off Confirmation');
  const [newDetails, setNewDetails] = useState<string>('Recorded offline recipient hand-off and signature.');
  const [newAmount, setNewAmount] = useState<number>(300);

  const pendingCount = queue.filter(q => q.status === 'queued_locally').length;
  const syncedCount = queue.filter(q => q.status === 'reconciled').length;

  const handleDrainQueue = () => {
    if (networkMode === 'offline') {
      soundEngine.play('defeat');
      setSyncStatusMsg('Cannot sync while in Offline / Airplane Mode. Switch network to Online or Flaky 2G first.');
      return;
    }

    soundEngine.play('tap');
    setIsDraining(true);
    setSyncStatusMsg('Replaying idempotent offline mutation log to Brief REST API…');

    setTimeout(() => {
      soundEngine.play('victory');
      setQueue(prev =>
        prev.map(item =>
          item.status === 'queued_locally'
            ? { ...item, status: 'reconciled', serverReceiptId: `TXN-${Math.floor(100000 + Math.random() * 900000)}` }
            : item
        )
      );
      setIsDraining(false);
      setSyncStatusMsg(`Sync complete! Reconciled ${pendingCount} offline records without duplicate charges.`);
    }, 1200);
  };

  const handleCreateOfflineAction = (e: React.FormEvent) => {
    e.preventDefault();
    soundEngine.play('tap');

    const newAction: OfflineActionRecord = {
      id: `act-${Date.now()}`,
      idempotencyKey: `IDEMP-${Date.now()}`,
      category: newCategory,
      title: newTitle,
      details: newDetails,
      amountKes: newAmount,
      timestamp: 'Just now',
      status: networkMode === 'online' ? 'reconciled' : 'queued_locally',
      serverReceiptId: networkMode === 'online' ? `TXN-${Math.floor(100000 + Math.random() * 900000)}` : undefined
    };

    setQueue(prev => [newAction, ...prev]);
    setActiveTab('queue');
  };

  return (
    <div className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-3xl overflow-hidden shadow-2xl text-[var(--brief-ink)] max-w-4xl mx-auto">
      
      {/* ================= HEADER ================= */}
      <div className="bg-gradient-to-br from-[#0F172A] via-[#1E293B] to-[#0A101D] text-white p-5 sm:p-6 relative">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-[11px] font-mono font-black px-2.5 py-0.5 rounded-full bg-[#10B981] text-[var(--brief-ink)] uppercase tracking-wider">
                PWA SERVICE WORKER • INDEXEDDB ENGINE
              </span>
              <span className="text-xs text-emerald-200 font-bold flex items-center space-x-1">
                <Database className="w-3.5 h-3.5 text-cyan-400" />
                <span>Zero-Data Offline Queue & Sync</span>
              </span>
            </div>

            <h2 className="text-xl sm:text-2xl font-black mt-2 text-white tracking-tight flex items-center space-x-2">
              <span>Offline Local Storage & Sync Queue</span>
              <Zap className="w-5 h-5 text-amber-400" />
            </h2>
            <p className="text-xs text-emerald-200/80 mt-0.5 max-w-xl">
              Never lose a delivery, Duka sale, or Circle payment during network blackouts. Actions record instantly to local storage and sync idempotently on reconnect.
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

        {/* Tab Switcher & Network State Indicator */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 mt-5 border-t border-white/10 pt-3">
          <div className="flex items-center space-x-1.5 overflow-x-auto">
            {[
              { id: 'queue', label: 'Sync Queue', count: pendingCount },
              { id: 'add_action', label: '+ Log Offline Action' },
              { id: 'storage_inspect', label: 'IndexedDB Tables' },
              { id: 'sw_architecture', label: 'Sync Architecture' }
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
                {tab.count !== undefined && tab.count > 0 && (
                  <span className="text-[11px] px-1.5 py-0.2 rounded-full font-mono bg-[#40916C] text-white">
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Network Simulator Pills */}
          <div className="flex items-center space-x-1 bg-black/40 p-1 rounded-xl border border-white/10 text-xs">
            <span className="text-[11px] text-gray-400 px-1 font-mono uppercase">Net:</span>
            {[
              { id: 'online', label: '4G Online', color: 'text-emerald-400' },
              { id: 'flaky_2g', label: '2G Flaky', color: 'text-amber-400' },
              { id: 'offline', label: 'Offline', color: 'text-red-400' }
            ].map(mode => (
              <button
                key={mode.id}
                type="button"
                onClick={() => { soundEngine.play('tap'); setNetworkMode(mode.id as any); }}
                className={`px-2 py-0.5 rounded-lg text-[11px] font-bold font-mono transition-all cursor-pointer ${
                  networkMode === mode.id
                    ? 'bg-white/20 text-white shadow-xs font-black'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                <span className={mode.color}>●</span> {mode.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ================= TAB 1: SYNC QUEUE ================= */}
      {activeTab === 'queue' && (
        <div className="p-5 sm:p-6 space-y-4">
          
          {/* Quick Metrics Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 space-y-1">
              <span className="text-[11px] font-mono text-amber-700 uppercase font-bold block">Pending Sync</span>
              <span className="text-xl font-black font-mono text-amber-900">{pendingCount} mutations</span>
              <span className="text-[11px] text-amber-700 block">Stored in browser IndexedDB</span>
            </div>

            <div className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 space-y-1">
              <span className="text-[11px] font-mono text-emerald-700 uppercase font-bold block">Reconciled Clean</span>
              <span className="text-xl font-black font-mono text-emerald-900">{syncedCount} reconciled</span>
              <span className="text-[11px] text-emerald-700 block">Server confirmed with receipts</span>
            </div>

            <div className="p-3.5 rounded-2xl bg-gray-50 border border-gray-200 space-y-1 flex flex-col justify-between">
              <div>
                <span className="text-[11px] font-mono text-gray-500 uppercase font-bold block">Current Network</span>
                <span className="text-xs font-black font-mono text-[var(--brief-ink)] block mt-1 uppercase">
                  {networkMode === 'online' ? '🟢 4G / Wi-Fi Active' : networkMode === 'flaky_2g' ? '🟡 2G Cellular Edge' : '🔴 Offline / No Signal'}
                </span>
              </div>
              <button
                type="button"
                onClick={handleDrainQueue}
                disabled={isDraining || pendingCount === 0}
                className="w-full py-1.5 rounded-xl bg-[#0891B2] hover:bg-[#1D4ED8] text-white font-bold text-xs flex items-center justify-center space-x-1 shadow-xs cursor-pointer disabled:opacity-50 transition-all"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isDraining ? 'animate-spin' : ''}`} />
                <span>{isDraining ? 'Draining Queue…' : 'Drain Sync Queue'}</span>
              </button>
            </div>
          </div>

          {syncStatusMsg && (
            <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 text-xs font-bold flex items-center justify-between animate-fadeIn">
              <div className="flex items-center space-x-2">
                <CheckCircle2 className="w-4 h-4 text-blue-600" />
                <span>{syncStatusMsg}</span>
              </div>
            </div>
          )}

          {/* Queue Items List */}
          <div className="space-y-2.5">
            <span className="text-[11px] font-mono uppercase text-gray-500 font-bold block">
              Mutations Log (Ordered by Local Timestamp)
            </span>

            <div className="space-y-2">
              {queue.map(item => (
                <div
                  key={item.id}
                  className="p-4 rounded-2xl bg-white border border-[var(--brief-line)] space-y-2 shadow-xs"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="font-mono text-xs font-black text-[var(--brief-ink)]">{item.title}</span>
                        <span className="text-[11px] font-mono px-1.5 py-0.2 rounded uppercase font-bold bg-gray-100 text-gray-700">
                          {item.category.replace('_', ' ')}
                        </span>
                      </div>
                      <p className="text-xs text-gray-600 mt-1">{item.details}</p>
                    </div>

                    <div className="text-right">
                      {item.amountKes !== undefined && (
                        <span className="font-mono font-black text-xs text-[var(--brief-ink)] block">
                          KES {item.amountKes}
                        </span>
                      )}
                      <span className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded-full uppercase mt-1 inline-block ${
                        item.status === 'reconciled'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}>
                        {item.status === 'reconciled' ? 'Reconciled ✓' : 'Queued Locally'}
                      </span>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-gray-100 flex items-center justify-between text-[11px] font-mono text-gray-400">
                    <span>Key: {item.idempotencyKey}</span>
                    <span>{item.serverReceiptId ? `Server Ref: ${item.serverReceiptId}` : item.timestamp}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      )}

      {/* ================= TAB 2: ADD OFFLINE ACTION ================= */}
      {activeTab === 'add_action' && (
        <form onSubmit={handleCreateOfflineAction} className="p-5 sm:p-6 space-y-4 max-w-lg mx-auto text-xs">
          <div className="p-3.5 rounded-2xl bg-gray-50 border border-gray-200 text-gray-700 space-y-1">
            <h4 className="font-bold text-[var(--brief-ink)] flex items-center space-x-1.5">
              <Plus className="w-4 h-4 text-[#40916C]" />
              <span>Simulate Local Mutation While Disconnected</span>
            </h4>
            <p className="text-[12px] leading-relaxed">
              When a boda rider drops a parcel or a duka logs a sale in the basement with zero reception, Brief stores the mutation with an immutable cryptographic idempotency key.
            </p>
          </div>

          <div className="space-y-1">
            <label className="font-bold text-gray-700">Action Domain / Category</label>
            <select
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value as any)}
              className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs outline-none focus:border-[#0891B2]"
            >
              <option value="wairo_logistics">Wairo Courier Drop-off & PIN</option>
              <option value="duka_sales">Duka POS Cash Sale</option>
              <option value="circle_ledger">Circle Table Banking Contribution</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="font-bold text-gray-700">Action Title</label>
            <input
              type="text"
              required
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs outline-none focus:border-[#0891B2]"
            />
          </div>

          <div className="space-y-1">
            <label className="font-bold text-gray-700">Details & Metadata</label>
            <textarea
              rows={2}
              required
              value={newDetails}
              onChange={(e) => setNewDetails(e.target.value)}
              className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs outline-none focus:border-[#0891B2]"
            />
          </div>

          <div className="space-y-1">
            <label className="font-bold text-gray-700">Amount (KES)</label>
            <input
              type="number"
              value={newAmount}
              onChange={(e) => setNewAmount(Number(e.target.value))}
              className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs outline-none focus:border-[#0891B2]"
            />
          </div>

          <button
            type="submit"
            className="w-full py-2.5 rounded-2xl bg-[color:var(--brief-ink)] hover:bg-[#1E293B] text-white font-black text-xs shadow-md cursor-pointer transition-all"
          >
            Record Mutation in Local IndexedDB
          </button>
        </form>
      )}

      {/* ================= TAB 3: INDEXEDDB TABLES INSPECT ================= */}
      {activeTab === 'storage_inspect' && (
        <div className="p-5 sm:p-6 space-y-4 text-xs font-mono">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-4 rounded-2xl bg-gray-50 border border-gray-200 space-y-1.5">
              <span className="font-black text-[var(--brief-ink)] text-xs">📦 wairo_offline_deliveries</span>
              <p className="text-[12px] text-gray-600 font-sans">Stores encrypted recipient verification PINs, driver GPS breadcrumbs, and pending escrow releases.</p>
              <span className="text-[11px] text-blue-600 font-bold block">1 Record (2.4 KB)</span>
            </div>

            <div className="p-4 rounded-2xl bg-gray-50 border border-gray-200 space-y-1.5">
              <span className="font-black text-[var(--brief-ink)] text-xs">🛒 duka_offline_sales</span>
              <p className="text-[12px] text-gray-600 font-sans">Stores cash transactions, barcodes, and inventory decrements before server ledger sync.</p>
              <span className="text-[11px] text-blue-600 font-bold block">1 Record (1.8 KB)</span>
            </div>

            <div className="p-4 rounded-2xl bg-gray-50 border border-gray-200 space-y-1.5">
              <span className="font-black text-[var(--brief-ink)] text-xs">🌸 circle_offline_ledger</span>
              <p className="text-[12px] text-gray-600 font-sans">Stores meeting attendance, cash Merry-Go-Round collections, and loan disbursement notes.</p>
              <span className="text-[11px] text-blue-600 font-bold block">1 Record (3.1 KB)</span>
            </div>


          </div>
        </div>
      )}

      {/* ================= TAB 4: SW ARCHITECTURE ================= */}
      {activeTab === 'sw_architecture' && (
        <div className="p-5 sm:p-6 space-y-4 text-xs">
          <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-950 space-y-2">
            <h4 className="font-bold flex items-center space-x-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>Idempotent Two-Phase Synchronization</span>
            </h4>
            <p className="text-[12px] text-emerald-900 leading-relaxed font-sans">
              Every offline write generates a unique 128-bit key. When internet connectivity resumes, the ServiceWorker BackgroundSync API replays the mutation. The Brief server checks if the key has already settled—preventing double M-Pesa debits even if the connection drops mid-request.
            </p>
          </div>
        </div>
      )}

    </div>
  );
}
