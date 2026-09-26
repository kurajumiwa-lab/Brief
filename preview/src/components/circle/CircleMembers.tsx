import React from 'react';
import type { Member, MemberEvidence } from '../../api/types';

/**
 * CIRCLE MEMBERS + EVIDENCE.
 *
 * TRUST IS EVIDENCE, NEVER A SCORE.
 *
 * There is deliberately no percentage, rating, star count, reliability index
 * or hidden ranking anywhere in this component. A member is described by
 * things that actually happened -- verifications that were recorded, tasks
 * they completed, votes they cast, when they joined -- each of which is
 * checkable and contestable in a way a number never is.
 *
 * A member with no history shows no evidence. That is the honest answer, not
 * a gap to fill with a default rating.
 */

const ROLE_LABEL: Record<string, string> = {
  coordinator: 'Coordinator',
  contributor: 'Contributor',
  scout: 'Scout',
  logistics: 'Logistics',
  observer: 'Observer'
};

export interface CircleMembersProps {
  members: Member[];
  /** Evidence per userId, loaded on demand when a member is expanded. */
  evidence: Record<string, MemberEvidence | 'loading' | 'error'>;
  expandedId: string | null;
  onToggle: (userId: string) => void;
  /**
   * Governance. Only passed when the viewer is this circle's coordinator;
   * the server refuses these calls for anybody else, so the panel never
   * shows controls that would only produce a 403.
   */
  canGovern?: boolean;
  currentUserId?: string;
  busyUserId?: string | null;
  /** Invite by @handle — the thing a person knows about their neighbour. The
   *  server resolves it and says so when no account answers to it. A raw user id
   *  is a database key, and nobody should be asked to paste one. */
  onInvite?: (handle: string, role: Member['role']) => void;
  /** A role change and a removal each carry a reason, because the server refuses
   *  them without one. The reason is the group's record, not an apology. */
  onRole?: (userId: string, role: Member['role'], reason: string) => void;
  onRemove?: (userId: string, reason: string) => void;
  onTransfer?: (userId: string) => void;
}

const GOV_ROLES: Member['role'][] = ['coordinator', 'contributor', 'scout', 'logistics', 'observer'];

export function CircleMembers({
  members,
  evidence,
  expandedId,
  onToggle,
  canGovern = false,
  currentUserId,
  busyUserId,
  onInvite,
  onRole,
  onRemove,
  onTransfer
}: CircleMembersProps) {
  const [inviteId, setInviteId] = React.useState('');
  const [inviteRole, setInviteRole] = React.useState<Member['role']>('contributor');
  const [confirmRemove, setConfirmRemove] = React.useState<string | null>(null);
  // Typed before the act is offered: there is no version of this UI where a
  // neighbour can be removed, or a role handed out, in silence.
  const [reason, setReason] = React.useState('');
  const [roleDraft, setRoleDraft] = React.useState<Record<string, Member['role']>>({});

  /** How long ago the door opened for them, in the coarsest honest unit. */
  const since = (iso?: string | null) => {
    if (!iso) return null;
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) return null;
    const days = Math.floor((Date.now() - ms) / 86400000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 30) return `${days} days ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
    const years = Math.floor(days / 365);
    return `${years} year${years === 1 ? '' : 's'} ago`;
  };

  const handleInvite = (event: React.FormEvent) => {
    event.preventDefault();
    const id = inviteId.trim().replace(/^@/, '');
    if (!id || !onInvite) return;
    onInvite(id, inviteRole);
    setInviteId('');
  };

  return (
    <div>
      <h3 className="text-[12px] font-extrabold text-[var(--ink-60)] mb-2">
        Members
      </h3>

      {members.length === 0 && !canGovern && (
        <p className="text-xs text-[var(--ink-60)]">No members yet.</p>
      )}
      {members.length === 0 && canGovern && (
        <p className="text-xs text-[var(--ink-60)]">
          No members yet — invite someone below.
        </p>
      )}

      <div className="space-y-2">
        {/* Coordinator governance: invite, re-role, remove. Every action is
            server-authorised; a refusal is surfaced verbatim by the parent. */}
        {canGovern && (
          <form
            onSubmit={handleInvite}
            className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-2xl p-3 space-y-2"
          >
            <p className="text-[11px] font-extrabold text-[var(--ink-60)]">
              Invite by handle
            </p>
            <div className="flex items-center gap-2">
              <input
                value={inviteId}
                onChange={(e) => setInviteId(e.target.value)}
                placeholder="@handle"
                aria-label="invite handle"
                className="min-w-0 flex-1 px-2.5 py-1.5 rounded-xl border border-[var(--brief-line)] text-[11px] text-[var(--brief-ink)]"
              />
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as Member['role'])}
                aria-label="invite role"
                className="px-2 py-1.5 rounded-xl border border-[var(--brief-line)] text-[11px] text-[var(--brief-ink)]"
              >
                {GOV_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r] ?? r}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={!inviteId.trim() || busyUserId === 'invite'}
                className="shrink-0 px-3 py-1.5 rounded-xl bg-[#40916C] text-[var(--accent-ink)] font-extrabold text-[11px] cursor-pointer disabled:opacity-50"
              >
                Invite
              </button>
            </div>
          </form>
        )}

        {members.map((member) => {
            const open = expandedId === member.userId;
            const ev = evidence[member.userId];

            return (
              <div
                key={member.id}
                className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-2xl p-3 space-y-2"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex items-center gap-2">
                    {/* An initial in a warm tile stands in for a face. It is not a
                        photo, so it never pretends to be one. */}
                    <span
                      aria-hidden="true"
                      className="w-8 h-8 shrink-0 rounded-full grid place-items-center text-[12px] font-black"
                      style={{ background: 'var(--color-well)', color: 'var(--color-primary)', boxShadow: 'inset 0 0 0 1px var(--brief-line)' }}
                    >
                      {member.initials || (member.displayName ? member.displayName.slice(0, 1).toUpperCase() : '?')}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-xs font-extrabold text-[var(--brief-ink)] truncate">
                        {member.displayName || (member.handle ? `@${member.handle}` : 'a member')}
                      </span>
                      <span className="block text-[11px] text-[var(--ink-60)] mt-0.5">
                        {ROLE_LABEL[member.role] ?? member.role}
                        {since(member.joinedAt) ? ` · joined ${since(member.joinedAt)}` : ''}
                      </span>
                    </span>
                  </div>
                  <button
                    onClick={() => onToggle(member.userId)}
                    className="shrink-0 text-[11px] font-extrabold text-[var(--brief-ink)] cursor-pointer"
                  >
                    {open ? 'Hide' : 'Evidence'}
                  </button>
                </div>

                {/* Governance row: the coordinator can re-role or remove.
                    Self-governance is not offered here (you leave, you don't
                    remove yourself), and the server refuses it anyway. */}
                {canGovern && member.userId !== currentUserId && (() => {
                  const draft = roleDraft[member.userId] ?? member.role;
                  const changedRole = draft !== member.role;
                  const reasonless = !reason.trim();
                  const removing = confirmRemove === member.userId;
                  return (
                    <div className="pt-1 space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <select
                          value={draft}
                          onChange={(e) => setRoleDraft((prev) => ({ ...prev, [member.userId]: e.target.value as Member['role'] }))}
                          aria-label={`role for ${member.displayName || member.handle || 'this member'}`}
                          disabled={busyUserId === member.userId}
                          className="px-2 py-1 rounded-xl border border-[var(--brief-line)] text-[11px] text-[var(--brief-ink)] cursor-pointer disabled:opacity-50"
                        >
                          {GOV_ROLES.map((r) => (
                            <option key={r} value={r}>{ROLE_LABEL[r] ?? r}</option>
                          ))}
                        </select>
                        {changedRole && (
                          <button
                            onClick={() => {
                              if (reasonless) return;
                              onRole?.(member.userId, draft, reason.trim());
                              setReason('');
                              setRoleDraft((prev) => { const next = { ...prev }; delete next[member.userId]; return next; });
                            }}
                            disabled={busyUserId === member.userId || reasonless}
                            className="px-2.5 py-1 rounded-xl bg-[#40916C] text-[var(--accent-ink)] font-extrabold text-[11px] cursor-pointer disabled:opacity-40"
                          >
                            Save role
                          </button>
                        )}
                        {onTransfer && member.role !== 'coordinator' && (
                          <button
                            onClick={() => onTransfer(member.userId)}
                            disabled={busyUserId === member.userId}
                            className="px-2.5 py-1 rounded-xl border border-[var(--brief-line)] font-bold text-[11px] text-[var(--ink-60)] cursor-pointer disabled:opacity-50"
                          >
                            Hand over the room
                          </button>
                        )}
                        {removing ? (
                          <>
                            <button
                              onClick={() => {
                                if (reasonless) return;
                                onRemove?.(member.userId, reason.trim());
                                setConfirmRemove(null);
                                setReason('');
                              }}
                              disabled={busyUserId === member.userId || reasonless}
                              className="px-2.5 py-1 rounded-xl bg-[var(--color-danger)] text-[var(--accent-ink)] font-extrabold text-[11px] cursor-pointer disabled:opacity-40"
                            >
                              Confirm remove
                            </button>
                            <button
                              onClick={() => { setConfirmRemove(null); setReason(''); }}
                              className="px-2.5 py-1 rounded-xl border border-[var(--brief-line)] font-bold text-[11px] text-[var(--ink-60)] cursor-pointer"
                            >
                              Keep
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => setConfirmRemove(member.userId)}
                            disabled={busyUserId === member.userId}
                            className="ml-auto px-2.5 py-1 rounded-xl border border-[var(--brief-line)] font-bold text-[11px] text-[var(--ink-60)] cursor-pointer disabled:opacity-50"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                      {(changedRole || removing) && (
                        <input
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          placeholder={removing
                            ? 'why are they being removed? the circle sees this'
                            : 'why the change? the circle sees this'}
                          aria-label="reason for this change"
                          maxLength={500}
                          className="w-full px-2.5 py-1.5 rounded-xl border border-[var(--brief-line)] text-[11px] text-[var(--brief-ink)]"
                        />
                      )}
                    </div>
                  );
                })()}

                {/* Verifications: each names a specific check that happened. */}
                {member.trust.evidence.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {member.trust.evidence.map((e) => (
                      <span
                        key={e.kind}
                        className="text-[11px] px-2 py-0.5 rounded-full bg-[color:var(--color-paper)] text-[var(--brief-ink)]"
                      >
                        {e.label}
                      </span>
                    ))}
                  </div>
                )}

                {open && (
                  <div className="pt-1 space-y-2 border-t border-[var(--brief-line)]">
                    {/* Plain factual counts from the server. */}
                    {member.trust.facts.length > 0 && (
                      <ul className="space-y-0.5 mt-2">
                        {member.trust.facts.map((f) => (
                          <li key={f.kind} className="text-[11px] text-[var(--ink-60)]">
                            {f.label}
                          </li>
                        ))}
                      </ul>
                    )}

                    {ev === 'loading' && (
                      <p className="text-[11px] text-[var(--ink-60)]">Loading evidence...</p>
                    )}

                    {ev === 'error' && (
                      <p className="text-[11px] text-[var(--brief-ink)]">
                        Couldn't load this member's history.
                      </p>
                    )}

                    {ev && ev !== 'loading' && ev !== 'error' && (
                      <>
                        {ev.summary.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {ev.summary.map((s) => (
                              <span
                                key={s.kind}
                                className="text-[11px] px-2 py-0.5 rounded-full bg-[var(--color-well)] border border-[var(--brief-line)] text-[var(--ink-60)]"
                              >
                                {s.label}
                              </span>
                            ))}
                          </div>
                        )}

                        {ev.evidence.length === 0 ? (
                          <p className="text-[11px] text-[var(--ink-60)]">
                            No recorded activity in this circle yet.
                          </p>
                        ) : (
                          <ul className="space-y-1">
                            {ev.evidence.slice(0, 10).map((item) => (
                              <li
                                key={item.signalId}
                                className="flex items-center gap-2 text-[11px] text-[var(--ink-60)]"
                              >
                                <span className="min-w-0 truncate">{item.label}</span>
                                <span className="text-[11px] text-[var(--ink-60)] ml-auto shrink-0">
                                  {item.at.slice(0, 10)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}
