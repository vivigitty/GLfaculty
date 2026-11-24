"use client";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="login-wrap">
      <div className="card login-card">
        <div className="card-body stack">
          <h1>Something went wrong</h1>
          <p className="muted">The page could not be loaded. Your saved work is safe. Try again, and contact the RTS Admin if it continues.</p>
          <button className="btn btn-primary" onClick={() => reset()}>Try again</button>
        </div>
      </div>
    </main>
  );
}
