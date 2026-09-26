import React, { useState } from 'react';
import {
  Smartphone,
  Radio,
  Send,
  CheckCircle2,
  MessageSquare,
  ShieldCheck,
  Zap,
  RefreshCw,
  X,
  Copy,
  Bike,
  Phone,
  ArrowRight,
  Clock,
  Sparkles,
  Info
} from 'lucide-react';
import { soundEngine } from '../../utils/SoundEngine';

export interface SmsMessage {
  id: string;
  sender: 'user' | 'system';
  text: string;
  time: string;
  status?: 'sent' | 'delivered';
}

export function UssdSimulatorDesk({
  onClose,
  onAction
}: {
  onClose?: () => void;
  onAction?: (actionName: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<'ussd' | 'sms' | 'architecture'>('ussd');

  // ================= USSD STATE MACHINE =================
  const [ussdInput, setUssdInput] = useState('*483*88#');
  const [ussdSessionActive, setUssdSessionActive] = useState(false);
  const [ussdScreenText, setUssdScreenText] = useState('');
  const [ussdMenuState, setUssdMenuState] = useState<'root' | 'active_orders' | 'nearby_gigs' | 'enter_pin' | 'balance' | 'circle' | 'ended'>('root');
  const [ussdPromptInput, setUssdPromptInput] = useState('');
  const [ussdHistory, setUssdHistory] = useState<string[]>([]);

  // ================= SMS STATE =================
  const [smsMessages, setSmsMessages] = useState<SmsMessage[]>([
    {
      id: 'sms-1',
      sender: 'system',
      text: 'WAIRO DISPATCH: New Boda Gig #WRO-9821. Pickup: Westlands Sarit, Drop: CBD Kencom. Fee: KES 250 (You get KES 225). Reply "WAIRO ACC 9821" to accept.',
      time: '10:14 AM'
    },
    {
      id: 'sms-2',
      sender: 'user',
      text: 'WAIRO ACC 9821',
      time: '10:15 AM'
    },
    {
      id: 'sms-3',
      sender: 'system',
      text: 'CONFIRMED: Gig #WRO-9821 assigned to you. Client: Jane (0722334455). Ask client for 4-digit PIN at drop-off. Reply "WAIRO PIN 9821 <PIN>" to complete.',
      time: '10:15 AM'
    }
  ]);
  const [smsDraft, setSmsDraft] = useState('');

  // --- USSD CONTROLLER ---
  const handleDialUssd = () => {
    if (ussdInput !== '*483*88#' && !ussdInput.startsWith('*483')) {
      setUssdScreenText('Invalid MMI Code. Please dial *483*88# for Brief & Wairo.');
      setUssdSessionActive(true);
      setUssdMenuState('ended');
      return;
    }
    soundEngine.play('heavyTap');
    setUssdSessionActive(true);
    setUssdMenuState('root');
    setUssdScreenText(
      `CON Welcome to Brief & Wairo Logistics:\n` +
      `1. Active Courier Dispatches (1)\n` +
      `2. Find Nearby Gigs (Boda/Van)\n` +
      `3. Confirm Delivery (4-Digit PIN)\n` +
      `4. Check M-Pesa Payout Balance\n` +
      `5. Circle & Life Events\n` +
      `0. Exit`
    );
    setUssdPromptInput('');
  };

  const handleSendUssdResponse = (choice: string) => {
    const val = choice.trim();
    soundEngine.play('tap');
    setUssdPromptInput('');

    if (ussdMenuState === 'root') {
      if (val === '1') {
        setUssdMenuState('active_orders');
        setUssdScreenText(
          `CON Active Dispatch #WRO-9821:\n` +
          `From: Westlands (Sarit)\n` +
          `To: CBD (Kencom)\n` +
          `Fee: KES 250 (90% Payout: KES 225)\n` +
          `Client: Jane (0722334455)\n\n` +
          `1. Enter Recipient PIN\n` +
          `0. Back to Main Menu`
        );
      } else if (val === '2') {
        setUssdMenuState('nearby_gigs');
        setUssdScreenText(
          `CON Gigs Available Nearby:\n` +
          `1. Boda: Kileleshwa to Kilimani (KES 180)\n` +
          `2. Van: Ind. Area to Eastleigh (KES 1,200)\n` +
          `3. Errand: Highridge to Parklands (KES 200)\n\n` +
          `Reply with 1, 2, or 3 to Accept:\n` +
          `0. Back`
        );
      } else if (val === '3') {
        setUssdMenuState('enter_pin');
        setUssdScreenText(
          `CON Enter 4-Digit Recipient Confirmation PIN for Order #WRO-9821:`
        );
      } else if (val === '4') {
        setUssdMenuState('ended');
        setUssdScreenText(
          `END Your Wairo Ledger:\n` +
          `Available Balance: KES 3,450\n` +
          `Completed Deliveries: 14\n` +
          `Registered M-Pesa: 0712***111\n\n` +
          `Automatic M-Pesa disbursement sent at 6:00 PM daily.`
        );
      } else if (val === '5') {
        setUssdMenuState('circle');
        setUssdScreenText(
          `CON Kilimani Traders Circle (Cycle 5):\n` +
          `Pot: KES 50,000 / KES 60,000 (83%)\n` +
          `Beneficiary: Grace Wanjiku\n\n` +
          `1. Pay KES 5,500 via M-Pesa\n` +
          `2. Check Table Banking Balance\n` +
          `0. Back`
        );
      } else if (val === '0') {
        setUssdMenuState('ended');
        setUssdScreenText('END Thank you for using Brief & Wairo Kenya. Safe riding!');
      } else {
        setUssdScreenText(`CON Invalid option.\n1. Active Dispatches\n2. Nearby Gigs\n3. Confirm PIN\n4. Balance\n0. Exit`);
      }
    } else if (ussdMenuState === 'active_orders') {
      if (val === '1') {
        setUssdMenuState('enter_pin');
        setUssdScreenText(`CON Enter 4-Digit Recipient Confirmation PIN for Order #WRO-9821:`);
      } else {
        handleDialUssd();
      }
    } else if (ussdMenuState === 'nearby_gigs') {
      if (val === '1' || val === '2' || val === '3') {
        soundEngine.play('victory');
        setUssdMenuState('ended');
        setUssdScreenText(
          `END SUCCESS! Gig accepted.\n` +
          `Client details sent via SMS to your phone.\n` +
          `Pickup ETA: 15 mins. Ride safe!`
        );
      } else {
        handleDialUssd();
      }
    } else if (ussdMenuState === 'enter_pin') {
      if (val.length === 4) {
        soundEngine.play('victory');
        setUssdMenuState('ended');
        setUssdScreenText(
          `END DELIVERY CONFIRMED! ✅\n` +
          `Order #WRO-9821 complete.\n` +
          `KES 225.00 has been credited to your M-Pesa account.\n` +
          `Ref: QKM849102A.`
        );
      } else {
        setUssdScreenText(`CON Invalid PIN. Must be 4 digits. Please re-enter recipient PIN:`);
      }
    } else if (ussdMenuState === 'circle') {
      if (val === '1') {
        soundEngine.play('victory');
        setUssdMenuState('ended');
        setUssdScreenText(
          `END M-Pesa STK Push initiated for KES 5,500 to Kilimani Circle.\n` +
          `Enter your M-Pesa PIN on the prompt to complete.`
        );
      } else if (val === '2') {
        setUssdMenuState('ended');
        setUssdScreenText(
          `END Table Banking Welfare Reserve: KES 148,000.\n` +
          `Active Loans: 2. Next meeting: 14 June.`
        );
      } else {
        handleDialUssd();
      }
    }
  };

  const handleKeypadPress = (key: string) => {
    soundEngine.play('tap');
    if (!ussdSessionActive) {
      setUssdInput(prev => prev + key);
    } else {
      setUssdPromptInput(prev => prev + key);
    }
  };

  const handleKeypadClear = () => {
    soundEngine.play('tap');
    if (!ussdSessionActive) {
      setUssdInput('');
    } else {
      setUssdPromptInput('');
    }
  };

  const handleKeypadCancel = () => {
    soundEngine.play('tap');
    setUssdSessionActive(false);
    setUssdScreenText('');
    setUssdMenuState('root');
  };

  // --- SMS CONTROLLER ---
  const handleSendSms = (e: React.FormEvent) => {
    e.preventDefault();
    if (!smsDraft.trim()) return;

    soundEngine.play('tap');
    const userText = smsDraft.trim();
    const newMsg: SmsMessage = {
      id: `sms-${Date.now()}`,
      sender: 'user',
      text: userText,
      time: 'Just now'
    };

    setSmsMessages(prev => [...prev, newMsg]);
    setSmsDraft('');

    // Automated Africa's Talking / Twilio SMS Bot Response Logic
    setTimeout(() => {
      soundEngine.play('victory');
      const upper = userText.toUpperCase();
      let replyText = '';

      if (upper.startsWith('WAIRO ACC')) {
        const orderId = upper.replace('WAIRO ACC', '').trim() || '9821';
        replyText = `CONFIRMED: You accepted Order #${orderId}. Pickup: Westlands Sarit Centre. Client: Jane (0722334455). Reply "WAIRO PIN ${orderId} <PIN>" when delivered.`;
      } else if (upper.startsWith('WAIRO PIN')) {
        replyText = `SUCCESS: Order marked delivered! 90% payout of KES 225.00 has been sent to your M-Pesa. Ref: QKM990123A. Thank you for riding with Wairo!`;
      } else if (upper.includes('BAL') || upper.includes('WALLET')) {
        replyText = `WAIRO WALLET: Your settled balance is KES 3,450.00. Automatic daily M-Pesa disbursement active.`;
      } else if (upper.includes('CIRCLE')) {
        replyText = `KILIMANI CIRCLE (Cycle 5): KES 50,000 / KES 60,000 collected (83%). Recipient: Grace Wanjiku. Your status: PAID. Next meeting: 14 June.`;
      } else {
        replyText = `BRIEF SMS GATEWAY (22880):\nAvailable keywords:\n- WAIRO ACC <ID> (Accept Gig)\n- WAIRO PIN <ID> <PIN> (Complete Job)\n- WAIRO BAL (Wallet)\n- CIRCLE BAL (Cycle Status)\n- HELP`;
      }

      const botReply: SmsMessage = {
        id: `sms-${Date.now() + 1}`,
        sender: 'system',
        text: replyText,
        time: 'Just now'
      };
      setSmsMessages(prev => [...prev, botReply]);
    }, 600);
  };

  return (
    <div className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-3xl overflow-hidden shadow-2xl text-[var(--brief-ink)] max-w-3xl mx-auto">
      
      {/* ================= HEADER ================= */}
      <div className="bg-gradient-to-br from-[#0F172A] via-[#1E293B] to-[var(--brief-ink)] text-white p-5 sm:p-6 relative">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-[11px] font-mono font-black px-2.5 py-0.5 rounded-full bg-[#40916C] text-white uppercase tracking-wider">
                OFFLINE GSM PROTOCOL
              </span>
              <span className="text-xs text-emerald-200 font-bold flex items-center space-x-1">
                <Radio className="w-3.5 h-3.5 text-[#00BFEF] animate-pulse" />
                <span>2G Feature Phone & SMS Fallback</span>
              </span>
            </div>

            <h2 className="text-xl sm:text-2xl font-black mt-2 text-white tracking-tight flex items-center space-x-2">
              <span>SMS & USSD Fallback Gateway</span>
              <Zap className="w-5 h-5 text-amber-400" />
            </h2>
            <p className="text-xs text-emerald-200/80 mt-0.5">
              Empowering boda boda riders, errand runners, and offline merchants without smartphones or mobile data.
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
        <div className="flex items-center space-x-1.5 mt-5 border-t border-white/10 pt-3">
          {[
            { id: 'ussd', label: 'Interactive USSD (*483*88#)' },
            { id: 'sms', label: 'Two-Way SMS Shortcode (22880)' },
            { id: 'architecture', label: 'Offline Architecture & Sync' }
          ].map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => { soundEngine.play('tap'); setActiveTab(tab.id as any); }}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                activeTab === tab.id
                  ? 'bg-white text-[var(--brief-ink)] shadow-md font-black'
                  : 'bg-white/10 text-white/80 hover:bg-white/20'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ================= TAB 1: USSD SIMULATOR ================= */}
      {activeTab === 'ussd' && (
        <div className="p-5 sm:p-6 grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
          
          {/* Left Column: Nokia / Feature Phone Mockup */}
          <div className="md:col-span-6 flex justify-center">
            <div className="w-[280px] bg-gradient-to-b from-[#334155] to-[#1E293B] rounded-[36px] p-4 shadow-2xl border-4 border-[#475569] ring-4 ring-black/30 flex flex-col items-center space-y-3">
              
              {/* Speaker Grill */}
              <div className="w-12 h-1.5 bg-black/40 rounded-full mb-1" />

              {/* Retro LCD Screen */}
              <div className="w-full h-[180px] bg-[#9EA792] rounded-xl p-3 border-2 border-[#76806C] shadow-inner font-mono text-xs text-[#1E2319] overflow-y-auto flex flex-col justify-between leading-tight select-none">
                {!ussdSessionActive ? (
                  <div className="space-y-1 my-auto text-center">
                    <span className="text-[11px] font-bold block text-[#3F4836]">SAFARICOM 2G</span>
                    <span className="text-sm font-black tracking-wider block mt-2 text-[#1E2319]">
                      {ussdInput || '*483*88#'}
                    </span>
                    <span className="text-[11px] text-[#556049] block pt-2">Press DIAL to connect</span>
                  </div>
                ) : (
                  <div className="space-y-1.5 text-left text-[12px] whitespace-pre-line">
                    <p className="font-bold">{ussdScreenText}</p>
                    {ussdMenuState !== 'ended' && (
                      <div className="pt-2 border-t border-[#76806C] flex items-center justify-between">
                        <span className="text-[11px] font-bold">Input: {ussdPromptInput}_</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Retro Action Keys (DIAL / CANCEL) */}
              <div className="grid grid-cols-2 gap-2 w-full pt-1">
                {!ussdSessionActive ? (
                  <button
                    type="button"
                    onClick={handleDialUssd}
                    className="py-2 rounded-xl bg-[#059669] hover:bg-[#15803D] text-white font-black text-xs uppercase tracking-wider shadow cursor-pointer text-center active:scale-95 transition-all"
                  >
                    DIAL
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleSendUssdResponse(ussdPromptInput)}
                    disabled={ussdMenuState === 'ended'}
                    className={`py-2 rounded-xl font-black text-xs uppercase tracking-wider shadow cursor-pointer text-center active:scale-95 transition-all ${
                      ussdMenuState === 'ended' ? 'bg-gray-400 text-gray-700 cursor-not-allowed' : 'bg-[#0891B2] text-white hover:bg-[#1D4ED8]'
                    }`}
                  >
                    SEND
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleKeypadCancel}
                  className="py-2 rounded-xl bg-[#DC2626] hover:bg-[#B91C1C] text-white font-black text-xs uppercase tracking-wider shadow cursor-pointer text-center active:scale-95 transition-all"
                >
                  END / CLR
                </button>
              </div>

              {/* Numeric Keypad (0-9, *, #) */}
              <div className="grid grid-cols-3 gap-1.5 w-full pt-1">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].map(k => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => handleKeypadPress(k)}
                    className="h-9 rounded-xl bg-[#0F172A] hover:bg-[#1E293B] active:bg-[#334155] border border-white/10 text-white font-mono font-black text-sm flex items-center justify-center shadow-xs cursor-pointer"
                  >
                    {k}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Right Column: Instructions & Quick Shortcuts */}
          <div className="md:col-span-6 space-y-4 text-xs">
            <div className="p-4 rounded-2xl bg-[color:var(--brief-bg)] border border-[var(--brief-line)] space-y-2">
              <div className="flex items-center space-x-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <h4 className="font-black text-[var(--brief-ink)] uppercase tracking-wider text-xs">
                  How Kenyan Boda Riders Use USSD
                </h4>
              </div>
              <p className="text-gray-600 leading-relaxed text-[12px]">
                Couriers dial <strong>*483*88#</strong> on any feature phone (Nokia, itel, Tecno) with zero internet. The server communicates via GSM flash sessions, enabling instant gig acceptance, PIN confirmation, and automated M-Pesa disbursements.
              </p>
            </div>

            <div className="space-y-2">
              <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-gray-500 block">
                Try Interactive USSD Flows:
              </span>

              <div className="grid grid-cols-1 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    handleDialUssd();
                    setTimeout(() => handleSendUssdResponse('3'), 150);
                  }}
                  className="p-3 rounded-2xl bg-white border border-[var(--brief-line)] hover:border-[#40916C] text-left transition-all shadow-xs cursor-pointer flex items-center justify-between"
                >
                  <div>
                    <span className="font-bold text-[var(--brief-ink)] block">Confirm Delivery (PIN #4821)</span>
                    <span className="text-[11px] text-gray-500">Unlocks 90% payout instantly to rider's M-Pesa</span>
                  </div>
                  <ArrowRight className="w-4 h-4 text-[#40916C]" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    handleDialUssd();
                    setTimeout(() => handleSendUssdResponse('2'), 150);
                  }}
                  className="p-3 rounded-2xl bg-white border border-[var(--brief-line)] hover:border-[#40916C] text-left transition-all shadow-xs cursor-pointer flex items-center justify-between"
                >
                  <div>
                    <span className="font-bold text-[var(--brief-ink)] block">Accept Nearby Boda Gig</span>
                    <span className="text-[11px] text-gray-500">View real-time dispatches and claim jobs via GSM</span>
                  </div>
                  <ArrowRight className="w-4 h-4 text-[#40916C]" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    handleDialUssd();
                    setTimeout(() => handleSendUssdResponse('4'), 150);
                  }}
                  className="p-3 rounded-2xl bg-white border border-[var(--brief-line)] hover:border-[#40916C] text-left transition-all shadow-xs cursor-pointer flex items-center justify-between"
                >
                  <div>
                    <span className="font-bold text-[var(--brief-ink)] block">Check M-Pesa Ledger Balance</span>
                    <span className="text-[11px] text-gray-500">View settled balance and daily payout schedule</span>
                  </div>
                  <ArrowRight className="w-4 h-4 text-[#40916C]" />
                </button>
              </div>
            </div>
          </div>

        </div>
      )}

      {/* ================= TAB 2: TWO-WAY SMS SHORTCODE ================= */}
      {activeTab === 'sms' && (
        <div className="p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <MessageSquare className="w-4 h-4 text-[#40916C]" />
              <h3 className="text-xs font-black uppercase tracking-wider text-[var(--brief-ink)]">
                Live Shortcode Gateway: 22880 (Africa's Talking / Twilio)
              </h3>
            </div>
            <span className="text-[11px] font-mono text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 font-bold">
              ● Webhook Active
            </span>
          </div>

          {/* SMS Chat Feed */}
          <div className="h-[280px] bg-gray-50 border border-gray-200 rounded-2xl p-4 overflow-y-auto space-y-3 font-sans text-xs">
            {smsMessages.map(m => (
              <div
                key={m.id}
                className={`flex flex-col ${m.sender === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[85%] p-3 rounded-2xl leading-relaxed whitespace-pre-line shadow-xs ${
                    m.sender === 'user'
                      ? 'bg-[color:var(--brief-ink)] text-white rounded-tr-none'
                      : 'bg-white border border-gray-200 text-gray-800 rounded-tl-none font-mono text-[12px]'
                  }`}
                >
                  {m.text}
                </div>
                <span className="text-[11px] text-gray-400 mt-1 px-1">{m.time}</span>
              </div>
            ))}
          </div>

          {/* SMS Composer Form */}
          <form onSubmit={handleSendSms} className="flex gap-2">
            <input
              type="text"
              placeholder="Try keywords: WAIRO ACC 9821, WAIRO PIN 9821 4821, WAIRO BAL, CIRCLE BAL"
              value={smsDraft}
              onChange={(e) => setSmsDraft(e.target.value)}
              className="flex-1 bg-gray-50 border border-gray-200 rounded-2xl px-4 py-2.5 text-xs text-[var(--brief-ink)] outline-none focus:border-[#0891B2]"
            />
            <button
              type="submit"
              className="px-5 py-2.5 rounded-2xl bg-[#40916C] hover:bg-[#ff6f3b] text-white font-bold text-xs flex items-center space-x-1.5 shadow-sm cursor-pointer transition-all"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Send SMS</span>
            </button>
          </form>

          {/* Quick SMS Prompt Chips */}
          <div className="flex flex-wrap gap-1.5 pt-1">
            <span className="text-[11px] text-gray-500 font-mono py-1">Quick SMS:</span>
            {[
              'WAIRO ACC 9821',
              'WAIRO PIN 9821 4821',
              'WAIRO BAL',
              'CIRCLE BAL',
              'BRIEF HELP'
            ].map(cmd => (
              <button
                key={cmd}
                type="button"
                onClick={() => setSmsDraft(cmd)}
                className="px-2.5 py-1 rounded-xl bg-gray-100 hover:bg-gray-200 text-[var(--brief-ink)] font-mono text-[11px] font-bold cursor-pointer transition-colors"
              >
                {cmd}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ================= TAB 3: OFFLINE ARCHITECTURE ================= */}
      {activeTab === 'architecture' && (
        <div className="p-5 sm:p-6 space-y-4 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono">
            <div className="p-4 rounded-2xl bg-[color:var(--brief-bg)] border border-[var(--brief-line)] space-y-1.5">
              <span className="text-xl">📡</span>
              <h5 className="font-black text-[var(--brief-ink)] text-xs">1. Zero-Data GSM</h5>
              <p className="text-[12px] text-gray-600 font-sans leading-relaxed">
                USSD runs on the cellular signalling channel, working even with zero airtime and zero mobile data bundles.
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-[color:var(--brief-bg)] border border-[var(--brief-line)] space-y-1.5">
              <span className="text-xl">🔒</span>
              <h5 className="font-black text-[var(--brief-ink)] text-xs">2. 4-Digit Escrow PIN</h5>
              <p className="text-[12px] text-gray-600 font-sans leading-relaxed">
                Delivery escrow cannot be released until the recipient shares their 4-digit PIN with the driver.
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-[color:var(--brief-bg)] border border-[var(--brief-line)] space-y-1.5">
              <span className="text-xl">💸</span>
              <h5 className="font-black text-[var(--brief-ink)] text-xs">3. 90% High Payout</h5>
              <p className="text-[12px] text-gray-600 font-sans leading-relaxed">
                Couriers receive 90% of the total order fee directly disbursed to their M-Pesa phone number.
              </p>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-[color:var(--brief-ink)] text-white space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black uppercase text-[#00BFEF]">
                Offline-First Sync Engine Status
              </span>
              <span className="text-[11px] font-mono text-emerald-400 font-bold">
                ✓ PWA ServiceWorker Active
              </span>
            </div>
            <p className="text-xs text-gray-300 font-sans leading-relaxed">
              When an offline rider switches back to a smartphone or reconnects to Wi-Fi/4G, all queued USSD/SMS confirmations automatically synchronize with the Brief web application ledger without race conditions or duplicate entries.
            </p>
          </div>
        </div>
      )}

    </div>
  );
}
