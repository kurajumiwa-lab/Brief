import { Link, Navigate, useParams } from "react-router-dom";
import { Swords, Briefcase, ChevronRight } from "lucide-react";
import SquadPage from "@/pages/squad/SquadPage";

// ─────────────────────────────────────────────────────────────────────────────
// TASK TRACKS — the two loops behind the Tasks hub, each on its own screen.
//
// The Tasks portal is the hub; this is where a track actually lives. Two
// tracks, two different shapes:
//
//   /tasks/squad  — the Hustle League itself. It used to sit at the unlisted
//                   route /squad, reachable only from inside Tasks. It is a
//                   screen of the Tasks section now, so the URL says where you
//                   are; /squad redirects here.
//   /tasks/brief  — the Brief workspace. It is a surface with routes of its own
//                   (/brief, /stock, /analytics…), so this track hands you over
//                   to it rather than cloning a second copy of the workspace.
//
// That is the "rewire instead of clone" rule: the squad had no home, so it got
// one here; the workspace already had one, so the track points at it.
// ─────────────────────────────────────────────────────────────────────────────

const TRACKS = {
  squad: { label: "Squad", icon: Swords, blurb: "League, divisions, squads & the full match controls" },
  brief: { label: "Brief", icon: Briefcase, blurb: "Your workspace — numbers, feed & suggestions" },
};

export default function TaskTrack() {
  const { track } = useParams();

  if (track === "squad") return <SquadPage />;
  if (track === "brief") return <Navigate to="/brief" replace />;

  // Unknown track — show the two real doors rather than a dead URL.
  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <nav className="flex items-center gap-1.5 text-2xs text-ink-4" aria-label="Breadcrumb">
        <Link to="/" className="hover:text-ink-2">Home</Link>
        <ChevronRight size={11} />
        <Link to="/tasks" className="hover:text-ink-2">Tasks</Link>
      </nav>
      <div className="grid grid-cols-2 gap-3">
        {Object.entries(TRACKS).map(([value, { label, icon: Icon, blurb }]) => (
          <Link key={value} to={`/tasks/${value}`}
            className="glass glass-hover rounded-3xl p-4 text-left">
            <Icon size={16} className={value === "squad" ? "text-brand-600 dark:text-brand-400" : "text-accent-600 dark:text-accent-400"} />
            <p className="text-sm font-semibold text-ink-1 mt-2">{label}</p>
            <p className="text-2xs text-ink-4 mt-0.5">{blurb}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
