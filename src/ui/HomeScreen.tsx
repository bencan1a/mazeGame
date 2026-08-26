import type { ReactElement } from 'react';
import type { ShapeLibrary } from '../game/shapes.js';

export interface HomeScreenProps {
  readonly library: ShapeLibrary;
  /** Index into `library.shapes` of the drawing on screen. */
  readonly index: number;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
  readonly onPlay: () => void;
  /** The shape holding the one saved board, if there is one. */
  readonly resumeShapeId: string | null;
}

export function HomeScreen(props: HomeScreenProps): ReactElement {
  const { library, index, onPrevious, onNext, onPlay, resumeShapeId } = props;
  const shape = library.shapes[index];
  if (shape === undefined) return <div className="home-screen" />;
  const resumable = shape.id === resumeShapeId;

  return (
    <div className="home-screen">
      <h1 className="home-title">{shape.name}</h1>
      <div className="home-controls">
        <button type="button" onClick={onPrevious} aria-label="Previous shape">
          ‹
        </button>
        <button type="button" className="home-play" onClick={onPlay}>
          {resumable ? 'Resume' : 'Play'}
        </button>
        <button type="button" onClick={onNext} aria-label="Next shape">
          ›
        </button>
      </div>
    </div>
  );
}
