"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startSubmissionAction } from "@/app/actions/faculty";

export function StartButton({ academicYearId }: { academicYearId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div style={{ textAlign: "right" }}>
      <button
        className="btn btn-primary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await startSubmissionAction(academicYearId);
            if (res.ok) router.push(`/faculty/submissions/${res.data.id}`);
            else setError(res.error);
          })
        }
      >
        {pending ? "Starting…" : "Start submission"}
      </button>
      {error && <div className="small" style={{ color: "var(--bad)" }} role="alert">{error}</div>}
    </div>
  );
}
