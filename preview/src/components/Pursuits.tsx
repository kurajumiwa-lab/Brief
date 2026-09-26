import React from 'react';
import { Trash2 } from 'lucide-react';
import { getObjectTypeMeta, getDistanceLabel, WATCH_CONDITION_LABELS } from '../App';
import type {
  BriefObject,
  Pursuit,
  PursuitMatch,
  PursuitStatus,
  WatchCondition
} from '../App';

/**
 * PURSUITS -- standing intents.
 *
 * "find cheap solar lights near kilimani" is kept as an ongoing pursuit and
 * matched against objects as they arrive. Extracted from App.tsx with
 * behaviour and styling unchanged.
 *
 * Matches are evidence-based: a pursuit only matches an object when the
 * matcher can point at why. Nothing is fabricated to make a pursuit look
 * productive -- a pursuit with no matches says so.
 */

export interface PursuitsProps {
  pursuits: Pursuit[];
  pursuitResults: Record<string, PursuitMatch[]>;
  pursuitDraft: string;
  setPursuitDraft: React.Dispatch<React.SetStateAction<string>>;
  handleCreatePursuit: (rawQuery: string) => void;
  handleRemovePursuit: (id: string) => void;
  handleSetPursuitStatus: (id: string, status: Pursuit['status']) => void;
  handleTogglePursuitWatch: (id: string) => void;
  handleTogglePursuitCondition: (id: string, condition: WatchCondition) => void;
  setSelectedObjectForDetail: (o: BriefObject | null) => void;
}

export function Pursuits({
  pursuits,
  pursuitResults,
  pursuitDraft,
  setPursuitDraft,
  handleCreatePursuit,
  handleRemovePursuit,
  handleSetPursuitStatus,
  handleTogglePursuitWatch,
  handleTogglePursuitCondition,
  setSelectedObjectForDetail
}: PursuitsProps) {
  return (
    <div className="space-y-4">

      <div>
        <h2 className="text-lg font-extrabold text-[var(--brief-ink)]">Alerts</h2>
        <p className="text-[12px] text-[var(--ink-60)] leading-snug mt-1">
          Things you have asked Brief to find or keep an eye on. Brief
          searches only what it already holds, so results grow as more
          information arrives.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleCreatePursuit(pursuitDraft);
          setPursuitDraft('');
        }}
        className="flex gap-2"
      >
        <input
          value={pursuitDraft}
          onChange={(e) => setPursuitDraft(e.target.value)}
          placeholder="find a plumber near me"
          className="flex-1 bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-xl px-3 py-2.5 text-xs text-[var(--brief-ink)] placeholder:text-[var(--ink-60)] outline-none focus:border-[var(--brief-line)]"
        />
        <button
          type="submit"
          className="px-4 py-2.5 rounded-xl bg-[#40916C] text-[var(--accent-ink)] font-extrabold text-[12px] cursor-pointer"
        >
          Search
        </button>
      </form>

      {pursuits.length === 0 && (
        <div className="border border-dashed border-[var(--brief-line)] rounded-2xl p-8 text-center">
          <p className="text-xs text-[var(--ink-60)]">Nothing being pursued yet.</p>
          <p className="text-[11px] text-[var(--ink-60)] mt-1">
            Ask for something above, or start one from any object.
          </p>
        </div>
      )}

      {pursuits.map((pursuit) => {
        const results = pursuitResults[pursuit.id] ?? [];
        const dormant =
          pursuit.status === 'completed' || pursuit.status === 'archived';

        return (
          <div
            key={pursuit.id}
            className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-2xl p-4 space-y-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-extrabold text-[var(--brief-ink)] leading-snug">
                  {pursuit.query}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[11px] text-[var(--ink-60)]">
                    {pursuit.status}
                  </span>
                  {pursuit.watchChanges && (
                    <span className="text-[11px] text-[var(--brief-ink)]">
                      watching
                    </span>
                  )}
                </div>
              </div>

              <button
                onClick={() => handleRemovePursuit(pursuit.id)}
                title="Remove pursuit"
                className="shrink-0 p-2 rounded-xl bg-[color:var(--color-paper)] text-[var(--brief-ink)] border border-[var(--brief-line)] hover:border-[#0891B2] cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>

            {!dormant && (
              <>
                <p className="text-[11px] text-[var(--ink-60)]">
                  {results.length > 0
                    ? `${results.length} match${results.length === 1 ? '' : 'es'} in Brief`
                    : 'Nothing matching yet'}
                </p>

                {/* Saying "I don't know yet" is a feature, not a
                    failure state. Brief never pads this with guesses. */}
                {results.length === 0 && (
                  <div className="space-y-2">
                    <p className="text-[12px] font-bold text-[var(--ink-60)]">
                      Nothing useful yet.
                    </p>
                    <p className="text-[11px] text-[var(--ink-60)] leading-snug">
                      Keep this pursuit open and Brief can match new
                      information later.
                    </p>
                    {!pursuit.watchChanges && (
                      <button
                        onClick={() => handleTogglePursuitWatch(pursuit.id)}
                        className="px-3 py-1.5 rounded-full bg-[color:var(--color-paper)] border border-[var(--brief-line)] text-[var(--brief-ink)] font-extrabold text-[11px] cursor-pointer"
                      >
                        Keep watching
                      </button>
                    )}
                  </div>
                )}

                {results.length > 0 && (
                  <div className="space-y-1.5">
                    {results.slice(0, 4).map((match) => {
                      const distance = getDistanceLabel(match.item);
                      return (
                        <button
                          key={match.item.id}
                          onClick={() => setSelectedObjectForDetail(match.item)}
                          className="w-full text-left bg-[color:var(--color-paper)] border border-[var(--brief-line)] hover:border-[var(--brief-line)] rounded-xl p-2.5 cursor-pointer transition"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] text-[var(--ink-60)]">
                              {getObjectTypeMeta(match.item.type).label}
                            </span>
                            {distance && (
                              <span className="text-[11px] text-[var(--ink-60)]">
                                {distance}
                              </span>
                            )}
                          </div>
                          <p className="text-[12px] font-bold text-[var(--brief-ink)] leading-snug mt-0.5">
                            {match.item.title}
                          </p>
                          {match.item.metadata?.statusBadge && (
                            <p className="text-[11px] text-[var(--brief-ink)] mt-0.5">
                              {match.item.metadata.statusBadge}
                            </p>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            <div className="flex flex-wrap gap-1.5 pt-1">
              {(['active', 'paused', 'completed', 'archived'] as PursuitStatus[]).map(
                (status) => (
                  <button
                    key={status}
                    onClick={() => handleSetPursuitStatus(pursuit.id, status)}
                    className={`text-[11px] font-bold px-2 py-0.5 rounded-full border cursor-pointer transition ${
                      pursuit.status === status
                        ? 'bg-[#40916C] text-[var(--accent-ink)] border-[#0891B2]'
                        : 'bg-transparent text-[var(--ink-60)] border-[var(--brief-line)] hover:border-[var(--brief-line)]'
                    }`}
                  >
                    {status}
                  </button>
                )
              )}

              <button
                onClick={() => handleTogglePursuitWatch(pursuit.id)}
                className={`text-[11px] font-bold px-2 py-0.5 rounded-full border cursor-pointer transition ${
                  pursuit.watchChanges
                    ? 'bg-[color:var(--color-paper)] text-[var(--brief-ink)] border-[var(--brief-line)]'
                    : 'bg-transparent text-[var(--ink-60)] border-[var(--brief-line)] hover:border-[var(--brief-line)]'
                }`}
              >
                watch changes
              </button>
            </div>

            {/* Which changes matter (prompt 5). Model + matching only --
                nothing is monitoring in the background yet. */}
            {pursuit.watchChanges && (
              <div className="space-y-1.5 pt-1">
                <p className="text-[11px] text-[var(--ink-60)]">
                  Tell me about
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(WATCH_CONDITION_LABELS) as WatchCondition[]).map(
                    (condition) => {
                      const on = (pursuit.watchConditions ?? []).includes(
                        condition
                      );
                      return (
                        <button
                          key={condition}
                          onClick={() =>
                            handleTogglePursuitCondition(pursuit.id, condition)
                          }
                          className={`text-[11px] font-bold px-2 py-0.5 rounded-full border cursor-pointer transition ${
                            on
                              ? 'bg-[color:var(--color-paper)] text-[var(--brief-ink)] border-[var(--brief-line)]'
                              : 'bg-transparent text-[var(--ink-60)] border-[var(--brief-line)] hover:border-[var(--brief-line)]'
                          }`}
                        >
                          {WATCH_CONDITION_LABELS[condition]}
                        </button>
                      );
                    }
                  )}
                </div>
                <p className="text-[11px] text-[var(--ink-60)]">
                  Alerts are not live yet. Brief records what matters to you.
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
