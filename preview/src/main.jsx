import './index.css';
import './ui/theme.css';
import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { LaunchExperience } from './features/launch/LaunchExperience';
import { BrandLoading } from './features/launch/BrandLoading';
// Independent public entry points do not mount private shell effects.
// The legacy App.tsx remains a test harness, not the production shell.
const ReviewsPage = lazy(() => import('./features/reviews/ReviewsPage'));
const OrderTrackingPage = lazy(() => import('./features/tracking/OrderTrackingPage'));
const WanderlyPage = lazy(() => import('./features/wanderly/WanderlyPage'));
const AppShell = lazy(() => import('./app/AppShell.tsx').then(m => ({ default: m.AppShell })));
const PublicGroupsPage = lazy(() => import('./components/PublicGroupsPage').then(m => ({ default: m.PublicGroupsPage })));
import { flushOfflineQueue } from './api/briefApi.ts';
import { captureAcquisitionFromUrl } from './api/acquisition.ts';

// Capture the partner/cohort provenance from the landing URL before anything
// else runs, so a member who arrived through a partner's join link is
// attributed at sign-up (first-touch-wins on the server).
captureAcquisitionFromUrl();

// /groups is the anonymous directory; /c/:slug is a deliberately public event.
// Other paths enter the authenticated-capable application shell.
const slug = /^\/c\/([A-Za-z0-9_-]+)\/?$/.exec(window.location.pathname)?.[1] ?? null;

// OFFLINE QUEUE RECONNECT TRIGGER.
//
// Writes that fail on a dead signal are parked in localStorage (offlineQueue.ts)
// and replayed oldest-first. This is the listener that actually flushes them:
// the moment the browser regains a connection, parked writes send themselves —
// the server's idempotency keys make a replayed write harmless (never a double
// sale). Without this, the queue fills but nothing drains it.
function installOfflineFlush() {
  let flushing = false;
  const flush = async () => {
    if (flushing) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    flushing = true;
    try {
      await flushOfflineQueue();
    } catch {
      /* a failed flush stays queued; the next online event retries */
    } finally {
      flushing = false;
    }
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('online', flush);
    // Returning to the tab (visibilitychange) is another natural moment to
    // drain anything that queued while the phone was asleep or on a dead link.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void flush();
    });
  }
}
installOfflineFlush();

function Root() {
  if (/^\/reviews(?:\/[A-Za-z0-9_-]+)?\/?$/.test(window.location.pathname)) return <ReviewsPage />;
  if (/^\/track\/?$/.test(window.location.pathname)) return <OrderTrackingPage />;
  if (/^\/groups\/?$/.test(window.location.pathname)) return <PublicGroupsPage />;
  if (slug) return <WanderlyPage initialSlug={slug} />;
  return <AppShell />;
}

// A failed lazy chunk must offer recovery rather than an endless splash.
class StartupBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <div className="wairo-loading" role="alert"><h1>Wairo Blue Avenue</h1><p>We couldn’t open the app. Check your connection and try again.</p><button className="wairo-intro-next" onClick={() => window.location.reload()}>Try again →</button></div> : this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <LaunchExperience><StartupBoundary><Suspense fallback={<BrandLoading />}><Root /></Suspense></StartupBoundary></LaunchExperience>
  </React.StrictMode>
);
