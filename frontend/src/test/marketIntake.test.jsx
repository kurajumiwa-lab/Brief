import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * The two halves of thread J, from the browser's side:
 *
 *   · the intake desk turns a gallery selection into rows a person confirms,
 *     one press each, and never saves anything unconfirmed;
 *   · the market-data screen shows prices to a member and withholds the seller,
 *     showing the seller only when the API says the caller is a partner.
 *
 * The second is the commercial contract of the whole feature, so it is asserted
 * on what is and is not in the document, not on the shape of the payload.
 */

const ok = (data) => Promise.resolve({ data });
const MATCH = {
  id: "o-1",
  product: "Maya diapers bale",
  price_kes: 2100,
  quantity: null,
  unit: null,
  category: "household",
  market: "Kikomba",
  confidence: 0.88,
  raw_line: "Maya diapers bale@ksh 2100/-",
};

vi.mock("@/lib/api", () => {
  const apiError = (e, fallback = "Something went wrong") => e?.response?.data?.detail || fallback;
  return {
    default: {},
    apiError,
    intakeAPI: {
      upload: vi.fn(() =>
        ok({
          id: "b-1",
          image_count: 2,
          lines_read: 41,
          ocr_engine: "rapidocr",
          seller_hint: "Khetia",
          phone_hint: "+254104211141",
          presence: { virtual_id: "~khetia" },
          observations: [MATCH],
          skipped: [],
        })
      ),
      fromText: vi.fn(() => ok({ id: "b-2", observations: [MATCH], skipped: [], lines_read: 1 })),
      batches: vi.fn(() => ok({ batches: [] })),
      batch: vi.fn(() => ok({})),
      decide: vi.fn(() => ok({ id: "o-1", status: "confirmed" })),
    },
    // The payloads below are copied from the running API, not invented: the
    // access block, the category rows and `items` are what it actually returns.
    marketDataAPI: {
      summary: vi.fn(() =>
        ok({
          access: {
            tier: "member",
            label: "Member",
            shows: ["products", "prices", "markets"],
            hides: ["sellers", "contacts"],
            upgrade: {
              label: "Request seller contacts",
              note: "Seller names and phone numbers are included in the Business and Enterprise plans. Billing is not live yet.",
              to: "/storefront?desk=business_software",
            },
          },
          observations: 23,
          sellers: 4,
          pending_review: 9,
          categories: [
            { category: "household", count: 6, price_min_kes: 800, price_max_kes: 5500 },
            { category: "food", count: 4, price_min_kes: 1400, price_max_kes: 5800 },
          ],
        })
      ),
      observations: vi.fn(() =>
        ok({
          access: { tier: "member", label: "Member", shows: [], hides: ["sellers"], upgrade: null },
          count: 1,
          items: [{ ...MATCH, id: "o-1", seller: null, seller_hidden: true, created_at: "2026-10-20T10:00:00" }],
        })
      ),
      claim: vi.fn(() => ok({})),
    },
    fileAPI: {
      upload: vi.fn(() => ok({ url: "/api/files/test/photo.jpg" })),
      uploadMany: vi.fn((files = []) =>
        ok({ files: files.map((f) => ({ url: `/api/files/test/${f.name}` })), count: files.length })
      ),
      limits: vi.fn(() => ok({})),
    },
  };
});

import * as api from "@/lib/api";
import MarketIntakePage from "@/pages/intake/MarketIntakePage";
import MarketDataPage from "@/pages/market/MarketDataPage";

const mount = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("market intake desk", () => {
  it("reads a batch of photographs and holds every row until it is kept", async () => {
    mount(<MarketIntakePage />);

    const picker = await screen.findByLabelText(/choose photos from your gallery|choose photos/i);
    fireEvent.change(picker, {
      target: {
        files: [
          new File(["a"], "a.jpg", { type: "image/jpeg" }),
          new File(["b"], "b.jpg", { type: "image/jpeg" }),
        ],
      },
    });

    // both photographs go up in one request
    await waitFor(() => expect(api.fileAPI.uploadMany).toHaveBeenCalled());
    expect(api.fileAPI.uploadMany.mock.calls[0][0]).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: /read the market/i }));

    const row = await screen.findByTestId("intake-row");
    expect(within(row).getByText("Maya diapers bale")).toBeInTheDocument();
    expect(within(row).getByText(/ksh 2,100/i)).toBeInTheDocument();
    // the reader is named, so an operator knows what produced the number
    expect(screen.getByText(/read by rapidocr/i)).toBeInTheDocument();
    // the seller is named without being given an account
    expect(screen.getByText("~khetia")).toBeInTheDocument();

    fireEvent.click(within(row).getByRole("button", { name: /^keep$/i }));
    await waitFor(() => expect(api.intakeAPI.decide).toHaveBeenCalledWith("o-1", "confirmed"));
    expect(await within(row).findByText("Kept")).toBeInTheDocument();
  });

  it("never calls the API with nothing to read", async () => {
    mount(<MarketIntakePage />);
    expect(await screen.findByRole("button", { name: /read the market/i })).toBeDisabled();
    expect(api.intakeAPI.upload).not.toHaveBeenCalled();
    expect(api.intakeAPI.fromText).not.toHaveBeenCalled();
  });

  it("reads pasted text when there is no photograph", async () => {
    mount(<MarketIntakePage />);
    fireEvent.click(await screen.findByRole("button", { name: /paste text instead/i }));
    fireEvent.change(screen.getByLabelText(/what the sign says/i), {
      target: { value: "Maya diapers bale@ksh 2100/-" },
    });
    fireEvent.click(screen.getByRole("button", { name: /read the market/i }));
    await waitFor(() => expect(api.intakeAPI.fromText).toHaveBeenCalled());
    expect(await screen.findByTestId("intake-row")).toBeInTheDocument();
  });
});

describe("market data", () => {
  it("shows the price and withholds the seller on a member plan", async () => {
    mount(<MarketDataPage />);
    expect(await screen.findByText("Maya diapers bale")).toBeInTheDocument();
    expect(screen.getByText(/ksh 2,100/i)).toBeInTheDocument();
    expect(screen.getByText(/seller withheld on your plan/i)).toBeInTheDocument();
    // and it offers the upgrade by name, without pretending to charge for it
    expect(screen.getByText("Request seller contacts")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /request the contacts/i })).toHaveAttribute(
      "href",
      "/storefront?desk=business_software"
    );
    // the free layer's shape is honest about the spread, not just one number
    expect(screen.getByRole("option", { name: /household — KSh 800–5,500/i })).toBeInTheDocument();
  });

  it("names the seller when the API says the caller is a partner", async () => {
    api.marketDataAPI.observations.mockResolvedValueOnce(
      ok({
        access: { tier: "partner", label: "Partner", shows: ["sellers"], hides: [], upgrade: null },
        count: 1,
        items: [
          {
            ...MATCH,
            id: "o-2",
            seller: { virtual_id: "~khetia", label: "Khetia Pekee", phone: "+254104211141" },
            seller_hidden: false,
          },
        ],
      })
    );
    mount(<MarketDataPage />);
    expect(await screen.findByText(/Khetia Pekee/)).toBeInTheDocument();
    expect(screen.getByText(/\+254104211141/)).toBeInTheDocument();
    expect(screen.queryByText(/seller withheld/i)).not.toBeInTheDocument();
  });

  it("says every row is a seen price, not a quotation", async () => {
    mount(<MarketDataPage />);
    await screen.findByText("Maya diapers bale");
    expect(screen.getByText(/a photograph of a board, not a quotation/i)).toBeInTheDocument();
  });
});
