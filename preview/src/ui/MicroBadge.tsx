// ---------------------------------------------------------------------------
// MICRO BADGE — one small, border-anchored label for compact metadata.
//
// The critique's spec: secondary metadata (status, tags, counts) goes into a
// "subtle micro-badge (#40916C border)" instead of eating horizontal card
// space. This is that badge — token-based, three variants, no arbitrary hex.
// It is a PRESENTATION primitive: it renders a label, never invents one.
// ---------------------------------------------------------------------------

import React from "react";

export type MicroBadgeTone = "neutral" | "primary" | "success" | "warning" | "danger";

export interface MicroBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: MicroBadgeTone;
  children: React.ReactNode;
}

const TONE_BORDER: Record<MicroBadgeTone, string> = {
  neutral: "var(--color-border)",
  primary: "var(--color-primary)", // bronze
  success: "var(--color-success)",
  warning: "var(--color-warning)",
  danger: "var(--color-danger)"
};

const TONE_TEXT: Record<MicroBadgeTone, string> = {
  neutral: "var(--color-text-muted)",
  primary: "var(--color-text)",
  success: "var(--color-success)",
  warning: "var(--color-warning)",
  danger: "var(--color-danger)"
};

export function MicroBadge({ tone = "neutral", children, style, ...rest }: MicroBadgeProps) {
  return (
    <span
      {...rest}
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "1px 8px",
        borderRadius: "var(--radius-pill)",
        border: `1px solid ${TONE_BORDER[tone]}`,
        color: TONE_TEXT[tone],
        background: "var(--color-surface)",
        fontSize: "10px",
        fontWeight: 700,
        lineHeight: "16px",
        whiteSpace: "nowrap",
        ...style
      }}
    >
      {children}
    </span>
  );
}
