import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { BoardMetrics, GenParams, PlayParams } from '../core/types.js';
import {
  GEN_FIELDS,
  PLAY_FIELDS,
  REGENERATE_DEBOUNCE_MS,
  formatFixed,
  formatInt,
  formatMs,
  formatPercent,
  parseFieldInput,
  randomSeed,
  withGenField,
  withPlayField,
  type FieldSpec,
  type GenFieldKey,
  type PlayFieldKey,
} from './devPanel.js';

interface DevPanelProps {
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly genParams: GenParams;
  readonly playParams: PlayParams;
  readonly metrics: BoardMetrics | null;
  /** Metrics read off the board on screen failed; the board itself is unaffected. */
  readonly metricsError: string | null;
  /** Set when the last parameter change could not generate a board; the old board stays live. */
  readonly regenerateError: string | null;
  readonly onApply: (genParams: GenParams, playParams: PlayParams) => void;
}

function NumberField<K extends string>(props: {
  readonly field: FieldSpec<K>;
  readonly value: number;
  readonly onDraft: (value: number) => void;
  readonly onCommitNow: () => void;
}): ReactElement {
  const { field, value, onDraft, onCommitNow } = props;
  return (
    <label className="dev-field">
      <span className="dev-field-label">{field.label}</span>
      <input
        type="range"
        min={field.min}
        max={field.max}
        step={field.step}
        value={value}
        onChange={(event) => onDraft(parseFieldInput(event.target.value, field, value))}
        onPointerUp={onCommitNow}
        onKeyUp={onCommitNow}
      />
      <span className="dev-field-value">
        {field.integer ? formatInt(value) : formatFixed(value, 2)}
      </span>
    </label>
  );
}

/**
 * Collapsed by default so it never covers the board during play. React owns
 * this chrome only — every parameter change goes through `onApply`, which the
 * caller uses to drive the board controller; nothing here touches a canvas.
 */
export function DevPanel(props: DevPanelProps): ReactElement {
  const { open, onToggle, genParams, playParams, metrics, metricsError, regenerateError, onApply } =
    props;

  const [draftGen, setDraftGen] = useState<GenParams>(genParams);
  const [draftPlay, setDraftPlay] = useState<PlayParams>(playParams);
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  // The board can change without the panel asking — a resumed save mounts on
  // its own parameters, not the ones the sliders were built from. Adopting
  // them while an edit is still pending would discard what is being typed, so
  // this yields to the debounce rather than overriding it.
  useEffect(() => {
    if (timerRef.current !== undefined) return;
    setDraftGen(genParams);
    setDraftPlay(playParams);
  }, [genParams, playParams]);

  const scheduleApply = (nextGen: GenParams, nextPlay: PlayParams): void => {
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = undefined;
      onApply(nextGen, nextPlay);
    }, REGENERATE_DEBOUNCE_MS);
  };

  const flush = (): void => {
    if (timerRef.current === undefined) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = undefined;
    onApply(draftGen, draftPlay);
  };

  const draftGenField = (key: GenFieldKey, value: number): void => {
    const next = withGenField(draftGen, key, value);
    setDraftGen(next);
    scheduleApply(next, draftPlay);
  };

  const draftPlayField = (key: PlayFieldKey, value: number): void => {
    const next = withPlayField(draftPlay, key, value);
    setDraftPlay(next);
    scheduleApply(draftGen, next);
  };

  const rollSeed = (): void => {
    const next = withGenField(draftGen, 'seed', randomSeed());
    setDraftGen(next);
    window.clearTimeout(timerRef.current);
    timerRef.current = undefined;
    onApply(next, draftPlay);
  };

  const seedField = GEN_FIELDS.find((field) => field.key === 'seed');

  if (!open) {
    return (
      <button type="button" className="dev-panel-toggle" onClick={onToggle}>
        Tune
      </button>
    );
  }

  return (
    <div className="dev-panel">
      <div className="dev-panel-head">
        <span>Tuning</span>
        <button type="button" onClick={onToggle}>
          Close
        </button>
      </div>

      {regenerateError !== null ? (
        <p className="dev-panel-error" role="alert">
          Could not generate with these parameters, board unchanged: {regenerateError}
        </p>
      ) : null}

      <div className="dev-field-group">
        {seedField !== undefined ? (
          <label className="dev-field">
            <span className="dev-field-label">{seedField.label}</span>
            <input
              type="number"
              min={seedField.min}
              max={seedField.max}
              step={1}
              value={draftGen.seed}
              onChange={(event) =>
                draftGenField('seed', parseFieldInput(event.target.value, seedField, draftGen.seed))
              }
              onBlur={flush}
            />
            <button type="button" onClick={rollSeed}>
              New seed
            </button>
          </label>
        ) : null}

        {GEN_FIELDS.filter((field) => field.key !== 'seed').map((field) => (
          <NumberField
            key={field.key}
            field={field}
            value={draftGen[field.key]}
            onDraft={(value) => draftGenField(field.key, value)}
            onCommitNow={flush}
          />
        ))}
      </div>

      <p className="dev-panel-note">
        Bend probability is a steer, not a target: the contour path's own geometry bounds what is
        reachable, roughly 0.16–0.45 at gridSize 100 and 0.30–0.47 at gridSize 20. Requested{' '}
        {formatPercent(draftGen.bendProbability)}, achieved{' '}
        {metrics !== null ? formatPercent(metrics.bendRate) : '—'}.
      </p>
      <p className="dev-panel-note">
        Mean piece length is the sampling target, not the achieved mean — a floor of{' '}
        {draftGen.minPieceLength} cells truncates the distribution&apos;s left tail. Requested{' '}
        {formatFixed(draftGen.meanPieceLength, 1)} cells, achieved mean segment length{' '}
        {metrics !== null ? formatFixed(metrics.meanSegmentLength, 1) : '—'}.
      </p>

      <div className="dev-field-group">
        {PLAY_FIELDS.map((field) => (
          <NumberField
            key={field.key}
            field={field}
            value={draftPlay[field.key]}
            onDraft={(value) => draftPlayField(field.key, value)}
            onCommitNow={flush}
          />
        ))}
      </div>

      <div className="dev-panel-metrics">
        {metricsError !== null ? (
          <p className="dev-panel-error" role="alert">
            Metrics unavailable: {metricsError}
          </p>
        ) : metrics === null ? (
          <p className="dev-panel-note">Metrics compute on open.</p>
        ) : (
          <dl>
            <dt>Segments</dt>
            <dd>{formatInt(metrics.segmentCount)}</dd>
            <dt>Coverage</dt>
            <dd>{formatPercent(metrics.coverage)}</dd>
            <dt>DAG depth</dt>
            <dd>{formatInt(metrics.dagDepth)}</dd>
            <dt>Mean free-set size</dt>
            <dd>{formatFixed(metrics.meanFreeSetSize, 2)}</dd>
            <dt>Min free-set size</dt>
            <dd>{formatInt(metrics.minFreeSetSize)}</dd>
            <dt>Blocking edges</dt>
            <dd>{formatInt(metrics.edgeCount)}</dd>
            <dt>Generation time</dt>
            <dd>{formatMs(metrics.generationMs)}</dd>
          </dl>
        )}
      </div>
    </div>
  );
}
