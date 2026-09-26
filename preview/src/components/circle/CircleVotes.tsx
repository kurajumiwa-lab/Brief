import React from 'react';
import type { Block, MemberRole } from '../../api/types';

/**
 * CIRCLE VOTES.
 *
 * Votes are Blocks of type 'vote'. The tally on `block.tally` is recomputed
 * server-side from the ballot rows on every read -- this component renders it
 * and never counts anything itself.
 *
 * Rules held here:
 *
 *   - `pct === null` (nobody has voted) renders as a dash, not 0%. A zero
 *     percentage would imply a measured result rather than an absent one.
 *   - A tie has no leader, and none is displayed. The server returns
 *     `leader: null` and the UI does not pick a winner to fill the space.
 *   - One member, one vote. A second attempt is refused by the server with a
 *     409; the UI reflects that a ballot was already cast rather than
 *     silently replacing it.
 *   - Every declared option is shown even at zero votes, so a result never
 *     hides what was rejected.
 */

const OPERATIONAL: MemberRole[] = ['coordinator', 'contributor', 'scout', 'logistics'];

export interface CircleVotesProps {
  blocks: Block[];
  myRole: MemberRole | null;
  busyId: string | null;
  /** Block ids the viewer has cast a ballot in this session. */
  votedIds: string[];
  onVote: (blockId: string, option: string) => void;
  onClose: (blockId: string) => void;
  /** Cancelling a vote publishes a reason to the circle. It is the only way to
   *  stop a count that already has ballots — closing one by hand is refused by
   *  the server, because whoever can end a count at a moment of their choosing
   *  can end it while they are ahead. */
  onCancel?: (blockId: string, reason: string) => void;
}

export function CircleVotes({
  blocks,
  myRole,
  busyId,
  votedIds,
  onVote,
  onCancel,
  onClose
}: CircleVotesProps) {
  const votes = blocks.filter((b) => b.type === 'vote');

  if (votes.length === 0) {
    return (
      <div>
        <Heading>Votes</Heading>
        <p className="text-xs text-[var(--ink-60)]">No votes in this circle.</p>
      </div>
    );
  }

  const canVote = myRole !== null && OPERATIONAL.includes(myRole);
  const isCoordinator = myRole === 'coordinator';

  const active = votes.filter((v) => !v.tally?.closed);
  const closed = votes.filter((v) => v.tally?.closed);

  const row = (vote: Block) => {
    const tally = vote.tally;
    const busy = busyId === vote.id;
    const alreadyVoted = votedIds.includes(vote.id);
    const isClosed = Boolean(tally?.closed);

    return (
      <div
        key={vote.id}
        className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-2xl p-3 space-y-2"
      >
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs font-extrabold text-[var(--brief-ink)] min-w-0">
            {vote.content}
          </p>
          {isClosed && (
            <span className="shrink-0 text-[11px] px-2 py-0.5 rounded-full bg-[var(--brief-line)] text-[var(--ink-60)]">
              closed
            </span>
          )}
        </div>

        {/* Turnout, from real rows on both sides. */}
        <p className="text-[11px] text-[var(--ink-60)]">
          {tally?.totalVotes ?? 0} of {tally?.eligibleCount ?? 0} eligible{' '}
          {(tally?.eligibleCount ?? 0) === 1 ? 'member' : 'members'} voted
        </p>

        <div className="space-y-1.5">
          {(tally?.results ?? []).map((r) => {
            const isLeader = tally?.leader === r.option;
            return (
              <div key={r.option} className="space-y-1">
                <div className="flex items-center justify-between gap-3">
                  <span
                    className={`text-[12px] ${
                      isLeader ? 'text-[var(--brief-ink)] font-extrabold' : 'text-[var(--ink-60)]'
                    }`}
                  >
                    {r.option}
                  </span>
                  <span className="text-[11px] text-[var(--ink-60)] shrink-0">
                    {r.count} {r.count === 1 ? 'vote' : 'votes'}
                    {/* Dash, not 0%: nobody has voted, so there is no share
                        to report. */}
                    {r.pct === null ? ' \u00b7 --' : ` \u00b7 ${Math.round(r.pct)}%`}
                  </span>
                </div>
                <div className="h-1 bg-[var(--color-well)] rounded-full overflow-hidden">
                  <div
                    className={`h-full ${isLeader ? 'bg-[#40916C]' : 'bg-[var(--brief-line)]'}`}
                    style={{ width: `${r.pct ?? 0}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* When it ends on its own, and how many it needs. A time and a number,
            not a promise about the outcome. */}
        {!isClosed && (tally?.closesAt || tally?.quorum) && (
          <p className="text-[11px] font-mono text-[var(--ink-60)]">
            {tally?.closesAt ? `closes ${String(tally.closesAt).slice(5, 10)}` : 'no deadline set'}
            {tally?.quorum ? ` · quorum ${tally.quorum} of ${tally.eligibleCount}` : ''}
          </p>
        )}

        {/* A count under quorum is not a decision, and is not shown as one. */}
        {!isClosed && tally?.quorum != null && tally?.quorumMet === false && (
          <p className="text-[11px] text-[var(--color-warning)]">
            {tally.totalVotes} of {tally.quorum} needed — under quorum, whatever the lead.
          </p>
        )}

        {/* Only a strict winner is announced. A tie says so. */}
        {isClosed && (
          <p className="text-[11px] text-[var(--brief-ink)]">
            {tally?.leader
              ? `Result: ${tally.leader}`
              : (tally?.totalVotes ?? 0) === 0
              ? 'Closed with no votes cast.'
              : tally?.status === 'failed_quorum'
              ? 'Closed under quorum — not a decision.'
              : 'Closed with no clear result.'}
          </p>
        )}

        {!isClosed && canVote && !alreadyVoted && (
          <div className="flex flex-wrap gap-2 pt-1">
            {(tally?.results ?? []).map((r) => (
              <button
                key={r.option}
                onClick={() => onVote(vote.id, r.option)}
                disabled={busy}
                className="px-3 py-1.5 rounded-xl bg-[color:var(--color-paper)] border border-[var(--brief-line)] text-[var(--brief-ink)] font-extrabold text-[11px] cursor-pointer disabled:opacity-50"
              >
                {busy ? '...' : `Vote ${r.option}`}
              </button>
            ))}
          </div>
        )}

        {!isClosed && alreadyVoted && (
          <div className="pt-1">
            <p className="text-[11px] text-[var(--brief-ink)]">
              You have voted. One vote counts — changing it leaves the first on the record.
            </p>
            <div className="flex flex-wrap gap-2 mt-1">
              {(tally?.results ?? []).map((r) => (
                <button
                  key={r.option}
                  onClick={() => onVote(vote.id, r.option)}
                  disabled={busy}
                  className="px-2.5 py-1 rounded-xl border border-[var(--brief-line)] text-[11px] font-extrabold text-[var(--ink-60)] cursor-pointer disabled:opacity-50"
                >
                  Change to {r.option}
                </button>
              ))}
            </div>
          </div>
        )}

        {!isClosed && myRole === 'observer' && (
          <p className="text-[11px] text-[var(--ink-60)]">Observers cannot vote.</p>
        )}

        {!isClosed && isCoordinator && (
          (tally?.totalVotes ?? 0) === 0 ? (
            <button
              onClick={() => onClose(vote.id)}
              disabled={busy}
              className="text-[11px] font-extrabold text-[var(--brief-ink)] cursor-pointer disabled:opacity-50"
            >
              Close it — nobody has voted
            </button>
          ) : (
            <details className="text-[11px]">
              <summary className="font-extrabold text-[var(--brief-ink)] cursor-pointer">Cancel this vote</summary>
              <form
                className="mt-1 flex items-center gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  const el = (e.currentTarget as HTMLFormElement).elements.namedItem('reason') as HTMLInputElement | null;
                  const reason = (el && el.value || '').trim();
                  if (!reason || !el) return;
                  onCancel?.(vote.id, reason);
                  el.value = '';
                }}
              >
                <input
                  name="reason"
                  aria-label="reason for cancelling this vote"
                  placeholder="why? the circle reads this with the ballots"
                  className="min-w-0 flex-1 px-2 py-1 rounded-lg border border-[var(--brief-line)] text-[11px] text-[var(--brief-ink)]"
                />
                <button type="submit" className="shrink-0 px-2 py-1 rounded-lg bg-[var(--color-danger)] text-[var(--accent-ink)] font-extrabold text-[11px] cursor-pointer">
                  Cancel vote
                </button>
              </form>
            </details>
          )
        )}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <Heading>Votes</Heading>

      {active.length > 0 && (
        <div className="space-y-2">
          <SubHeading>Open &middot; {active.length}</SubHeading>
          {active.map(row)}
        </div>
      )}

      {closed.length > 0 && (
        <div className="space-y-2">
          <SubHeading>Closed &middot; {closed.length}</SubHeading>
          {closed.map(row)}
        </div>
      )}
    </div>
  );
}

const Heading = ({ children }: { children: React.ReactNode }) => (
  <h3 className="text-[12px] font-extrabold text-[var(--ink-60)]">
    {children}
  </h3>
);

const SubHeading = ({ children }: { children: React.ReactNode }) => (
  <p className="text-[11px] text-[var(--ink-60)]">{children}</p>
);
