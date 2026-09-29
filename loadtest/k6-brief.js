// Brief_ k6 scenario (Directive v2.1 §6.2).
//
//   k6 run loadtest/k6-brief.js
//   BASE_URL=https://staging.brief.example VENDORS=25 k6 run loadtest/k6-brief.js
//
// The Python harness (`brief_load.py`) needs nothing but the repo; this script
// is for teams that already run k6 and want the same scenario with k6's cloud
// reporting. Both hit the same read paths and assert the same SLOs.
import http from "k6/http";
import { check, group, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";
import { randomItem } from "https://jslib.k6.io/k6-utils/1.4.0/index.js";

const BASE = __ENV.BASE_URL || "http://localhost:8000";
const VENDORS = Number(__ENV.VENDORS || 10);
const PASSWORD = __ENV.LOAD_PASSWORD || "Load-9test";

export const errors = new Rate("brief_errors");
export const apiLatency = new Trend("brief_latency", true);

export const options = {
  scenarios: {
    vendor_network: {
      executor: "ramping-vus",
      startVUs: 1,
      stages: [
        { duration: "10s", target: VENDORS },
        { duration: __ENV.DURATION || "30s", target: VENDORS },
        { duration: "5s", target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.02"],
    http_req_duration: ["p(95)<800", "p(99)<2000"],
    brief_errors: ["rate<0.02"],
  },
};

const ROUTES = [
  "/api/stock/network-stock",
  "/api/stock/my-stock",
  "/api/analytics/overview?days=90",
  "/api/notifications",
  "/api/vendors/network",
  "/api/tools/browse",
  "/api/vendor-lists/browse",
  "/api/stock/movements",
];

export function setup() {
  const tokens = [];
  for (let i = 0; i < VENDORS; i++) {
    const suffix = `${Date.now().toString(36)}${i}`;
    const res = http.post(
      `${BASE}/api/auth/register`,
      JSON.stringify({
        business_name: `Load Vendor ${suffix}`,
        vendor_handle: `load_${suffix}`,
        email: `load_${suffix}@example.com`,
        password: PASSWORD,
        business_categories: ["fresh produce"],
        physical_location: "Nairobi",
      }),
      { headers: { "Content-Type": "application/json" } }
    );
    if (res.status === 201) tokens.push(res.json("access_token"));
  }
  if (tokens.length === 0) throw new Error("no tokens — is the API up, or is the auth rate limit too low?");
  return { tokens };
}

export default function (data) {
  const token = randomItem(data.tokens);
  const params = { headers: { Authorization: `Bearer ${token}` } };

  group("vendor reads", () => {
    const path = randomItem(ROUTES);
    const res = http.get(`${BASE}${path}`, params);
    apiLatency.add(res.timings.duration);
    const ok = check(res, {
      [`${path} → 200`]: (r) => r.status === 200,
    });
    errors.add(!ok);
  });

  sleep(Math.random() * 0.4 + 0.1);
}

export function teardown() {
  // Metrics stay on the server; scrape /api/metrics for the full picture.
  http.get(`${BASE}/api/health`);
}
