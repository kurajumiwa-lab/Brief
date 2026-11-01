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

/* ── a prop that is passed but not declared is silent data loss ───────────── */

describe("ErrorState renders the reason it was given", () => {
  const Default = () => <div>default-description</div>;

  it("uses `description`", async () => {
    const ErrorState = (await import("@/components/ui/ErrorState")).default;
    render(<ErrorState description="the shelf could not be read" />);
    expect(screen.getByText("the shelf could not be read")).toBeInTheDocument();
  });

  it("also accepts `message` — the prop two screens used and got silence for", async () => {
    // React drops an undeclared prop without a murmur. `PassportPage` and
    // `GrowthPlannerPage` both passed `message`, so the reason they computed was
    // never shown: the reader got "That didn't load" and nothing else.
    const ErrorState = (await import("@/components/ui/ErrorState")).default;
    render(<ErrorState message="your passport could not be loaded" />);
    expect(screen.getByText("your passport could not be loaded")).toBeInTheDocument();
  });

  it("prefers `description` when both are given", async () => {
    const ErrorState = (await import("@/components/ui/ErrorState")).default;
    render(<ErrorState description="chosen" message="ignored" />);
    expect(screen.getByText("chosen")).toBeInTheDocument();
    expect(screen.queryByText("ignored")).not.toBeInTheDocument();
  });

  it("still says something when given neither", async () => {
    const ErrorState = (await import("@/components/ui/ErrorState")).default;
    render(<ErrorState />);
    expect(screen.getByText(/the network or the server didn't answer/i)).toBeInTheDocument();
    expect(Default).toBeTruthy();
  });
});

describe("no screen passes ErrorState a prop it does not declare", () => {
  /**
   * The regression guard for the bug above.
   *
   * A component's props are its contract. React enforces it by discarding
   * anything outside it, silently — so an author who writes `message=` instead
   * of `description=` gets a page that renders a generic sentence and a bug
   * report that says "it just says it didn't load".
   */
  it("every attribute in every <ErrorState> call site is a declared prop", async () => {
    // Parsed, not pattern-matched: a JSX element nested inside a prop
    // (`action={<Button size="sm" />}`) puts whole elements between the angle
    // brackets, and a regular expression cannot tell their attributes from the
    // component's own. An AST can, exactly.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const parser = (await import("@babel/parser")).default
      || (await import("@babel/parser"));

    const parse = parser.parse || parser;

    const source = fs.readFileSync(
      path.resolve(__dirname, "../components/ui/ErrorState.jsx"),
      "utf8"
    );
    const signature = source.slice(
      source.indexOf("export default function ErrorState({"),
      source.indexOf("}) {", source.indexOf("export default function ErrorState({"))
    );
    const declared = new Set(
      [...signature.matchAll(/(\w+)\s*(?:=|,)/g)].map((m) => m[1])
    );

    const root = path.resolve(__dirname, "..");
    const offenders = [];
    const seen = [];

    const visit = (node) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach(visit);

      if (
        (node.type === "JSXOpeningElement" || node.type === "JSXElement") &&
        node.openingElement?.name?.name === "ErrorState"
      ) {
        seen.push(node);
        for (const attr of node.openingElement.attributes) {
          const name = attr.name?.name || (attr.type === "JSXSpreadAttribute" ? "spread" : null);
          if (!name) continue;
          if (name === "spread") {
            offenders.push("a spread attribute hides the props from this check");
            continue;
          }
          if (!declared.has(name) && name !== "key" && !name.startsWith("data-")) {
            offenders.push(`<ErrorState ${name}=…>`);
          }
        }
        return; // children do not belong to this element's prop list
      }
      for (const key of Object.keys(node)) visit(node[key]);
    };

    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "test") walk(full);
        } else if (/\.jsx?$/.test(entry.name)) {
          const ast = parse(fs.readFileSync(full, "utf8"), {
            sourceType: "module",
            plugins: ["jsx"],
          });
          const before = offenders.length;
          visit(ast.program || ast);
          if (offenders.length > before) {
            offenders.splice(before, 0, `in ${path.relative(root, full)}`);
          }
        }
      }
    };
    walk(root);

    expect(offenders).toEqual([]);
    expect(seen.length).toBeGreaterThan(10); // the sweep found the call sites
    expect(declared.has("description")).toBe(true);
    expect(declared.has("message")).toBe(true);
  });
});

// ── the advice that was written and never shown ────────────────────────────
//
// `readGalleryPhoto` composes a specific sentence — HEIC, size, the server's
// refusal — and throws it. Every call site formats the error with `apiError`,
// which used to return its fallback for anything without a `response`, so the
// one sentence written for the person holding the phone was replaced on the way
// to the toast by "Couldn't read that photo". These pin the opt-in.

describe("an error that explains itself", () => {
  it("keeps the upload advice instead of the generic fallback", async () => {
    const { PhotoUploadError } = await import("@/lib/images");
    const err = new PhotoUploadError("That photo is too large — crop it or pick another.");

    expect(apiError(err, "Couldn't read that photo")).toBe(
      "That photo is too large — crop it or pick another."
    );
  });

  it("still refuses to read a stray error's message aloud", () => {
    // A TypeError's text is a bug report, not a sentence for a customer.
    const bug = new TypeError("Cannot read properties of undefined (reading 'files')");
    expect(apiError(bug, "Couldn't read that photo")).toBe("Couldn't read that photo");
  });

  it("keeps the cause's kind but the wrapper's words", async () => {
    const { PhotoUploadError } = await import("@/lib/images");
    const server = Object.assign(new Error("Request failed with status code 503"), {
      response: { status: 503, data: { detail: "upload store unavailable" } },
    });
    const err = new PhotoUploadError(
      "That photo could not be uploaded. Check the connection and try again.",
      server
    );

    const described = describeFailure(err, { subject: "your photo" });
    expect(described.description).toBe(
      "That photo could not be uploaded. Check the connection and try again."
    );
    // The kind still comes from what actually happened, so retry stays truthful.
    expect(described.status).toBe(503);
  });

  it("names HEIC and the server's own reason on a rejected upload", async () => {
    const { readGalleryPhoto } = await import("@/lib/images");
    const { fileAPI } = await import("@/lib/api");
    const spy = vi.spyOn(fileAPI, "upload").mockRejectedValue(
      Object.assign(new Error("Request failed with status code 413"), {
        response: { status: 413, data: { detail: "photo is 9 MB, the limit is 5 MB" } },
      })
    );

    const file = new File([new Uint8Array([0, 1, 2])], "IMG_4821.HEIC", { type: "image/heic" });
    const err = await readGalleryPhoto(file).catch((e) => e);

    expect(err.expose).toBe(true);
    // The server's reason survives, and the phone-specific advice is attached to it.
    expect(err.message).toContain("photo is 9 MB, the limit is 5 MB");
    expect(err.message).toContain("HEIC");
    // And that is what a caller formatting the error will show.
    expect(apiError(err, "Couldn't read that photo")).toContain("5 MB");
    spy.mockRestore();
  });
});

// ── the bug itself must not come back ──────────────────────────────────────
//
// A photograph read into a `data:` URL and saved as its own address renders in
// the tab that made it and nowhere else: the seller sees their picture, every
// buyer sees a blank tile, nobody sees an error. That is what "photos aren't
// visible in the whole app" was. Two pickers still had the fallback months after
// it was removed everywhere else, so it is now checked rather than remembered.

describe("no photo path invents its own address", () => {
  it("nothing outside the tests turns a picked file into a data: URL", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const root = path.resolve(process.cwd(), "src");
    const offenders = [];

    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "test") walk(full);
        } else if (/\.jsx?$/.test(entry.name)) {
          const source = fs.readFileSync(full, "utf8");
          if (/readAsDataURL|new FileReader\s*\(/.test(source)) {
            offenders.push(path.relative(root, full));
          }
        }
      }
    };
    walk(root);

    expect(offenders).toEqual([]);
  });
});

describe("a document picker accepts what a phone actually produces", () => {
  it("every explicit accept list includes HEIC, which is what an iPhone hands over", async () => {
    // The server transcodes HEIC (app/services/images.py). A picker that lists
    // extensions without it greys the file out before the upload is ever tried,
    // so an iPhone photograph of a passport or a certificate simply cannot be
    // selected — and the person has no way to know why.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const root = path.resolve(process.cwd(), "src");
    const offenders = [];
    let seen = 0;

    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "test") walk(full);
        } else if (/\.jsx?$/.test(entry.name)) {
          const source = fs.readFileSync(full, "utf8");
          for (const match of source.matchAll(/accept="(\.[^"]+)"/g)) {
            seen += 1;
            if (!/\.heic|\.heif|image\/\*/.test(match[1])) {
              offenders.push(`${path.relative(root, full)}: accept="${match[1]}"`);
            }
          }
        }
      }
    };
    walk(root);

    expect(offenders).toEqual([]);
    expect(seen).toBeGreaterThan(0); // the sweep found the pickers
  });
});
