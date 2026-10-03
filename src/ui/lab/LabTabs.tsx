/*
 * ForgeCoach — ui/lab/LabTabs.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The two lab pages' switch: Progress (#lab) and AI ladder (#lab/ladder).
 * Plain links, so each page keeps its own URL and the back button works.
 */
export function LabTabs({ current }: { current: 'progress' | 'ladder' }) {
  return (
    <nav className="lb-tabs" aria-label="Lab pages">
      <a href="#lab" aria-current={current === 'progress' ? 'page' : undefined}>
        Progress
      </a>
      <a href="#lab/ladder" aria-current={current === 'ladder' ? 'page' : undefined}>
        AI ladder
      </a>
    </nav>
  );
}
