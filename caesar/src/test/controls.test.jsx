/**
 * THE CONTROLS THAT ARE EASY TO GET WRONG.
 *
 * Three promises the product makes that a normal social app breaks:
 *
 *   · reporting, blocking and muting are *separate* from disagreement;
 *   · a report never removes anything — a moderator decision does;
 *   · a weak connection never stops you participating, and the app says so
 *     instead of pretending the action was delivered.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, fireEvent, within, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "@/App.jsx";
import { useApp } from "@/store/appStore.js";
import { resetStore } from "./helpers.js";

const open = (route = "/") =>
  render(
    <MemoryRouter initialEntries={[route]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App />
    </MemoryRouter>
  );

const card = (id) => screen.getByTestId(`post-${id}`);

beforeEach(() => {
  resetStore();
});

describe("reporting is not disagreeing", () => {
  it("opens a case and leaves the post exactly where it was", () => {
    open();
    expect(card("p-bypass")).toBeInTheDocument();

    fireEvent.click(within(card("p-bypass")).getByRole("button", { name: /post actions/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /report this post/i }));

    fireEvent.click(screen.getByLabelText(/harassment or a personal attack/i));
    fireEvent.click(screen.getByRole("button", { name: /send report/i }));

    expect(screen.getByTestId("report-sent")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^close$/i }));

    // Still there: a report is a question, not a verdict.
    expect(card("p-bypass")).toBeInTheDocument();
    expect(useApp.getState().reports).toHaveLength(1);
    expect(useApp.getState().posts.find((post) => post.id === "p-bypass").status).toBe("published");
  });

  it("keeps the case visible in the Safety centre", () => {
    const feed = open();
    fireEvent.click(within(card("p-bypass")).getByRole("button", { name: /post actions/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /report this post/i }));
    fireEvent.click(screen.getByLabelText(/spam or a scam/i));
    fireEvent.click(screen.getByRole("button", { name: /send report/i }));
    feed.unmount();

    open("/safety");
    expect(screen.getByText(/spam or a scam/i)).toBeInTheDocument();
    expect(screen.getByText(/status: received/i)).toBeInTheDocument();
  });

  it("cannot send a report without a reason", () => {
    open();
    fireEvent.click(within(card("p-bypass")).getByRole("button", { name: /post actions/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /report this post/i }));
    expect(screen.getByRole("button", { name: /send report/i })).toBeDisabled();
  });
});

describe("blocking and muting are personal, and reversible", () => {
  it("hides a blocked author's posts from the feed without deleting them", () => {
    open();
    const before = screen.getAllByTestId(/^post-/).length;

    fireEvent.click(within(card("p-tomato")).getByRole("button", { name: /post actions/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^block\b/i }));

    expect(screen.queryByTestId("post-p-tomato")).toBeNull();
    expect(screen.getAllByTestId(/^post-/).length).toBe(before - 1);
    // The record still exists; only this viewer stopped seeing it.
    expect(useApp.getState().posts.some((post) => post.id === "p-tomato")).toBe(true);
    expect(useApp.getState().blocks).toContain("u-wekesa");
  });

  it("mutes instead of blocking when asked, and shows it in Safety", () => {
    const feed = open();
    fireEvent.click(within(card("p-kale")).getByRole("button", { name: /post actions/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /mute/i }));

    expect(screen.queryByTestId("post-p-kale")).toBeNull();
    expect(useApp.getState().mutes).toContain("u-grace");
    expect(useApp.getState().blocks).toHaveLength(0);
    feed.unmount();

    open("/safety");
    expect(screen.getAllByText("Grace Njeri").length).toBeGreaterThan(0);
  });

  it("unblocks from the Safety centre and the posts come back", () => {
    const feed = open();
    fireEvent.click(within(card("p-tomato")).getByRole("button", { name: /post actions/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^block\b/i }));
    expect(screen.queryByTestId("post-p-tomato")).toBeNull();
    feed.unmount();

    const safety = open("/safety");
    fireEvent.click(within(safety.container).getByRole("button", { name: /^unblock$/i }));
    expect(useApp.getState().blocks).toHaveLength(0);
    safety.unmount();

    open();
    expect(card("p-tomato")).toBeInTheDocument();
  });
});

describe("a weak connection does not stop you", () => {
  it("queues a reaction while offline, marks it, and sends it on reconnect", async () => {
    open();

    fireEvent.click(screen.getByRole("button", { name: /go offline/i }));
    expect(screen.getByTestId("offline-banner")).toBeInTheDocument();

    fireEvent.click(within(card("p-tomato")).getByRole("button", { name: /support/i }));

    expect(within(card("p-tomato")).getByText("Queued")).toBeInTheDocument();
    expect(useApp.getState().queue).toHaveLength(1);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /go online/i }));
    });

    expect(useApp.getState().queue).toHaveLength(0);
    expect(useApp.getState().preferences.offline).toBe(false);
    expect(screen.queryByTestId("offline-banner")).toBeNull();
  });

  it("keeps one queued intent per post, not one per tap", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: /go offline/i }));
    fireEvent.click(within(card("p-tomato")).getByRole("button", { name: /support/i }));
    fireEvent.click(within(card("p-tomato")).getByRole("button", { name: /disagree/i }));

    expect(useApp.getState().queue).toHaveLength(1);
    expect(useApp.getState().queue[0].value).toBe("down");
  });
});

describe("data saver", () => {
  it("hides the image, says what it would have cost, and loads it on request", () => {
    open();
    const kale = card("p-kale");
    expect(kale.querySelector("img")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /data saver/i }));

    const saved = card("p-kale");
    expect(saved.querySelector("img")).toBeNull();
    expect(within(saved).getByText(/image not loaded — data saver is on/i)).toBeInTheDocument();

    fireEvent.click(within(saved).getByRole("button", { name: /load it/i }));
    expect(card("p-kale").querySelector("img")).not.toBeNull();
  });

  it("states each post's data cost", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: /data saver/i }));
    expect(screen.getAllByText(/for this post$/i).length).toBeGreaterThan(0);
  });
});

describe("the prototype says what it does not do", () => {
  it("lists appeals, privacy and a moderator console as not built", () => {
    open("/safety");
    expect(screen.getByText(/^Appeals\.$/)).toBeInTheDocument();
    expect(screen.getByText(/^Privacy controls\.$/)).toBeInTheDocument();
    expect(screen.getByText(/^A moderator console\.$/)).toBeInTheDocument();
    expect(screen.getByText(/^Money\.$/)).toBeInTheDocument();
    expect(screen.getByText(/^Real media capture\.$/)).toBeInTheDocument();
  });
});

describe("the verdict panel behaves like a dialog", () => {
  it("takes focus, closes on Escape, and gives focus back", () => {
    open();
    // The whole line is a button, so it can hold focus.
    const opener = within(card("p-tomato")).getByText(/confidence from \d+ reactions/i).closest("button");
    opener.focus();
    fireEvent.click(opener);

    const close = screen.getByRole("button", { name: /^close$/i });
    expect(document.activeElement).toBe(close);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});

describe("the composer is honest about its samples", () => {
  it("labels the voice note a sample and says the mic is never opened", () => {
    open("/compose");
    expect(screen.getByRole("button", { name: /voice note \(sample\)/i })).toBeInTheDocument();
    expect(screen.getByText(/does not open your camera or\s+microphone/i)).toBeInTheDocument();
  });
});

describe("language and theme", () => {
  it("switches the interface to Kiswahili", () => {
    open();
    fireEvent.change(screen.getByLabelText(/interface language/i), { target: { value: "sw" } });

    expect(screen.getAllByText("Nyumbani").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Miduara").length).toBeGreaterThan(0);
    expect(useApp.getState().preferences.locale).toBe("sw");
  });

  it("is honest about the languages it has not built", () => {
    open("/safety");
    expect(screen.getByText(/Not built yet, and not pretended/i)).toBeInTheDocument();
  });

  it("switches theme on the document, so every surface follows", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: /dark theme/i }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });
});

describe("composing", () => {
  it("publishes into the chosen circle and lands on that circle", () => {
    open("/compose");

    fireEvent.change(screen.getByLabelText("Your post"), {
      target: { value: "Two lorries of maize arrived at Ahero at 6am. Prices are down 12%." },
    });
    fireEvent.change(screen.getByLabelText("Circle"), { target: { value: "c-kilimo" } });
    fireEvent.click(screen.getByRole("button", { name: /post to circle/i }));

    const created = useApp.getState().posts[0];
    expect(created.circleId).toBe("c-kilimo");
    expect(created.authorId).toBe(useApp.getState().viewerId);
    expect(created.body).toMatch(/Prices are down/);
  });

  it("refuses a post with nothing in it", () => {
    open("/compose");
    fireEvent.change(screen.getByLabelText("Your post"), { target: { value: "hi" } });
    fireEvent.click(screen.getByRole("button", { name: /post to circle/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/eight characters/i);
  });

  it("saves an offline post and marks it queued rather than failing", () => {
    open("/compose");
    fireEvent.click(screen.getByRole("button", { name: /go offline/i }));
    fireEvent.change(screen.getByLabelText("Your post"), {
      target: { value: "Power is out in the whole row. Bring cash, the M-Pesa line is down too." },
    });
    fireEvent.click(screen.getByRole("button", { name: /save and queue/i }));

    expect(useApp.getState().posts[0].body).toMatch(/Power is out/);
    expect(useApp.getState().queue.some((item) => item.type === "post")).toBe(true);
  });

  it("shows what the post will cost before sending, and the photo is the expensive part", () => {
    open("/compose");
    const total = () => screen.getByText(/Estimated data for this post/i).parentElement.textContent;
    const textOnly = total();

    fireEvent.click(screen.getByRole("button", { name: /^farm$/i }));
    const withPhoto = total();
    expect(withPhoto).not.toBe(textOnly);
    expect(withPhoto).toMatch(/KB|MB/);
  });
});

describe("circles", () => {
  it("shows the rules before the join button", () => {
    open("/circles");
    const newcomers = screen.getByText("Campus Innovators KE").closest("article");
    expect(within(newcomers).getByText(/Cite your source/i)).toBeInTheDocument();
    expect(within(newcomers).getByRole("button", { name: /^join$/i })).toBeInTheDocument();
  });

  it("joins and leaves, and the membership is real", () => {
    open("/circles");
    const newcomers = screen.getByText("Campus Innovators KE").closest("article");
    fireEvent.click(within(newcomers).getByRole("button", { name: /^join$/i }));
    expect(useApp.getState().memberships).toContain("c-campus");
    expect(within(screen.getByText("Campus Innovators KE").closest("article")).getByRole("button", { name: /joined/i })).toBeInTheDocument();

    fireEvent.click(within(screen.getByText("Campus Innovators KE").closest("article")).getByRole("button", { name: /joined/i }));
    expect(useApp.getState().memberships).not.toContain("c-campus");
  });

  it("ranks a circle's posts with the same rules as the feed", () => {
    open("/circles/c-market");
    const order = screen.getAllByTestId(/^post-/).map((node) => node.getAttribute("data-testid"));
    expect(order[0]).toBe("post-p-tomato");
    expect(order).toContain("post-p-packaging");
  });
});

describe("profile", () => {
  it("counts contribution, not followers", () => {
    open("/profile");
    expect(screen.getByText(/no follower count on caesar/i)).toBeInTheDocument();
    expect(screen.queryByText(/followers/i)).toBeNull();
    expect(screen.getAllByText(/useful to a community/i).length).toBeGreaterThan(0);
  });

  it("shows the viewer's own post ranked as everyone sees it", () => {
    open("/profile");
    expect(card("p-own-stall")).toBeInTheDocument();
  });
});
