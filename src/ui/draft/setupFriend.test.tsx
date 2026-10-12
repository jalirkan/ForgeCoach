/*
 * ForgeCoach — ui/draft/setupFriend.test.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Draft with a friend is a button beside "Begin the draft" (common-sense pass
 * item 7: the top-bar link was missed), with a line under it saying what it
 * needs — the engine on your PC started with the draft room on.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DraftSetup, ROOM_CMD } from './Setup.tsx';

const noop = () => undefined;

describe('Draft with a friend on the Draft vs Bot page', () => {
  it('a button in the footer, beside Begin, with the line about the draft room', () => {
    const html = renderToStaticMarkup(<DraftSetup resume={null} onResume={noop} onAbandon={noop} onBegin={noop} onExit={noop} onPaper={noop} onFriend={noop} hints />);
    const foot = html.slice(html.indexOf('setup-foot'));
    expect(foot).toContain('data-friend-draft');
    expect(foot.indexOf('data-friend-draft')).toBeLessThan(foot.indexOf('btn-begin'));
    expect(html).toContain('setup-friend');
    expect(ROOM_CMD).toBe('./scripts/play.sh --engine-only --lan --draft-room');
  });

  it('no friend route: no button', () => {
    const html = renderToStaticMarkup(<DraftSetup resume={null} onResume={noop} onAbandon={noop} onBegin={noop} onExit={noop} onPaper={noop} hints />);
    expect(html).not.toContain('data-friend-draft');
  });
});
