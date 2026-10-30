import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Swords, ListChecks, Trophy, Briefcase, Star, ArrowUpRight, Zap, Medal,
  Plus, Flame, Award,
} from "lucide-react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Tabs from "@/components/ui/Tabs";
import { PageSpinner } from "@/components/ui/Spinner";
import {
  TemporaryJobsHero,
  JobCategoryGrid,
  JobCard,
  JobDetailsModal,
  PostJobModal,
  categoryForSkill,
} from "@/components/tasks/TemporaryJobsSection";
import { useAuthStore } from "@/stores/authStore";
import { squadAPI, apiError } from "@/lib/api";
import { toast } from "@/components/ui/Toast";
import { num, relativeTime } from "@/lib/formatters";
import { cn } from "@/lib/utils";

const STATUS_TONE = {
  accepted: "text-accent-600 dark:text-accent-400",
  in_progress: "text-blue-600 dark:text-blue-400",
  proof_pending: "text-accent-600 dark:text-accent-400",
  completed: "text-brand-600 dark:text-brand-400",
  cancelled: "text-red-600 dark:text-red-400",
};

export default function TasksPortal() {
  const navigate = useNavigate();
  const vendor = useAuthStore((s) => s.vendor);
  const jobsRef = useRef(null);

  const [me, setMe] = useState(null);
  const [calls, setCalls] = useState(null);
  const [wins, setWins] = useState(null);
  const [accepting, setAccepting] = useState(null);
  const [error, setError] = useState("");
  const [applyError, setApplyError] = useState("");
  const [selectedSkill, setSelectedSkill] = useState("");
  const [viewTab, setViewTab] = useState("available"); // 'available' | 'portfolio' | 'posted'
  const [selectedCall, setSelectedCall] = useState(null);
  const [postOpen, setPostOpen] = useState(false);

  const load = useCallback(() => {
    setError("");
    squadAPI
      .me()
      .then((r) => setMe(r.data))
      .catch((e) => setError(apiError(e, "The task board could not be loaded")));
    squadAPI
      .calls()
      .then((r) => setCalls(r.data?.calls || []))
      .catch(() => setCalls([]));
    if (squadAPI.recent) {
      squadAPI
        .recent()
        .then((r) => setWins(r.data?.wins || []))
        .catch(() => setWins([]));
    } else {
      setWins([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const accept = async (call) => {
    if (accepting) return;
    setAccepting(call.id);
    setApplyError("");
    try {
      await squadAPI.accept(call.id);
      toast.success(`Contract signed — ${call.title}`);
      setSelectedCall(null);
      load();
    } catch (e) {
      const msg = apiError(e, "That contract could not be accepted");
      setApplyError(msg);
      toast.error(msg);
    } finally {
      setAccepting(null);
    }
  };

  const allCalls = calls || [];
  const openCalls = useMemo(() => {
    return allCalls.filter((c) => {
      if (c.mine) return false;
      if (selectedSkill && c.skill !== selectedSkill) return false;
      return true;
    });
  }, [allCalls, selectedSkill]);

  const myPostedCalls = useMemo(() => allCalls.filter((c) => c.mine), [allCalls]);

  if (error) {
    return (
      <EmptyState
        icon={Swords}
        tone="danger"
        illustration="error"
        title="The task board is down"
        description={error}
        action={
          <Button size="sm" onClick={load}>
            Try again
          </Button>
        }
      />
    );
  }
  if (!me) return <PageSpinner label="Dealing your tasks…" />;

  const active = me.active_contract;
  const recent = wins || [];
  const energyCapReached = Boolean(me.energy?.rest_today || (me.energy?.used >= me.energy?.limit && me.energy?.limit > 0));

  const scrollToJobs = () => {
    setViewTab("available");
    jobsRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="space-y-6">
      {/* ── 1. Temporary-Jobs Hero Section ────────────────────────────── */}
      <TemporaryJobsHero
        onBrowseJobs={scrollToJobs}
        onPostJob={() => setPostOpen(true)}
        openCount={allCalls.filter((c) => c.status === "open" && !c.mine).length}
        activeContract={active}
      />

      {/* ── 2. Worker Standing & Active Contract Strip ────────────────── */}
      <div className="grid lg:grid-cols-[1.2fr_0.8fr] gap-4">
        {active ? (
          <Card className="p-5 border-brand-300 dark:border-brand-700 space-y-3">
            <div className="flex items-center gap-2">
              <Medal size={15} className="text-brand-600 dark:text-brand-400" />
              <p className="text-micro uppercase tracking-[0.14em] text-ink-4 font-bold">Active contract in hand</p>
              <span className={cn("ml-auto text-2xs font-bold uppercase tracking-wide", STATUS_TONE[active.status] || "text-ink-4")}>
                {active.status.replaceAll("_", " ")}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-base font-bold text-ink-1 truncate">{active.title}</p>
                <p className="text-xs text-ink-3 mt-0.5 truncate">
                  {active.i_am_player ? `For ${active.client_name}` : `Worker: ${active.player_name}`}
                  {active.location ? ` · ${active.location}` : ""}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="digital text-xl text-ink-1">KES {num(active.pay_kes)}</p>
                <p className="text-micro text-ink-4">agreed rate</p>
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 pt-2 border-t border-edge-1">
              <span className="text-micro text-ink-3">
                Complete on site with the client&apos;s 6-digit OTP to release XP and Gold.
              </span>
              <Button size="sm" onClick={() => navigate("/tasks/squad")}>
                Continue in Squad <ArrowUpRight size={12} />
              </Button>
            </div>
          </Card>
        ) : (
          <Card className="p-5 flex flex-col justify-between gap-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-ink-1 flex items-center gap-2">
                  <ListChecks size={15} className="text-brand-600" /> No active shift in hand
                </p>
                <p className="text-xs text-ink-3 mt-1">
                  Apply for an open call-up below to lock in the shift rate. You can hold one active shift at a time.
                </p>
              </div>
              <Badge variant="outline" size="xs">
                {me.energy?.used ?? 0} / {me.energy?.limit ?? 4} daily shifts
              </Badge>
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-edge-1 text-micro text-ink-3">
              <span>Division: <strong className="text-ink-1">{me.division || "Rookie"}</strong></span>
              <span>·</span>
              <span>Level: <strong className="text-ink-1">{me.level || "L1"}</strong> ({num(me.xp || 0)} XP)</span>
              <span>·</span>
              <span>Gold: <strong className="text-ink-1">{num(me.gold || 0)}</strong></span>
              {me.streak > 0 && (
                <>
                  <span>·</span>
                  <span className="inline-flex items-center gap-0.5 text-accent-600 font-semibold">
                    <Flame size={11} /> {me.streak}d streak
                  </span>
                </>
              )}
            </div>
          </Card>
        )}

        {/* Quick Portfolio Summary Card */}
        <Card className="p-5 flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-ink-1">Work portfolio &amp; skill cards</h2>
              <p className="text-micro text-ink-4">Earned from completed contracts and client ratings</p>
            </div>
            <Badge variant="brand" size="xs">
              {(me.cards || []).length} skill {(me.cards || []).length === 1 ? "card" : "cards"}
            </Badge>
          </div>
          {(me.cards || []).length === 0 ? (
            <p className="text-xs text-ink-3">
              Complete your first shift to earn a verified skill card with your completion count and average client rating.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {me.cards.slice(0, 4).map((c) => (
                <div
                  key={c.skill}
                  className="rounded-xl border border-edge-1 bg-surface-1 px-2.5 py-1.5 text-2xs flex items-center gap-2"
                >
                  <Award size={12} className="text-brand-600 shrink-0" />
                  <span className="font-semibold text-ink-1">{c.label || categoryForSkill(c.skill).shortLabel}</span>
                  <span className="font-mono text-ink-3 capitalize">{c.tier}</span>
                  {c.avg_rating > 0 && (
                    <span className="text-accent-600 font-mono">★{Number(c.avg_rating).toFixed(1)}</span>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center justify-between pt-2 border-t border-edge-1">
            <span className="text-micro text-ink-4">{recent.length} recent completed shifts</span>
            <button
              type="button"
              onClick={() => setViewTab("portfolio")}
              className="text-2xs font-semibold text-brand-700 dark:text-brand-300 hover:underline cursor-pointer"
            >
              View work history
            </button>
          </div>
        </Card>
      </div>

      {/* ── 3. Visual Category Cards ──────────────────────────────────── */}
      <JobCategoryGrid
        activeSkill={selectedSkill}
        onSelectSkill={(skill) => {
          setSelectedSkill(skill);
          setViewTab("available");
        }}
        calls={allCalls}
      />

      {/* ── 4. Jobs & Portfolio Tabs ──────────────────────────────────── */}
      <div ref={jobsRef} className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Tabs
            value={viewTab}
            onChange={setViewTab}
            tabs={[
              { value: "available", label: "Open Call-Ups", icon: Zap, count: openCalls.length },
              { value: "portfolio", label: "Completed & Portfolio", icon: Trophy, count: recent.length },
              { value: "posted", label: "Posted by My Business", icon: Briefcase, count: myPostedCalls.length },
            ]}
          />
          <button
            type="button"
            onClick={() => navigate("/tasks/squad")}
            className="text-2xs font-bold text-brand-600 dark:text-brand-400 hover:underline cursor-pointer"
          >
            all call-ups
          </button>
        </div>

        {viewTab === "available" && (
            calls === null ? (
              <PageSpinner />
            ) : openCalls.length === 0 ? (
              <EmptyState
                icon={Briefcase}
                illustration={selectedSkill ? "search" : "jobs"}
                title={
                  selectedSkill
                    ? `No open ${categoryForSkill(selectedSkill).title} shifts right now`
                    : "No open call-ups right now"
                }
                description={
                  selectedSkill
                    ? "Clear the category filter to view all open shifts across the market, or post a job for your business."
                    : "Clients post paid temporary jobs here. Post a job if your business needs extra hands today."
                }
                action={
                  selectedSkill ? (
                    <Button size="sm" variant="secondary" onClick={() => setSelectedSkill("")}>
                      Show all categories
                    </Button>
                  ) : (
                    <Button size="sm" icon={Plus} onClick={() => setPostOpen(true)}>
                      Post a Job
                    </Button>
                  )
                }
              />
            ) : (
              <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {openCalls.map((c) => (
                  <JobCard
                    key={c.id}
                    call={c}
                    onViewJob={(job) => {
                      setApplyError("");
                      setSelectedCall(job);
                    }}
                    onApply={accept}
                    applying={accepting === c.id}
                    hasActiveContract={Boolean(active)}
                    energyCapReached={energyCapReached}
                    actionLabel="Accept"
                  />
                ))}
              </div>
            )
        )}

        {viewTab === "portfolio" && (
          <div className="space-y-4">
            {recent.length === 0 ? (
              <EmptyState
                compact
                icon={Trophy}
                illustration="jobs"
                title="No completed shifts yet"
                description="Completed contracts, client ratings, XP, and Gold bonuses appear here as your verified work portfolio."
                action={
                  <Button size="sm" onClick={() => setViewTab("available")}>
                    Browse Open Jobs
                  </Button>
                }
              />
            ) : (
              <div className="grid sm:grid-cols-2 gap-3">
                {recent.map((w) => (
                  <Card key={w.id} className="p-4 flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-ink-1 truncate">{w.title}</p>
                      <p className="text-2xs text-ink-4 mt-0.5 flex items-center gap-2">
                        <span>{w.completed_at ? relativeTime(w.completed_at) : "Completed"}</span>
                        {w.client_rating && (
                          <span className="inline-flex items-center gap-0.5 text-accent-600 dark:text-accent-400 font-semibold">
                            <Star size={10} className="fill-amber-400" /> {w.client_rating}.0
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="digital text-base font-bold text-ink-1">KES {num(w.pay_kes)}</p>
                      <p className="text-micro text-brand-700 dark:text-brand-300">
                        +{num(w.xp_earned)} XP · +{num(w.gold_earned)} Gold
                      </p>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {viewTab === "posted" && (
          <div>
            {myPostedCalls.length === 0 ? (
              <EmptyState
                compact
                icon={Briefcase}
                illustration="jobs"
                title="No jobs posted by your business"
                description="Need loaders, stock counters, packers, or a local runner? Post a shift with a fixed KES rate and two-party OTP proof."
                action={
                  <Button size="sm" icon={Plus} onClick={() => setPostOpen(true)}>
                    Post a Job
                  </Button>
                }
              />
            ) : (
              <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {myPostedCalls.map((c) => (
                  <JobCard
                    key={c.id}
                    call={c}
                    onViewJob={(job) => {
                      setApplyError("");
                      setSelectedCall(job);
                    }}
                    onApply={accept}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── 5. The loop doors (preserved for TaskTrack navigation) ────── */}
      <div className="grid sm:grid-cols-2 gap-3 pt-2">
        <button
          type="button"
          onClick={() => navigate("/tasks/squad")}
          className="rounded-2xl border border-edge-1 bg-surface-0 p-4 text-left shadow-xs glass-hover cursor-pointer"
        >
          <Swords size={16} className="text-brand-600 dark:text-brand-400" />
          <p className="text-sm font-semibold text-ink-1 mt-2">Squad</p>
          <p className="text-2xs text-ink-4 mt-0.5">League, divisions, squads &amp; the full match controls</p>
        </button>
        <button
          type="button"
          onClick={() => navigate("/tasks/brief")}
          className="rounded-2xl border border-edge-1 bg-surface-0 p-4 text-left shadow-xs glass-hover cursor-pointer"
        >
          <Briefcase size={16} className="text-accent-600 dark:text-accent-400" />
          <p className="text-sm font-semibold text-ink-1 mt-2">Brief</p>
          <p className="text-2xs text-ink-4 mt-0.5">Your workspace — numbers, feed &amp; suggestions</p>
        </button>
      </div>

      <JobDetailsModal
        call={selectedCall}
        open={!!selectedCall}
        onClose={() => setSelectedCall(null)}
        onApply={accept}
        applying={selectedCall && accepting === selectedCall.id}
        applyError={applyError}
        hasActiveContract={Boolean(active)}
        energyCapReached={energyCapReached}
      />

      <PostJobModal
        open={postOpen}
        onClose={() => setPostOpen(false)}
        defaultLocation={vendor?.physical_location || ""}
        onPosted={() => {
          load();
          setViewTab("posted");
        }}
      />
    </div>
  );
}
