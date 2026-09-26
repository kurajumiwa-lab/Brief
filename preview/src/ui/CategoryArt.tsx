import React from 'react';

/** Original, filled category illustrations. Navigation art, never product photos.
    One calm family: every tile is mint, every ink is forest, pine, sage, navy
    or white. Nothing here may equal the action accent (#40916C): art that is
    also "the primary button" makes every CTA look like a label. */
export function CategoryArt({ kind, className = '' }: { kind: string; className?: string }) {
  const key = ({ circles: 'groups', group: 'groups', community: 'groups', business: 'shops', side_hustle: 'shops', creator: 'services', bulk: 'groupBuys', direct: 'shops', niche: 'services', delivery: 'runs', pickup: 'groupBuys', food: 'food', skilled: 'services', care: 'groups', other: 'services', all: 'shops' } as Record<string, string>)[kind] ?? kind;
  const palettes: Record<string, string> = { shops: '#D8F3DC', events: '#D8F3DC', groups: '#D8F3DC', errands: '#D8F3DC', runs: '#D8F3DC', groupBuys: '#D8F3DC', services: '#D8F3DC', food: '#D8F3DC' };
  return <svg viewBox="0 0 88 80" className={`category-art ${className}`} aria-hidden="true" focusable="false" data-category-art={key}>
    <rect x="3" y="3" width="82" height="74" rx="25" fill={palettes[key] ?? '#D8F3DC'} />
    <ellipse cx="45" cy="66" rx="27" ry="5" fill="#101820" opacity=".1" />
    {key === 'shops' ? <>
      <rect x="19" y="31" width="51" height="32" rx="5" fill="#FFFFFF" />
      <path d="M18 21h51l6 19H13z" fill="#1B4332" /><path d="M25 21h9l-2 19H21zm19 0h9l2 19H43zm19 0h6l6 19H64z" fill="#52B788" />
      <path d="M13 39h12v3a6 6 0 0 1-12 0zm24 0h13v3a6.5 6.5 0 0 1-13 0zm26 0h12v3a6 6 0 0 1-12 0z" fill="#1B4332" />
      <rect x="27" y="49" width="15" height="14" rx="2" fill="#1B4332" /><rect x="48" y="48" width="15" height="10" rx="2" fill="#95D5B2" />
    </> : key === 'events' ? <>
      <rect x="19" y="20" width="51" height="44" rx="8" fill="#fff" transform="rotate(-7 44 42)" />
      <path d="M17 26q-1-7 7-8l35-4q8-1 9 7l1 9-51 6z" fill="#1B4332" />
      <rect x="28" y="13" width="5" height="14" rx="2.5" fill="#0D1B2A" /><rect x="55" y="10" width="5" height="14" rx="2.5" fill="#0D1B2A" />
      <path d="m46 37 4 7 8 1-6 6 1 8-7-4-7 4 1-8-6-6 8-1z" fill="#52B788" />
    </> : key === 'groups' ? <>
      <circle cx="27" cy="31" r="10" fill="#1B4332" /><circle cx="61" cy="31" r="10" fill="#1B4332" /><path d="M11 60V49q0-12 16-12t16 12v11z" fill="#1B4332" /><path d="M46 60V49q0-12 15-12t15 12v11z" fill="#1B4332" />
      <circle cx="44" cy="27" r="12" fill="#1B4332" /><path d="M24 64V50q0-14 20-14t20 14v14z" fill="#1B4332" /><path d="m39 38 5 7 5-7" fill="#fff" />
    </> : key === 'errands' ? <>
      <path d="M21 29h46l5 36H16z" fill="#52B788" /><path d="M31 32v-9a13 13 0 0 1 26 0v9h-6v-9a7 7 0 0 0-14 0v9z" fill="#1B4332" />
      <circle cx="45" cy="49" r="12" fill="#fff" /><path d="m37 49 5 5 10-11 4 4-14 13-9-8z" fill="#1B4332" />
    </> : key === 'runs' ? <>
      <circle cx="23" cy="58" r="10" fill="#0D1B2A" /><circle cx="66" cy="58" r="10" fill="#0D1B2A" /><circle cx="23" cy="58" r="4" fill="#fff" /><circle cx="66" cy="58" r="4" fill="#fff" />
      <path d="M23 52h26l11-21h7l-5 14q12 0 13 9H22z" fill="#52B788" /><rect x="17" y="37" width="25" height="16" rx="3" fill="#95D5B2" /><path d="M28 37h5v16h-5z" fill="#1B4332" />
      <path d="M42 45h13l2 5H39z" fill="#0D1B2A" /><rect x="59" y="26" width="14" height="5" rx="2.5" fill="#0D1B2A" />
    </> : key === 'groupBuys' ? <>
      <path d="m17 34 23-10 27 10-24 12z" fill="#95D5B2" /><path d="m17 34 26 12v22L17 56z" fill="#1B4332" /><path d="m43 46 24-12v22L43 68z" fill="#52B788" /><path d="m29 29 26 12v10l-7 3V44L23 33z" fill="#FFFFFF" />
      <path d="M41 29 44 9h18l4 20z" fill="#1B4332" /><path d="M49 12h7v13h-7z" fill="#95D5B2" />
    </> : key === 'food' ? <>
      <ellipse cx="44" cy="47" rx="28" ry="20" fill="#fff" /><ellipse cx="44" cy="46" rx="20" ry="13" fill="#95D5B2" /><path d="M25 40q8-18 19-5 14-13 19 6z" fill="#52B788" /><circle cx="40" cy="47" r="6" fill="#1B4332" />
    </> : <>
      <rect x="19" y="30" width="50" height="34" rx="7" fill="#52B788" /><path d="M33 30v-9h22v9h-6v-4H39v4z" fill="#1B4332" /><path d="M19 42q25 13 50 0v7q-25 13-50 0z" fill="#95D5B2" /><rect x="40" y="43" width="8" height="10" rx="2" fill="#0D1B2A" />
    </>}
  </svg>;
}
