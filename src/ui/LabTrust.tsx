/*
 * ForgeCoach — ui/LabTrust.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * "Lab number: shaky for 5+ drops" — how far to trust the cube lab's number
 * for this kind of card (cube/labTrust.ts, docs/human-blend.md part 2 B). In
 * the lab's gold (a gold rule, like the Lab numbers it qualifies), never the
 * blue that marks human data. `detail` adds the measurement as a second line
 * (the card sheet); otherwise it is the tooltip.
 */
import type { LabTrust } from '../cube/labTrust.ts';
import { labTrustDetail, labTrustLine } from '../cube/labTrust.ts';
import { cx } from './util.ts';
import './labtrust.css';

export function LabTrustLine({ trust, detail }: { trust: LabTrust | null; detail?: boolean }) {
  if (!trust) return null;
  return (
    <span className={cx('lt', `is-${trust.level}`)} title={detail ? undefined : labTrustDetail(trust)} data-trust={trust.level}>
      <span className="lt-line">{labTrustLine(trust)}</span>
      {detail && <span className="lt-detail">{labTrustDetail(trust)}</span>}
    </span>
  );
}
