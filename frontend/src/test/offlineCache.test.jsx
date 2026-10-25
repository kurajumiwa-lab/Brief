import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cacheKey, clearCache, dropOtherAccounts, readCache, writeCache,
} from "@/lib/offline";

describe("offline cache", () => {
  beforeEach(() => window.localStorage.clear());

  it("round-trips a document with the time it was saved", () => {
    writeCache("brief", "acct-1", { total: 2 });
    const cached = readCache("brief", "acct-1");
    expect(cached.data).toEqual({ total: 2 });
    expect(Number.isNaN(new Date(cached.savedAt).getTime())).toBe(false);
    expect(cached.accountId).toBe("acct-1");
  });

  it("keeps accounts apart, and the account in use takes the device", () => {
    writeCache("brief", "acct-1", { total: 1 });
    expect(readCache("brief", "acct-1").data).toEqual({ total: 1 });

    // A second account signs in on the same phone.
    writeCache("brief", "acct-2", { total: 9 });
    expect(readCache("brief", "acct-2").data).toEqual({ total: 9 });

    // Reading as acct-2 purged acct-1, so the previous user's copy is gone.
    expect(window.localStorage.getItem(cacheKey("brief", "acct-1"))).toBeNull();
    expect(readCache("brief", "acct-1")).toBeNull();
  });

  it("removes another account's documents when one account takes the device", () => {
    writeCache("brief", "acct-1", { total: 1 });
    writeCache("receipts", "acct-1", [1, 2]);
    dropOtherAccounts("acct-2");
    expect(window.localStorage.getItem(cacheKey("brief", "acct-1"))).toBeNull();
    expect(window.localStorage.getItem(cacheKey("receipts", "acct-1"))).toBeNull();
  });

  it("survives corrupt or hostile storage instead of throwing", () => {
    window.localStorage.setItem(cacheKey("brief", "acct-1"), "{not json");
    expect(readCache("brief", "acct-1")).toBeNull();
    window.localStorage.setItem(cacheKey("brief", "acct-1"), JSON.stringify({ data: 1 }));
    expect(readCache("brief", "acct-1")).toBeNull(); // no savedAt → not a valid cache entry
  });

  it("is cleared on request", () => {
    writeCache("brief", "acct-1", { total: 1 });
    writeCache("receipts", "acct-1", []);
    clearCache("acct-1");
    expect(readCache("brief", "acct-1")).toBeNull();
    expect(readCache("receipts", "acct-1")).toBeNull();
  });

  it("does not throw when storage is unavailable", () => {
    const spy = vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => writeCache("brief", "acct-1", {})).not.toThrow();
    expect(readCache("brief", "acct-1")).toBeNull();
    spy.mockRestore();
  });
});
