/**
 * IMAGERY for the prototype.
 *
 * Real uploads need storage, and a prototype without a backend should not
 * pretend to have them. These are drawn as small in-palette SVG scenes instead:
 * they render instantly, work offline, cost the same bytes every time, and are
 * obviously illustrations rather than borrowed photographs. The data-saver
 * toggle has something real to hide because their byte size is real.
 */
const svg = (body) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400" width="640" height="400">${body}</svg>`
  )}`;

/** Crates of produce under a market awning. */
export const IMG_MARKET = svg(`
<rect width="640" height="400" fill="#F5EBD3"/>
<rect y="268" width="640" height="132" fill="#E4D6B4"/>
<path d="M0 268h640v10H0z" fill="#D3C299"/>
<g fill="#0B3D2E"><rect x="52" y="196" width="150" height="84" rx="6"/><rect x="222" y="176" width="150" height="104" rx="6"/><rect x="392" y="208" width="150" height="72" rx="6"/></g>
<g fill="#F2C14E"><circle cx="86" cy="182" r="13"/><circle cx="118" cy="176" r="15"/><circle cx="152" cy="184" r="12"/><circle cx="184" cy="178" r="14"/></g>
<g fill="#E07A5F"><circle cx="256" cy="160" r="14"/><circle cx="292" cy="154" r="16"/><circle cx="330" cy="162" r="13"/><circle cx="356" cy="156" r="12"/></g>
<g fill="#1C6A51"><rect x="424" y="192" width="86" height="18" rx="9"/><rect x="424" y="216" width="64" height="18" rx="9"/></g>
<path d="M0 64h640v46H0z" fill="#0B3D2E" opacity="0.92"/>
<path d="M0 110l80 34h480l80-34z" fill="#14523E"/>
<path d="M120 110l40 34M240 110l40 34M360 110l40 34M480 110l40 34" stroke="#0B3D2E" stroke-width="4" opacity="0.35"/>
`);

/** Tide lines on a coastal wall. */
export const IMG_COAST = svg(`
<rect width="640" height="400" fill="#EAF1EE"/>
<rect y="0" width="640" height="150" fill="#CFE0D8"/>
<path d="M0 150c90-26 180 26 270 0s180-30 270-4 100 18 100 18v40H0z" fill="#8FB4A6" opacity="0.7"/>
<rect y="196" width="640" height="204" fill="#F5F0E1"/>
<g stroke="#D6CCB2" stroke-width="3"><path d="M40 240h560M40 300h560M40 360h560"/></g>
<g fill="#0B3D2E"><rect x="60" y="212" width="26" height="26" rx="4"/><rect x="150" y="212" width="26" height="26" rx="4"/><rect x="240" y="212" width="26" height="26" rx="4"/></g>
<g fill="#E07A5F"><circle cx="470" cy="268" r="10"/><circle cx="505" cy="252" r="7"/><circle cx="436" cy="286" r="6"/></g>
<g fill="#F2C14E"><circle cx="90" cy="330" r="18"/><circle cx="132" cy="344" r="12"/></g>
`);

/** Rows of crops and a drying rack. */
export const IMG_FARM = svg(`
<rect width="640" height="400" fill="#F3EFDF"/>
<path d="M0 210h640v190H0z" fill="#DCCFA8"/>
<g stroke="#0B3D2E" stroke-width="8" opacity="0.55">
<path d="M-20 260L660 210M-20 312L660 262M-20 364L660 314"/></g>
<g fill="#1C6A51">
<circle cx="120" cy="252" r="16"/><circle cx="196" cy="243" r="14"/><circle cx="272" cy="234" r="15"/>
<circle cx="348" cy="226" r="13"/><circle cx="424" cy="217" r="15"/></g>
<g fill="#F2C14E"><circle cx="120" cy="252" r="6"/><circle cx="272" cy="234" r="6"/><circle cx="424" cy="217" r="6"/></g>
<rect x="470" y="96" width="120" height="10" rx="5" fill="#0B3D2E"/>
<rect x="480" y="106" width="8" height="96" fill="#0B3D2E"/>
<rect x="572" y="106" width="8" height="96" fill="#0B3D2E"/>
<g fill="#E07A5F"><circle cx="500" cy="120" r="9"/><circle cx="524" cy="120" r="9"/><circle cx="548" cy="120" r="9"/></g>
<g fill="#F2C14E"><circle cx="512" cy="140" r="9"/><circle cx="536" cy="140" r="9"/></g>
`);

export const IMAGERY = { market: IMG_MARKET, coast: IMG_COAST, farm: IMG_FARM };

export default IMAGERY;
