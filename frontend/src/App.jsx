import { useState, useEffect, useRef } from "react";
import {
  useIsAuthenticated,
  useMsal,
  AuthenticatedTemplate,
  UnauthenticatedTemplate,
} from "@azure/msal-react";
import { InteractionRequiredAuthError } from "@azure/msal-browser";
import { loginRequest } from "./authConfig";

const RADIUS_OPTIONS = [
  { label: "1 km", value: 1000 },
  { label: "2 km", value: 2000 },
  { label: "5 km", value: 5000 },
  { label: "10 km", value: 10000 },
];

// ─── Login screen ────────────────────────────────────────────────────────────
function LoginPage() {
  const { instance } = useMsal();
  const login = () => instance.loginRedirect(loginRequest);

  return (
    <div className="page page--center">
      <div className="login-card">
        <div className="mark" aria-hidden="true">◎</div>
        <h1>Nearby</h1>
        <p className="tagline">Sign in to find your nearest grocery store.</p>
        <button className="search__go login-btn" onClick={login}>
          Sign in with Microsoft
        </button>
      </div>
    </div>
  );
}

// ─── Main app (authenticated) ─────────────────────────────────────────────────
function GroceryFinder() {
  const { instance, accounts } = useMsal();
  const account = accounts[0];

  const [address, setAddress] = useState("");
  const [radius, setRadius] = useState(2000);
  const [status, setStatus] = useState("idle");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const skipNextFetch = useRef(false);
  const boxRef = useRef(null);

  // Silently get a fresh access token, falling back to redirect if needed.
  const getToken = async () => {
    try {
      const res = await instance.acquireTokenSilent({
        ...loginRequest,
        account,
      });
      return res.accessToken;
    } catch (e) {
      if (e instanceof InteractionRequiredAuthError) {
        instance.acquireTokenRedirect({ ...loginRequest, account });
      }
      throw e;
    }
  };

  // Authenticated fetch helper — attaches Bearer token automatically.
  const authFetch = async (url, options = {}) => {
    const token = await getToken();
    return fetch(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
        Authorization: `Bearer ${token}`,
      },
    });
  };

  // Debounced autocomplete
  useEffect(() => {
    if (skipNextFetch.current) { skipNextFetch.current = false; return; }
    if (address.trim().length < 3) { setSuggestions([]); return; }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await authFetch(
          `/autocomplete?q=${encodeURIComponent(address)}`,
          { signal: controller.signal }
        );
        if (!res.ok) return;
        setSuggestions(await res.json());
        setShowSuggestions(true);
        setActiveIndex(-1);
      } catch { /* aborted or token refresh — ignore */ }
    }, 350);

    return () => { clearTimeout(timer); controller.abort(); };
  }, [address]);

  // Close dropdown on outside click
  useEffect(() => {
    const onClick = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target))
        setShowSuggestions(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const pickSuggestion = (s) => {
    skipNextFetch.current = true;
    setAddress(s.display_name);
    setShowSuggestions(false);
    setSuggestions([]);
  };

  const search = async () => {
    setShowSuggestions(false);
    if (address.trim().length < 3) {
      setError("Enter at least a street and city.");
      setStatus("error");
      return;
    }
    setStatus("loading");
    setError("");
    try {
      const params = new URLSearchParams({ address, radius_m: radius });
      const res = await authFetch(`/nearest-grocery?${params}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || "Search failed.");
      }
      setResult(await res.json());
      setStatus("done");
    } catch (e) {
      setError(e.message);
      setStatus("error");
    }
  };

  const onKey = (e) => {
    if (showSuggestions && suggestions.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setActiveIndex((i) => (i + 1) % suggestions.length); return; }
      if (e.key === "ArrowUp")   { e.preventDefault(); setActiveIndex((i) => (i - 1 + suggestions.length) % suggestions.length); return; }
      if (e.key === "Enter" && activeIndex >= 0) { e.preventDefault(); pickSuggestion(suggestions[activeIndex]); return; }
      if (e.key === "Escape") { setShowSuggestions(false); return; }
    }
    if (e.key === "Enter") search();
  };

  const signOut = () => instance.logoutRedirect();

  return (
    <div className="page">
      <header className="masthead">
        <div className="mark" aria-hidden="true">◎</div>
        <h1>Nearby</h1>
        <p className="tagline">
          Type where you are. We'll point you to the closest place to buy
          groceries.
        </p>
        <div className="user-bar">
          <span className="user-bar__name">
            {account?.name || account?.username}
          </span>
          <button className="chip" onClick={signOut}>Sign out</button>
        </div>
      </header>

      <section className="search" aria-label="Search">
        <div className="search__box" ref={boxRef}>
          <input
            className="search__input"
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onFocus={() => suggestions.length && setShowSuggestions(true)}
            onKeyDown={onKey}
            placeholder="123 Main St, Markham, ON"
            aria-label="Your address"
            autoComplete="off"
            role="combobox"
            aria-expanded={showSuggestions}
            aria-controls="suggestion-list"
          />
          {showSuggestions && suggestions.length > 0 && (
            <ul className="suggestions" id="suggestion-list" role="listbox">
              {suggestions.map((s, i) => (
                <li
                  key={`${s.lat}-${s.lon}`}
                  role="option"
                  aria-selected={i === activeIndex}
                  className={`suggestion ${i === activeIndex ? "suggestion--on" : ""}`}
                  onMouseDown={() => pickSuggestion(s)}
                  onMouseEnter={() => setActiveIndex(i)}
                >
                  {s.display_name}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="search__row">
          <div className="radius" role="group" aria-label="Search radius">
            {RADIUS_OPTIONS.map((o) => (
              <button
                key={o.value}
                className={`chip ${radius === o.value ? "chip--on" : ""}`}
                onClick={() => setRadius(o.value)}
                type="button"
              >
                {o.label}
              </button>
            ))}
          </div>
          <button
            className="search__go"
            onClick={search}
            disabled={status === "loading"}
            type="button"
          >
            {status === "loading" ? "Searching…" : "Find groceries"}
          </button>
        </div>
      </section>

      <section className="results" aria-live="polite">
        {status === "error" && <p className="note note--error">{error}</p>}

        {status === "done" && result && (
          <>
            <p className="results__meta">
              {result.count} found near <strong>{result.query}</strong>
            </p>
            {result.stores.length === 0 ? (
              <p className="note">No grocery stores in this radius. Try widening the search.</p>
            ) : (
              <ol className="list">
                {result.stores.map((s, i) => (
                  <li className="card" key={`${s.lat}-${s.lon}-${i}`}>
                    <div className="card__dist">
                      <span className="card__km">{s.distance_km}</span>
                      <span className="card__unit">km</span>
                    </div>
                    <div className="card__body">
                      <h3 className="card__name">{s.name}</h3>
                      <p className="card__addr">{s.address}</p>
                      <span className="card__type">{s.type}</span>
                    </div>
                    <a
                      className="card__map"
                      href={`https://www.openstreetmap.org/?mlat=${s.lat}&mlon=${s.lon}#map=18/${s.lat}/${s.lon}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Map ↗
                    </a>
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
        {status === "idle" && <p className="note">Results will appear here.</p>}
      </section>

      <footer className="foot">
        Data from OpenStreetMap (Nominatim &amp; Overpass).
      </footer>
    </div>
  );
}

// ─── Root: show login or app based on auth state ──────────────────────────────
export default function App() {
  return (
    <>
      <AuthenticatedTemplate>
        <GroceryFinder />
      </AuthenticatedTemplate>
      <UnauthenticatedTemplate>
        <LoginPage />
      </UnauthenticatedTemplate>
    </>
  );
}