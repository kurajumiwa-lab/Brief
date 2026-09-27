import React, { useState, useRef, useMemo } from 'react';

// Wanderly Tokyo Guide — editorial magazine + planning tools
// Design: Primary #0D9488 teal, dark #134E4A, accent #F59E0B, light #F0FDFA / #F9FAFB
// Fonts: DM Serif Display for headings (via Google Fonts), Inter for body
// Cards 12px radius, soft shadow, generous photography

const TEAL = '#0D9488';
const DARK_TEAL = '#134E4A';
const AMBER = '#F59E0B';
const LIGHT_TEAL_BG = '#F0FDFA';
const NEUTRAL_BG = '#F9FAFB';

// Unsplash Tokyo images (cinematic, free)
const HERO_IMG = 'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?q=80&w=2000&auto=format&fit=crop'; // Tokyo skyline dusk
const COLLAGE_IMGS = [
  'https://images.unsplash.com/photo-1492571350019-22de08371fd3?q=80&w=800&auto=format&fit=crop', // shrine
  'https://images.unsplash.com/photo-1513407030348-c983a97b98d8?q=80&w=800&auto=format&fit=crop', // street neon
  'https://images.unsplash.com/photo-1578916171728-46686eac8d58?q=80&w=800&auto=format&fit=crop', // sushi
  'https://images.unsplash.com/photo-1533050487297-09b450131914?q=80&w=800&auto=format&fit=crop', // bullet train
];

type Attraction = {
  id: string;
  name: string;
  neighborhood: string;
  desc: string;
  time: string;
  cost: string;
  rating: number;
  cat: 'Culture' | 'Nature' | 'Food' | 'Shopping';
  img: string;
  badge?: string;
};

const ATTRACTIONS: Attraction[] = [
  { id:'sensoji', name:'Senso-ji Temple', neighborhood:'Asakusa', desc:"Tokyo's oldest temple, dating to 645 AD, with the iconic Kaminarimon thunder gate", time:'2-3 hours', cost:'Free', rating:4.8, cat:'Culture', img:'https://images.unsplash.com/photo-1524413840807-0c3cb6fa8d64?q=80&w=800&auto=format&fit=crop', badge:'Must-see' },
  { id:'shibuya', name:'Shibuya Crossing', neighborhood:'Shibuya', desc:'The world\'s busiest pedestrian crossing — up to 3,000 people cross at once', time:'30 min', cost:'Free', rating:4.6, cat:'Culture', img:'https://images.unsplash.com/photo-1542051841857-5f90071e7989?q=80&w=800&auto=format&fit=crop' },
  { id:'tsukiji', name:'Tsukiji Outer Market', neighborhood:'Chuo', desc:'Street food paradise with the freshest sushi, tamagoyaki, and wagyu skewers', time:'2-3 hours', cost:'Free entry', rating:4.9, cat:'Food', img:'https://images.unsplash.com/photo-1579584425555-c3ce17fd4351?q=80&w=800&auto=format&fit=crop' },
  { id:'meiji', name:'Meiji Shrine', neighborhood:'Harajuku', desc:'A serene Shinto shrine surrounded by 170 acres of forest in the heart of the city', time:'1-2 hours', cost:'Free', rating:4.7, cat:'Nature', img:'https://images.unsplash.com/photo-1478436127897-769e1b3f0f36?q=80&w=800&auto=format&fit=crop' },
  { id:'teamlab', name:'TeamLab Borderless', neighborhood:'Odaiba', desc:'An immersive digital art museum with stunning interactive light installations', time:'3-4 hours', cost:'¥3,800', rating:4.8, cat:'Culture', img:'https://images.unsplash.com/photo-1519608487953-e999c86e7455?q=80&w=800&auto=format&fit=crop' },
  { id:'akihabara', name:'Akihabara Electric Town', neighborhood:'Akihabara', desc:'Neon-drenched district for anime, manga, retro games, and electronics', time:'3-4 hours', cost:'Free', rating:4.5, cat:'Shopping', img:'https://images.unsplash.com/photo-1513407030348-c983a97b98d8?q=80&w=800&auto=format&fit=crop' },
];

const ITINERARIES = {
  '3': {
    label:'3 Days — Highlights',
    badge:'Most Popular',
    days:[
      { d:1, title:'Tradition & Future', items:[
        { t:'09:00', icon:'🏯', name:'Senso-ji Temple', note:'Morning prayers, Nakamise mochi', img:'https://images.unsplash.com/photo-1524413840807-0c3cb6fa8d64?q=80&w=200&auto=format&fit=crop'},
        { t:'12:00', icon:'🗼', name:'Tokyo Skytree', note:'Lunch with city panorama (350m)'},
        { t:'15:00', icon:'🎮', name:'Akihabara', note:'Retro arcades & duty-free electronics'},
        { t:'19:30', icon:'🍜', name:'Ramen in Shinjuku', note:'Golden Gai alley → Ichiran'},
      ]},
      { d:2, title:'Harajuku to Shibuya', items:[
        { t:'09:00', icon:'⛩️', name:'Meiji Shrine', note:'Forest walk, iris garden'},
        { t:'11:00', icon:'🛍️', name:'Harajuku Takeshita', note:'Crepes & vintage'},
        { t:'14:00', icon:'🚶', name:'Shibuya Crossing', note:'Hachiko, Shibuya Sky 47F'},
        { t:'19:00', icon:'🍶', name:'Izakaya Crawl', note:'Nonbei Yokocho, yakitori'},
      ]},
      { d:3, title:'Market & Palace', items:[
        { t:'08:00', icon:'🍣', name:'Tsukiji Outer Market', note:'Breakfast: sashimi & tamagoyaki'},
        { t:'11:00', icon:'👜', name:'Ginza', note:'Department stores & art galleries'},
        { t:'14:30', icon:'🏯', name:'Imperial Palace Gardens', note:'East Gardens, cherry moat'},
        { t:'18:00', icon:'🌃', name:'Roppongi Hills', note:'City night views, Mori Tower'},
      ]},
    ]
  },
  '5': {
    label:'5 Days — Deep Dive',
    badge:null,
    days:[
      { d:1, title:'Tradition & Future', items:[{t:'09:00',icon:'🏯',name:'Senso-ji',note:'Asakusa morning'}, {t:'19:30',icon:'🍜',name:'Shinjuku Ramen',note:'Memory Lane'}]},
      { d:2, title:'Harajuku to Shibuya', items:[{t:'09:00',icon:'⛩️',name:'Meiji Shrine',note:'Forest'}, {t:'14:00',icon:'🚶',name:'Shibuya Crossing',note:'Sky deck'}]},
      { d:3, title:'Markets & Ginza', items:[{t:'08:00',icon:'🍣',name:'Tsukiji',note:'Outer market'}, {t:'11:00',icon:'👜',name:'Ginza',note:'Shopping'}]},
      { d:4, title:'Day Trip Kamakura', items:[{t:'08:30',icon:'🚃',name:'Kamakura',note:'Big Buddha, bamboo'}, {t:'15:00',icon:'👖',name:'Shimokitazawa',note:'Vintage shopping'}]},
      { d:5, title:'Odaiba & Sumo', items:[{t:'10:00',icon:'💡',name:'TeamLab Borderless',note:'Odaiba'}, {t:'15:00',icon:'🤼',name:'Sumo Tournament',note:'Ryogoku Kokugikan (seasonal)'}]},
    ]
  },
  '7': {
    label:'7 Days — Complete Tokyo',
    badge:null,
    days:[
      { d:1, title:'Asakusa & Akihabara', items:[{t:'09:00',icon:'🏯',name:'Senso-ji',note:'Nakamise Street'}, {t:'15:00',icon:'🎮',name:'Akihabara',note:'Electric Town'}]},
      { d:2, title:'Harajuku & Shibuya', items:[{t:'09:00',icon:'⛩️',name:'Meiji Shrine',note:'170 acres forest'}, {t:'19:00',icon:'🍶',name:'Izakaya',note:'Shibuya'}]},
      { d:3, title:'Tsukiji & Ginza', items:[{t:'08:00',icon:'🍣',name:'Tsukiji Outer Market',note:'Food stalls'}, {t:'14:30',icon:'🏯',name:'Palace Gardens',note:'East Gardens'}]},
      { d:4, title:'Kamakura Day Trip', items:[{t:'08:30',icon:'🚃',name:'Kamakura',note:'Coastal temples'}, {t:'15:00',icon:'👗',name:'Shimokitazawa',note:'Thrift & cafes'}]},
      { d:5, title:'Odaiba & TeamLab', items:[{t:'10:00',icon:'✨',name:'TeamLab',note:'Digital art'}, {t:'15:00',icon:'🏖️',name:'Odaiba',note:'Bay views'}]},
      { d:6, title:'Hakone / Mt Fuji', items:[{t:'07:00',icon:'🗻',name:'Hakone / Mt Fuji',note:'Ropeway, onsen, Fuji views'}, {t:'19:00',icon:'♨️',name:'Ryokan Stay',note:'Kaiseki dinner'}]},
      { d:7, title:'Yanaka & Ueno', items:[{t:'09:00',icon:'🏘️',name:'Yanaka Old Town',note:'Shitamachi, galleries'}, {t:'11:30',icon:'🐟',name:'Toyosu Auction',note:'Fish market (lottery)'} ,{t:'14:00',icon:'🏛️',name:'Ueno Museums',note:'National Museum, park'}]},
    ]
  },
} as const;

const NEIGHBORHOODS = [
  { id:'shinjuku', name:'Shinjuku', desc:'Central hub with great transport links, nightlife, and department stores', price:'From $120/night', best:'First-timers', img:'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?q=80&w=800&auto=format&fit=crop', transit:'🚇 Shinjuku Sta: 3 min · JR Yamanote' },
  { id:'shibuya', name:'Shibuya', desc:'Young, trendy, and walkable with great dining and shopping', price:'From $100/night', best:'Couples & nightlife', img:'https://images.unsplash.com/photo-1542051841857-5f90071e7989?q=80&w=800&auto=format&fit=crop', transit:'🚇 Shibuya Sta: 2 min · Hachiko Exit' },
  { id:'asakusa', name:'Asakusa', desc:'Traditional atmosphere near Senso-ji with budget-friendly options', price:'From $65/night', best:'Culture lovers & budget travelers', img:'https://images.unsplash.com/photo-1524413840807-0c3cb6fa8d64?q=80&w=800&auto=format&fit=crop', transit:'🚇 Asakusa Sta: 1 min · Ginza Line' },
];

const TIPS = [
  { icon:'💳', text:'Get a Suica or Pasmo IC card for seamless subway and convenience store payments' },
  { icon:'🚇', text:'Avoid rush hour (7:30–9:30 AM) on the subway — it\'s extremely crowded' },
  { icon:'🍜', text:'Slurping noodles is polite — it shows you\'re enjoying the meal' },
  { icon:'🏪', text:'7-Eleven and Lawson convenience stores have surprisingly excellent food' },
  { icon:'👟', text:'Wear slip-on shoes — you\'ll remove them frequently at temples and restaurants' },
  { icon:'📶', text:'Rent a pocket WiFi at the airport — coverage is fast and reliable everywhere' },
  { icon:'🗑️', text:'Public trash cans are rare — carry a small bag for your waste' },
  { icon:'💴', text:'Japan is still very cash-based — carry yen, especially outside tourist areas' },
];

const MONTHS = [
  { m:'Jan', temp:'5-10°', rain:48, color:'#3B82F6', label:'Cold' },
  { m:'Feb', temp:'6-11°', rain:56, color:'#3B82F6', label:'Cold' },
  { m:'Mar', temp:'10-15°', rain:118, color:'#10B981', label:'Best' },
  { m:'Apr', temp:'12-19°', rain:125, color:'#10B981', label:'Best' },
  { m:'May', temp:'17-22°', rain:138, color:'#10B981', label:'Best' },
  { m:'Jun', temp:'20-25°', rain:168, color:'#F59E0B', label:'Hot/Rainy' },
  { m:'Jul', temp:'25-30°', rain:154, color:'#F59E0B', label:'Hot/Rainy' },
  { m:'Aug', temp:'26-31°', rain:168, color:'#F59E0B', label:'Hot/Rainy' },
  { m:'Sep', temp:'22-27°', rain:210, color:'#F59E0B', label:'Hot/Rainy' },
  { m:'Oct', temp:'16-22°', rain:198, color:'#10B981', label:'Best' },
  { m:'Nov', temp:'11-17°', rain:93, color:'#10B981', label:'Best' },
  { m:'Dec', temp:'7-12°', rain:51, color:'#FCD34D', label:'Good' },
];

// --- Organizer Photo Studio types ---
type Hobby = 'Culture' | 'Food' | 'Nature' | 'Shopping' | 'Gaming';
type PriceLike = '$' | '$$' | '$$$' | '$$$$';

export const TokyoGuide: React.FC = () => {
  const [attractionFilter, setAttractionFilter] = useState<'All'|'Culture'|'Nature'|'Food'|'Shopping'>('All');
  const [itineraryTab, setItineraryTab] = useState<'3'|'5'|'7'>('3');
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [showToast, setShowToast] = useState<string|null>(null);

  // Organizer studio state
  const [viewerRole, setViewerRole] = useState<'customer'|'creator'>('creator');
  const [hobby, setHobby] = useState<Hobby>('Culture');
  const [priceLike, setPriceLike] = useState<PriceLike>('$$');
  const [referralDest, setReferralDest] = useState('');
  const [coverPhoto, setCoverPhoto] = useState<string|null>(null);
  const [gallery, setGallery] = useState<string[]>([]);
  const [lightbox, setLightbox] = useState<string|null>(null);
  const [outflow, setOutflow] = useState<number>(18500); // JPY tethered outflow demo
  const fileInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const triggerToast = (msg:string)=>{ setShowToast(msg); setTimeout(()=>setShowToast(null),2600); };

  const filteredAttractions = useMemo(()=> ATTRACTIONS.filter(a=> attractionFilter==='All' || a.cat===attractionFilter),[attractionFilter]);

  const toggleSave = (id:string)=>{
    const next = new Set(saved);
    if(next.has(id)) next.delete(id); else next.add(id);
    setSaved(next);
    triggerToast(next.has(id) ? 'Saved to your list ♥' : 'Removed from saved');
  };

  const handleCoverUpload = (e:React.ChangeEvent<HTMLInputElement>)=>{
    const f = e.target.files?.[0];
    if(!f) return;
    const url = URL.createObjectURL(f);
    setCoverPhoto(url);
    triggerToast('Cover photo set — this is your listing thumbnail');
  };
  const handleGalleryUpload = (e:React.ChangeEvent<HTMLInputElement>)=>{
    const files = Array.from(e.target.files || []);
    if(files.length===0) return;
    const urls = files.map(f=>URL.createObjectURL(f));
    setGallery(prev=> [...prev, ...urls].slice(0,12));
    triggerToast(`${files.length} photo(s) added to gallery`);
  };
  const removeGallery = (idx:number)=>{
    setGallery(g=> g.filter((_,i)=>i!==idx));
  };

  const referralBonus = useMemo(()=>{
    if(!referralDest.trim()) return 0;
    const base = hobby==='Gaming'? 3200 : hobby==='Food'? 2800 : 2400;
    const priceMult = priceLike==='$'?1 : priceLike==='$$'?1.4 : priceLike==='$$$'?1.8 : 2.2;
    return Math.round(base * priceMult);
  },[referralDest, hobby, priceLike]);

  const minPhotosMet = coverPhoto !== null && gallery.length >= 2; // total 3+
  const canPublish = minPhotosMet;

  return (
    <div className="min-h-screen bg-white" style={{ fontFamily:'Inter, system-ui, -apple-system, sans-serif' }}>
      {/* Google Fonts */}
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=Inter:wght@400;500;600;700;800&display=swap');`}</style>

      {/* TOAST */}
      {showToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[80] px-4 py-3 rounded-xl text-white text-sm font-semibold shadow-xl" style={{ background: DARK_TEAL }}>
          {showToast}
        </div>
      )}

      {/* LIGHTBOX */}
      {lightbox && (
        <div className="fixed inset-0 z-[90] bg-black/85 grid place-items-center p-6" onClick={()=>setLightbox(null)}>
          <img src={lightbox} alt="Gallery full" className="max-w-[92vw] max-h-[88vh] rounded-xl object-contain" />
          <button className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white text-black grid place-items-center font-bold" onClick={()=>setLightbox(null)}>✕</button>
          <p className="absolute bottom-6 text-white/70 text-xs">Viewed once • Tap to close</p>
        </div>
      )}

      {/* NAVIGATION BAR — sticky */}
      <header className="sticky top-0 z-40 bg-white border-b border-black/5" style={{ boxShadow:'0 1px 12px rgba(0,0,0,0.06)'}}>
        <div className="max-w-[1240px] mx-auto px-4 sm:px-6 h-[64px] flex items-center justify-between gap-6">
          <div className="flex items-center gap-8">
            <a href="#" className="flex items-center gap-2.5 shrink-0">
              <span className="w-9 h-9 rounded-xl grid place-items-center text-white" style={{ background: TEAL }}>
                {/* Compass rose */}
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <circle cx="12" cy="12" r="3.5" stroke="white" strokeWidth="1.8"/>
                  <path d="M12 2.8L13.6 7.2 18 8.8 13.6 10.4 12 14.8 10.4 10.4 6 8.8 10.4 7.2z" fill="white" opacity="0.95"/>
                  <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5.2 5.2l2.1 2.1M16.7 16.7l2.1 2.1M18.8 5.2l-2.1 2.1M5.2 18.8l2.1-2.1" stroke="white" strokeWidth="1.2" strokeLinecap="round"/>
                </svg>
              </span>
              <span className="font-black tracking-tight text-[19px]" style={{ fontFamily:'DM Serif Display, serif', color:'#0F172A' }}>Wanderly</span>
            </a>
            <nav className="hidden lg:flex items-center gap-6 text-[14px] font-medium text-[#475569]">
              <a href="#" className="hover:text-[#0F172A]">Destinations</a>
              <a href="#" className="hover:text-[#0F172A]">Trip Styles</a>
              <a href="#" className="hover:text-[#0F172A]">Deals</a>
              <a href="#" className="hover:text-[#0F172A]">About Us</a>
              <a href="#" className="hover:text-[#0F172A]">Blog</a>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={()=>triggerToast('Planning flow coming soon')} className="hidden sm:inline-flex items-center justify-center px-5 h-10 rounded-full text-white text-[14px] font-bold" style={{ background: TEAL }}>Plan My Trip</button>
            <button className="lg:hidden w-10 h-10 rounded-full bg-neutral-100 grid place-items-center">☰</button>
          </div>
        </div>
        {/* Breadcrumb */}
        <div className="max-w-[1240px] mx-auto px-4 sm:px-6 py-2.5 text-[13px] text-[#64748B] flex items-center gap-2 border-t border-black/[0.04]">
          <a href="#" className="hover:underline">Home</a><span>→</span><a href="#" className="hover:underline">Destinations</a><span>→</span><a href="#" className="hover:underline">Asia</a><span>→</span><span className="font-semibold text-[#0F172A]">Tokyo, Japan</span>
        </div>
      </header>

      {/* HERO 70vh */}
      <section className="relative" style={{ height:'70vh', minHeight: 520 }}>
        <img src={HERO_IMG} alt="Tokyo skyline at dusk with Mount Fuji and neon" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0" style={{ background:`linear-gradient(to top, rgba(19,78,74,0.88) 0%, rgba(19,78,74,0.55) 34%, rgba(0,0,0,0.18) 62%, transparent 100%)`}} />
        <div className="absolute inset-0 flex items-end">
          <div className="max-w-[1240px] w-full mx-auto px-4 sm:px-6 pb-8 sm:pb-10">
            <div className="max-w-[760px]">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/15 backdrop-blur text-white text-sm font-semibold border border-white/20">
                <span>🇯🇵</span> Japan
              </div>
              <h1 className="mt-3 text-white text-[48px] sm:text-[64px] font-normal leading-[0.9] tracking-tight" style={{ fontFamily:'DM Serif Display, serif'}}>Tokyo</h1>
              <p className="mt-3 text-white/90 text-[18px] sm:text-[20px] font-medium">Where ancient temples meet neon-lit streets</p>
              <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-white/90 text-[13px] font-medium">
                <span className="inline-flex items-center gap-1.5">✈️ 14h from NYC</span><span className="opacity-40">·</span>
                <span className="inline-flex items-center gap-1.5">🌡️ Best: Mar–May, Oct–Nov</span><span className="opacity-40">·</span>
                <span className="inline-flex items-center gap-1.5">💴 $$$ Moderate</span><span className="opacity-40">·</span>
                <span className="inline-flex items-center gap-1.5">🗣️ Japanese</span>
              </div>
              <button onClick={()=>document.getElementById('overview')?.scrollIntoView({behavior:'smooth'})} className="mt-6 inline-flex items-center px-6 h-[44px] rounded-full text-white font-bold text-[14px]" style={{ background: TEAL }}>Start Planning →</button>
            </div>
          </div>
        </div>
      </section>

      {/* MAIN GRID: sidebar + content */}
      <div className="max-w-[1240px] mx-auto px-4 sm:px-6 py-8 grid lg:grid-cols-[340px_1fr] gap-8">
        {/* SIDEBAR */}
        <aside className="lg:sticky lg:top-[112px] h-fit">
          {/* Mobile collapsible */}
          <button onClick={()=>setMobileSidebarOpen(v=>!v)} className="lg:hidden w-full flex items-center justify-between px-4 py-3 rounded-xl border border-black/10 bg-white font-bold text-sm">
            <span>At a Glance — Quick facts</span><span>{mobileSidebarOpen?'−':'+'}</span>
          </button>
          <div className={`${mobileSidebarOpen ? 'block' : 'hidden'} lg:block mt-3 lg:mt-0`}>
            <div className="rounded-xl bg-white border border-black/5 p-5" style={{ borderRadius:12, boxShadow:'0 8px 32px rgba(16,24,40,0.08)'}}>
              <h3 className="font-bold text-[13px] tracking-widest uppercase" style={{ color:DARK_TEAL }}>At a Glance</h3>
              <div className="mt-4 space-y-3 text-[13px] leading-5">
                {[
                  ['Currency', 'Japanese Yen (¥)'],
                  ['Language', 'Japanese (English widely understood in tourist areas)'],
                  ['Time Zone', 'JST (UTC+9)'],
                  ['Visa', '90-day visa-free for US/EU citizens'],
                  ['Plug Type', 'Type A (US-compatible)'],
                  ['Tipping', 'Not customary'],
                  ['Safety Rating', '★★★★★ "Very Safe"'],
                ].map(([k,v])=>(
                  <div key={k} className="flex gap-3 justify-between border-b border-black/5 pb-3 last:border-0">
                    <span className="font-semibold text-[#334155] whitespace-nowrap">{k}</span>
                    <span className="text-right text-[#475569]">{v}</span>
                  </div>
                ))}
              </div>
              <button onClick={()=>triggerToast('PDF downloaded (demo)')} className="mt-5 w-full h-11 rounded-xl font-bold text-sm border" style={{ borderColor:TEAL, color:TEAL }}>Download PDF Guide</button>
              <button onClick={()=>triggerToast('Booking flow opens — Tokyo saved!')} className="mt-3 w-full h-11 rounded-xl font-bold text-sm text-white" style={{ background:TEAL }}>Book This Destination</button>
              <p className="mt-3 text-center text-[11px] text-[#94A3B8]">Free cancellation · Expert support 24/7</p>
            </div>

            {/* Referral mini card */}
            <div className="mt-4 rounded-xl p-4 text-white" style={{ background:DARK_TEAL }}>
              <p className="text-xs font-bold tracking-widest uppercase opacity-80">Refer & Earn</p>
              <p className="mt-1 text-sm font-semibold">Point a friend to Tokyo → get <span style={{ color: AMBER }}>¥{referralBonus.toLocaleString()} extra cash</span> when they book.</p>
              <p className="mt-1 text-xs opacity-70">Hobby: {hobby} · Price: {priceLike} · Minimum 3 photos required</p>
            </div>
          </div>
        </aside>

        {/* CONTENT */}
        <div className="space-y-12 min-w-0">
          {/* OVERVIEW */}
          <section id="overview" className="scroll-mt-28">
            <h2 className="text-[28px] font-normal" style={{ fontFamily:'DM Serif Display, serif', color:'#0F172A' }}>A city of endless contrast</h2>
            <div className="mt-5 grid md:grid-cols-[60%_40%] gap-6 md:gap-8 items-start">
              <div className="space-y-5">
                <p className="text-[15.5px] leading-7 text-[#334155]">
                  Tokyo is a city of contrasts — a place where centuries-old shrines sit in the shadow of soaring skyscrapers, where Michelin-starred sushi bars share streets with bustling ramen stalls, and where cutting-edge technology coexists with deeply rooted tradition. With 14 million residents, the world's largest metropolitan area offers endless discovery.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    ['🏯','38,000+ temples & shrines'],
                    ['🍣','More Michelin stars than any city on Earth'],
                    ['🚄','Bullet trains at 200mph'],
                    ['🌸','Cherry blossom season (late March)'],
                    ['🎮','Global capital of gaming & anime'],
                    ['🛍️','Shopping districts for every style'],
                  ].map(([icon,label])=>(
                    <div key={label} className="rounded-xl bg-white border border-black/5 p-3 flex gap-3 items-center" style={{ borderRadius:12 }}>
                      <span className="w-10 h-10 rounded-xl grid place-items-center text-lg shrink-0" style={{ background: LIGHT_TEAL_BG }}>{icon}</span>
                      <span className="text-[13px] font-semibold leading-4 text-[#0F172A]">{label}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <img src={COLLAGE_IMGS[0]} alt="Temple" className="rounded-xl object-cover h-[170px] w-full col-span-2" style={{ borderRadius:12 }} />
                <img src={COLLAGE_IMGS[1]} alt="Neon street" className="rounded-xl object-cover h-[130px] w-full" style={{ borderRadius:12 }} />
                <img src={COLLAGE_IMGS[2]} alt="Sushi" className="rounded-xl object-cover h-[130px] w-full" style={{ borderRadius:12 }} />
              </div>
            </div>
          </section>

          {/* MUST-SEE ATTRACTIONS */}
          <section id="attractions" className="scroll-mt-28">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <h2 className="text-[26px] font-normal" style={{ fontFamily:'DM Serif Display, serif', color:'#0F172A' }}>Must-See Attractions</h2>
              <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                {(['All','Culture','Nature','Food','Shopping'] as const).map(tab=>(
                  <button key={tab} onClick={()=>setAttractionFilter(tab)} className={`shrink-0 px-4 h-8 rounded-full text-sm font-semibold border ${attractionFilter===tab?'text-white border-transparent':'bg-white text-[#475569] border-black/10'}`} style={attractionFilter===tab?{background:TEAL}:{}}>{tab}</button>
                ))}
              </div>
            </div>

            <div className="mt-5 grid sm:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-5 [@media(max-width:768px)]:flex [@media(max-width:768px)]:overflow-x-auto [@media(max-width:768px)]:snap-x [@media(max-width:768px)]:pb-2">
              {filteredAttractions.map(card=>(
                <article key={card.id} className="group relative rounded-xl overflow-hidden bg-white border border-black/5 shrink-0 [@media(max-width:768px)]:w-[280px] [@media(max-width:768px)]:snap-start" style={{ borderRadius:12, boxShadow:'0 6px 24px rgba(16,24,40,0.06)'}}>
                  <div className="relative h-[190px] overflow-hidden">
                    <img src={card.img} alt={card.name} className="w-full h-full object-cover group-hover:scale-[1.03] transition duration-500" />
                    <button onClick={()=>toggleSave(card.id)} aria-label="Save" className="absolute top-3 right-3 w-9 h-9 rounded-full bg-white/90 backdrop-blur grid place-items-center text-lg shadow">
                      <span style={{ color: saved.has(card.id)? '#EF4444':'#64748B' }}>{saved.has(card.id)?'♥':'♡'}</span>
                    </button>
                    <span className="absolute left-3 bottom-3 px-2.5 py-1 rounded-full bg-black/60 backdrop-blur text-white text-[11px] font-bold tracking-wide">{card.neighborhood}</span>
                    {card.badge && <span className="absolute left-3 top-3 px-2.5 py-1 rounded-full text-white text-[11px] font-black" style={{ background: AMBER }}>{card.badge}</span>}
                  </div>
                  <div className="p-4">
                    <h3 className="font-bold text-[15px] leading-5" style={{ color:'#0F172A', fontFamily:'DM Serif Display, serif' }}>{card.name}</h3>
                    <p className="mt-1.5 text-[13px] leading-5 text-[#475569] line-clamp-2">{card.desc}</p>
                    <div className="mt-3 flex items-center gap-3 text-[12px] text-[#64748B]">
                      <span>⏱️ {card.time}</span><span>·</span><span>{card.cost}</span>
                    </div>
                    <div className="mt-2 flex items-center gap-1.5 text-[12px] font-bold">
                      <span className="text-[#F59E0B]">★ {card.rating.toFixed(1)}</span><span className="text-[#94A3B8]">· {card.cat}</span>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>

          {/* ORGANIZER PHOTO STUDIO — satisfies photo requirements */}
          <section id="organizer-studio" className="scroll-mt-28 rounded-2xl border border-teal-100 overflow-hidden" style={{ borderRadius:16, background:'#FFFFFF', boxShadow:'0 12px 32px rgba(13,148,136,0.08)'}}>
            <div className="px-5 sm:px-7 py-6" style={{ background:`linear-gradient(135deg, ${DARK_TEAL} 0%, ${TEAL} 100%)`}}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] tracking-widest font-black text-white/70 uppercase">For Organizers & Creators</p>
                  <h3 className="mt-1 text-white text-[22px] leading-6" style={{ fontFamily:'DM Serif Display, serif'}}>Showcase your Tokyo event — cover + gallery</h3>
                  <p className="mt-1.5 text-white/80 text-[13px] max-w-[620px]">Add photos to advertise the location or post previous trips. Choose a <b className="text-white">cover photo for the listing card</b> and a gallery viewed once selected. We auto-identify <b className="text-white">customer vs creator</b> so outflow stays tethered to the creator.</p>
                </div>
                <div className="flex items-center gap-2 bg-white/10 rounded-full p-1">
                  {(['customer','creator'] as const).map(role=>(
                    <button key={role} onClick={()=>setViewerRole(role)} className={`px-4 h-8 rounded-full text-sm font-bold capitalize ${viewerRole===role?'bg-white text-[#134E4A]':'text-white/90'}`}>{role}</button>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-5 sm:p-7 grid lg:grid-cols-[1.1fr_0.9fr] gap-6">
              {/* Left: photo management */}
              <div className="space-y-5">
                {/* Hobby + Price.like + Referral */}
                <div className="grid sm:grid-cols-3 gap-3">
                  <label className="space-y-1.5">
                    <span className="text-[11px] font-black tracking-widest uppercase text-[#475569]">Hobby *</span>
                    <select value={hobby} onChange={e=>setHobby(e.target.value as Hobby)} className="w-full h-10 rounded-xl border border-black/10 px-3 text-sm bg-white">
                      <option>Culture</option><option>Food</option><option>Nature</option><option>Shopping</option><option>Gaming</option>
                    </select>
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-[11px] font-black tracking-widest uppercase text-[#475569]">Price like *</span>
                    <select value={priceLike} onChange={e=>setPriceLike(e.target.value as PriceLike)} className="w-full h-10 rounded-xl border border-black/10 px-3 text-sm bg-white">
                      <option>$</option><option>$$</option><option>$$$</option><option>$$$$</option>
                    </select>
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-[11px] font-black tracking-widest uppercase text-[#475569]">Refer destination</span>
                    <input value={referralDest} onChange={e=>setReferralDest(e.target.value)} placeholder="e.g., Kyoto, Osaka" className="w-full h-10 rounded-xl border border-black/10 px-3 text-sm" />
                  </label>
                </div>

                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm flex items-center justify-between gap-3">
                  <span className="text-[#92400E]">Extra cash for pointing <b>{referralDest || 'a destination'}</b>: <b style={{ color: DARK_TEAL }}>¥{referralBonus.toLocaleString()}</b> · {hobby} × {priceLike}</span>
                  <span className={`px-2.5 py-1 rounded-full text-xs font-black ${minPhotosMet?'bg-emerald-100 text-emerald-700':'bg-white border text-amber-700'}`}>{minPhotosMet?'✓ Meets minimum':'Need ≥3 photos'}</span>
                </div>

                {/* Cover photo */}
                <div>
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-bold text-[#0F172A]">Cover photo for listing <span className="font-normal text-[#64748B]">(1 required)</span></p>
                    <button onClick={()=>fileInputRef.current?.click()} className="px-4 h-9 rounded-full text-white text-sm font-bold" style={{ background: TEAL }}>{coverPhoto?'Replace cover':'Add cover photo'}</button>
                    <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleCoverUpload} />
                  </div>
                  <div className="mt-3 rounded-xl border-2 border-dashed p-3" style={{ borderColor: coverPhoto? TEAL : '#E2E8F0', background: coverPhoto?'#F0FDFA':'white' }}>
                    {coverPhoto ? (
                      <div className="relative">
                        <img src={coverPhoto} alt="Cover" className="w-full h-[220px] object-cover rounded-xl" />
                        <span className="absolute left-3 top-3 px-2.5 py-1 rounded-full bg-white text-xs font-black">Listing cover</span>
                        <button onClick={()=>setCoverPhoto(null)} className="absolute right-3 top-3 w-8 h-8 rounded-full bg-black/60 text-white grid place-items-center">✕</button>
                      </div>
                    ) : (
                      <div className="h-[140px] grid place-items-center text-center">
                        <div>
                          <p className="text-3xl">🖼️</p>
                          <p className="mt-1 text-sm font-semibold text-[#334155]">No cover yet — this is what travelers see in the card grid.</p>
                          <p className="text-xs text-[#64748B]">JPG/PNG, min 1200×800 recommended</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Gallery */}
                <div>
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-bold text-[#0F172A]">Gallery <span className="font-normal text-[#64748B]">(≥2 photos, viewed once selected)</span></p>
                    <button onClick={()=>galleryInputRef.current?.click()} className="px-4 h-9 rounded-full bg-white border text-sm font-bold" style={{ borderColor: TEAL, color: TEAL }}>Add gallery photos</button>
                    <input ref={galleryInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleGalleryUpload} />
                  </div>
                  <div className="mt-3">
                    {gallery.length===0 ? (
                      <div className="rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 h-[120px] grid place-items-center text-sm text-[#64748B]">No gallery yet — add previous trips or location shots.</div>
                    ) : (
                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                        {gallery.map((src,idx)=>(
                          <div key={idx} className="relative group">
                            <img src={src} onClick={()=>setLightbox(src)} alt={`Gallery ${idx+1}`} className="h-[110px] w-full object-cover rounded-xl cursor-pointer border border-black/5" />
                            <button onClick={()=>removeGallery(idx)} className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-white border shadow grid place-items-center text-xs">✕</button>
                            <span className="absolute bottom-1 left-1 px-2 py-0.5 rounded-full bg-black/60 text-white text-[10px] font-bold">#{idx+1}</span>
                            <span className="absolute inset-0 rounded-xl ring-2 ring-transparent group-hover:ring-teal-400/40 pointer-events-none" />
                          </div>
                        ))}
                      </div>
                    )}
                    <p className="mt-2 text-xs text-[#64748B]">Tap a gallery image → lightbox (gallery viewed once selected). Cover stays as the card thumbnail.</p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <button disabled={!canPublish} onClick={()=>triggerToast(viewerRole==='creator'? `Published! Outflow tethered: ¥${outflow.toLocaleString()} (creator)` : 'Saved as traveler — outflow not tethered (customer)')} className={`flex-1 h-11 rounded-xl font-bold text-sm text-white ${canPublish?'':'opacity-40 cursor-not-allowed'}`} style={{ background: TEAL }}>
                    {viewerRole==='creator' ? 'Publish as Creator (tether outflow)' : 'Save as Customer (no outflow)'}
                  </button>
                  <span className="text-xs text-[#64748B]">{gallery.length+ (coverPhoto?1:0)}/3 min</span>
                </div>
                {!canPublish && <p className="text-xs text-amber-700">Must provide minimum photos data for selected price ({priceLike}) & hobby ({hobby}) to publish and unlock extra cash.</p>}
              </div>

              {/* Right: outflow + preview */}
              <div className="space-y-4">
                <div className="rounded-xl border border-black/5 p-4 bg-white">
                  <p className="text-xs font-black tracking-widest uppercase" style={{ color: DARK_TEAL }}>Identity & Outflow</p>
                  <div className="mt-3 flex items-center gap-3">
                    <span className={`px-3 py-1.5 rounded-full text-xs font-black ${viewerRole==='creator'?'bg-emerald-100 text-emerald-700':'bg-slate-100 text-slate-600'}`}>{viewerRole==='creator' ? 'Creator (organizer)' : 'Customer (traveler)'}</span>
                    <span className="text-xs text-[#64748B]">Outflow {viewerRole==='creator' ? 'tethered to creator' : 'not tethered'}</span>
                  </div>
                  {viewerRole==='creator' ? (
                    <div className="mt-4 rounded-xl p-4" style={{ background: LIGHT_TEAL_BG, border:'1px solid #CCFBF1' }}>
                      <p className="text-xs font-bold text-[#134E4A]">Creator outflow (tethered)</p>
                      <p className="mt-1 text-2xl font-black" style={{ color: DARK_TEAL }}>¥{outflow.toLocaleString()}</p>
                      <input type="range" min={5000} max={50000} step={500} value={outflow} onChange={e=>setOutflow(Number(e.target.value))} className="w-full mt-3" />
                      <p className="mt-1 text-xs text-[#475569]">Adjust event cost — stays linked to creator wallet, not customer.</p>
                    </div>
                  ) : (
                    <div className="mt-4 rounded-xl p-4 bg-slate-50 border text-sm text-[#475569]">Customers browse & save — no outflow. Only creators publish & spend.</div>
                  )}
                </div>

                <div className="rounded-xl overflow-hidden border border-black/5 bg-white">
                  <p className="px-4 pt-4 text-xs font-black tracking-widest uppercase" style={{ color: DARK_TEAL }}>Listing preview (as travelers see it)</p>
                  <div className="p-4">
                    <div className="rounded-xl overflow-hidden border border-black/5" style={{ borderRadius:12 }}>
                      <div className="h-[160px] bg-slate-100 relative">
                        {coverPhoto ? <img src={coverPhoto} alt="Preview cover" className="w-full h-full object-cover" /> : <span className="absolute inset-0 grid place-items-center text-[#94A3B8] text-sm">No cover — add one</span>}
                        {coverPhoto && gallery.length>0 && <span className="absolute right-2 bottom-2 px-2 py-1 rounded-full bg-black/60 text-white text-xs">+{gallery.length} photos</span>}
                      </div>
                      <div className="p-3">
                        <p className="text-sm font-bold" style={{ fontFamily:'DM Serif Display, serif'}}> {referralDest ? `Tokyo — ${hobby} Highlight` : 'Tokyo Highlight'} · {priceLike} · {hobby}</p>
                        <p className="text-xs text-[#64748B]">By {viewerRole==='creator' ? 'You (creator)' : 'Wanderly organizer franchu'} · ¥{outflow.toLocaleString()} outflow</p>
                      </div>
                    </div>
                    <p className="mt-3 text-xs text-[#64748B]">Gallery is not shown in the card — tap to view once selected → lightbox.</p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* SAMPLE ITINERARIES */}
          <section id="itineraries" className="scroll-mt-28">
            <h2 className="text-[26px] font-normal" style={{ fontFamily:'DM Serif Display, serif', color:'#0F172A' }}>Sample Itineraries</h2>
            <div className="mt-4 flex gap-2 overflow-x-auto no-scrollbar pb-1">
              {(['3','5','7'] as const).map(k=>(
                <button key={k} onClick={()=>setItineraryTab(k)} className={`shrink-0 px-5 h-10 rounded-full text-sm font-bold border relative ${itineraryTab===k?'text-white border-transparent':'bg-white text-[#475569] border-black/10'}`} style={itineraryTab===k?{background:TEAL}:{}}>
                  {ITINERARIES[k].label}
                  {ITINERARIES[k].badge && <span className="ml-2 px-2 py-0.5 rounded-full text-[10px] font-black bg-white" style={{ color: TEAL }}>{ITINERARIES[k].badge}</span>}
                </button>
              ))}
            </div>
            <div className="mt-5 space-y-6">
              {ITINERARIES[itineraryTab].days.map(day=>(
                <div key={day.d} className="rounded-xl bg-white border border-black/5 overflow-hidden" style={{ borderRadius:12 }}>
                  <div className="px-5 py-3 flex items-center justify-between" style={{ background: NEUTRAL_BG }}>
                    <h3 className="font-bold text-sm" style={{ color: DARK_TEAL }}>Day {day.d}: {day.title}</h3>
                    <span className="text-xs text-[#64748B]">{day.items.length} stops</span>
                  </div>
                  <div className="p-5 grid gap-3">
                    {day.items.map((it, idx)=>(
                      <div key={idx} className="flex gap-3">
                        <div className="flex flex-col items-center">
                          <span className="w-8 h-8 rounded-full grid place-items-center text-sm shrink-0" style={{ background: LIGHT_TEAL_BG }}>{it.icon}</span>
                          {idx < day.items.length-1 && <span className="w-px flex-1 bg-slate-200 mt-1" style={{ minHeight:12 }} />}
                        </div>
                        <div className="flex-1 pb-3 flex gap-3">
                          <div className="flex-1">
                            <p className="text-xs font-bold tracking-wide text-[#0F172A]">{it.t} · {it.name}</p>
                            <p className="text-[13px] text-[#475569]">{(it as any).note}</p>
                          </div>
                          {(it as any).img && <img src={(it as any).img} alt={it.name} className="w-20 h-14 rounded-lg object-cover shrink-0 border border-black/5" />}
                        </div>
                      </div>
                    ))}
                    <p className="text-xs text-[#64748B]">🍱 Meal tip: convenience store onigiri for lunch, kaiseki for dinner — keep shoes slip-on.</p>
                  </div>
                </div>
              ))}
              <button onClick={()=>triggerToast('Itinerary customizer opened')} className="w-full sm:w-auto px-6 h-11 rounded-xl font-bold text-sm text-white" style={{ background: TEAL }}>Customize This Itinerary →</button>
            </div>
          </section>

          {/* WHERE TO STAY */}
          <section id="stay" className="scroll-mt-28">
            <div className="flex items-end justify-between gap-4">
              <h2 className="text-[26px] font-normal" style={{ fontFamily:'DM Serif Display, serif', color:'#0F172A' }}>Best Neighborhoods to Stay</h2>
              <a href="#" onClick={e=>{e.preventDefault(); triggerToast('All hotels — filtered to Tokyo');}} className="hidden sm:inline text-sm font-bold" style={{ color: TEAL }}>View All Hotels →</a>
            </div>
            <div className="mt-5 grid md:grid-cols-3 gap-5">
              {NEIGHBORHOODS.map(n=>(
                <article key={n.id} className="rounded-xl overflow-hidden bg-white border border-black/5" style={{ borderRadius:12, boxShadow:'0 6px 24px rgba(16,24,40,0.06)'}}>
                  <img src={n.img} alt={n.name} className="h-[180px] w-full object-cover" />
                  <div className="p-4 space-y-2">
                    <h3 className="font-bold text-[16px]" style={{ fontFamily:'DM Serif Display, serif', color:'#0F172A' }}>{n.name}</h3>
                    <p className="text-[13px] leading-5 text-[#475569]">{n.desc}</p>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="px-2.5 py-1 rounded-full font-bold text-white" style={{ background: TEAL }}>{n.price}</span>
                      <span className="px-2.5 py-1 rounded-full font-bold" style={{ background: LIGHT_TEAL_BG, color: DARK_TEAL }}>{n.best}</span>
                    </div>
                    <p className="text-[12px] text-[#64748B]">{n.transit}</p>
                  </div>
                </article>
              ))}
            </div>
            <a href="#" onClick={e=>{e.preventDefault(); triggerToast('All hotels');}} className="sm:hidden mt-3 inline-block text-sm font-bold" style={{ color: TEAL }}>View All Hotels →</a>
          </section>

          {/* LOCAL TIPS */}
          <section id="tips" className="rounded-2xl p-6 sm:p-8" style={{ background: LIGHT_TEAL_BG }}>
            <h2 className="text-[22px] font-normal" style={{ fontFamily:'DM Serif Display, serif', color:'#0F172A' }}>Insider Tips from Our Travel Experts</h2>
            <div className="mt-4 grid sm:grid-cols-2 gap-3">
              {TIPS.map(t=>(
                <div key={t.text} className="flex gap-3 items-start rounded-xl bg-white p-3.5 border border-black/5">
                  <span className="text-lg leading-none w-8 h-8 rounded-xl grid place-items-center shrink-0" style={{ background: NEUTRAL_BG }}>{t.icon}</span>
                  <p className="text-[13px] leading-5 text-[#334155]">{t.text}</p>
                </div>
              ))}
            </div>
          </section>

          {/* WEATHER & BEST TIME */}
          <section id="weather" className="scroll-mt-28">
            <h2 className="text-[26px] font-normal" style={{ fontFamily:'DM Serif Display, serif', color:'#0F172A' }}>Weather & Best Time to Visit</h2>
            <div className="mt-4 overflow-x-auto no-scrollbar pb-2">
              <div className="min-w-[760px] grid grid-cols-12 gap-2">
                {MONTHS.map(m=>(
                  <div key={m.m} className="rounded-xl overflow-hidden border border-black/5 bg-white text-center">
                    <div className="h-1.5 w-full" style={{ background: m.color }} />
                    <p className="mt-2 text-xs font-black" style={{ color:'#0F172A'}}>{m.m}</p>
                    <p className="text-[11px] text-[#64748B]">{m.temp}</p>
                    <div className="mx-2 my-2 h-[56px] flex items-end justify-center">
                      <div className="w-7 rounded-full" style={{ height: `${18 + (m.rain/210)*36}px`, background: m.color, opacity:0.85 }} />
                    </div>
                    <p className="text-[10px] font-bold pb-2" style={{ color: m.color }}>{m.label}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-4 grid md:grid-cols-3 gap-3 text-[13px] leading-5">
              <div className="rounded-xl p-4 border" style={{ borderColor:'#A7F3D0', background:'#ECFDF5' }}><b className="text-emerald-700">Best</b><span className="text-[#334155]"> · Mar–May cherry blossoms, mild 15-22°C · Oct–Nov autumn foliage, 15-20°C</span></div>
              <div className="rounded-xl p-4 border" style={{ borderColor:'#FDE68A', background:'#FFFBEB' }}><b className="text-amber-700">Good</b><span className="text-[#334155]"> · Dec–Feb cold but festive, illuminations, fewer crowds</span></div>
              <div className="rounded-xl p-4 border" style={{ borderColor:'#FDBA74', background:'#FFF7ED' }}><b className="text-orange-700">Avoid</b><span className="text-[#334155]"> · Jun–Aug rainy season → extreme humidity, 30°C+</span></div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <span className="px-3 py-1.5 rounded-full bg-white border font-semibold">🌸 Cherry Blossom · late March</span>
              <span className="px-3 py-1.5 rounded-full bg-white border font-semibold">🎆 Sumidagawa Fireworks · July</span>
              <span className="px-3 py-1.5 rounded-full bg-white border font-semibold">🍁 Autumn leaves · November</span>
            </div>
          </section>

          {/* REVIEWS */}
          <section id="reviews" className="scroll-mt-28">
            <h2 className="text-[26px] font-normal" style={{ fontFamily:'DM Serif Display, serif', color:'#0F172A' }}>What Travelers Say About Tokyo</h2>
            <div className="mt-5 grid md:grid-cols-3 gap-5">
              {[
                { q:'Tokyo exceeded every expectation. The food alone is worth the flight.', who:'James R.', meta:'5 days, October', rating:5, img:'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?q=80&w=400&auto=format&fit=crop' },
                { q:'We felt so safe walking around at midnight. The city is incredibly clean and the people are so kind.', who:'Priya & Anil M.', meta:'7 days, April', rating:5, img:'https://images.unsplash.com/photo-1544005313-94ddf0286df2?q=80&w=400&auto=format&fit=crop' },
                { q:'Third time visiting and I still discover something new every day.', who:'Sophie L.', meta:'10 days, November', rating:5, img:'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?q=80&w=400&auto=format&fit=crop' },
              ].map(r=>(
                <article key={r.who} className="rounded-xl bg-white border border-black/5 p-5 flex flex-col" style={{ borderRadius:12 }}>
                  <div className="flex gap-1" aria-label={`${r.rating} stars`}>
                    {Array.from({length:5}).map((_,i)=><span key={i} style={{ color: AMBER }}>★</span>)}
                  </div>
                  <p className="mt-3 text-[14px] leading-6 text-[#334155]">“{r.q}”</p>
                  <div className="mt-4 flex items-center gap-3 pt-4 border-t border-black/5">
                    <img src={r.img} alt={r.who} className="w-9 h-9 rounded-full object-cover" />
                    <div>
                      <p className="text-sm font-bold" style={{ color:'#0F172A'}}>{r.who}</p>
                      <p className="text-xs text-[#64748B]">{r.meta} · ★★★★★</p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>

          {/* CTA */}
          <section className="rounded-2xl p-8 sm:p-10 text-center" style={{ background: DARK_TEAL }}>
            <h2 className="text-white text-[30px] leading-none" style={{ fontFamily:'DM Serif Display, serif'}}>Ready to Explore Tokyo?</h2>
            <p className="mt-3 text-white/80 text-[15px]">Our travel experts will craft a personalized itinerary just for you</p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <button onClick={()=>triggerToast('Let’s plan your Tokyo trip!')} className="px-7 h-11 rounded-full bg-white font-bold text-sm" style={{ color: DARK_TEAL }}>Plan My Tokyo Trip</button>
              <button onClick={()=>triggerToast('Browsing Tokyo packages')} className="px-7 h-11 rounded-full bg-transparent border border-white text-white font-bold text-sm">Browse Tokyo Packages</button>
            </div>
            <p className="mt-4 text-white/60 text-xs">Starting from $2,899/person · 7 days · Flights + Hotels + Experiences</p>
          </section>

          {/* FOOTER */}
          <footer className="border-t border-black/5 pt-8 pb-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-sm">
              <div>
                <p className="font-black" style={{ fontFamily:'DM Serif Display, serif', color:'#0F172A' }}>Wanderly</p>
                <p className="mt-2 text-[#64748B] text-xs leading-5">Travel, beautifully planned.<br/>© 2026 Wanderly Travel Co.</p>
                <div className="mt-3 flex gap-2 text-xs">
                  {['IG','FB','PT','YT','TT'].map(s=>(
                    <a key={s} href="#" className="w-8 h-8 rounded-full bg-slate-100 grid place-items-center text-[11px] font-bold" aria-label={s}>{s}</a>
                  ))}
                </div>
              </div>
              {[
                ['Destinations',['Asia','Europe','Africa','Americas','Oceania','City Guides']],
                ['Trip Styles',['Food & Culture','Adventure','Family','Luxury','Solo','Hobby Groups']],
                ['Company',['About Us','Careers','Press','Blog','Gift Cards']],
                ['Support',['Help Center','Contact','Terms','Privacy','Referrals']],
              ].map(([title, links]:any)=>(
                <div key={title as string}>
                  <p className="font-bold text-xs tracking-widest uppercase" style={{ color:'#0F172A'}}>{title as string}</p>
                  <ul className="mt-3 space-y-2 text-[#475569]">
                    {(links as string[]).map(l=> <li key={l}><a href="#" className="hover:text-[#0F172A]">{l}</a></li>)}
                  </ul>
                </div>
              ))}
            </div>
            <p className="mt-8 text-center text-xs text-[#94A3B8]">© 2026 Wanderly Travel Co. · Made for wanderers. · Destinations · Trip Styles · Company · Support</p>
          </footer>
        </div>
      </div>

      {/* Sticky bottom bar mobile */}
      <div className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-black/5 p-3 flex gap-3" style={{ boxShadow:'0 -8px 24px rgba(0,0,0,0.08)'}}>
        <button onClick={()=>triggerToast('Plan My Trip — mobile')} className="flex-1 h-11 rounded-full text-white font-bold text-sm" style={{ background: TEAL }}>Plan My Trip — from $2,899</button>
      </div>

      <style>{`html{scroll-behavior:smooth} .no-scrollbar::-webkit-scrollbar{display:none} .no-scrollbar{-ms-overflow-style:none; scrollbar-width:none}`}</style>
    </div>
  );
};

export default TokyoGuide;
