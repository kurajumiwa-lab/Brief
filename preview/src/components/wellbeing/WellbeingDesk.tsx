import React, { useState } from 'react';
import { 
  Heart, 
  Users, 
  CalendarDays, 
  Star, 
  Check, 
  Sparkles, 
  Clock, 
  MapPin, 
  ChevronRight, 
  X, 
  Phone, 
  MessageCircle, 
  ShieldCheck,
  Smile,
  Frown,
  Meh
} from 'lucide-react';
import { soundEngine } from '../../utils/SoundEngine';

export interface MoodOption {
  id: string;
  emoji: string;
  label: string;
  color: string;
  advice: string;
}

export function WellbeingDesk({
  onClose,
  onBookTherapist
}: {
  onClose?: () => void;
  onBookTherapist?: (therapistName: string) => void;
}) {
  const [selectedMood, setSelectedMood] = useState<string | null>(null);
  const [activeSubTab, setActiveSubTab] = useState<'all' | 'professionals' | 'groups' | 'activities'>('all');
  const [bookedTherapist, setBookedTherapist] = useState<string | null>(null);
  const [joinedGroup, setJoinedGroup] = useState<string | null>(null);

  const moods: MoodOption[] = [
    { id: 'lonely', emoji: '😔', label: 'Lonely', color: '#60A5FA', advice: 'Connect with a peer support circle or join a community morning run.' },
    { id: 'stressed', emoji: '😫', label: 'Stressed', color: '#F59E0B', advice: 'Try taking a 10-minute deep breathing break or acoustic music session.' },
    { id: 'heartbreak', emoji: '💔', label: 'Heartbreak', color: '#EF4444', advice: 'Healing takes time. Speak confidentially with a licensed counselor.' },
    { id: 'anxious', emoji: '😰', label: 'Anxious', color: '#A855F7', advice: 'Focus on what you can control right now. Safe guided exercises help ground you.' },
    { id: 'burnt_out', emoji: '🔥', label: 'Burnt out', color: '#F97316', advice: 'Give yourself permission to rest. Step away from work screens today.' },
    { id: 'grieving', emoji: '🥀', label: 'Grieving', color: '#64748B', advice: 'The Grief Support Group meets every Saturday at 10:00 AM.' },
    { id: 'angry', emoji: '😡', label: 'Angry', color: '#DC2626', advice: 'Express your feelings safely through physical movement or art therapy.' },
    { id: 'overwhelmed', emoji: '🌊', label: 'Overwhelmed', color: '#0EA5E9', advice: 'Break your day down into tiny single steps. You do not have to carry it all.' },
    { id: 'not_okay', emoji: '⚪', label: "I'm just not okay", color: '#475569', advice: 'We are here for you. Free peer listening rooms are open 24/7.' }
  ];

  const professionals = [
    {
      id: 'doc-1',
      name: 'Dr. Mercy Bosire',
      title: 'Clinical Psychologist',
      exp: '8 yrs exp • Kisii & Online',
      specialties: 'Anxiety, Depression, Trauma',
      rating: 4.9,
      reviews: 42,
      fee: 'KES 2,500 / session'
    },
    {
      id: 'doc-2',
      name: 'James Nyamweya',
      title: 'Counselor & Life Coach',
      exp: '5 yrs exp • Online Audio',
      specialties: 'Relationship, Stress, Anger',
      rating: 4.8,
      reviews: 31,
      fee: 'KES 1,800 / session'
    },
    {
      id: 'doc-3',
      name: 'Lilian Moraa',
      title: 'Youth & Family Therapist',
      exp: '6 yrs exp • Kisii Town',
      specialties: 'Youth, Anxiety, Self-esteem',
      rating: 4.9,
      reviews: 28,
      fee: 'KES 2,000 / session'
    },
    {
      id: 'doc-4',
      name: 'Dr. Allan Omondi',
      title: 'Psychiatrist',
      exp: '10 yrs exp • Kisii County Hospital',
      specialties: 'Mood disorders, Addiction',
      rating: 4.7,
      reviews: 54,
      fee: 'KES 3,500 / session'
    }
  ];

  const supportGroups = [
    {
      id: 'grp-1',
      title: 'Grief Support Group',
      schedule: 'Every Saturday • 10:00 AM',
      location: 'Kisii County Hospital / Online Room',
      desc: 'Safe space for individuals mourning family members, parents, or partners.',
      tag: 'Grief & Loss'
    },
    {
      id: 'grp-2',
      title: "Men's Mental Health Circle",
      schedule: 'Wednesdays • 7:00 PM',
      location: 'Online Audio Room (Anonymous)',
      desc: 'Private discussion for men addressing career pressure, burnout, and family balance.',
      tag: 'Men Only'
    },
    {
      id: 'grp-3',
      title: 'Youth & Student Support Circle',
      schedule: 'Sundays • 4:00 PM',
      location: 'Nyamataro Youth Center',
      desc: 'Campus stress, peer pressure, exam anxiety & future career guidance.',
      tag: 'Youth'
    },
    {
      id: 'grp-4',
      title: 'Addiction Recovery Group',
      schedule: 'Fridays • 6:00 PM',
      location: 'Kisii Recovery Center',
      desc: 'Structured 12-step peer community for alcohol and substance recovery.',
      tag: 'Recovery'
    }
  ];

  const activities = [
    {
      id: 'act-1',
      title: 'Morning Yoga & Meditation',
      schedule: 'Every Saturday • 7:00 AM',
      location: 'The Green Park, Kisii',
      tag: 'Free Outdoor Session'
    },
    {
      id: 'act-2',
      title: 'Weekend Community Park Run',
      schedule: 'Every Sunday • 6:30 AM',
      location: 'Kisii Sports Club Outer Track',
      tag: 'All Fitness Levels'
    },
    {
      id: 'act-3',
      title: 'Expressive Art Therapy Workshop',
      schedule: 'Friday, 24 May • 2:00 PM',
      location: 'Nyamataro Creative Hub',
      tag: 'Express & Heal'
    },
    {
      id: 'act-4',
      title: 'Acoustic Music & Chill Evening',
      schedule: 'Tonight • 7:00 PM',
      location: 'Kisii Sports Club Lounge',
      tag: 'Live Healing Sounds'
    }
  ];

  const handleSelectMood = (m: MoodOption) => {
    soundEngine.play('tap');
    setSelectedMood(m.id);
  };

  const handleBook = (name: string) => {
    soundEngine.play('reward');
    setBookedTherapist(name);
    setTimeout(() => setBookedTherapist(null), 3500);
    if (onBookTherapist) onBookTherapist(name);
  };

  const handleJoinGroup = (title: string) => {
    soundEngine.play('reward');
    setJoinedGroup(title);
    setTimeout(() => setJoinedGroup(null), 3500);
  };

  const activeMoodObj = moods.find(m => m.id === selectedMood);

  return (
    <div className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-3xl overflow-hidden shadow-xl text-[var(--brief-ink)] max-w-2xl mx-auto">
      
      {/* ================= HERO HEADER ================= */}
      <div className="bg-gradient-to-br from-[#064E3B] via-[#047857] to-[var(--brief-ink)] text-white p-5 sm:p-6 relative">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center space-x-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[11px] font-mono font-black uppercase tracking-wider text-emerald-300">
                TOWN WELLBEING DISTRICT
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-black mt-1 flex items-center space-x-2 text-white">
              <span>Emotional Wellbeing</span>
              <Heart className="w-5 h-5 text-emerald-300 fill-current" />
            </h2>
            <p className="text-xs text-emerald-100/90 mt-0.5">
              You matter. Let's help you feel better in a safe, community-rooted space.
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
      </div>

      <div className="p-5 sm:p-6 space-y-6">
        
        {/* ================= 1-TAP MOOD CHECK-IN ================= */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black uppercase tracking-wider text-[var(--brief-ink)]">
              How are you feeling today?
            </h3>
            <span className="text-[11px] font-mono text-gray-400">1-Tap Confidential Check-in</span>
          </div>

          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            {moods.slice(0, 8).map(m => {
              const isSelected = selectedMood === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => handleSelectMood(m)}
                  className={`p-2.5 rounded-2xl border text-center transition-all cursor-pointer flex flex-col items-center justify-center ${
                    isSelected
                      ? 'bg-emerald-50 border-emerald-500 shadow-md transform scale-105'
                      : 'bg-[color:var(--brief-bg)] border-[var(--brief-line)] hover:bg-gray-100'
                  }`}
                >
                  <span className="text-2xl block mb-1">{m.emoji}</span>
                  <span className="text-[12px] font-bold text-[var(--brief-ink)] leading-tight block">
                    {m.label}
                  </span>
                </button>
              );
            })}

            {/* "I'm just not okay" full pill */}
            <button
              type="button"
              onClick={() => handleSelectMood(moods[8])}
              className={`col-span-3 sm:col-span-2 p-2.5 rounded-2xl border text-center transition-all cursor-pointer flex items-center justify-center space-x-2 ${
                selectedMood === 'not_okay'
                  ? 'bg-slate-800 text-white border-slate-800'
                  : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200'
              }`}
            >
              <span className="text-base">⚪</span>
              <span className="text-xs font-black uppercase tracking-wider">I'm just not okay</span>
            </button>
          </div>

          {/* Active Mood Encouragement Banner */}
          {activeMoodObj && (
            <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-start space-x-3 text-xs text-emerald-900 animate-fadeIn">
              <span className="text-xl">{activeMoodObj.emoji}</span>
              <div>
                <span className="font-bold block text-emerald-950">Feeling {activeMoodObj.label}:</span>
                <p className="text-[12px] text-emerald-800 mt-0.5">{activeMoodObj.advice}</p>
              </div>
            </div>
          )}
        </section>

        {/* Filter Tabs */}
        <div className="flex items-center space-x-1 border-b border-gray-100 pb-2">
          {[
            { id: 'all', label: 'All Resources' },
            { id: 'professionals', label: 'Professional Help' },
            { id: 'groups', label: 'Support Groups' },
            { id: 'activities', label: 'Activities' }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => { soundEngine.play('tap'); setActiveSubTab(tab.id as any); }}
              className={`px-3 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                activeSubTab === tab.id
                  ? 'bg-[color:var(--brief-ink)] text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ================= SECTION 1: VERIFIED PROFESSIONAL HELP ================= */}
        {(activeSubTab === 'all' || activeSubTab === 'professionals') && (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-black uppercase tracking-wider text-[var(--brief-ink)]">
                Find Professional Help (Licensed Therapists)
              </h3>
              <span className="text-[11px] text-emerald-700 font-bold flex items-center space-x-1">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Verified Credentials</span>
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {professionals.map(doc => (
                <div 
                  key={doc.id}
                  className="p-4 bg-white border border-[var(--brief-line)] rounded-2xl flex flex-col justify-between shadow-xs hover:border-emerald-500 transition-all space-y-3"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="font-black text-xs text-[var(--brief-ink)]">{doc.name}</h4>
                      <p className="text-[11px] text-emerald-700 font-bold">{doc.title}</p>
                      <p className="text-[11px] text-gray-500 mt-0.5">{doc.exp}</p>
                    </div>
                    <div className="flex items-center space-x-1 bg-amber-50 px-1.5 py-0.5 rounded text-[11px] font-bold text-amber-700">
                      <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                      <span>{doc.rating}</span>
                    </div>
                  </div>

                  <div className="text-[11px] text-gray-600 bg-gray-50 p-2 rounded-xl">
                    <span className="font-bold text-gray-700 block">Focus:</span>
                    <span>{doc.specialties}</span>
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t border-gray-100">
                    <span className="text-[11px] font-mono font-bold text-[var(--brief-ink)]">{doc.fee}</span>
                    <button
                      type="button"
                      onClick={() => handleBook(doc.name)}
                      className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold uppercase tracking-wider cursor-pointer shadow-xs"
                    >
                      {bookedTherapist === doc.name ? 'Booking Sent ✓' : 'Book Session'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ================= SECTION 2: PEER SUPPORT GROUPS ================= */}
        {(activeSubTab === 'all' || activeSubTab === 'groups') && (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-black uppercase tracking-wider text-[var(--brief-ink)]">
                Free Community Peer Support Circles
              </h3>
              <span className="text-[11px] text-gray-400">100% Free • Non-Judgemental</span>
            </div>

            <div className="space-y-2.5">
              {supportGroups.map(grp => (
                <div 
                  key={grp.id}
                  className="p-3.5 bg-white border border-[var(--brief-line)] rounded-2xl flex items-center justify-between shadow-xs hover:border-[#00BFEF] transition-all"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center space-x-2">
                      <h4 className="font-black text-xs text-[var(--brief-ink)]">{grp.title}</h4>
                      <span className="text-[11px] font-mono px-1.5 py-0.2 rounded bg-cyan-50 text-cyan-700 font-bold">
                        {grp.tag}
                      </span>
                    </div>
                    <p className="text-[12px] text-gray-500">{grp.desc}</p>
                    <div className="flex items-center space-x-3 text-[11px] font-mono text-gray-400 pt-1">
                      <span className="flex items-center space-x-1">
                        <Clock className="w-3 h-3 text-[#40916C]" />
                        <span>{grp.schedule}</span>
                      </span>
                      <span className="flex items-center space-x-1">
                        <MapPin className="w-3 h-3 text-emerald-600" />
                        <span>{grp.location}</span>
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleJoinGroup(grp.title)}
                    className="ml-3 px-4 py-2 rounded-xl bg-[color:var(--brief-ink)] hover:bg-[#1E2633] text-white text-xs font-bold uppercase tracking-wider cursor-pointer whitespace-nowrap shadow-xs"
                  >
                    {joinedGroup === grp.title ? 'Joined ✓' : 'Join Circle'}
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ================= SECTION 3: WELLBEING ACTIVITIES ================= */}
        {(activeSubTab === 'all' || activeSubTab === 'activities') && (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-black uppercase tracking-wider text-[var(--brief-ink)]">
                Community Wellbeing & Movement
              </h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {activities.map(act => (
                <div 
                  key={act.id}
                  className="p-3.5 bg-[color:var(--brief-bg)] border border-[var(--brief-line)] rounded-2xl flex flex-col justify-between shadow-xs"
                >
                  <div>
                    <span className="text-[11px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">
                      {act.tag}
                    </span>
                    <h4 className="font-black text-xs text-[var(--brief-ink)] mt-1.5">{act.title}</h4>
                    <p className="text-[11px] text-gray-500 mt-0.5">{act.schedule} • {act.location}</p>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      soundEngine.play('tap');
                      handleJoinGroup(act.title);
                    }}
                    className="mt-3 w-full py-1.5 rounded-xl bg-white border border-gray-300 hover:border-emerald-500 text-[var(--brief-ink)] font-bold text-xs uppercase cursor-pointer"
                  >
                    {joinedGroup === act.title ? 'Added to Calendar ✓' : 'Interested / Join'}
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

      </div>

    </div>
  );
}
