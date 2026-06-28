// Branded full-screen status states for the app shell (loading + error).
// Styled by .app-* rules in src/styles/app.css; the spinner reuses the
// notoSpin keyframe from workspace.css.

export function AppLoading({ message }: { message: string }) {
  return (
    <div className="app-loading" role="status" aria-live="polite">
      <div className="app-spinner" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}

export function AppError({ message }: { message: string }) {
  return (
    <div className="app-loading">
      <div className="app-error-card" role="alert">
        <div className="app-error-title">Couldn't load your vault</div>
        <div className="app-error-msg">{message}</div>
        <button className="app-retry" type="button" onClick={() => window.location.reload()}>
          Try again
        </button>
      </div>
    </div>
  );
}
