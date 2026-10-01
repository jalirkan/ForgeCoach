/*
 * ForgeCoach — ui/GuideSheet.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Pick the deck play guide the coach reads, and edit guides in place.
 */
import { useEffect, useState } from 'react';
import { activeGuideId, deleteGuide, isBuiltinGuide, listGuides, newGuideId, saveGuide, setActiveGuideId, type Guide } from '../guide.ts';
import { IconPlus, IconTrash } from './Icons.tsx';
import { Sheet } from './Sheet.tsx';
import { cx } from './util.ts';

function safe<T>(f: () => T, fb: T): T {
  try {
    return f();
  } catch {
    return fb;
  }
}

export function GuideSheet({ open, onClose, onChange }: { open: boolean; onClose: () => void; onChange: () => void }) {
  const [guides, setGuides] = useState<Guide[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [editing, setEditing] = useState<Guide | null>(null);
  const [dirty, setDirty] = useState(false);

  const refresh = () => {
    setGuides(safe(listGuides, []));
    setActive(safe(activeGuideId, null));
  };
  useEffect(() => {
    if (open) {
      refresh();
      setEditing(null);
      setDirty(false);
    }
  }, [open]);

  const pick = (id: string | null) => {
    safe(() => setActiveGuideId(id), undefined);
    setActive(id);
    onChange();
  };
  const edit = (g: Guide) => {
    setEditing({ ...g });
    setDirty(false);
  };
  const create = () => {
    const g: Guide = { id: safe(newGuideId, `user:${Date.now().toString(36)}`), name: 'New guide', text: '' };
    setEditing(g);
    setDirty(true);
  };
  const save = () => {
    if (!editing) return;
    safe(() => saveGuide({ ...editing, name: editing.name.trim() || 'Untitled guide', text: editing.text }), undefined);
    setDirty(false);
    refresh();
    onChange();
  };
  const remove = () => {
    if (!editing) return;
    const builtin = safe(() => isBuiltinGuide(editing.id), false);
    if (!confirm(builtin ? `Reset “${editing.name}” to the built-in text?` : `Delete “${editing.name}”?`)) return;
    safe(() => deleteGuide(editing.id), undefined);
    if (!builtin && active === editing.id) pick(null);
    setEditing(null);
    refresh();
    onChange();
  };

  return (
    <Sheet open={open} onClose={onClose} title="Play guides" subtitle="The coach reads the selected guide with every question." width={640}>
      <div className="guides">
        <div className="guide-list" role="radiogroup" aria-label="Active guide">
          <GuideRow name="No guide" sub="Coach from the cards alone" on={active === null} onPick={() => pick(null)} />
          {guides.map((g) => (
            <GuideRow
              key={g.id}
              name={g.name}
              sub={g.text.split('\n').find((l) => l.trim()) ?? 'Empty'}
              on={active === g.id}
              onPick={() => pick(g.id)}
              onEdit={() => edit(g)}
              editing={editing?.id === g.id}
            />
          ))}
          <button className="btn btn-quiet guide-new" onClick={create}>
            <IconPlus size={14} /> New guide
          </button>
        </div>
        {editing && (
          <div className="guide-editor">
            <label className="field">
              <span className="field-label">Name</span>
              <input
                value={editing.name}
                onChange={(e) => {
                  setEditing({ ...editing, name: e.target.value });
                  setDirty(true);
                }}
              />
            </label>
            <label className="field">
              <span className="field-label">Guide</span>
              <textarea
                rows={12}
                value={editing.text}
                placeholder="Lead with fodder, hold payoffs until there's an outlet…"
                onChange={(e) => {
                  setEditing({ ...editing, text: e.target.value });
                  setDirty(true);
                }}
              />
            </label>
            <div className="guide-actions">
              {guides.some((g) => g.id === editing.id) && (
                <button className="btn btn-quiet danger" onClick={remove}>
                  <IconTrash size={14} /> {safe(() => isBuiltinGuide(editing.id), false) ? 'Reset' : 'Delete'}
                </button>
              )}
              <span className="grow" />
              <button className="btn btn-quiet" onClick={() => setEditing(null)}>
                Close
              </button>
              <button className="btn btn-primary" onClick={save} disabled={!dirty}>
                {dirty ? 'Save guide' : 'Saved'}
              </button>
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}

function GuideRow({
  name,
  sub,
  on,
  onPick,
  onEdit,
  editing,
}: {
  name: string;
  sub: string;
  on: boolean;
  onPick: () => void;
  onEdit?: () => void;
  editing?: boolean;
}) {
  return (
    <div className={cx('guide-row', on && 'is-on', editing && 'is-editing')}>
      <button className="guide-pick" role="radio" aria-checked={on} onClick={onPick}>
        <span className="radio" aria-hidden="true" />
        <span className="guide-text">
          <span className="guide-row-name">{name}</span>
          <span className="guide-row-sub">{sub}</span>
        </span>
      </button>
      {onEdit && (
        <button className="btn btn-quiet btn-sm" onClick={onEdit}>
          Edit
        </button>
      )}
    </div>
  );
}
