import React from 'react';
import {
  getTopEarners,
  getPercentile,
  PARTICIPANTS,
  getAcceptanceRate,
  getPoolRemaining,
  getTopContributors,
  COMMUNITY_POOL,
  summariseContribution,
  getBriefRank,
  getNextRankRequirement
} from '../App';
import type { Destination, Participant, Quest } from '../App';

/**
 * QUESTS -- open local contribution requests.
 *
 * Extracted from App.tsx unchanged. Quests are real asks with real
 * contributions; nothing here manufactures participation to make the board
 * look active. An empty board renders empty.
 */

export interface QuestsProps {
  quests: Quest[];
  /**
   * The cohort the leaderboards rank. Defaults to the real cohort, which is
   * empty until real participants exist -- a percentile against an invented
   * cohort is meaningless, so Brief ships none.
   */
  participants?: Participant[];
  boardMode: string;
  setBoardMode: (m: any) => void;
  handleSubmitQuest: (quest: Quest) => void;
  setActiveTab: (d: Destination) => void;
}

export function Quests({
  quests,
  participants = PARTICIPANTS,
  boardMode,
  setBoardMode,
  handleSubmitQuest,
  setActiveTab
}: QuestsProps) {
  // Derived from the same quest rows the board renders, so these can never
  // disagree with what is on screen. The wallet counts settled work only:
  // submitted work is visible but deliberately worth nothing until reviewed.
  const openQuests = React.useMemo(
    () => quests.filter((q) => q.status === 'open'),
    [quests]
  );
  const myContribution = React.useMemo(
    () => summariseContribution(quests),
    [quests]
  );
  const myRank = React.useMemo(() => getBriefRank(myContribution), [myContribution]);
  const nextRank = React.useMemo(
    () => getNextRankRequirement(myContribution),
    [myContribution]
  );
  const pendingCount = React.useMemo(
    () => quests.filter((q) => q.status === 'submitted').length,
    [quests]
  );

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
      <div>
        <h2 className="text-lg font-extrabold text-[var(--brief-ink)]">Jobs</h2>
        <p className="text-[12px] text-[var(--ink-60)] leading-snug mt-1">
          Useful work around you. Points settle when a contribution is
          accepted, not when it is submitted.
        </p>
      </div>

      {/* Wallet. Settled and pending are never added together. */}
      <div className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-2xl p-4 space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[11px] text-[var(--ink-60)]">
            Brief Points
          </span>
          <span className="text-lg font-extrabold text-[var(--brief-ink)]">
            {myContribution.settledPoints.toLocaleString()}
          </span>
        </div>
        {pendingCount > 0 && (
          <p className="text-[11px] text-[var(--brief-ink)]">
            {pendingCount} submitted, awaiting review. Worth nothing yet.
          </p>
        )}
        <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
          <span className="text-[11px] text-[var(--ink-60)]">
            Progress <span className="text-[var(--ink-60)]">{myRank}</span>
          </span>
          <span className="text-[11px] text-[var(--ink-60)]">
            Accepted{' '}
            <span className="text-[var(--ink-60)]">{myContribution.accepted}</span>
          </span>
          <span className="text-[11px] text-[var(--ink-60)]">
            Accuracy{' '}
            <span className="text-[var(--ink-60)]">
              {typeof getAcceptanceRate(myContribution) === 'number'
                ? `${getAcceptanceRate(myContribution)}%`
                : 'No reviewed work yet'}
            </span>
          </span>
        </div>
        {/* Only ever states a real remaining requirement. */}
        {nextRank && (
          <p className="text-[11px] text-[var(--ink-60)]">
            {nextRank.rank} needs {nextRank.needAccepted} more accepted
            {nextRank.needRate > 0
              ? ` and ${nextRank.needRate}% higher accuracy`
              : ''}
            .
          </p>
        )}
      </div>

      {/* The pool is stated plainly. No salary comparisons.
          An unfunded pool says so rather than rendering "KES 0" as though a
          real fund existed and happened to be empty. */}
      <div className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-2xl p-4">
        <p className="text-[11px] text-[var(--ink-60)]">
          Community pool - {COMMUNITY_POOL.periodLabel}
        </p>
        {COMMUNITY_POOL.totalKes > 0 ? (
          <>
            <p className="text-base font-extrabold text-[var(--brief-ink)] mt-1">
              KES {COMMUNITY_POOL.totalKes.toLocaleString()}
            </p>
            <p className="text-[11px] text-[var(--ink-60)] mt-1">
              KES {getPoolRemaining(COMMUNITY_POOL).toLocaleString()} still to be
              distributed. {COMMUNITY_POOL.kesPerPoint} KES per point.
            </p>
          </>
        ) : (
          <p className="text-[11px] text-[var(--ink-60)] mt-1 leading-snug">
            No reward pool is funded. Points still record accepted
            contributions, but Brief cannot pay anything out.
          </p>
        )}
      </div>

      <div>
        <h3 className="text-[12px] font-extrabold text-[var(--ink-60)] mb-2">
          Open jobs
        </h3>
        <div className="space-y-2">
          {openQuests.map((q) => (
            <div
              key={q.id}
              className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-2xl p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-extrabold text-[var(--brief-ink)]">
                    {q.title}
                  </p>
                  {/* Criteria shown up front, never retroactively. */}
                  <p className="text-[11px] text-[var(--ink-60)] mt-1">
                    Accepted when: {q.acceptanceCriteria}
                  </p>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                    {q.locationName && (
                      <span className="text-[11px] text-[var(--ink-60)]">
                        {q.locationName}
                        {typeof q.distanceKm === 'number'
                          ? ` - ${q.distanceKm} km`
                          : ''}
                      </span>
                    )}
                    {q.expiresAt && (
                      <span className="text-[11px] text-[var(--brief-ink)]">
                        closes {q.expiresAt.slice(0, 10)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs font-extrabold text-[var(--brief-ink)]">
                    {q.points}
                  </p>
                  <button
                    onClick={() => handleSubmitQuest(q)}
                    className="mt-1 px-3 py-1 rounded-xl bg-[#40916C] text-[var(--accent-ink)] font-extrabold text-[11px] cursor-pointer"
                  >
                    Submit
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Rejections stay visible with their reason. */}
      {quests.some((q) => q.status === 'rejected') && (
        <div>
          <h3 className="text-[12px] font-extrabold text-[var(--ink-60)] mb-2">
            Not accepted
          </h3>
          <div className="space-y-2">
            {quests
              .filter((q) => q.status === 'rejected')
              .map((q) => (
                <div
                  key={q.id}
                  className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-2xl p-3"
                >
                  <p className="text-xs text-[var(--ink-60)]">{q.title}</p>
                  <p className="text-[11px] text-[var(--brief-ink)] mt-1">
                    {q.reviewNote} No points awarded.
                  </p>
                </div>
              ))}
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center gap-2 mb-2">
          <button
            onClick={() => setBoardMode('contributors')}
            className={`px-3 py-1.5 rounded-xl text-[11px] font-extrabold cursor-pointer border ${
              boardMode === 'contributors'
                ? 'bg-[#40916C] text-[var(--accent-ink)] border-[#0891B2]'
                : 'bg-[color:var(--color-paper)] text-[var(--ink-70)] border-[var(--brief-line)]'
            }`}
          >
            Top Contributors
          </button>
          <button
            onClick={() => setBoardMode('earners')}
            className={`px-3 py-1.5 rounded-xl text-[11px] font-extrabold cursor-pointer border ${
              boardMode === 'earners'
                ? 'bg-[#40916C] text-[var(--accent-ink)] border-[#0891B2]'
                : 'bg-[color:var(--color-paper)] text-[var(--ink-70)] border-[var(--brief-line)]'
            }`}
          >
            Top Earners
          </button>
        </div>
        <p className="text-[11px] text-[var(--ink-60)] mb-2">
          {boardMode === 'contributors'
            ? 'Ranked by accepted contributions, so volume alone does not win.'
            : 'Ranked by settled points.'}
        </p>
        <div className="space-y-2">
          {(boardMode === 'contributors'
            ? getTopContributors(participants)
            : getTopEarners(participants)
          ).map((person, i) => {
            const rate = getAcceptanceRate(person.contribution);
            const pct = getPercentile(person, participants);
            return (
              <div
                key={person.id}
                className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-2xl p-3 flex items-center gap-3"
              >
                <span className="text-[11px] text-[var(--ink-60)] w-4 shrink-0">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-extrabold text-[var(--brief-ink)]">
                    {person.displayName}
                    <span className="ml-2 text-[11px] text-[var(--brief-ink)]">
                      {getBriefRank(person.contribution)}
                    </span>
                  </p>
                  <p className="text-[11px] text-[var(--ink-60)] mt-0.5">
                    {person.locationName} - {person.contribution.accepted} accepted
                    {typeof rate === 'number' ? ` - ${rate}% accepted` : ''}
                    {typeof pct === 'number' ? ` - top ${pct}%` : ''}
                  </p>
                </div>
                <span className="text-[11px] text-[var(--ink-60)] shrink-0">
                  {person.contribution.settledPoints.toLocaleString()}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Brief Points are a record of contribution, not a spendable currency. */}
      <div className="border-t border-[var(--brief-line)] pt-4">
        <p className="text-[12px] text-[var(--ink-60)]">
          Points are not cash and have no monetary value.
        </p>
      </div>
    </div>
  );
}
