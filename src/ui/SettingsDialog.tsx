/*
 * ForgeCoach — ui/SettingsDialog.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { DEFAULT_COACH_SOURCE, DEFAULT_SKIN, LIVE_FAST_MODEL, MODELS, liveModelOf, loadSettings, saveSettings, type CoachSource, type CoachStyle, type CoachThinking, type LiveModel, type ModelId, type Settings, type Skin } from '../claude.ts';
import { chooseSource, pageHelperTarget, type HelperStatus } from '../coachHelper.ts';
import { useCoachAvailability } from './hooks.ts';
import { IconExternal } from './Icons.tsx';
import { Sheet } from './Sheet.tsx';
import { cx } from './util.ts';
import { ScenerySettings } from './ambience/ScenerySettings.tsx';
import { setFeedbackList, useFeedbackList } from './AdviceFeedback.tsx';
import { exportFeedback } from '../feedback.ts';
import { COACH_USE_KEY, coachUseStorage, exportCoachUse, loadCoachUse } from '../coachUse.ts';
import { installOffer, onInstallChange, promptInstall } from '../pwa/install.ts';

/** Coach thinking (mtg-table D346): how long Claude Code on your PC may think before it answers. */
const THINKING: Array<{ id: CoachThinking; label: string; hint: string }> = [
  { id: 'default', label: 'Default', hint: 'As Claude Code chooses' },
  { id: 'low', label: 'Low', hint: 'A short think, then the answer' },
  { id: 'off', label: 'Off', hint: 'Answers soonest' },
];

const STYLES: Array<{ id: CoachStyle; label: string; hint: string }> = [
  { id: 'plan', label: 'Steps', hint: 'A plan in numbered steps, checked against the engine' },
  { id: 'short', label: 'Short', hint: 'A few commands and one line of why' },
  { id: 'detailed', label: 'Detailed', hint: 'The play, the reasons and the trap' },
];

const SOURCES: Array<{ id: CoachSource; label: string; hint: string }> = [
  { id: 'auto', label: 'Automatic', hint: 'Claude Code when it’s running, else your API key' },
  { id: 'helper', label: 'Claude Code', hint: 'On your PC; no key needed' },
  { id: 'apiKey', label: 'API key', hint: 'Your own Anthropic key' },
];

const LOOKS: Array<{ id: Skin; label: string; hint: string }> = [
  { id: 'stack', label: 'Stack', hint: 'Dark table, cream cards, amber calls (default)' },
  { id: 'felt', label: 'Hot Felt', hint: 'Green baize; warmth shows win chance' },
  { id: 'classic', label: 'Classic', hint: 'The original dark look' },
];

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [s, setS] = useState<Settings>(() => safeLoad());
  const [show, setShow] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (open) {
      setS(safeLoad());
      setSaved(false);
      setShow(false);
    }
  }, [open]);
  const save = () => {
    try {
      saveSettings({ ...s, apiKey: s.apiKey.trim() });
      setSaved(true);
      setTimeout(onClose, 450);
    } catch {
      /* storage blocked */
    }
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Settings"
      subtitle="The coach runs on Claude Code on your PC (no key needed) or on your own Anthropic API key. Your settings stay in this browser."
      width={520}
      footer={
        <>
          <button className="btn btn-quiet" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save}>
            {saved ? 'Saved' : 'Save'}
          </button>
        </>
      }
    >
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <h3 className="settings-group">The coach</h3>
        <CoachSourceField s={s} setS={setS} />
        <label className="field">
          <span className="field-label">Anthropic API key</span>
          <div className="field-row">
            <input
              type={show ? 'text' : 'password'}
              value={s.apiKey}
              onChange={(e) => setS({ ...s, apiKey: e.target.value })}
              placeholder="sk-ant-…"
              autoComplete="off"
              spellCheck={false}
            />
            <button type="button" className="btn btn-quiet" onClick={() => setShow((x) => !x)}>
              {show ? 'Hide' : 'Show'}
            </button>
          </div>
          <span className="field-help">
            Kept only in this browser and sent only to Anthropic — ForgeCoach has no server. Use a key with a spending limit.{' '}
            <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" className="link-ext">
              Get a key <IconExternal size={11} />
            </a>
          </span>
        </label>
        <fieldset className="field">
          <legend className="field-label">Coach thinking</legend>
          <div className="model-grid" role="radiogroup" aria-label="Coach thinking">
            {THINKING.map((o) => {
              const on = (s.coachThinking ?? 'default') === o.id;
              return (
                <label key={o.id} className={cx('model-opt', on && 'is-on')}>
                  <input type="radio" name="coachThinking" value={o.id} checked={on} onChange={() => setS({ ...s, coachThinking: o.id })} />
                  <span className="model-name">{o.label}</span>
                  <span className="model-hint">{o.hint}</span>
                </label>
              );
            })}
          </div>
          <span className="field-help">
            How long Claude Code on your PC thinks before it answers, everywhere. During a game the coach styles cap it: Steps
            thinks Low (Off if you pick Off), Short thinks Off (Low if you pick Low). It matters most on Haiku, which otherwise thinks
            at length; Sonnet and Opus always think a little. Your API key ignores it.
          </span>
        </fieldset>

        <h3 className="settings-group">During a game</h3>
        <LiveModelField s={s} setS={setS} />
        <fieldset className="field">
          <legend className="field-label">Coach style</legend>
          <div className="model-grid" role="radiogroup" aria-label="Coach style">
            {STYLES.map((o) => {
              const on = (s.coachStyle ?? 'plan') === o.id;
              return (
                <label key={o.id} className={cx('model-opt', on && 'is-on')}>
                  <input type="radio" name="coachStyle" value={o.id} checked={on} onChange={() => setS({ ...s, coachStyle: o.id })} />
                  <span className="model-name">{o.label}</span>
                  <span className="model-hint">{o.hint}</span>
                </label>
              );
            })}
          </div>
          <span className="field-help">
            How the coach answers while you play. <b>Steps</b> (the default) gives a one-line plan and numbered steps, each checked
            against what the engine allows before you see it — a step that can’t be done goes back to the coach to fix. With
            Auto-coach on, it asks at your opening hand, your turn, a spell of theirs you could answer, your blocks, their end step
            and the engine’s questions. <b>Short</b> gives a few commands (“Play: Shock → their Bears”) and one line of why, with
            the rule and details behind More. <b>Detailed</b> gives the full answer. In Short and Detailed, Auto-coach plans your
            next turn at their end step.
          </span>
        </fieldset>
        <WinChanceField s={s} setS={setS} />

        <h3 className="settings-group">Everything else</h3>
        <fieldset className="field">
          <legend className="field-label">Model</legend>
          <div className="model-grid">
            {MODELS.map((m) => (
              <label key={m.id} className={cx('model-opt', s.model === m.id && 'is-on')}>
                <input type="radio" name="model" value={m.id} checked={s.model === m.id} onChange={() => setS({ ...s, model: m.id as ModelId })} />
                <span className="model-name">{m.label}</span>
                <span className="model-hint">{hint(m.id)}</span>
              </label>
            ))}
          </div>
          <span className="field-help">
            The coach for everything except a game in progress: replays, game and engine reviews, the film room, practice, the deck
            assistant and draft help. Claude Code on your PC uses the same choice.
          </span>
        </fieldset>
        <label className="field check-row">
          <input type="checkbox" checked={s.answerFirst === true} onChange={(e) => setS({ ...s, answerFirst: e.target.checked })} />
          <span>
            <span className="field-label">Answer first</span>
            <span className="field-help">
              The coach opens with the play in one line, then explains. For “Ask coach” in a replay and the Detailed style during a
              game.
            </span>
          </span>
        </label>

        <h3 className="settings-group">The table</h3>
        <fieldset className="field">
          <legend className="field-label">Look</legend>
          <div className="model-grid" role="radiogroup" aria-label="Look">
            {LOOKS.map((o) => {
              const on = (s.skin ?? DEFAULT_SKIN) === o.id;
              return (
                <label key={o.id} className={cx('model-opt', on && 'is-on')}>
                  <input type="radio" name="skin" value={o.id} checked={on} onChange={() => setS({ ...s, skin: o.id })} />
                  <span className="model-name">{o.label}</span>
                  <span className="model-hint">{o.hint}</span>
                </label>
              );
            })}
          </div>
          <span className="field-help">The table, panels and type around the cards, on every screen. Cards always show their real images.</span>
        </fieldset>
        <ScenerySettings />

        <h3 className="settings-group">Your data, kept in this browser</h3>
        <AdviceFeedbackField />
        <CoachUseField />
        <InstallField />
        {s.apiKey && (
          <button
            type="button"
            className="link-btn danger"
            onClick={() => {
              setS({ ...s, apiKey: '' });
            }}
          >
            Forget the key
          </button>
        )}
      </form>
    </Sheet>
  );
}

const modelLabel = (id: ModelId) => MODELS.find((m) => m.id === id)?.label ?? id;

/** The live coach's model (claude.ts `liveModelOf`): Automatic picks the measured fast one. */
function LiveModelField({ s, setS }: { s: Settings; setS: (s: Settings) => void }) {
  const opts: Array<{ id: LiveModel; label: string; hint: string }> = [
    { id: 'auto', label: 'Automatic', hint: `Now ${modelLabel(liveModelOf({ model: s.model, liveModel: 'auto' }))}: quick enough to keep up` },
    ...MODELS.map((m) => ({ id: m.id as LiveModel, label: m.label, hint: hint(m.id) })),
  ];
  const cur = s.liveModel ?? 'auto';
  return (
    <fieldset className="field">
      <legend className="field-label">Live coach model</legend>
      <div className="model-grid" role="radiogroup" aria-label="Live coach model">
        {opts.map((o) => (
          <label key={o.id} className={cx('model-opt', cur === o.id && 'is-on')}>
            <input type="radio" name="liveModel" value={o.id} checked={cur === o.id} onChange={() => setS({ ...s, liveModel: o.id })} />
            <span className="model-name">{o.label}</span>
            <span className="model-hint">{o.hint}</span>
          </label>
        ))}
      </div>
      <span className="field-help">
        The coach while you play: Auto-coach and “Ask about this”. Automatic is {modelLabel(LIVE_FAST_MODEL)}, the fastest model that
        plans a turn well in our tests — or Haiku 4.5 when Model below is Haiku. Pick one to always use it. In the Steps style each
        moment is a fresh question with low thinking, so answers come in seconds.
      </span>
    </fieldset>
  );
}

/** Coach source: the helper's live status and the auto / helper / key choice. Mounted only while the dialog is open. */
function CoachSourceField({ s, setS }: { s: Settings; setS: (s: Settings) => void }) {
  const { helper, recheck } = useCoachAvailability(4000);
  const active = chooseSource(s, helper);
  return (
    <fieldset className="field">
      <legend className="field-label">Coach source</legend>
      <div className="helper-status" role="status" aria-live="polite">
        <span className={cx('helper-dot', helper?.state === 'ok' ? 'is-ok' : helper ? 'is-down' : 'is-checking')} aria-hidden="true" />
        <span className="helper-text">
          <HelperStatusText helper={helper} />
        </span>
        <button type="button" className="link-btn" onClick={recheck}>
          Check again
        </button>
      </div>
      <div className="model-grid" role="radiogroup" aria-label="Coach source">
        {SOURCES.map((o) => (
          <label key={o.id} className={cx('model-opt', s.coachSource === o.id && 'is-on')}>
            <input type="radio" name="coachSource" value={o.id} checked={s.coachSource === o.id} onChange={() => setS({ ...s, coachSource: o.id })} />
            <span className="model-name">{o.label}</span>
            <span className="model-hint">{o.hint}</span>
          </label>
        ))}
      </div>
      <span className="field-help">
        {active === 'helper'
          ? 'Answering now: Claude Code on your PC, with your Claude login. No API key needed.'
          : active === 'apiKey'
            ? 'Answering now: your API key.'
            : s.coachSource === 'apiKey'
              ? 'Add a key below to ask the coach. Until then, “Copy prompt” gives you the question to paste into Claude.'
              : 'No coach yet: start ForgeCoach on your PC with Claude Code logged in, or add a key below. Until then, “Copy prompt” gives you the question to paste into Claude.'}
      </span>
    </fieldset>
  );
}

/** Win chance (mtg-table D361): off by default; shown only while the coach helper has a model. */
function WinChanceField({ s, setS }: { s: Settings; setS: (s: Settings) => void }) {
  const { helper } = useCoachAvailability();
  const model = helper?.eval ?? null;
  return (
    <label className="field check-row">
      <input type="checkbox" checked={s.winChance === true} onChange={(e) => setS({ ...s, winChance: e.target.checked })} />
      <span>
        <span className="field-label">Show win chance</span>
        <span className="field-help">
          An estimate of your chances from a model on your PC, trained on games Forge’s AI played against itself: a strip while you
          play and a line over a replay’s timeline, marking where it fell after your decisions. It sees only what your board shows.{' '}
          {!helper
            ? 'Looking for the engine on your PC…'
            : model
              ? `Model found: ${model.model}.`
              : helper.state === 'ok' || helper.reason === 'not_ready'
                ? 'The engine on your PC has no win-chance model (start it with play.sh --eval-model), so nothing is shown.'
                : 'The engine on your PC isn’t running, so nothing is shown.'}
        </span>
      </span>
    </label>
  );
}

/** Install as an app: only where the browser offers it (Chromium's prompt, or the iOS Safari hint); nothing otherwise. */
function InstallField() {
  const offer = useSyncExternalStore(onInstallChange, () => installOffer());
  if (!offer) return null;
  return (
    <div className="field" data-testid="install-field">
      <span className="field-label">Install</span>
      {offer === 'prompt' ? (
        <>
          <span className="field-help">Add ForgeCoach to your home screen or desktop: it opens full-screen, in its own window.</span>
          <div className="field-row">
            <button type="button" className="btn btn-sm" onClick={() => void promptInstall()}>
              Install ForgeCoach
            </button>
          </div>
        </>
      ) : (
        <span className="field-help">On iPhone and iPad: Share → Add to Home Screen. It then opens full-screen, like an app.</span>
      )}
    </div>
  );
}

/** Settings → Coach use (mtg-table D414): per game against the AI, how many coach answers were shown; the JSON export for the human test set. */
function CoachUseField() {
  const [list, setList] = useState(() => loadCoachUse(coachUseStorage()));
  const used = list.filter((g) => g.plans + g.asks > 0).length;
  const exportJson = () => {
    const text = JSON.stringify(exportCoachUse(list), null, 2);
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `coach-usage-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className="field" data-testid="coach-use-field">
      <span className="field-label">Coach use</span>
      <span className="field-help">
        {list.length
          ? `${list.length} game${list.length === 1 ? '' : 's'} against the bot: ${used} with the coach’s advice, ${list.length - used} without.`
          : 'No game against the bot recorded in this browser yet.'}{' '}
        Per game, how many coach answers you saw and from which model — never the advice. For the lab: save the export in mtg-table’s
        var/ml/human/ folder so its test set knows which games you played with the coach.
      </span>
      {list.length > 0 && (
        <div className="field-row">
          <button type="button" className="btn btn-sm" onClick={exportJson}>
            Export JSON
          </button>
          <button
            type="button"
            className="btn btn-sm btn-quiet"
            onClick={() => {
              if (!confirm('Delete the coach-use record of every game stored in this browser?')) return;
              try {
                coachUseStorage()?.removeItem(COACH_USE_KEY);
              } catch {
                /* blocked storage: nothing to clear */
              }
              setList([]);
            }}
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
}

/** Settings → Advice feedback: how many answers were rated, the JSON export, and clearing it. */
function AdviceFeedbackField() {
  const list = useFeedbackList();
  const up = list.filter((e) => e.vote === 'up').length;
  const exportJson = () => {
    const text = JSON.stringify(exportFeedback(list), null, 2);
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `forgecoach-advice-feedback-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className="field">
      <span className="field-label">Advice feedback</span>
      <span className="field-help">
        {list.length
          ? `${list.length} answer${list.length === 1 ? '' : 's'} rated (${up} helpful, ${list.length - up} not), ${list.filter((e) => e.note).length} with a note.`
          : 'Nothing rated yet: use the thumbs under a coach answer.'}{' '}
        Your vote, your note, the game and moment it was about, and who answered — never the advice itself.
      </span>
      {list.length > 0 && (
        <div className="field-row">
          <button type="button" className="btn btn-sm" onClick={exportJson}>
            Export JSON
          </button>
          <button
            type="button"
            className="btn btn-sm btn-quiet"
            onClick={() => {
              if (confirm('Delete every advice rating stored in this browser?')) setFeedbackList([]);
            }}
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
}

function HelperStatusText({ helper }: { helper: HelperStatus | null }) {
  if (!helper) return <>Looking for Claude Code on your PC…</>;
  if (helper.state === 'ok') {
    return (
      <>
        <b>Detected</b> — Claude Code{helper.claude ? ` ${helper.claude.replace(/\s*\(Claude Code\)\s*$/i, '')}` : ''} on your PC
      </>
    );
  }
  if (helper.reason === 'not_running') {
    return (
      <>
        <b>Not running</b> — start ForgeCoach on your PC (the app-menu launcher, or <code>./scripts/play.sh</code> in mtg-table) with Claude Code installed and logged in.{' '}
        <span className="helper-addr">Looked at {pageHelperTarget().baseUrl}.</span>
      </>
    );
  }
  return (
    <>
      <b>{helper.reason === 'unauthorized' ? 'Refused' : 'Found, not ready'}</b> — {helper.message.replace(/`/g, '')}
    </>
  );
}

function hint(id: string): string {
  if (id.includes('opus')) return 'Best judgement';
  if (id.includes('sonnet')) return 'Fast and sharp';
  if (id.includes('haiku')) return 'Quickest, cheapest';
  return '';
}

function safeLoad(): Settings {
  try {
    return loadSettings();
  } catch {
    return { apiKey: '', model: MODELS[0].id, liveModel: 'auto', coachSource: DEFAULT_COACH_SOURCE, answerFirst: false, coachThinking: 'default', coachStyle: 'plan', skin: DEFAULT_SKIN, winChance: false };
  }
}
