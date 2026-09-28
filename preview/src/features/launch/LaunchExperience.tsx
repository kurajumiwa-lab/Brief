import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BrandIntro } from './BrandIntro';
import { hasSeenIntro, isIntroPath, rememberIntro, shouldPlayIntro } from './launchPolicy';
import './launch.css';

/** The app loads behind the brand cards, without becoming a second focus surface. */
export function LaunchExperience({ children }: { children: React.ReactNode }) {
  const [show, setShow] = useState(() => shouldPlayIntro(window.location.pathname, window.location.hash, hasSeenIntro()));
  const appRef = useRef<HTMLDivElement>(null);
  const finished = useRef(false);
  useLayoutEffect(() => { document.getElementById('boot-splash')?.remove(); }, []);
  const finish = useCallback((normalizeIntro = true) => {
    rememberIntro(); finished.current = true; setShow(false);
    if (normalizeIntro && isIntroPath(window.location.pathname)) {
      window.history.replaceState(null, '', '/#home');
      window.dispatchEvent(new Event('hashchange'));
    }
  }, []);
  useEffect(() => { if (!show && finished.current) appRef.current?.focus({ preventScroll: true }); }, [show]);
  useEffect(() => {
    const navigation = () => { if (show) finish(false); };
    window.addEventListener('hashchange', navigation); window.addEventListener('popstate', navigation);
    return () => { window.removeEventListener('hashchange', navigation); window.removeEventListener('popstate', navigation); };
  }, [show, finish]);
  return <>
    {show && <BrandIntro onDone={() => finish()} />}
    <div data-wairo-app hidden={show} ref={appRef} tabIndex={-1}>{children}</div>
  </>;
}
