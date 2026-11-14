import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Monitor, Smartphone } from "lucide-react";
import TodayView from "@/components/home/TodayView";
import YouView from "@/components/you/YouView";
import PortfolioView from "@/components/you/PortfolioView";
import RegionsView from "@/components/regions/RegionsView";
import RegionView from "@/components/regions/RegionView";
import StartView from "@/components/start/StartView";
import ExplorePage from "@/pages/explore/ExplorePage";
import { rankFor } from "@/config/identity";
import { REGION_BY_SLUG } from "@/config/regions";
import { cn } from "@/lib/utils";

/**
 * DESIGN PREVIEW — a living spec, not a product route.
 *
 * The redesign touches the shell, the information architecture and every screen
 * that carries an identity. A written brief is not enough to judge that, and the
 * real app needs a session and a database. This page renders the *actual*
 * components with representative data so the decisions can be seen and argued
 * with before anyone is asked to use them.
 *
 * Dev-only. In a production build the route redirects to Home.
 */

const DEMO_VENDOR = {
  id: "demo-1",
  business_name: "Ogallo",
  vendor_handle: "ogallo",
  display_name: "Ogallo",
  physical_location: "Kisumu, Nyanza",
  business_description:
    "I run a virtual kitchen in Kisumu. Ready meals for offices and small events — cooked to order, delivered within town. Fifteen years in hospitality, formerly at a hotel kitchen on the lakefront.",
  current_role: "both",
  account_kind: "person",
  movements_completed: 7,
  fulfillment_rate: 0.96,
  network_score: 41,
  is_verified: false,
  allow_direct_calls: false,
  phone: "+254 712 000 111",
  created_at: "2026-08-02T09:00:00",
};

const DEMO_PROFILE = {
  work_items: [
    {
      title: "Office lunch run, 40 covers",
      summary: "A weekly Friday lunch for a logistics office on the Nairobi road. Fourteen weeks without a missed delivery.",
      year: "2026",
    },
    {
      title: "Wedding reception, 120 guests",
      summary: "Full service for a wedding in Kombewa: three courses, two servers, one kitchen.",
      year: "2026",
    },
  ],
  avatar_url: null,
  banner_url: null,
};

const DEMO_IDENTITY = {
  intent: "offer",
  capabilities: ["sell_goods", "offer_services"],
  contact: { phone: "+254 712 000 111", email: "", show_phone: true, show_email: false },
  affiliation: {
    name: "Kisumu Hospitality Association",
    kind: "Association",
    role: "Member",
    method: "domain_email",
    status: "pending",
    official_email: "office@kha.or.ke",
  },
  licence: null,
};

const DEMO_PEOPLE = [
  { ...DEMO_VENDOR, id: "p1", business_name: "Achieng Groceries", vendor_handle: "achieng", business_description: "Sukuma, tomatoes and onions from Ahero. Delivered in Kisumu before 9am.", movements_completed: 23, is_verified: true, physical_location: "Kisumu" },
  { ...DEMO_VENDOR, id: "p2", business_name: "Kisii Nursing Home Outreach", vendor_handle: "kisii_nursing", business_description: "Wound dressing, home nursing and nutrition education. Licensed nurses.", movements_completed: 4, physical_location: "Kisii", is_verified: true },
  { ...DEMO_VENDOR, id: "p3", business_name: "Bondo Boda Co-op", vendor_handle: "bondo_boda", business_description: "Twelve riders covering Bondo, Usenge and the lake road. Parcels and passengers.", movements_completed: 0, physical_location: "Bondo" },
];

const DEMO_ITEMS = [
  { kind: "available", id: "i1", title: "Fresh tilapia, 40 crates weekly", location: "Kisumu", price_kes: 380, created_at: "2026-11-13T08:00:00", to: "/regions/nyanza?tab=offers" },
  { kind: "service", id: "i2", title: "Home nursing visits — wound care", location: "Kisii", price_kes: 500, created_at: "2026-11-12T14:00:00", to: "/regions/nyanza?tab=offers" },
  { kind: "wanted", id: "i3", title: "Need 200 crates for a school event", location: "Kisumu", created_at: "2026-11-12T10:00:00", to: "/regions/nyanza?tab=needs" },
  { kind: "opportunity", id: "i4", title: "Two kitchen assistants, Lumumba estate", location: "Kisumu", price_kes: 12000, created_at: "2026-11-11T09:00:00", to: "/regions/nyanza?tab=needs" },
];

const DEMO_DISCOVERY = [
  {
    id: "d1", kind: "listing", to: "/listing/d1", title: "Fresh tilapia, 40 crates weekly",
    summary: "Landing at Dunga beach every morning. Delivered in Kisumu before 10am.",
    location: "Kisumu", distance_km: 2.4, created_at: "2026-11-13T08:00:00",
    price_kes: 380, is_commercial: true,
    owner: { id: "p1", handle: "achieng", name: "Achieng Groceries" },
    counts: { available: 40 }, reactions: {}, meta: { unit: "crate" },
  },
  {
    id: "d2", kind: "service", to: "/listing/d2", title: "Home nursing visits — wound care",
    summary: "Licensed nurses, home visits across Kisumu and Kisii. Book a two-hour window.",
    location: "Kisii", distance_km: 9.1, created_at: "2026-11-12T14:00:00",
    price_kes: 1500, is_commercial: true,
    owner: { id: "p2", handle: "kisii_nursing", name: "Kisii Nursing Home Outreach" },
    counts: {}, reactions: {}, meta: {},
  },
  {
    id: "d3", kind: "wanted", to: "/listing/d3", title: "Need 200 crates for a school event",
    summary: "One supplier, delivered to Milimani on Friday morning. Quote with transport.",
    location: "Kisumu", distance_km: 3.7, created_at: "2026-11-12T10:00:00",
    owner: { id: "demo-1", handle: "ogallo", name: "Ogallo" },
    counts: {}, reactions: {}, meta: {},
  },
];

const SCREENS = [
  { key: "today", label: "Home" },
  { key: "discover", label: "Discover" },
  { key: "regions", label: "Regions list" },
  { key: "region", label: "Nyanza" },
  { key: "you", label: "You" },
  { key: "page", label: "Page" },
  { key: "start", label: "Join" },
];

export default function PreviewPage() {
  const [screen, setScreen] = useState("today");
  const [frame, setFrame] = useState("phone");
  const [intent, setIntent] = useState("offer");
  const [capabilities, setCapabilities] = useState(["sell_goods", "offer_services"]);
  const [regionTab, setRegionTab] = useState("people");

  if (!import.meta.env.DEV) return <Link to="/">Home</Link>;

  const identity = { ...DEMO_IDENTITY, intent, capabilities };
  const rank = rankFor({ vendor: DEMO_VENDOR, profile: DEMO_PROFILE, identity });
  const region = REGION_BY_SLUG.nyanza;

  return (
    <div className="min-h-screen bg-surface-0">
      <div className="sticky top-0 z-30 border-b border-edge-1 bg-surface-0/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 px-4 py-2.5">
          <Link
            to="/auth"
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-micro font-bold text-ink-3 hover:bg-surface-2 hover:text-ink-1"
          >
            <ArrowLeft size={13} aria-hidden="true" />
            Sign in
          </Link>
          <span className="hidden text-micro font-semibold text-ink-4 sm:inline">Design preview</span>
          <nav className="flex flex-1 flex-wrap gap-1" aria-label="Preview screens">
            {SCREENS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setScreen(item.key)}
                aria-pressed={screen === item.key}
                className={cn(
                  "rounded-full px-3 py-1.5 text-micro font-bold transition-colors",
                  screen === item.key
                    ? "bg-brand-700 text-white"
                    : "text-ink-3 hover:bg-surface-2 hover:text-ink-1",
                )}
              >
                {item.label}
              </button>
            ))}
          </nav>
          <button
            type="button"
            onClick={() => setFrame(frame === "phone" ? "wide" : "phone")}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-micro font-bold text-ink-3 hover:bg-surface-2"
            aria-label="Toggle frame"
          >
            {frame === "phone" ? <Monitor size={13} aria-hidden="true" /> : <Smartphone size={13} aria-hidden="true" />}
            {frame === "phone" ? "Wide" : "Phone"}
          </button>
        </div>
      </div>

      <div className={cn("mx-auto px-4 py-6", frame === "phone" ? "max-w-md" : "max-w-3xl")}>
        {screen === "today" && (
          <TodayView
            name={DEMO_VENDOR.business_name}
            firstName={DEMO_VENDOR.business_name}
            rank={rank}
            identity={identity}
            region={region}
            pulse={DEMO_ITEMS}
            unread={3}
            institution={{ name: "Kisumu Hospitality Association", line: "Member · Kisumu" }}
            page={{
              published: true,
              url: "/p/ogallo",
              href: "/p/ogallo",
              counts: { offers: 4, trades: 7, verified: false },
            }}
          />
        )}

        {/* /regions is the discovery feed; this is the directory behind its
            knob, kept here as the "All regions" screen. */}
        {screen === "discover" && (
          <ExplorePage
            regionAware
            demo={{
              items: DEMO_DISCOVERY,
              location: { lat: -0.095, lng: 34.77, label: "Kondele, Kisumu", radius_km: 15 },
              region,
            }}
          />
        )}

        {screen === "regions" && (
          <RegionsView
            country="KE"
            onCountry={() => {}}
            counts={{ nyanza: 12, "nairobi-metro": 148, coast: 64 }}
            search=""
            onSearch={() => {}}
          />
        )}

        {screen === "region" && (
          <RegionView
            region={region}
            tab={regionTab}
            onTab={(value) => setRegionTab(value)}
            people={DEMO_PEOPLE}
            items={DEMO_ITEMS}
          />
        )}

        {screen === "you" && (
          <YouView
            vendor={DEMO_VENDOR}
            profile={DEMO_PROFILE}
            identity={identity}
            rank={rank}
            institution={{ name: "Kisumu Hospitality Association", line: "Member · Kisumu" }}
            counts={{ offers: 4, trades: 7, verified: false }}
            copied={false}
            onCopy={() => {}}
            onShare={() => {}}
            onToggleCapability={(value) =>
              setCapabilities((current) =>
                current.includes(value) ? current.filter((item) => item !== value) : [...current, value],
              )
            }
          />
        )}

        {screen === "page" && (
          <PortfolioView
            vendor={DEMO_VENDOR}
            profile={DEMO_PROFILE}
            identity={identity}
            rank={rank}
            isOwner={false}
            onShare={() => {}}
          />
        )}

        {screen === "start" && (
          <StartView
            name="Ogallo"
            initialIntent={intent}
            initialCapabilities={capabilities}
            saving={false}
            onSave={({ intent: nextIntent, capabilities: nextCapabilities }) => {
              setIntent(nextIntent);
              setCapabilities(nextCapabilities);
              setScreen("you");
            }}
            onSkip={() => setScreen("today")}
          />
        )}
      </div>

      <p className="pb-8 text-center text-micro text-ink-4">
        Sample data. The same components run in the app; only the data source changes.
      </p>
    </div>
  );
}
