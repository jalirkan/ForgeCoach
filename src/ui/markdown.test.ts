import { describe, expect, it } from 'vitest';
import { parseBlocks } from './Markdown.tsx';

describe('parseBlocks', () => {
  it('splits paragraphs, headings and lists', () => {
    const b = parseBlocks('## Play\nCast **Bolt**.\n\n- one\n- two\n\n1. a\n2. b\n> trap');
    expect(b.map((x) => x.t)).toEqual(['h', 'p', 'ul', 'ol', 'quote']);
    expect(b[2]).toMatchObject({ items: ['one', 'two'] });
  });
  it('keeps html as plain text', () => {
    const b = parseBlocks('<img src=x onerror=alert(1)>');
    expect(b).toEqual([{ t: 'p', text: '<img src=x onerror=alert(1)>' }]);
  });
});
