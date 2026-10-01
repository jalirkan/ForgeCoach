import { describe, expect, it, vi } from 'vitest';

vi.mock('../claude.ts', () => ({ hasKey: () => false, askClaude: vi.fn() }));

import { getAnswer, startAnswer } from './answers.ts';
import { askClaude } from '../claude.ts';

vi.stubGlobal('requestAnimationFrame', (f: () => void) => setTimeout(f, 0));

describe('startAnswer without an API key', () => {
  it('reports no_key without building the prompt or calling Claude', async () => {
    const makePrompt = vi.fn(async () => ({ system: 's', user: 'u' }));
    await startAnswer('k', makePrompt);
    expect(makePrompt).not.toHaveBeenCalled();
    expect(getAnswer('k')).toMatchObject({ status: 'error', errorKind: 'no_key' });
    expect(askClaude).not.toHaveBeenCalled();
  });
});
