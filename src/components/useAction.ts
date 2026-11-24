"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/server/services/common";

/** Runs a server action, tracks pending/error/success, and refreshes server data on success. */
export function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  function exec<T>(fn: () => Promise<ActionResult<T>>, onOk?: (data: T) => void) {
    start(async () => {
      setError(null);
      setMessage(null);
      setFieldErrors({});
      const r = await fn();
      if (r.ok) {
        setMessage(r.message ?? null);
        onOk?.(r.data);
        router.refresh();
      } else {
        setError(r.error);
        setFieldErrors(Object.fromEntries((r.fieldErrors ?? []).map((e) => [e.path, e.message])));
      }
    });
  }
  return { pending, error, fieldErrors, message, exec, setError, setMessage };
}
