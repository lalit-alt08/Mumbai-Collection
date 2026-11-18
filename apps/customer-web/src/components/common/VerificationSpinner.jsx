import React from "react";

/**
 * Modern iOS/Tick-Style Verification Spinner
 * Matches the checkout verification spinner with 12 graduated opacity tick marks.
 */
export default function VerificationSpinner({ className = "h-5 w-5 text-[#22499F]" }) {
  return (
    <svg
      className={`animate-spin shrink-0 ${className}`}
      style={{ animation: "spin 0.85s linear infinite" }}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect x="11" y="1.5" width="2" height="5" rx="1" fill="currentColor" opacity="1.0" />
      <rect x="11" y="1.5" width="2" height="5" rx="1" fill="currentColor" opacity="0.92" transform="rotate(30 12 12)" />
      <rect x="11" y="1.5" width="2" height="5" rx="1" fill="currentColor" opacity="0.84" transform="rotate(60 12 12)" />
      <rect x="11" y="1.5" width="2" height="5" rx="1" fill="currentColor" opacity="0.75" transform="rotate(90 12 12)" />
      <rect x="11" y="1.5" width="2" height="5" rx="1" fill="currentColor" opacity="0.67" transform="rotate(120 12 12)" />
      <rect x="11" y="1.5" width="2" height="5" rx="1" fill="currentColor" opacity="0.58" transform="rotate(150 12 12)" />
      <rect x="11" y="1.5" width="2" height="5" rx="1" fill="currentColor" opacity="0.5" transform="rotate(180 12 12)" />
      <rect x="11" y="1.5" width="2" height="5" rx="1" fill="currentColor" opacity="0.42" transform="rotate(210 12 12)" />
      <rect x="11" y="1.5" width="2" height="5" rx="1" fill="currentColor" opacity="0.33" transform="rotate(240 12 12)" />
      <rect x="11" y="1.5" width="2" height="5" rx="1" fill="currentColor" opacity="0.25" transform="rotate(270 12 12)" />
      <rect x="11" y="1.5" width="2" height="5" rx="1" fill="currentColor" opacity="0.17" transform="rotate(300 12 12)" />
      <rect x="11" y="1.5" width="2" height="5" rx="1" fill="currentColor" opacity="0.1" transform="rotate(330 12 12)" />
    </svg>
  );
}
