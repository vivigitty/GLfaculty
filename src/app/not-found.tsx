import Link from "next/link";

export default function NotFound() {
  return (
    <main className="login-wrap">
      <div className="card login-card">
        <div className="card-body stack">
          <h1>Not found</h1>
          <p className="muted">This page does not exist, or you do not have access to it.</p>
          <Link className="btn btn-primary" href="/">Go to my home page</Link>
        </div>
      </div>
    </main>
  );
}
