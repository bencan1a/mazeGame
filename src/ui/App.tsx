/** Placeholder shell. The board mount, settings panel and HUD are not built. */
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
