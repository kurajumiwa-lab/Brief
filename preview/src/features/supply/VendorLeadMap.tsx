import React, { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import * as api from "../../api/briefApi";

// ---------------------------------------------------------------------------
// VENDOR + DIRECTORY + COURIER MAP — pins for real rows with real coordinates,
// and nothing else.
//
// Deliberately NOT the "red to green" game: there are no red unknowns (we
// do not know what is in an unwalked area, so we draw nothing there), no
// zone totals (no denominator exists to complete), no heatmap (no density
// truth), and no ranks or revenue (refused outright). A blank patch of map
// is an honest statement: unwalked.
//
// Courier pins are the carrier's own GPS, shared explicitly during an active
// delivery and visible to the errand's parties only. Each pin carries the
// timestamp of its last report — refresh redraws from live rows, and a
// stale pin reads as stale, never animated into motion it did not report.
//
// Tiles: CARTO basemaps (free, no key).
// ---------------------------------------------------------------------------

const STYLE = "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json";
const LEAD_COLORS = {
  captured: "#F59E0B",
  validated: "#2F8F68",
  claimed: "#40916C",
};
const PLACE_COLOR = "#0D1B2A";
const COURIER_COLOR = "#111827";
const COURIER_RING = "#EAB308";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

interface CourierPin {
  id: string;
  what: string;
  lat: number;
  lon: number;
  at: string;
  accuracy: number | null;
}

export function VendorLeadMap() {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [counts, setCounts] = useState({ leads: 0, places: 0, couriers: 0 });
  const [refreshing, setRefreshing] = useState(false);

  const paintCouriers = (map: maplibregl.Map, pins: CourierPin[]) => {
    const data = {
      type: "FeatureCollection",
      features: pins.map((p) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [p.lon, p.lat] },
        properties: {
          name: `Carrier · ${p.what}`,
          detail: `seen ${new Date(p.at).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })}${typeof p.accuracy === "number" ? ` · ±${Math.round(p.accuracy)} m` : ""}`,
        },
      })),
    };
    const existing = map.getSource("couriers") as maplibregl.GeoJSONSource | undefined;
    if (existing) existing.setData(data as any);
    else {
      map.addSource("couriers", { type: "geojson", data } as any);
      map.addLayer({
        id: "courier-pins",
        type: "circle",
        source: "couriers",
        paint: {
          "circle-radius": 9,
          "circle-color": COURIER_COLOR,
          "circle-stroke-width": 3,
          "circle-stroke-color": COURIER_RING,
        },
      });
      map.on("click", "courier-pins", (e: any) => {
        const f = e.features?.[0];
        if (!f) return;
        const coords = (f.geometry as any).coordinates as [number, number];
        new maplibregl.Popup({ closeButton: false })
          .setLngLat(coords)
          .setHTML(
            `<strong>${esc(String(f.properties?.name ?? ""))}</strong><br/>${esc(String(f.properties?.detail ?? ""))}`,
          )
          .addTo(map);
      });
      map.on("mouseenter", "courier-pins", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "courier-pins", () => { map.getCanvas().style.cursor = ""; });
    }
  };

  const readCouriers = async (): Promise<CourierPin[] | null> => {
    const b = await api.getErrandBoard();
    if (!b.ok) return null;
    return b.data.mine
      .filter(
        (e) =>
          (e.status === "accepted" || e.status === "picked_up") &&
          e.carrierPosition !== null &&
          typeof e.carrierPosition.lat === "number",
      )
      .map((e) => ({
        id: e.id,
        what: e.what,
        lat: (e.carrierPosition as NonNullable<typeof e.carrierPosition>).lat,
        lon: (e.carrierPosition as NonNullable<typeof e.carrierPosition>).lon,
        at: (e.carrierPosition as NonNullable<typeof e.carrierPosition>).at,
        accuracy: (e.carrierPosition as NonNullable<typeof e.carrierPosition>).accuracy,
      }));
  };

  useEffect(() => {
    let live = true;
    let map: maplibregl.Map | null = null;
    (async () => {
      const [lr, pr, pins] = await Promise.all([
        api.listVendorLeads(),
        api.listMapPlaces(),
        readCouriers(),
      ]);
      if (!live || !hostRef.current) return;
      if (!lr.ok || !pr.ok || pins === null) {
        setStatus("error");
        return;
      }
      const leads = (lr.data.leads ?? []).filter(
        (l) => typeof l.lat === "number" && typeof l.lon === "number" && l.status !== "dropped",
      );
      const places = (pr.data.places ?? []).filter(
        (p) => typeof p.lat === "number" && typeof p.lon === "number",
      );
      setCounts({ leads: leads.length, places: places.length, couriers: pins.length });
      try {
        map = new maplibregl.Map({
          container: hostRef.current,
          style: STYLE,
          center: [36.8172, -1.2864],
          zoom: 11,
        });
      } catch {
        setStatus("error");
        return;
      }
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      map.on("error", () => {
        if (live) setStatus("error");
      });
      map.on("load", () => {
        if (!live || !map) return;
        const m = map;
        m.addSource("leads", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: leads.map((l) => ({
              type: "Feature",
              geometry: { type: "Point", coordinates: [l.lon as number, l.lat as number] },
              properties: {
                name: l.name,
                detail: `${l.category} · ${l.contact} · ${l.status}`,
              },
            })),
          },
        } as any);
        m.addLayer({
          id: "lead-pins",
          type: "circle",
          source: "leads",
          paint: {
            "circle-radius": 8,
            "circle-color": [
              "match",
              ["get", "status"],
              "validated",
              LEAD_COLORS.validated,
              "claimed",
              LEAD_COLORS.claimed,
              LEAD_COLORS.captured,
            ],
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff",
          },
        });
        m.addSource("places", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: places.map((p) => ({
              type: "Feature",
              geometry: { type: "Point", coordinates: [p.lon, p.lat] },
              properties: {
                name: p.name,
                detail: `${p.category || "place"} · ${p.claimCount === 0 ? "no claimed prices" : `${p.claimCount} claimed price${p.claimCount === 1 ? "" : "s"}`}`,
              },
            })),
          },
        } as any);
        m.addLayer({
          id: "place-pins",
          type: "circle",
          source: "places",
          paint: {
            "circle-radius": 7,
            "circle-color": PLACE_COLOR,
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff",
          },
        });
        const showPopup = (e: any) => {
          const f = e.features?.[0];
          if (!f) return;
          const coords = (f.geometry as any).coordinates as [number, number];
          new maplibregl.Popup({ closeButton: false })
            .setLngLat(coords)
            .setHTML(
              `<strong>${esc(String(f.properties?.name ?? ""))}</strong><br/>${esc(String(f.properties?.detail ?? ""))}`,
            )
            .addTo(m);
        };
        m.on("click", "lead-pins", showPopup);
        m.on("click", "place-pins", showPopup);
        m.on("mouseenter", "lead-pins", () => { m.getCanvas().style.cursor = "pointer"; });
        m.on("mouseenter", "place-pins", () => { m.getCanvas().style.cursor = "pointer"; });
        m.on("mouseleave", "lead-pins", () => { m.getCanvas().style.cursor = ""; });
        m.on("mouseleave", "place-pins", () => { m.getCanvas().style.cursor = ""; });
        paintCouriers(m, pins);
        setStatus("ready");
      });
    })();
    return () => {
      live = false;
      mapRef.current = null;
      try {
        map?.remove();
      } catch {
        /* already gone */
      }
    };
  }, []);

  const refresh = async () => {
    const map = mapRef.current;
    if (!map || refreshing) return;
    setRefreshing(true);
    const pins = await readCouriers();
    if (pins !== null) {
      paintCouriers(map, pins);
      setCounts((c) => ({ ...c, couriers: pins.length }));
    }
    setRefreshing(false);
  };

  if (status === "error") {
    return (
      <section className="request-panel">
        <h2>Map unavailable</h2>
        <p role="alert">The map or its rows could not be read. Nothing is drawn in their place.</p>
      </section>
    );
  }
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div
        ref={hostRef}
        style={{ width: "100%", height: 420, borderRadius: 16, overflow: "hidden", background: "var(--color-well)" }}
        aria-label="Vendor, directory and courier map"
      />
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <p className="request-hint" style={{ margin: 0, flex: 1, minWidth: 200 }}>
          {status === "loading"
            ? "Reading pinned rows…"
            : `${counts.leads} lead${counts.leads === 1 ? "" : "s"} · ${counts.places} directory places · ${counts.couriers} active courier${counts.couriers === 1 ? "" : "s"}. Only rows with coordinates appear — blank areas are unwalked, not empty.`}
        </p>
        <button type="button" onClick={() => void refresh()} disabled={refreshing || status !== "ready"}>
          {refreshing ? "Refreshing…" : "Refresh positions"}
        </button>
      </div>
      <p style={{ margin: 0, fontSize: 12, display: "flex", gap: 12, flexWrap: "wrap" }}>
        {[
          ["Captured lead", LEAD_COLORS.captured],
          ["Validated lead", LEAD_COLORS.validated],
          ["Claimed lead", LEAD_COLORS.claimed],
          ["Directory place", PLACE_COLOR],
          ["Active courier", COURIER_COLOR],
        ].map(([label, color]) => (
          <span key={label} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 999, background: color, display: "inline-block" }} />
            {label}
          </span>
        ))}
      </p>
    </div>
  );
}

export default VendorLeadMap;
