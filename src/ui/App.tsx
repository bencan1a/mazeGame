/**
 * React owns chrome only. The board lives on a canvas behind an uncontrolled
 * ref that React never re-renders into. See docs/adr/0002-canvas-not-svg.md.
 *
 * Placeholder shell: the board mount, settings panel, and HUD land with their
 * own issues (streams S5 and S6).
 */
export function App() {
  return (
    <main
      style={{
        display: 'grid',
        placeItems: 'center',
        height: '100%',
        padding: '2rem',
        textAlign: 'center',
      }}
    >
      <div>
        <h1 style={{ margin: 0, fontSize: '1.5rem', letterSpacing: '0.02em' }}>Arrow Maze</h1>
        <p style={{ color: 'var(--muted)', maxWidth: '28ch', lineHeight: 1.5 }}>
          Scaffolding only. The generator, renderer, and game loop are tracked as open issues.
        </p>
      </div>
    </main>
  );
}
