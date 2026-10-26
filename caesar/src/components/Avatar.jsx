import { initials } from "@/lib/format.js";

const TONES = ["", "avatar--gold"];

/** A monogram, not a photo: nobody in this network has uploaded a face yet. */
export default function Avatar({ name = "", id = "", size = "md", gold = false, className = "" }) {
  const tone = gold ? "avatar--gold" : TONES[id.length % 2];
  const scale = size === "sm" ? "avatar--sm" : size === "lg" ? "avatar--lg" : "";
  return (
    <span className={`avatar ${scale} ${tone} ${className}`} aria-hidden="true">
      {initials(name) || "?"}
    </span>
  );
}
