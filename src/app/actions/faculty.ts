"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { facultyAction } from "@/server/auth/session";
import { run, type ActionResult } from "@/server/services/common";
import { previewForFaculty, saveDraft, startSubmission, submit, type Preview } from "@/server/services/submissions";
import { answerNotReceived, confirmReceipt } from "@/server/services/email";

/**
 * Faculty server actions. Every action re-derives the faculty identity from the
 * session — a client-supplied faculty id is never trusted.
 */

const id = z.string().regex(/^[A-Za-z0-9_.-]{1,120}$/);

export async function startSubmissionAction(academicYearId: string): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const { faculty, actor } = await facultyAction();
    const sub = await startSubmission(faculty, id.parse(academicYearId), actor);
    return { id: sub.id };
  });
}

export async function previewAction(submissionId: string, content: unknown, mode: "draft" | "submit" = "draft"): Promise<ActionResult<Preview>> {
  return run(async () => {
    const { faculty } = await facultyAction();
    return previewForFaculty(faculty, id.parse(submissionId), content, mode === "submit" ? "submit" : "draft");
  });
}

export async function saveDraftAction(submissionId: string, rev: number, content: unknown): Promise<ActionResult<{ rev: number; preview: Preview; savedAt: string }>> {
  return run(async () => {
    const { faculty, actor } = await facultyAction();
    return saveDraft(faculty, id.parse(submissionId), z.number().int().parse(rev), content, actor);
  }, "Draft saved");
}

export async function submitAction(submissionId: string, rev: number, content: unknown, declarationAccepted: boolean, responseMessage: string): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const { faculty, actor } = await facultyAction();
    const s = await submit(faculty, id.parse(submissionId), z.number().int().parse(rev), content, { declarationAccepted: declarationAccepted === true, responseMessage: String(responseMessage ?? "") }, actor);
    revalidatePath("/faculty");
    return { id: s.id };
  }, "Submitted");
}

export async function confirmReceiptAction(submissionId: string, received: boolean): Promise<ActionResult<{ receiptId: string }>> {
  return run(async () => {
    const { faculty, actor } = await facultyAction();
    const r = await confirmReceipt(faculty, id.parse(submissionId), received ? "YES_RECEIVED" : "NO_NOT_RECEIVED", actor);
    revalidatePath(`/faculty/submissions/${submissionId}`);
    return { receiptId: r.id };
  });
}

const answer = z.discriminatedUnion("addressCorrect", [
  z.object({ addressCorrect: z.literal(true), notes: z.string().max(2000) }),
  z.object({ addressCorrect: z.literal(false), requestedEmail: z.string().max(320), explanation: z.string().max(2000) }),
]);

export async function answerNotReceivedAction(receiptId: string, input: unknown): Promise<ActionResult<{ correctionRequested: boolean }>> {
  return run(async () => {
    const { faculty, actor } = await facultyAction();
    const res = await answerNotReceived(faculty, id.parse(receiptId), answer.parse(input), actor);
    revalidatePath("/faculty");
    return { correctionRequested: res.correction !== null };
  });
}
