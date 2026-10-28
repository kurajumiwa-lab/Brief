import { useState } from "react";
import { AlertTriangle, Check, CornerDownRight, Info, ShieldAlert, ThumbsDown, ThumbsUp, X } from "lucide-react";
import Avatar from "@/components/ui/Avatar";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { relativeTime } from "@/lib/formatters";
import { cn } from "@/lib/utils";

/**
 * ONE POST, WITH ITS VERDICT.
 *
 * The two reactions are visual peers. Support is not the "correct" button and
 * dissent is not an alarm — disagreement is information about how settled a
 * claim is, so it is drawn in warm neutrals rather than red. A report is a
 * separate, quieter affordance, because "I disagree" and "this is abuse" are
 * different sentences and must never share a control.
 *
 * Everything shown here came from the server: the counts, the confidence, the
 * contested flag. The card explains the ranking; it does not invent it.
 */

const REPORT_REASONS = [
  { value: "harassment", label: "Harassment or threats" },
  { value: "hate", label: "Hate against a group" },
  { value: "spam", label: "Spam or a scam" },
  { value: "false_information", label: "Something untrue" },
  { value: "other", label: "Something else" },
];

const LANG_LABEL = { en: "English", sw: "Kiswahili", fr: "Français" };

export default function PostCard({ entry, circleName, onReact, onReport, onBlock, myAccountId, busy }) {
  const { post, verdict } = entry;
  const [menu, setMenu] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState("harassment");
  const [caseNumber, setCaseNumber] = useState("");
  const [why, setWhy] = useState(false);
  const [failure, setFailure] = useState("");

  const mine = entry.my_reaction;
  const authored = post.author.id === myAccountId;
  const support = verdict?.up ?? 0;
  const dissent = verdict?.down ?? 0;
  const participation = verdict?.participation ?? 0;
  const share = participation ? Math.round((support / participation) * 100) : 0;

  // "0% support" is technically true of a post nobody supports yet, and it
  // reads like a verdict the crowd has already reached. Say the thing that is
  // actually true instead: no one has backed it, and this many people object.
  const summary =
    participation === 0
      ? "No one has weighed in yet"
      : support === 0
        ? `Nobody supports this yet · ${dissent} ${dissent === 1 ? "person disagrees" : "people disagree"}`
        : `${support} ${support === 1 ? "person supports" : "people support"} · ${dissent} against`;

  const react = async (value) => {
    setFailure("");
    try {
      await onReact?.(post.id, value);
    } catch (error) {
      setFailure(error?.response?.data?.detail || "That didn't reach the server. Nothing changed.");
    }
  };

  const submitReport = async () => {
    setFailure("");
    try {
      const report = await onReport?.(post.id, reason);
      setCaseNumber(report?.case_number || "received");
      setReporting(false);
    } catch (error) {
      setFailure(error?.response?.data?.detail || "The report didn't send. Try again.");
    }
  };

  const block = async () => {
    setMenu(false);
    setFailure("");
    try {
      await onBlock?.(post.author.id);
    } catch (error) {
      setFailure(error?.response?.data?.detail || "That didn't reach the server. Nothing changed.");
    }
  };

  return (
    <article
      className="rounded-2xl border border-edge-1 bg-surface-0 p-3.5 space-y-3"
      data-testid={`community-post-${post.id}`}
      data-contested={verdict?.contested ? "true" : "false"}
    >
      <header className="flex items-start gap-2.5">
        <Avatar name={post.author.display_name || post.author.handle || "Member"} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5 text-sm font-bold text-ink-1">
            <span className="truncate">{post.author.display_name || `@${post.author.handle}`}</span>
            {authored && <span className="text-2xs font-semibold text-ink-4">You</span>}
            {circleName && (
              <span className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 text-2xs font-semibold text-ink-3">
                {circleName}
              </span>
            )}
          </p>
          <p className="text-2xs text-ink-4">
            @{post.author.handle || "member"}
            {post.author.city ? ` · ${post.author.city}` : ""} · {relativeTime(post.created_at)}
            {post.lang && post.lang !== "en" ? ` · ${LANG_LABEL[post.lang] || post.lang}` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setMenu((open) => !open)}
          className="rounded-lg p-2 text-ink-4 hover:bg-surface-2 hover:text-ink-2"
          aria-label="More options for this post"
          aria-expanded={menu}
        >
          <Info size={16} aria-hidden="true" />
        </button>
      </header>

      <p className="whitespace-pre-line text-sm leading-relaxed text-ink-2">
        {post.body}
        {post.status === "removed" && (
          <span className="ml-1 text-2xs font-semibold text-red-600">· removed by its author</span>
        )}
      </p>

      {(menu || why) && (
        <div className="rounded-xl bg-surface-1 p-2.5 text-2xs text-ink-3 space-y-1.5">
          {menu && (
            <div className="flex flex-wrap items-center gap-1.5">
              {!authored && (
                <>
                  <Button size="xs" variant="ghost" icon={ShieldAlert} onClick={() => { setReporting(true); setMenu(false); }}>
                    Report
                  </Button>
                  <Button size="xs" variant="ghost" icon={X} onClick={block}>
                    Block {post.author.display_name || `@${post.author.handle}`}
                  </Button>
                </>
              )}
              <Button size="xs" variant="ghost" icon={CornerDownRight} onClick={() => { setWhy((open) => !open); setMenu(false); }}>
                Why is this here?
              </Button>
              {authored && <span className="px-1 text-ink-4">This is your post.</span>}
            </div>
          )}
          {why && (
            <div className="space-y-1" data-testid={`why-${post.id}`}>
              <p>
                Ranked by the server from the reactions it actually holds. Score{" "}
                <span className="font-mono">{typeof entry.score === "number" ? entry.score.toFixed(2) : "—"}</span>
                {entry.raised_by_floor ? ", lifted so a new voice is still seen" : ""}.
              </p>
              {entry.parts && (
                <p className="font-mono text-ink-4">
                  {Object.entries(entry.parts)
                    .map(([key, value]) => `${key} ${typeof value === "number" ? value.toFixed(2) : value}`)
                    .join(" · ")}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* The verdict, explained in one line before the numbers. */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-2xs text-ink-3">
          <span className="font-semibold text-ink-2">{summary}</span>
          <span className="flex items-center gap-1.5">
            {verdict?.contested && (
              <Badge variant="amber" size="xs">Contested</Badge>
            )}
            {verdict?.needs_more_voices && !verdict?.contested && (
              <span className="text-ink-4">Needs more voices</span>
            )}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
          <div
            className={cn("h-full rounded-full transition-all", verdict?.contested ? "bg-amber-500" : "bg-brand-500")}
            style={{ width: `${share}%` }}
          />
        </div>
      </div>

      <footer className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => react("up")}
          disabled={authored || busy}
          aria-pressed={mine === "up"}
          aria-label="Support this post"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50",
            mine === "up"
              ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
              : "border-edge-2 text-ink-3 hover:bg-surface-2 hover:text-ink-1"
          )}
        >
          <ThumbsUp size={14} aria-hidden="true" /> {support}
        </button>
        <button
          type="button"
          onClick={() => react("down")}
          disabled={authored || busy}
          aria-pressed={mine === "down"}
          aria-label="Disagree with this post"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50",
            mine === "down"
              ? "border-accent-600 bg-accent-100 text-accent-700 dark:bg-accent-500/15 dark:text-accent-300"
              : "border-edge-2 text-ink-3 hover:bg-surface-2 hover:text-ink-1"
          )}
        >
          <ThumbsDown size={14} aria-hidden="true" /> {dissent}
        </button>
        {caseNumber && (
          <span className="ml-auto inline-flex items-center gap-1 text-2xs font-semibold text-ink-3">
            <Check size={12} aria-hidden="true" /> Reported · case {caseNumber}
          </span>
        )}
        {authored && !caseNumber && <span className="ml-auto text-2xs text-ink-4">Your post — others can weigh in.</span>}
      </footer>

      {reporting && (
        <div className="space-y-2 rounded-xl border border-edge-2 bg-surface-1 p-2.5">
          <p className="flex items-center gap-1.5 text-xs font-bold text-ink-1">
            <AlertTriangle size={14} aria-hidden="true" /> What is wrong with this post?
          </p>
          <div className="space-y-1">
            {REPORT_REASONS.map((option) => (
              <label key={option.value} className="flex items-center gap-2 text-xs text-ink-2">
                <input
                  type="radio"
                  name={`report-${post.id}`}
                  value={option.value}
                  checked={reason === option.value}
                  onChange={() => setReason(option.value)}
                />
                {option.label}
              </label>
            ))}
          </div>
          <p className="text-2xs text-ink-4">
            A report opens a case with a number. The post stays visible until a moderator decides —
            reporting is not a delete button.
          </p>
          <div className="flex gap-2">
            <Button size="xs" variant="secondary" onClick={submitReport}>Send report</Button>
            <Button size="xs" variant="ghost" onClick={() => setReporting(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {failure && (
        <p role="alert" className="text-2xs font-semibold text-red-600">{failure}</p>
      )}
    </article>
  );
}
