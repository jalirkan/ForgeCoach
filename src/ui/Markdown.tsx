/*
 * ForgeCoach — ui/Markdown.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * A deliberately tiny Markdown renderer for coach answers: paragraphs,
 * headings, bullet and numbered lists, bold, italic, inline code, and {X}
 * mana symbols. It builds React elements only — no innerHTML, so untrusted
 * model text can never become markup.
 */
import { memo, type ReactNode } from 'react';
import { SymbolText } from './Mana.tsx';

type Block =
  | { t: 'p'; text: string }
  | { t: 'h'; level: number; text: string }
  | { t: 'ul' | 'ol'; items: string[]; start: number }
  | { t: 'quote'; text: string }
  | { t: 'code'; text: string }
  | { t: 'hr' };

export function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ t: 'p', text: para.join(' ') });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith('```')) body.push(lines[i++]!);
      out.push({ t: 'code', text: body.join('\n') });
      continue;
    }
    if (trimmed === '') {
      flush();
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flush();
      out.push({ t: 'hr' });
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (h) {
      flush();
      out.push({ t: 'h', level: h[1]!.length, text: h[2]! });
      continue;
    }
    const ul = /^[-*•]\s+(.*)$/.exec(trimmed);
    const ol = /^(\d+)[.)]\s+(.*)$/.exec(trimmed);
    if (ul || ol) {
      flush();
      const kind = ul ? 'ul' : 'ol';
      const text = ul ? ul[1]! : ol![2]!;
      const prev = out[out.length - 1];
      if (prev && prev.t === kind) prev.items.push(text);
      else out.push({ t: kind, items: [text], start: ol ? Number(ol[1]) : 1 });
      continue;
    }
    if (trimmed.startsWith('>')) {
      flush();
      const text = trimmed.replace(/^>\s?/, '');
      const prev = out[out.length - 1];
      if (prev && prev.t === 'quote') prev.text += ' ' + text;
      else out.push({ t: 'quote', text });
      continue;
    }
    // Indented continuation of a list item.
    const prev = out[out.length - 1];
    if (para.length === 0 && /^\s{2,}/.test(line) && prev && (prev.t === 'ul' || prev.t === 'ol')) {
      prev.items[prev.items.length - 1] += ' ' + trimmed;
      continue;
    }
    para.push(trimmed);
  }
  flush();
  return out;
}

/** Inline: **bold**, *italic* / _italic_, `code`, {X} symbols. */
export function Inline({ text }: { text: string }): ReactNode {
  const nodes: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(<SymbolText key={k++} text={text.slice(last, m.index)} />);
    const tok = m[0];
    if (tok.startsWith('**') || tok.startsWith('__')) {
      nodes.push(
        <strong key={k++}>
          <SymbolText text={tok.slice(2, -2)} />
        </strong>,
      );
    } else if (tok.startsWith('`')) {
      nodes.push(<code key={k++}>{tok.slice(1, -1)}</code>);
    } else {
      nodes.push(
        <em key={k++}>
          <SymbolText text={tok.slice(1, -1)} />
        </em>,
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(<SymbolText key={k++} text={text.slice(last)} />);
  return <>{nodes}</>;
}

export const Markdown = memo(function Markdown({ text, streaming }: { text: string; streaming?: boolean }) {
  const blocks = parseBlocks(text);
  return (
    <div className={streaming ? 'md md-streaming' : 'md'}>
      {blocks.map((b, i) => {
        switch (b.t) {
          case 'p':
            return (
              <p key={i}>
                <Inline text={b.text} />
              </p>
            );
          case 'h': {
            const Tag = b.level <= 2 ? 'h3' : 'h4';
            return (
              <Tag key={i}>
                <Inline text={b.text} />
              </Tag>
            );
          }
          case 'ul':
            return (
              <ul key={i}>
                {b.items.map((it, j) => (
                  <li key={j}>
                    <Inline text={it} />
                  </li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={i} start={b.start}>
                {b.items.map((it, j) => (
                  <li key={j}>
                    <Inline text={it} />
                  </li>
                ))}
              </ol>
            );
          case 'quote':
            return (
              <blockquote key={i}>
                <Inline text={b.text} />
              </blockquote>
            );
          case 'code':
            return <pre key={i}>{b.text}</pre>;
          case 'hr':
            return <hr key={i} />;
        }
      })}
    </div>
  );
});
