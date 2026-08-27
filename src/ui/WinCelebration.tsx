import type { ReactElement } from 'react';

export interface WinCelebrationProps {
  /** In pop order, headline first. Rendered over the board, never taking a tap. */
  readonly phrases: readonly string[];
}

/**
 * The phrases that pop up over a cleared board. Purely decorative: the
 * confetti is on the canvas underneath, and the chrome's own footer carries
 * the same news for a reader who is not watching the middle of the screen.
 */
export function WinCelebration(props: WinCelebrationProps): ReactElement | null {
  const [headline, ...rest] = props.phrases;
  if (headline === undefined) return null;
  return (
    <div className="win-celebration" aria-hidden="true">
      <p className="win-phrase win-phrase-headline">{headline}</p>
      {rest.map((phrase, index) => (
        <p key={phrase} className={`win-phrase win-phrase-echo win-phrase-echo-${index % 2}`}>
          {phrase}
        </p>
      ))}
    </div>
  );
}
