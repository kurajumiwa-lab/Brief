import { clsx } from "clsx";

export const cn = (...inputs) => clsx(inputs);

export const initials = (name = "") =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || "?";

export const truncate = (str = "", n = 60) => (str.length > n ? str.slice(0, n - 1).trimEnd() + "…" : str);

export const slugify = (str = "") =>
  str
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 30);

export const groupBy = (arr = [], key) =>
  arr.reduce((acc, item) => {
    const k = typeof key === "function" ? key(item) : item[key];
    (acc[k] ||= []).push(item);
    return acc;
  }, {});

export const debounce = (fn, wait = 300) => {
  let t;
  const debounced = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
  debounced.cancel = () => clearTimeout(t);
  return debounced;
};

export const titleCase = (s = "") => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** "a, b, c" → ["a","b","c"] */
export const splitList = (s = "") =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

export const numOrNull = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
