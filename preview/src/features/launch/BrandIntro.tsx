import React, { useEffect, useRef, useState } from 'react';
import { WairoMark } from '../../components/WairoMark';
import buildArt from '../../assets/brand/wairo-build.webp';
import goArt from '../../assets/brand/wairo-go.webp';
import { CARD_DURATION_MS } from './launchPolicy';
import './launch.css';

export const BRAND_CARDS = [
  {
    eyebrow: 'Your everyday avenue',
    title: <>Small starts.<br /><em>Big possibilities.</em></>,
    description: 'Open your space. Find your next task. Connect with the people who make things happen.',
    tags: ['Spaces', 'Work', 'Community'],
    image: buildArt,
    alt: 'Colorful illustrated shopfronts joined by a flowing blue avenue.',
    theme: 'build',
  },
  {
    eyebrow: 'Make room for living',
    title: <>Good people.<br /><em>Great plans.</em></>,
    description: 'From city nights to a few days away. Find parties and trips on Wanderly, right here in Wairo.',
    tags: ['Parties', 'Trips', 'Wanderly'],
    image: goArt,
    alt: 'A blue avenue winds from an outdoor music stage through green hills to the coast.',
    theme: 'go',
  },
];

export function BrandIntro({ onDone, durationMs = CARD_DURATION_MS }: { onDone: () => void; durationMs?: number }) {
  const [index, setIndex] = useState(0);
  const [reduced, setReduced] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(document.hidden);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const playing = !paused && !reduced && !hidden && !hovered && !focused;
  const card = BRAND_CARDS[index];

  useEffect(() => { const image = new Image(); image.src = goArt; }, []);
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const motion = () => setReduced(media?.matches ?? false);
    const visibility = () => setHidden(document.hidden);
    media?.addEventListener?.('change', motion);
    document.addEventListener('visibilitychange', visibility);
    return () => { media?.removeEventListener?.('change', motion); document.removeEventListener('visibilitychange', visibility); };
  }, []);
  // Restart the current card's reading time on resume. No hidden-tab countdown.
  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => { if (index === 0) setIndex(1); else doneRef.current(); }, durationMs);
    return () => window.clearTimeout(timer);
  }, [index, playing, durationMs]);

  const next = () => { if (index === 0) setIndex(1); else onDone(); };
  return <section className="wairo-intro" data-testid="brand-intro" aria-label="Welcome to Wairo Blue Avenue" aria-roledescription="slideshow"
    onKeyDown={e => { if (e.key === 'Escape') onDone(); if (e.key === 'ArrowRight') { setPaused(true); setIndex(1); } if (e.key === 'ArrowLeft') { setPaused(true); setIndex(0); } }}>
    <header className="wairo-intro-top">
      <div className="wairo-intro-brand"><WairoMark size={38} title="" /><span><strong>Wairo</strong><small>Blue Avenue</small></span></div>
      <button type="button" className="wairo-intro-skip" onClick={onDone}>Skip intro <span aria-hidden="true">↗</span></button>
    </header>
    <div className="wairo-intro-stage" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)} onBlurCapture={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setFocused(false); }}>
      <article key={card.theme} className={`wairo-brand-card wairo-brand-card--${card.theme}`} aria-label={`Card ${index + 1} of 2`} aria-live={playing ? 'off' : 'polite'}>
        <div className="wairo-brand-art">
          <img src={card.image} alt={card.alt} width="1120" height="752" decoding="async" onError={e => { e.currentTarget.style.visibility = 'hidden'; }} />
          <span className="wairo-art-seal" aria-hidden="true"><WairoMark size={20} title="" /> The avenue is yours.</span>
        </div>
        <div className="wairo-brand-copy">
          <span className="wairo-intro-eyebrow"><i aria-hidden="true" />{card.eyebrow}</span>
          <h1>{card.title}</h1>
          <p>{card.description}</p>
          <ul className="wairo-brand-tags" aria-label="Discover on Wairo">{card.tags.map(tag => <li key={tag}>{tag}</li>)}</ul>
          <button className="wairo-intro-next" type="button" onClick={next}>{index === 0 ? 'Meet your next plan' : 'Enter Wairo'}<span aria-hidden="true">→</span></button>
        </div>
      </article>
    </div>
    <footer className="wairo-intro-bottom">
      <div className="wairo-story-controls"><span className="wairo-story-number">0{index + 1}<span> / 02</span></span>
        <div className="wairo-story-dots" aria-label="Choose brand card">{BRAND_CARDS.map((c, i) => <button type="button" key={c.theme} aria-label={`Show card ${i + 1}`} aria-current={index === i ? 'step' : undefined} onClick={() => { setPaused(true); setIndex(i); }}><span className={i < index ? 'complete' : index === i && playing ? 'playing' : index === i ? 'current' : ''} key={`${index}-${playing}`} style={{ animationDuration: `${durationMs}ms` }} /></button>)}</div>
      </div>
      <p>Business. People. Possibility.</p>
      {!reduced ? <button type="button" className="wairo-playback" aria-label={paused ? 'Play introduction' : 'Pause introduction'} onClick={() => setPaused(p => !p)}>{paused ? 'Play' : 'Pause'}<span aria-hidden="true">{paused ? '▷' : 'Ⅱ'}</span></button> : <span className="wairo-motion-note">Go at your pace</span>}
    </footer>
  </section>;
}
