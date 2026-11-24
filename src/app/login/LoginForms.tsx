"use client";

import { useActionState } from "react";
import { adminLoginAction, facultyLoginAction, type LoginState } from "@/app/actions/auth";

export function LoginForms({ isAdmin, options }: { isAdmin: boolean; options: { id: string; label: string }[] }) {
  const [fState, fAction, fPending] = useActionState<LoginState, FormData>(facultyLoginAction, {});
  const [aState, aAction, aPending] = useActionState<LoginState, FormData>(adminLoginAction, {});

  if (isAdmin) {
    return (
      <form action={aAction} className="stack" noValidate>
        {aState.error && <div className="alert alert-bad" role="alert">{aState.error}</div>}
        <div className="field">
          <label htmlFor="username">Username</label>
          <input id="username" name="username" className="input" autoComplete="username" required />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" className="input" autoComplete="current-password" required />
        </div>
        <button className="btn btn-primary btn-block" disabled={aPending}>
          {aPending ? "Signing in…" : "Sign in as Admin"}
        </button>
      </form>
    );
  }

  return (
    <form action={fAction} className="stack" noValidate>
      {fState.error && <div className="alert alert-bad" role="alert">{fState.error}</div>}
      {options.length === 0 ? (
        <div className="alert alert-info">No faculty accounts are active yet. The RTS Admin issues an individual access code to each faculty member.</div>
      ) : (
        <>
          <div className="field">
            <label htmlFor="facultyId">Your name</label>
            <select id="facultyId" name="facultyId" className="input" required defaultValue="">
              <option value="" disabled>
                Select your name…
              </option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="code">Personal access code</label>
            <input id="code" name="code" className="input mono" autoComplete="one-time-code" placeholder="XXXXX-XXXXX-XXXXX-XXXXX" required spellCheck={false} autoCapitalize="characters" />
            <span className="hint">Issued to you individually by the RTS Admin. Not case-sensitive.</span>
          </div>
          <button className="btn btn-primary btn-block" disabled={fPending}>
            {fPending ? "Signing in…" : "Sign in"}
          </button>
        </>
      )}
    </form>
  );
}
