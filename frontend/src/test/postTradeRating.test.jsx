import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const api = vi.hoisted(() => ({
  status: vi.fn(),
  record: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  postTradeRatingAPI: api,
  apiError: (_e, fallback) => fallback,
}));

const flags = vi.hoisted(() => ({ on: true }));
vi.mock("@/config/flags", () => ({
  get POST_TRADE_RATING_GATE_ENABLED() { return flags.on; },
}));

const { default: PostTradeRatingPrompt } = await import("@/components/ratings/PostTradeRatingPrompt");

beforeEach(() => {
  api.status.mockReset();
  api.record.mockReset();
  flags.on = true;
});

describe("PostTradeRatingPrompt", () => {
  it("lets a client rate a completed trade with stars", async () => {
    api.status.mockResolvedValue({ data: { final: false, rated_by_me: false, can_rate_as: "client" } });
    api.record.mockResolvedValue({ data: { final: true } });
    render(<PostTradeRatingPrompt kind="appointment" subjectId="a-1" />);

    const submit = await screen.findByRole("button", { name: /submit rating/i });
    expect(submit).toBeDisabled();
    expect(screen.getByText(/used to show how reliable a business is/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "4 stars" }));
    fireEvent.click(submit);

    await waitFor(() => expect(api.record).toHaveBeenCalledWith({
      subject_kind: "appointment", subject_id: "a-1", outcome: "completed", stars: 4,
    }));
    expect(api.status).toHaveBeenCalledWith("appointment", "a-1");
  });

  it("lets a supplier record a failed or fraudulent trade, with no stars", async () => {
    api.status.mockResolvedValue({ data: { final: false, rated_by_me: false, can_rate_as: "supplier" } });
    api.record.mockResolvedValue({ data: { final: true } });
    render(<PostTradeRatingPrompt kind="movement" subjectId="m-1" />);

    expect(await screen.findByText(/record what went wrong/i)).toBeInTheDocument();
    expect(screen.queryByRole("radio")).toBeNull();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "fraud" } });
    fireEvent.click(screen.getByRole("button", { name: /record outcome/i }));

    await waitFor(() => expect(api.record).toHaveBeenCalledWith(expect.objectContaining({
      subject_kind: "movement", subject_id: "m-1", outcome: "fraud",
    })));
    expect(api.record.mock.calls[0][0]).not.toHaveProperty("stars");
  });

  it("shows nothing when there is nothing to do", async () => {
    api.status.mockResolvedValue({ data: { final: false, rated_by_me: false, can_rate_as: null } });
    const { container } = render(<PostTradeRatingPrompt kind="appointment" subjectId="a-2" />);
    await waitFor(() => expect(api.status).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("does nothing at all while the gate is off, and calls no route", () => {
    flags.on = false;
    const { container } = render(<PostTradeRatingPrompt kind="appointment" subjectId="a-3" />);
    expect(container).toBeEmptyDOMElement();
    expect(api.status).not.toHaveBeenCalled();
  });
});
