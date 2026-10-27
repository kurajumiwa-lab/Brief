import { Link } from "react-router-dom";
import { Gauge, Languages, Moon, Sun, Wifi, WifiOff } from "lucide-react";
import { CaesarLogo } from "./Logo.jsx";
import { useApp } from "@/store/appStore.js";
import { LOCALES } from "@/lib/i18n.js";

/**
 * The bar carries the three controls that change how much the app costs you:
 * language, data, and whether you are connected at all. They are in the chrome
 * rather than buried in settings because, for most of this network, they are
 * the settings that matter.
 */
export default function TopBar() {
  const preferences = useApp((state) => state.preferences);
  const setPreference = useApp((state) => state.setPreference);
  const goOnline = useApp((state) => state.goOnline);
  const goOffline = useApp((state) => state.goOffline);
  const queueLength = useApp((state) => state.queue.length);

  const toggleTheme = () => {
    const next = preferences.theme === "dark" ? "light" : "dark";
    setPreference("theme", next);
    document.documentElement.setAttribute("data-theme", next);
  };

  return (
    <header className="topbar">
      <div className="topbar__inner">
        <Link to="/" aria-label="Caesar home">
          <CaesarLogo size={30} />
        </Link>

        <div className="grow" />

        <div className="topbar__tools">
          {/* A native select sizes itself to its longest option, which on a
              390px phone pushed the whole top bar 15px past the edge. The code
              is what fits; the full name is in the accessible label and in the
              option text behind it. */}
          <label className="iconbtn topbar__lang" title="Language">
            <Languages size={16} aria-hidden="true" />
            <select
              value={preferences.locale}
              onChange={(event) => setPreference("locale", event.target.value)}
              aria-label={`Interface language: ${LOCALES.find((l) => l.code === preferences.locale)?.native || preferences.locale}`}
              className="topbar__lang-select"
            >
              {LOCALES.map((locale) => (
                <option key={locale.code} value={locale.code}>
                  {locale.code.toUpperCase()}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            className="iconbtn"
            aria-pressed={preferences.dataSaver}
            aria-label="Data saver"
            title="Data saver — hide images and show what each post costs"
            onClick={() => setPreference("dataSaver", !preferences.dataSaver)}
          >
            <Gauge size={17} aria-hidden="true" />
          </button>

          <button
            type="button"
            className="iconbtn"
            aria-pressed={preferences.offline}
            aria-label={preferences.offline ? "Go online" : "Go offline"}
            title={preferences.offline ? "Offline — actions are queued" : "Online"}
            onClick={() => (preferences.offline ? goOnline() : goOffline())}
          >
            {preferences.offline ? <WifiOff size={17} aria-hidden="true" /> : <Wifi size={17} aria-hidden="true" />}
            {queueLength > 0 && (
              <span className="iconbtn__badge" aria-hidden="true">
                {queueLength}
              </span>
            )}
          </button>

          <button
            type="button"
            className="iconbtn"
            aria-label={preferences.theme === "dark" ? "Light theme" : "Dark theme"}
            title="Theme"
            onClick={toggleTheme}
          >
            {preferences.theme === "dark" ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}
          </button>
        </div>
      </div>
    </header>
  );
}
