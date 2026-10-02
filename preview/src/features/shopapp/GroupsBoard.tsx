import React, { useCallback, useEffect, useState } from 'react';
import { Users, Check } from 'lucide-react';
import * as briefApi from '../../api/briefApi';
import type { Circle } from '../../api/types';
import type { GroupBuy, GroupDirectoryRow } from '../../api/briefApi';
import { kes } from './format';
import { soundEngine } from '../../utils/SoundEngine';

// ---------------------------------------------------------------------------
// GROUPS — structured business groups, not chat rooms.
//
// Three shelves, each from its own real rows:
//   * Your groups — the circles the signed-in person is in (or can join).
//   * Open groups — the directory of listed business groups, with one honest
//     action each: Join (when the server says canJoin), In (when it says
//     isMember), Request (when it says canRequest).
//   * Group orders — the group buys the signed-in person runs, with the
//     real target, stage and contribution count.
// A failed fetch collapses to its own line, because "sign in to see your
// groups" is a state, not an error to hide.
// ---------------------------------------------------------------------------

const Head: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="text-[11px] font-black uppercase tracking-wider mt-2" style={{ color: 'var(--color-text-muted)' }}>
    {children}
  </p>
);

const JoinButton: React.FC<{
  onClick: () => void;
  label: string;
  done?: boolean;
  disabled?: boolean;
}> = ({ onClick, label, done, disabled }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[11px] font-black cursor-pointer disabled:cursor-default"
    style={done
      ? { background: '#E7F2EC', color: '#166534' }
      : { background: '#0A0E14', color: '#EAB308' }}
  >
    {done && <Check className="w-3 h-3" />}
    {label}
  </button>
);

export const GroupsBoard: React.FC = () => {
  const [circles, setCircles] = useState<Circle[] | null>(null);
  const [circlesNote, setCirclesNote] = useState('');
  const [dir, setDir] = useState<GroupDirectoryRow[] | null>(null);
  const [buys, setBuys] = useState<GroupBuy[] | null>(null);
  const [joined, setJoined] = useState<Record<string, boolean>>({});
  const [joining, setJoining] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  };

  useEffect(() => {
    let live = true;
    briefApi.getCircles().then((res) => {
      if (!live) return;
      if (res.ok) setCircles(res.data);
      else setCirclesNote(res.error ?? 'Your groups could not be loaded.');
    });
    briefApi.getGroupDirectory().then((res) => {
      if (!live) return;
      if (res.ok) setDir(res.data.groups);
    });
    briefApi.listGroupBuys().then((res) => {
      if (!live) return;
      if (res.ok) setBuys(res.data);
    });
    return () => { live = false; };
  }, []);

  const join = useCallback(async (id: string) => {
    setJoining(id);
    const res = await briefApi.joinCircle(id);
    setJoining(null);
    if (res.ok) {
      setJoined((m) => ({ ...m, [id]: true }));
      soundEngine.play('reward');
      flash('You\u2019re in \u2713');
    } else {
      flash(res.error ?? 'That join was refused.');
    }
  }, []);

  const myCircles = circles ?? [];
  const openGroups = (dir ?? []).filter((g) => !g.isMember);
  const inGroups = (dir ?? []).filter((g) => g.isMember);

  return (
    <div className="space-y-2">
      {toast && (
        <div className="rounded-2xl px-4 py-2 text-[12px] font-bold animate-fadeIn"
          style={{ background: '#0A0E14', color: '#FFFFFF' }}>
          {toast}
        </div>
      )}

      <Head>Your groups</Head>
      {circles === null && !circlesNote && <p className="text-[12px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>Loading…</p>}
      {circlesNote && <p className="text-[12px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>{circlesNote}</p>}
      {myCircles.length === 0 && !circlesNote && (
        <p className="text-[12px] font-semibold px-1" style={{ color: 'var(--color-text-muted)' }}>None yet — join one below, or start one in your profile.</p>
      )}
      {myCircles.map((c) => (
        <div key={c.id} className="rounded-3xl p-3.5 flex items-center gap-3"
          style={{ background: 'var(--color-paper)', boxShadow: '0 2px 10px rgba(10,14,20,0.05)' }}>
          <span className="w-9 h-9 rounded-xl grid place-items-center shrink-0" style={{ background: '#EFEAF7', color: '#6D28D9' }}>
            <Users className="w-4 h-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-bold truncate" style={{ color: 'var(--color-text)' }}>{c.name}</p>
            <p className="text-[11px] font-semibold tabular-nums" style={{ color: 'var(--color-text-muted)' }}>
              {c.memberCount} {c.memberCount === 1 ? 'member' : 'members'}
              {c.directory?.industry ? ` · ${c.directory.industry}` : ''}
            </p>
          </div>
          {c.isMember ? (
            <span className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[11px] font-black" style={{ background: '#E7F2EC', color: '#166534' }}>
              <Check className="w-3 h-3" /> In
            </span>
          ) : c.canJoin ? (
            <JoinButton label={joining === c.id ? '…' : 'Join'} disabled={joining === c.id} onClick={() => join(c.id)} />
          ) : null}
        </div>
      ))}

      <Head>Open groups</Head>
      {openGroups.length === 0 && dir !== null && (
        <p className="text-[12px] font-semibold px-1" style={{ color: 'var(--color-text-muted)' }}>No listed groups right now.</p>
      )}
      {openGroups.map((g) => (
        <div key={g.id} className="rounded-3xl p-3.5 flex items-center gap-3"
          style={{ background: 'var(--color-paper)', boxShadow: '0 2px 10px rgba(10,14,20,0.05)' }}>
          <span className="w-9 h-9 rounded-xl grid place-items-center shrink-0" style={{ background: '#EFEAF7', color: '#6D28D9' }}>
            <Users className="w-4 h-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-bold truncate" style={{ color: 'var(--color-text)' }}>{g.name}</p>
            <p className="text-[11px] font-semibold truncate" style={{ color: 'var(--color-text-muted)' }}>
              {[g.industry, g.location].filter(Boolean).join(' · ')}
              {typeof g.memberCount === 'number' ? ` · ${g.memberCount} members` : ''}
            </p>
            {g.purposes.length > 0 && (
              <p className="text-[11px] font-semibold truncate" style={{ color: 'var(--color-text-muted)' }}>{g.purposes.join(' · ')}</p>
            )}
          </div>
          {joined[g.id] ? (
            <span className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[11px] font-black" style={{ background: '#E7F2EC', color: '#166534' }}>
              <Check className="w-3 h-3" /> In
            </span>
          ) : g.canJoin ? (
            <JoinButton label={joining === g.id ? '…' : 'Join'} disabled={joining === g.id} onClick={() => join(g.id)} />
          ) : g.canRequest ? (
            <p className="shrink-0 text-[11px] font-black" style={{ color: 'var(--color-text-muted)' }}>By request</p>
          ) : null}
        </div>
      ))}
      {inGroups.length > 0 && (
        <p className="text-[11px] font-semibold px-1" style={{ color: 'var(--color-text-muted)' }}>
          In {inGroups.map((g) => g.name).join(', ')}
        </p>
      )}

      <Head>Group orders</Head>
      {buys === null && <p className="text-[12px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>Loading…</p>}
      {(buys ?? []).length === 0 && buys !== null && (
        <p className="text-[12px] font-semibold px-1" style={{ color: 'var(--color-text-muted)' }}>No group orders you run yet.</p>
      )}
      {(buys ?? []).map((b) => (
        <div key={b.id} className="rounded-3xl p-4"
          style={{ background: 'var(--color-paper)', boxShadow: '0 2px 10px rgba(10,14,20,0.05)' }}>
          <div className="flex items-center justify-between gap-3">
            <p className="text-[13px] font-bold truncate" style={{ color: 'var(--color-text)' }}>{b.title}</p>
            <span className="shrink-0 text-[11px] font-black uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>{b.stage}</span>
          </div>
          <div className="mt-2 flex items-center gap-3">
            <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: '#EEF1F5' }}>
              <div className="h-full rounded-full" style={{ width: `${Math.min(100, b.progressPct ?? 0)}%`, background: '#0A0E14' }} />
            </div>
            <p className="shrink-0 text-[11px] font-black tabular-nums" style={{ color: 'var(--color-text)' }}>
              {kes(b.total)} / {kes(b.targetAmount)}
            </p>
          </div>
          <p className="mt-1.5 text-[11px] font-semibold tabular-nums" style={{ color: 'var(--color-text-muted)' }}>
            {b.contributionCount} {b.contributionCount === 1 ? 'contribution' : 'contributions'}
          </p>
        </div>
      ))}
    </div>
  );
};

export default GroupsBoard;
