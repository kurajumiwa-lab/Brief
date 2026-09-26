import React, { useState } from 'react';
import { 
  Users, 
  CheckCircle2, 
  Clock, 
  MapPin, 
  Share2, 
  Plus, 
  CalendarDays, 
  DollarSign, 
  FileText, 
  MessageCircle, 
  Video, 
  Car, 
  Building2, 
  X,
  Check,
  Send,
  Heart
} from 'lucide-react';
import { soundEngine } from '../../utils/SoundEngine';

export interface CommitteeTask {
  id: string;
  title: string;
  assignee: string;
  dueDate: string;
  status: 'todo' | 'in_progress' | 'completed';
}

export interface CommitteeContribution {
  id: string;
  contributor: string;
  amountKes: number;
  date: string;
  status: 'paid' | 'pending';
  mpesaRef?: string;
}

export function CommitteeDesk({
  onClose,
  onOpenVendor
}: {
  onClose?: () => void;
  onOpenVendor?: (vendorName: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<'overview' | 'tasks' | 'contributions' | 'guest_info'>('overview');
  const [tasks, setTasks] = useState<CommitteeTask[]>([
    { id: 't-1', title: 'Confirm mortuary & transport booking', assignee: 'James Nyamweya', dueDate: 'May 22', status: 'todo' },
    { id: 't-2', title: 'Book 200 tents and plastic chairs', assignee: 'Carol Gesare', dueDate: 'May 21', status: 'in_progress' },
    { id: 't-3', title: 'Catering (Nyaboke Catering 100 pax)', assignee: 'Mary Omoke', dueDate: 'May 21', status: 'completed' },
    { id: 't-4', title: 'Invite church choir & officiant', assignee: 'Peter Nyaboke', dueDate: 'May 22', status: 'todo' },
    { id: 't-5', title: 'Design and print funeral program booklet', assignee: 'Sharon Moraa', dueDate: 'May 23', status: 'todo' },
    { id: 't-6', title: 'PA system and sound generator setup', assignee: 'Samson Omwenga', dueDate: 'May 24', status: 'completed' }
  ]);

  const [contributions, setContributions] = useState<CommitteeContribution[]>([
    { id: 'c-1', contributor: 'Peter Nyaboke', amountKes: 20000, date: 'May 18', status: 'paid', mpesaRef: 'QKJ82910A' },
    { id: 'c-2', contributor: 'Caroline Gesare', amountKes: 15000, date: 'May 18', status: 'paid', mpesaRef: 'QKL49201B' },
    { id: 'c-3', contributor: 'Samson Omwenga', amountKes: 10000, date: 'May 19', status: 'paid', mpesaRef: 'QKP11244C' },
    { id: 'c-4', contributor: 'Grace Moraa', amountKes: 20000, date: 'May 20', status: 'pending' },
    { id: 'c-5', contributor: 'James Nyamweya', amountKes: 20000, date: 'May 20', status: 'pending' },
    { id: 'c-6', contributor: 'Dr. Mercy Bosire', amountKes: 50000, date: 'May 19', status: 'paid', mpesaRef: 'QKX77312D' },
    { id: 'c-7', contributor: 'Nyamataro Diaspora Circle', amountKes: 130000, date: 'May 17', status: 'paid', mpesaRef: 'QKY99821E' }
  ]);

  const [isAddTaskOpen, setIsAddTaskOpen] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskAssignee, setNewTaskAssignee] = useState('');
  const [newTaskDueDate, setNewTaskDueDate] = useState('');

  const [isLogPayOpen, setIsLogPayOpen] = useState(false);
  const [newPayName, setNewPayName] = useState('');
  const [newPayAmount, setNewPayAmount] = useState('5000');
  const [newPayRef, setNewPayRef] = useState('');
  const [copiedShare, setCopiedShare] = useState(false);

  const targetBudgetKes = 340000;
  const totalReceivedKes = contributions
    .filter(c => c.status === 'paid')
    .reduce((sum, c) => sum + c.amountKes, 0);
  const totalOutstandingKes = Math.max(0, targetBudgetKes - totalReceivedKes);
  const percentFunded = Math.min(100, Math.round((totalReceivedKes / targetBudgetKes) * 100));

  const handleAddTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;
    soundEngine.play('heavyTap');
    const newTask: CommitteeTask = {
      id: `task-${Date.now()}`,
      title: newTaskTitle.trim(),
      assignee: newTaskAssignee.trim() || 'Unassigned',
      dueDate: newTaskDueDate.trim() || 'This Week',
      status: 'todo'
    };
    setTasks(prev => [newTask, ...prev]);
    setNewTaskTitle('');
    setNewTaskAssignee('');
    setNewTaskDueDate('');
    setIsAddTaskOpen(false);
  };

  const handleLogContribution = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPayName.trim() || Number(newPayAmount) <= 0) return;
    soundEngine.play('reward');
    const newContrib: CommitteeContribution = {
      id: `contrib-${Date.now()}`,
      contributor: newPayName.trim(),
      amountKes: Number(newPayAmount),
      date: 'Today',
      status: 'paid',
      mpesaRef: newPayRef.trim() || `MP${Math.floor(100000 + Math.random() * 900000)}`
    };
    setContributions(prev => [newContrib, ...prev]);
    setNewPayName('');
    setNewPayAmount('5000');
    setNewPayRef('');
    setIsLogPayOpen(false);
  };

  const toggleTaskStatus = (id: string) => {
    soundEngine.play('tap');
    setTasks(prev => prev.map(t => {
      if (t.id !== id) return t;
      const nextStatus: CommitteeTask['status'] = 
        t.status === 'todo' ? 'in_progress' :
        t.status === 'in_progress' ? 'completed' : 'todo';
      return { ...t, status: nextStatus };
    }));
  };

  const handleShareWhatsApp = () => {
    soundEngine.play('tap');
    const text = `*Dad's Burial Arrangements Committee Update 🕊️*\n\n` +
      `*Target:* KES ${targetBudgetKes.toLocaleString()}\n` +
      `*Received via M-Pesa:* KES ${totalReceivedKes.toLocaleString()} (${percentFunded}%)\n` +
      `*Outstanding:* KES ${totalOutstandingKes.toLocaleString()}\n\n` +
      `*Service Date:* Saturday, 25 May 2026 at 10:00 AM\n` +
      `*Venue:* St. Peter's Church, Kisii\n\n` +
      `_Track tasks & send contributions via Brief Town Centre: https://brief.ke/circle/burial-arrangements_`;

    if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedShare(true);
      setTimeout(() => setCopiedShare(false), 3000);
    }
  };

  return (
    <div className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-3xl overflow-hidden shadow-xl text-[var(--brief-ink)] max-w-2xl mx-auto">
      
      {/* ================= HEADER SECTION ================= */}
      <div className="bg-[color:var(--brief-ink)] text-white p-5 sm:p-6 relative">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-full bg-[#B8621F] text-white">
                FAMILY SOLIDARITY CIRCLE · PRIVATE
              </span>
              <span className="text-xs text-[#DCE2E6]/70 flex items-center space-x-1">
                <Users className="w-3.5 h-3.5 text-[#E8985E]" />
                <span>24 Family & Clan Members</span>
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-black mt-1 text-white">
              Dad's Burial Arrangements 🕊️
            </h2>
            <p className="text-xs text-[#DCE2E6]/80 mt-0.5">
              St. Peter's Church, Kisii / Nyamataro • Sat, 25 May 2026 (Private Circle)
            </p>
          </div>

          {onClose && (
            <button
              onClick={() => { soundEngine.play('tap'); onClose(); }}
              className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Tab Strip */}
        <div className="flex items-center space-x-1.5 mt-5 border-t border-white/10 pt-3 overflow-x-auto">
          {[
            { id: 'overview', label: 'Overview' },
            { id: 'tasks', label: `Tasks (${tasks.length})` },
            { id: 'contributions', label: `Contributions (${contributions.length})` },
            { id: 'guest_info', label: 'Guest Info' }
          ].map(t => (
            <button
              key={t.id}
              onClick={() => { soundEngine.play('tap'); setActiveTab(t.id as any); }}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
                activeTab === t.id
                  ? 'bg-white text-[var(--brief-ink)] shadow-md font-black'
                  : 'bg-white/10 text-white/80 hover:bg-white/20'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ================= TAB 1: OVERVIEW ================= */}
      {activeTab === 'overview' && (
        <div className="p-5 sm:p-6 space-y-5">
          
          {/* Financial Harambee Stepper Card */}
          <div className="bg-[color:var(--brief-bg)] border border-[var(--brief-line)] rounded-2xl p-4 sm:p-5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono font-black text-gray-500 uppercase">
                HARAMBEE CONTRIBUTION SNAPSHOT
              </span>
              <span className="text-xs font-mono font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                {percentFunded}% FUNDED
              </span>
            </div>

            {/* Progress Bar */}
            <div className="h-3 w-full bg-gray-200 rounded-full overflow-hidden p-0.5">
              <div 
                className="h-full bg-gradient-to-r from-[#40916C] via-[#FF8A00] to-emerald-500 rounded-full transition-all duration-500"
                style={{ width: `${percentFunded}%` }}
              />
            </div>

            <div className="grid grid-cols-3 gap-2 pt-1 text-center font-mono">
              <div className="p-2.5 bg-white rounded-xl border border-gray-200">
                <span className="text-[11px] text-gray-400 block uppercase">TOTAL TARGET</span>
                <span className="text-xs sm:text-sm font-black text-[var(--brief-ink)]">
                  KES {targetBudgetKes.toLocaleString()}
                </span>
              </div>

              <div className="p-2.5 bg-emerald-50 rounded-xl border border-emerald-200 text-emerald-800">
                <span className="text-[11px] text-emerald-600 block uppercase">RECEIVED</span>
                <span className="text-xs sm:text-sm font-black text-emerald-700">
                  KES {totalReceivedKes.toLocaleString()}
                </span>
              </div>

              <div className="p-2.5 bg-rose-50 rounded-xl border border-rose-200 text-rose-800">
                <span className="text-[11px] text-rose-600 block uppercase">OUTSTANDING</span>
                <span className="text-xs sm:text-sm font-black text-rose-700">
                  KES {totalOutstandingKes.toLocaleString()}
                </span>
              </div>
            </div>
          </div>

          {/* Quick Actions & Broadcast */}
          <div className="flex flex-col sm:flex-row gap-2.5">
            <button
              type="button"
              onClick={handleShareWhatsApp}
              className="flex-1 py-3 rounded-2xl bg-[#25D366] hover:bg-[#20bd5a] text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center space-x-2 shadow-md cursor-pointer transition-all"
            >
              <Share2 className="w-4 h-4" />
              <span>{copiedShare ? 'Copied WhatsApp Broadcast!' : 'Share WhatsApp Committee Update'}</span>
            </button>

            <button
              type="button"
              onClick={() => setIsLogPayOpen(true)}
              className="py-3 px-5 rounded-2xl bg-[color:var(--brief-ink)] hover:bg-[#1E2633] text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center space-x-2 shadow-md cursor-pointer transition-all"
            >
              <Plus className="w-4 h-4 text-[#40916C]" />
              <span>Log M-Pesa</span>
            </button>
          </div>

          {/* Urgent Checklist Preview */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-black uppercase tracking-wider text-gray-700">
                Urgent Committee Tasks
              </h3>
              <button
                onClick={() => setActiveTab('tasks')}
                className="text-[12px] font-bold text-[#40916C] hover:underline cursor-pointer"
              >
                View all ({tasks.length}) →
              </button>
            </div>

            <div className="space-y-1.5">
              {tasks.slice(0, 3).map(t => (
                <div 
                  key={t.id}
                  onClick={() => toggleTaskStatus(t.id)}
                  className="p-3 bg-white border border-[var(--brief-line)] rounded-2xl flex items-center justify-between cursor-pointer hover:border-[#40916C] transition-colors"
                >
                  <div className="flex items-center space-x-2.5">
                    <div className={`w-5 h-5 rounded-lg flex items-center justify-center border ${
                      t.status === 'completed' 
                        ? 'bg-emerald-500 border-emerald-500 text-white' 
                        : t.status === 'in_progress'
                        ? 'bg-amber-100 border-amber-300 text-amber-700'
                        : 'border-gray-300 bg-white'
                    }`}>
                      {t.status === 'completed' && <Check className="w-3.5 h-3.5" />}
                    </div>
                    <div>
                      <span className={`text-xs font-bold block ${t.status === 'completed' ? 'line-through text-gray-400' : 'text-[var(--brief-ink)]'}`}>
                        {t.title}
                      </span>
                      <span className="text-[11px] text-gray-500">
                        {t.assignee} • Due {t.dueDate}
                      </span>
                    </div>
                  </div>

                  <span className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded uppercase ${
                    t.status === 'completed'
                      ? 'bg-emerald-50 text-emerald-700'
                      : t.status === 'in_progress'
                      ? 'bg-amber-50 text-amber-700'
                      : 'bg-gray-100 text-gray-600'
                  }`}>
                    {t.status.replace('_', ' ')}
                  </span>
                </div>
              ))}
            </div>
          </div>

        </div>
      )}

      {/* ================= TAB 2: TASKS ================= */}
      {activeTab === 'tasks' && (
        <div className="p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xs font-black uppercase tracking-wider text-[var(--brief-ink)]">
                Committee Task Board
              </h3>
              <p className="text-[12px] text-gray-500">Tap any item to cycle status (To Do → In Progress → Completed)</p>
            </div>

            <button
              type="button"
              onClick={() => setIsAddTaskOpen(true)}
              className="px-3.5 py-1.5 rounded-xl bg-[#40916C] text-white text-xs font-bold flex items-center space-x-1.5 shadow-sm cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Task</span>
            </button>
          </div>

          <div className="space-y-2">
            {tasks.map(t => (
              <div 
                key={t.id}
                onClick={() => toggleTaskStatus(t.id)}
                className="p-3.5 bg-white border border-[var(--brief-line)] rounded-2xl flex items-center justify-between cursor-pointer hover:border-[#40916C] transition-all shadow-xs"
              >
                <div className="flex items-center space-x-3">
                  <div className={`w-5 h-5 rounded-lg flex items-center justify-center border ${
                    t.status === 'completed' 
                      ? 'bg-emerald-500 border-emerald-500 text-white' 
                      : t.status === 'in_progress'
                      ? 'bg-amber-100 border-amber-300 text-amber-700'
                      : 'border-gray-300 bg-white'
                  }`}>
                    {t.status === 'completed' && <Check className="w-3.5 h-3.5" />}
                  </div>
                  <div>
                    <span className={`text-xs font-bold block ${t.status === 'completed' ? 'line-through text-gray-400' : 'text-[var(--brief-ink)]'}`}>
                      {t.title}
                    </span>
                    <span className="text-[11px] text-gray-500">
                      Assigned to: <b className="text-gray-700">{t.assignee}</b> • Due: {t.dueDate}
                    </span>
                  </div>
                </div>

                <span className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded uppercase ${
                  t.status === 'completed'
                    ? 'bg-emerald-50 text-emerald-700'
                    : t.status === 'in_progress'
                    ? 'bg-amber-50 text-amber-700'
                    : 'bg-gray-100 text-gray-600'
                }`}>
                  {t.status.replace('_', ' ')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ================= TAB 3: CONTRIBUTIONS ================= */}
      {activeTab === 'contributions' && (
        <div className="p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xs font-black uppercase tracking-wider text-[var(--brief-ink)]">
                M-Pesa Contribution Ledger
              </h3>
              <p className="text-[12px] text-gray-500">Transparent Harambee ledger with verified references</p>
            </div>

            <button
              type="button"
              onClick={() => setIsLogPayOpen(true)}
              className="px-3.5 py-1.5 rounded-xl bg-[color:var(--brief-ink)] text-white text-xs font-bold flex items-center space-x-1.5 shadow-sm cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 text-[#40916C]" />
              <span>Log M-Pesa</span>
            </button>
          </div>

          <div className="space-y-2">
            {contributions.map(c => (
              <div 
                key={c.id}
                className="p-3.5 bg-white border border-[var(--brief-line)] rounded-2xl flex items-center justify-between shadow-xs"
              >
                <div>
                  <span className="text-xs font-bold text-[var(--brief-ink)] block">
                    {c.contributor}
                  </span>
                  <div className="flex items-center space-x-2 text-[11px] text-gray-500 font-mono mt-0.5">
                    <span>{c.date}</span>
                    {c.mpesaRef && (
                      <span className="text-emerald-700 bg-emerald-50 px-1.5 rounded border border-emerald-200">
                        Ref: {c.mpesaRef}
                      </span>
                    )}
                  </div>
                </div>

                <div className="text-right">
                  <span className="text-sm font-mono font-black text-[var(--brief-ink)] block">
                    KES {c.amountKes.toLocaleString()}
                  </span>
                  <span className={`text-[11px] font-mono font-bold px-1.5 py-0.5 rounded uppercase ${
                    c.status === 'paid' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                  }`}>
                    {c.status.toUpperCase()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ================= TAB 4: GUEST INFO ================= */}
      {activeTab === 'guest_info' && (
        <div className="p-5 sm:p-6 space-y-4">
          
          {/* Venue Card */}
          <div className="p-4 rounded-2xl bg-[color:var(--brief-bg)] border border-[var(--brief-line)] space-y-3">
            <div className="flex items-center space-x-2">
              <MapPin className="w-4 h-4 text-[#40916C]" />
              <h4 className="text-xs font-black uppercase tracking-wider text-[var(--brief-ink)]">
                Service & Burial Venue
              </h4>
            </div>

            <div className="text-xs space-y-1 text-gray-700">
              <p className="font-bold text-[var(--brief-ink)]">St. Peter's Church, Kisii Town</p>
              <p className="text-[12px] text-gray-500">Service begins promptly at 10:00 AM, followed by procession to Nyamataro family homestead.</p>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1">
              <div className="p-2.5 bg-white rounded-xl border border-gray-200 text-xs">
                <span className="text-[11px] text-gray-400 block font-mono">PARKING:</span>
                <span className="font-bold text-gray-800 flex items-center space-x-1">
                  <Car className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Available at church compound</span>
                </span>
              </div>

              <div className="p-2.5 bg-white rounded-xl border border-gray-200 text-xs">
                <span className="text-[11px] text-gray-400 block font-mono">LIVESTREAM:</span>
                <span className="font-bold text-[#00BFEF] flex items-center space-x-1">
                  <Video className="w-3.5 h-3.5" />
                  <span>Zoom / YouTube Live</span>
                </span>
              </div>
            </div>
          </div>

          {/* Accommodation & Catering note */}
          <div className="p-4 rounded-2xl bg-white border border-[var(--brief-line)] space-y-2">
            <h4 className="text-xs font-black uppercase tracking-wider text-[var(--brief-ink)] flex items-center space-x-1.5">
              <Building2 className="w-4 h-4 text-[#00BFEF]" />
              <span>Accommodation & Catering</span>
            </h4>
            <p className="text-[12px] text-gray-600">
              For relatives arriving from Nairobi & Mombasa, discount rates arranged at Kisii Sports Club. Catering handled by <b>Nyaboke Catering Services</b>.
            </p>
            {onOpenVendor && (
              <button
                type="button"
                onClick={() => onOpenVendor('Nyaboke Catering')}
                className="text-xs font-bold text-[#40916C] hover:underline cursor-pointer"
              >
                View Nyaboke Catering Profile →
              </button>
            )}
          </div>

        </div>
      )}

      {/* ================= MODAL: ADD TASK ================= */}
      {isAddTaskOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-5 w-full max-w-md border border-[var(--brief-line)] shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-gray-100 pb-3">
              <h3 className="font-black text-sm text-[var(--brief-ink)]">Add Committee Task</h3>
              <button onClick={() => setIsAddTaskOpen(false)} className="text-gray-400 hover:text-gray-700">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddTask} className="space-y-3">
              <div>
                <label className="text-[11px] font-bold text-gray-500 uppercase block mb-1">Task Title</label>
                <input
                  type="text"
                  required
                  value={newTaskTitle}
                  onChange={e => setNewTaskTitle(e.target.value)}
                  placeholder="e.g. Order flowers & wreaths"
                  className="w-full bg-[color:var(--brief-bg)] border border-gray-300 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-[#40916C]"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-bold text-gray-500 uppercase block mb-1">Assignee</label>
                  <input
                    type="text"
                    value={newTaskAssignee}
                    onChange={e => setNewTaskAssignee(e.target.value)}
                    placeholder="e.g. James N."
                    className="w-full bg-[color:var(--brief-bg)] border border-gray-300 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-[#40916C]"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-bold text-gray-500 uppercase block mb-1">Due Date</label>
                  <input
                    type="text"
                    value={newTaskDueDate}
                    onChange={e => setNewTaskDueDate(e.target.value)}
                    placeholder="e.g. May 23"
                    className="w-full bg-[color:var(--brief-bg)] border border-gray-300 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-[#40916C]"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full py-2.5 rounded-xl bg-[#40916C] hover:bg-[#ff4805] text-white text-xs font-bold uppercase tracking-wider cursor-pointer"
              >
                Save Task
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ================= MODAL: LOG M-PESA CONTRIBUTION ================= */}
      {isLogPayOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-5 w-full max-w-md border border-[var(--brief-line)] shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-gray-100 pb-3">
              <h3 className="font-black text-sm text-[var(--brief-ink)]">Log M-Pesa Contribution</h3>
              <button onClick={() => setIsLogPayOpen(false)} className="text-gray-400 hover:text-gray-700">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleLogContribution} className="space-y-3">
              <div>
                <label className="text-[11px] font-bold text-gray-500 uppercase block mb-1">Contributor Name / Handle</label>
                <input
                  type="text"
                  required
                  value={newPayName}
                  onChange={e => setNewPayName(e.target.value)}
                  placeholder="e.g. Nyaboke Moraa"
                  className="w-full bg-[color:var(--brief-bg)] border border-gray-300 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-[#40916C]"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-bold text-gray-500 uppercase block mb-1">Amount (KES)</label>
                  <input
                    type="number"
                    required
                    value={newPayAmount}
                    onChange={e => setNewPayAmount(e.target.value)}
                    className="w-full bg-[color:var(--brief-bg)] border border-gray-300 rounded-xl px-3 py-2 text-xs font-mono font-bold focus:outline-none focus:border-[#40916C]"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-bold text-gray-500 uppercase block mb-1">M-Pesa Reference</label>
                  <input
                    type="text"
                    value={newPayRef}
                    onChange={e => setNewPayRef(e.target.value)}
                    placeholder="e.g. QKZ99120A"
                    className="w-full bg-[color:var(--brief-bg)] border border-gray-300 rounded-xl px-3 py-2 text-xs font-mono focus:outline-none focus:border-[#40916C]"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold uppercase tracking-wider cursor-pointer shadow-md"
              >
                Record Verified Payment
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── NON-PROMISES DISCLAIMER (NEIGHBORHOOD TRUST OS) ── */}
      <div className="mt-6 p-4 rounded-2xl bg-black/5 text-[12px] text-gray-500 leading-relaxed space-y-1">
        <span className="font-bold text-gray-700 block">Voluntary Community Support</span>
        <p>
          This is a voluntary community support fund. Contributions are gifts, not investments. Brief does not manage funds or guarantee outcomes.
        </p>
      </div>

    </div>
  );
}
