/*
 * ForgeCoach — ui/Logo.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
export function Logo({ compact }: { compact?: boolean }) {
  return (
    <span className="logo">
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 9h13l2-3h3v3l-3 2v2H8l-1 2h4v3H5v-3l1-2-3-1z" fill="currentColor" />
      </svg>
      {!compact && (
        <span className="logo-text">
          Forge<b>Coach</b>
        </span>
      )}
    </span>
  );
}
