/**
 * A FAILED SCREEN MUST NOT ACCUSE THE PERSON LOOKING AT IT.
 *
 * The report was a photograph of a shop front that said:
 *
 *     The database is reachable but its tables do not exist yet.
 *     No vendor answers to @ogallo. The handle may have changed, or the
 *     business may have left the network.
 *
 * Both sentences were wrong. The vendor existed — their shelf rendered one tab
 * away — and the database was not empty either. The only true thing on the page
 * was that a request had failed, and it was the one thing not said.
 *
 * These specs pin the rule: a 5xx is never described in the server's words, a
 * 404 is the only failure that may claim "no such vendor", and a retry is
 * offered only when asking again could work.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

import { apiError } from "@/lib/api";
import { describeFailure, FAILURE_KIND, failureSentence } from "@/lib/failure";
import { mediaUrl } from "@/lib/media";
import StockThumb from "@/components/stock/StockThumb";

const VENDOR = {
  id: "v-1",
  business_name: "Ogallo Hardware",
  vendor_handle: "ogallo",
  current_role: "selling",
  business_categories: ["hardware"],
  network_score: 3,
  parasitism_index: 10,
  total_sourced: 0,
  total_supplied: 0,
  total_stock_moved: 0,
  has_pos_connected: false,
  is_patron: false,
  is_verified: false,
  connected: false,
};

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    vendorAPI: {
      byHandle: vi.fn(),
      performance: vi.fn(() => Promise.resolve({ data: {} })),
      profile: vi.fn(() => Promise.resolve({ data: {} })),
    },
    stockAPI: {
      network: vi.fn(() => Promise.resolve({ data: [] })),
      mine: vi.fn(() => Promise.resolve({ data: [] })),
    },
    passportAPI: { of: vi.fn(() => Promise.resolve({ data: {} })) },
    fileAPI: { ...actual.fileAPI, audit: vi.fn() },
  };
});

import { vendorAPI, fileAPI } from "@/lib/api";
import PhotoAuditCard from "@/components/stock/PhotoAuditCard";

const SCHEMA_503 = {
  response: {
    status: 503,
    data: {
      detail: "The database is missing a column this version needs (column stock_items.brand_line does not exist). The schema is behind the application, not empty.",
      error: "UndefinedColumnError: column stock_items.brand_line does not exist",
      hint: "Run `alembic upgrade head` against this database, then retry.",
      code: "schema_out_of_date",
    },
  },
};

const GENERIC_503 = {
  response: {
    status: 503,
    data: { detail: "The database is reachable but its tables do not exist yet.", hint: "…" },
  },
};

const NOT_FOUND = {
  response: { status: 404, data: { detail: "Vendor not found" } },
};

beforeEach(() => {
  vi.clearAllMocks();
});

/* ── the classifier ───────────────────────────────────────────────────────── */

describe("describeFailure", () => {
  it("names a schema fault as a deployment problem, not as a missing vendor", () => {
    const failure = describeFailure(SCHEMA_503, { subject: "@ogallo" });

    expect(failure.kind).toBe(FAILURE_KIND.SCHEMA);
    expect(failure.title).toMatch(/database is missing part of its schema/i);
    expect(failure.description).toMatch(/deployment fault/i);
    expect(failure.description).not.toMatch(/no vendor answers/i);
    expect(failure.retryable).toBe(true);
    // The operator's sentence is kept, but as detail — never as the headline.
    expect(failure.technical).toContain("stock_items.brand_line");
    expect(failure.title).not.toContain("stock_items.brand_line");
  });

  it("treats a bare 503 as a server fault and still retries", () => {
    const failure = describeFailure(GENERIC_503);
    expect(failure.kind).toBe(FAILURE_KIND.SCHEMA);
    expect(failure.retryable).toBe(true);
  });

  it("only a 404 may claim the thing is gone", () => {
    const failure = describeFailure(NOT_FOUND, { subject: "@ogallo" });
    expect(failure.kind).toBe(FAILURE_KIND.NOT_FOUND);
    expect(failure.description).toMatch(/@ogallo/);
    expect(failure.description).toMatch(/wasn't found|may have changed/i);
    expect(failure.retryable).toBe(false);
  });

  it("so a 500 never does", () => {
    const failure = describeFailure({ response: { status: 500, data: {} } }, { subject: "@ogallo" });
    expect(failure.kind).toBe(FAILURE_KIND.SERVER);
    expect(failure.description).not.toMatch(/no vendor/i);
    expect(failure.description).not.toMatch(/left the network/i);
    expect(failure.retryable).toBe(true);
  });

  it("distinguishes a dead connection from a slow one", () => {
    expect(describeFailure({ message: "Network Error" }).kind).toBe(FAILURE_KIND.OFFLINE);
    expect(describeFailure({ code: "ECONNABORTED" }).kind).toBe(FAILURE_KIND.TIMEOUT);
    expect(describeFailure({}).retryable).toBe(true);
  });

  it("keeps the server's own words out of a toast for a 5xx", () => {
    expect(apiError(GENERIC_503, "fallback")).not.toContain("tables do not exist");
    expect(failureSentence(GENERIC_503)).not.toContain("tables do not exist");
    // …but a 4xx is the server explaining a rule, so it survives.
    expect(apiError({ response: { status: 400, data: { detail: "Minimum order is 10" } } })).toBe(
      "Minimum order is 10"
    );
  });
});

/* ── the shop front ───────────────────────────────────────────────────────── */

async function mountShopFront(handle = "ogallo") {
  const { default: VendorProfile } = await import("@/pages/vendor/VendorProfile");
  return render(
    <MemoryRouter initialEntries={[`/${handle}`]}>
      <Routes>
        <Route path="/:rawHandle" element={<VendorProfile />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("a shop front that fails to load", () => {
  it("says what broke instead of claiming the vendor does not exist", async () => {
    vendorAPI.byHandle.mockRejectedValueOnce(SCHEMA_503);

    await mountShopFront();

    expect(await screen.findByText(/database is missing part of its schema/i)).toBeInTheDocument();
    expect(screen.queryByText(/no vendor answers/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/may have left the network/i)).not.toBeInTheDocument();
    // The headline is never the API's sentence.
    expect(
      screen.queryByText(/The database is reachable but its tables do not exist yet/i)
    ).not.toBeInTheDocument();
  });

  it("folds the server's own message away, readable but not shouted", async () => {
    vendorAPI.byHandle.mockRejectedValueOnce(SCHEMA_503);

    await mountShopFront();

    const disclosure = await screen.findByText(/what the server said/i);
    expect(disclosure).toBeInTheDocument();
    expect(screen.getByText(/stock_items\.brand_line/)).toBeInTheDocument();
  });

  it("offers a retry that actually asks again", async () => {
    vendorAPI.byHandle.mockRejectedValueOnce(SCHEMA_503);

    await mountShopFront();
    const retry = await screen.findByRole("button", { name: /try again/i });

    vendorAPI.byHandle.mockResolvedValueOnce({ data: VENDOR });
    fireEvent.click(retry);

    expect(await screen.findByRole("heading", { name: "Ogallo Hardware" })).toBeInTheDocument();
  });

  it("does not offer a retry that cannot help — a 404", async () => {
    vendorAPI.byHandle.mockRejectedValueOnce(NOT_FOUND);

    await mountShopFront();

    expect(await screen.findByText(/nothing lives at this address/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
    // The one true statement is still made, with the handle the person typed.
    expect(screen.getByText(/@ogallo/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /back to the network/i })).toBeInTheDocument();
  });
});

/* ── the photograph that was not there ───────────────────────────────────── */

describe("an upload that moved host", () => {
  it("rewrites an absolute URL that points at this platform's own media route", () => {
    expect(mediaUrl("http://localhost:8000/static/uploads/a/b.jpg")).toBe("/static/uploads/a/b.jpg");
    expect(mediaUrl("https://brief-old-preview.vercel.app/static/uploads/a/b.jpg")).toBe(
      "/static/uploads/a/b.jpg"
    );
    expect(mediaUrl("https://x.example/uploads/a/b.jpg")).toBe("/static/uploads/a/b.jpg");
  });

  it("leaves a real bucket or data URL alone", () => {
    expect(mediaUrl("https://cdn.example.com/a.jpg")).toBe("https://cdn.example.com/a.jpg");
    expect(mediaUrl("data:image/png;base64,AAA")).toBe("data:image/png;base64,AAA");
  });

  it("says a recorded photo is 'unavailable' rather than pretending there was none", async () => {
    const { container } = render(
      <StockThumb item={{ name: "Supper flour", category: "grains", images: ["/static/uploads/x/y.jpg"] }} />
    );
    expect(container.firstChild).toHaveAttribute("data-photo", "present");

    const img = container.querySelector("img");
    fireEvent.error(img);

    await waitFor(() =>
      expect(container.firstChild).toHaveAttribute("data-photo", "unavailable")
    );
    // The fallback keeps the listing readable — only the picture is missing.
    expect(within(container).getByText(/grains/i)).toBeInTheDocument();
  });
});

/* ── the recovery the seller runs themselves ─────────────────────────────── */

describe("'Check my photos'", () => {
  it("says plainly when every recorded photo can be served", async () => {
    fileAPI.audit.mockResolvedValueOnce({
      data: { store: "db", durable: true, checked: 3, external: 0, missing: [], missing_count: 0 },
    });

    render(<PhotoAuditCard />);
    fireEvent.click(screen.getByRole("button", { name: /check my photos/i }));

    const result = await screen.findByTestId("photo-audit-result");
    expect(result).toHaveTextContent(/all 3 recorded photos can be served/i);
    expect(result).not.toHaveTextContent(/gone from the server/i);
  });

  it("names the records whose photographs are gone, and offers no false comfort", async () => {
    fileAPI.audit.mockResolvedValueOnce({
      data: {
        store: "db",
        durable: true,
        checked: 4,
        external: 0,
        missing_count: 2,
        missing: [
          { where: "stock", id: "s-1", label: "Flour, 50kg", url: "/static/uploads/a/b.jpg" },
          { where: "gallery", id: "p-1", label: "Shop gallery", url: "/static/uploads/c/d.jpg" },
        ],
      },
    });

    render(<PhotoAuditCard />);
    fireEvent.click(screen.getByRole("button", { name: /check my photos/i }));

    const result = await screen.findByTestId("photo-audit-result");
    expect(result).toHaveTextContent(/2 photos are gone from the server/i);
    expect(result).toHaveTextContent("Flour, 50kg");
    expect(result).toHaveTextContent("Shop gallery");
    expect(result).toHaveTextContent(/cannot be recovered/i);
  });

  it("warns when this deployment still cannot keep a file", async () => {
    fileAPI.audit.mockResolvedValueOnce({
      data: { store: "local", durable: false, checked: 0, external: 0, missing: [], missing_count: 0 },
    });

    render(<PhotoAuditCard />);
    fireEvent.click(screen.getByRole("button", { name: /check my photos/i }));

    const result = await screen.findByTestId("photo-audit-result");
    expect(result).toHaveTextContent(/MEDIA_STORE=db/i);
  });

  it("reports a failed check without pretending the photos are fine", async () => {
    fileAPI.audit.mockRejectedValueOnce({
      response: { status: 503, data: { detail: "The database is reachable but its tables do not exist yet." } },
    });

    render(<PhotoAuditCard />);
    fireEvent.click(screen.getByRole("button", { name: /check my photos/i }));

    // The check failed on a broken deployment. It must say so in its own words —
    // and must not print the API's sentence, which is what started all this.
    expect(await screen.findByText(/deployment fault/i)).toBeInTheDocument();
    expect(screen.queryByText(/tables do not exist/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("photo-audit-result")).not.toBeInTheDocument();
  });
});
