import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import WhatDoYouDo from "@/components/onboarding/WhatDoYouDo";
import { onboardingAPI } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  onboardingAPI: {
    getActivities: vi.fn(),
    saveActivities: vi.fn(),
    skipActivities: vi.fn(),
  },
  apiError: (_e, fallback) => fallback,
}));
vi.mock("@/components/ui/Toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const OPTIONS = [
  { key: "run_business", label: "Run a business" },
  { key: "organize_events", label: "Organize events" },
  { key: "work_for_someone", label: "Work for someone" },
];
const pending = { state: "pending", activities: [], options: OPTIONS };

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe("What do you do? card", () => {
  it("offers every option and lets a person pick several at once", async () => {
    onboardingAPI.getActivities.mockResolvedValue({ data: pending });
    render(<WhatDoYouDo />);
    await screen.findByText("What do you do?");
    const run = screen.getByRole("button", { name: "Run a business" });
    fireEvent.click(run);
    fireEvent.click(screen.getByRole("button", { name: "Organize events" }));
    expect(run.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Organize events" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("saves the selection and hides after the answer", async () => {
    onboardingAPI.getActivities.mockResolvedValue({ data: pending });
    onboardingAPI.saveActivities.mockResolvedValue({
      data: { state: "done", activities: ["run_business", "work_for_someone"], options: OPTIONS },
    });
    const { container } = render(<WhatDoYouDo />);
    await screen.findByText("What do you do?");
    fireEvent.click(screen.getByRole("button", { name: "Run a business" }));
    fireEvent.click(screen.getByRole("button", { name: "Work for someone" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(onboardingAPI.saveActivities).toHaveBeenCalledWith(["run_business", "work_for_someone"]));
    await waitFor(() => expect(container.querySelector("section")).toBeNull());
  });

  it("does not save an empty selection", async () => {
    onboardingAPI.getActivities.mockResolvedValue({ data: pending });
    render(<WhatDoYouDo />);
    await screen.findByText("What do you do?");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(onboardingAPI.saveActivities).not.toHaveBeenCalled();
  });

  it("skip hides the card on this device and records the skip", async () => {
    onboardingAPI.getActivities.mockResolvedValue({ data: pending });
    onboardingAPI.skipActivities.mockResolvedValue({ data: { state: "skipped", activities: [], options: OPTIONS } });
    const { container } = render(<WhatDoYouDo />);
    await screen.findByText("What do you do?");
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    await waitFor(() => expect(container.querySelector("section")).toBeNull());
    expect(onboardingAPI.skipActivities).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("brief.whatDoYouDo.dismissed")).toBe("1");
  });

  it("stays hidden for a person who already answered", async () => {
    onboardingAPI.getActivities.mockResolvedValue({
      data: { state: "done", activities: ["run_business"], options: OPTIONS },
    });
    const { container } = render(<WhatDoYouDo />);
    await waitFor(() => expect(onboardingAPI.getActivities).toHaveBeenCalled());
    expect(container.querySelector("section")).toBeNull();
  });

  it("renders nothing when the step cannot be loaded", async () => {
    onboardingAPI.getActivities.mockRejectedValue(new Error("network"));
    const { container } = render(<WhatDoYouDo />);
    await waitFor(() => expect(onboardingAPI.getActivities).toHaveBeenCalled());
    expect(container.querySelector("section")).toBeNull();
  });
});
