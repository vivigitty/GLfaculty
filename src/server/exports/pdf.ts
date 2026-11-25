import PDFDocument from "pdfkit";
import type { Policy } from "../policy/schema";
import { categoryRemark, type AcademicYear, type ScoreLine, type Submission } from "../domain/schemas";
import type { Eligibility } from "../scoring/engine";
import { totalOf } from "../scoring/engine";
import { fmtDate, fmtDateTime, fmtPoints, fmtRs, nil, STATUS_LABEL } from "@/lib/format";
import { designationLabel, isHidden, optionLabel, researchStatusLabel } from "@/lib/policyView";

export type PdfModel = {
  institution: string;
  templateVersion: string;
  kind: "INITIAL" | "FINAL" | "REGENERATED" | "RECOMPUTED";
  generatedAt: string;
  submission: Submission;
  ay: AcademicYear;
  policy: Policy;
  submittedElig: Eligibility;
  approvedElig: Eligibility;
};

const M = 40;
/** Standard PDF fonts only cover WinAnsi; map the few symbols we use outside it. */
const pt = (x: string) =>
  x.replace(/₹\s?/g, "Rs. ").replace(/≤/g, "<=").replace(/≥/g, ">=").replace(/−/g, "-").replace(/→/g, "->").replace(/[^\t\n\r\x20-\xFF–—‘’“”•…]/g, "?");
const W = 595.28 - 2 * M;
const INK = "#1b2733";
const MUTED = "#5b6875";
const RULE = "#c9d2db";
const BAND = "#eef2f6";

/** Faculty-specific PDF. Every source-form field is printed; blanks render as "Nil". */
export function renderSubmissionPdf(m: PdfModel): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: M, bufferPages: true, info: { Title: `RTS ${m.ay.label} — ${m.submission.facultySnapshot?.displayName ?? ""}`, Producer: m.templateVersion } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  const s = m.submission;
  const f = s.facultySnapshot!;
  const score = s.submittedScore!;
  const sub = s.submittedPoints!;
  const appr = s.approvedPoints ?? sub;
  // Approved values (and Admin review details) appear only once the Admin has given final approval.
  const final = s.status === "APPROVED";
  const elig = final ? m.approvedElig : m.submittedElig;

  const ensure = (h: number) => {
    if (doc.y + h > doc.page.height - M - 20) doc.addPage();
  };
  const h1 = (t: string) => {
    ensure(40);
    doc.moveDown(0.6).font("Helvetica-Bold").fontSize(12).fillColor(INK).text(pt(t), M, doc.y, { width: W });
    doc.moveTo(M, doc.y + 2).lineTo(M + W, doc.y + 2).strokeColor(RULE).lineWidth(0.8).stroke();
    doc.moveDown(0.4);
  };
  const h2 = (t: string) => {
    ensure(30);
    doc.moveDown(0.3).font("Helvetica-Bold").fontSize(9.5).fillColor(INK).text(pt(t), M, doc.y, { width: W }).moveDown(0.15);
  };
  const para = (t: string, opts: { muted?: boolean; size?: number } = {}) => {
    ensure(14);
    doc.font("Helvetica").fontSize(opts.size ?? 8.5).fillColor(opts.muted ? MUTED : INK).text(pt(t), M, doc.y, { width: W });
  };
  const kv = (rows: [string, string][], cols = 2) => {
    const colW = W / cols;
    for (let i = 0; i < rows.length; i += cols) {
      ensure(16);
      const y = doc.y;
      let maxY = y;
      for (let c = 0; c < cols; c++) {
        const r = rows[i + c];
        if (!r) continue;
        const x = M + c * colW;
        doc.font("Helvetica").fontSize(7.5).fillColor(MUTED).text(pt(r[0]), x, y, { width: colW - 8 });
        doc.font("Helvetica").fontSize(9).fillColor(INK).text(pt(r[1]), x, doc.y, { width: colW - 8 });
        maxY = Math.max(maxY, doc.y);
      }
      doc.y = maxY + 4;
    }
  };
  /** Simple table with wrapping cells and repeated header on page break. */
  const table = (headers: string[], widths: number[], rows: string[][], opts: { size?: number; alignRightFrom?: number; alignRightTo?: number } = {}) => {
    const size = opts.size ?? 7.5;
    const total = widths.reduce((a, b) => a + b, 0);
    const ws = widths.map((w) => (w / total) * W);
    const drawRow = (cells: string[], header: boolean) => {
      doc.font(header ? "Helvetica-Bold" : "Helvetica").fontSize(size);
      const heights = cells.map((c, i) => doc.heightOfString(pt(c), { width: ws[i]! - 6 }));
      const h = Math.max(...heights) + 6;
      if (doc.y + h > doc.page.height - M - 20) {
        doc.addPage();
        if (!header) drawRow(headers, true);
      }
      const y = doc.y;
      if (header) doc.rect(M, y, W, h).fill(BAND);
      let x = M;
      cells.forEach((c, i) => {
        const right = opts.alignRightFrom !== undefined && i >= opts.alignRightFrom && (opts.alignRightTo === undefined || i <= opts.alignRightTo);
        doc.fillColor(INK).font(header ? "Helvetica-Bold" : "Helvetica").fontSize(size).text(pt(c), x + 3, y + 3, { width: ws[i]! - 6, align: right ? "right" : "left" });
        x += ws[i]!;
      });
      doc.moveTo(M, y + h).lineTo(M + W, y + h).strokeColor(RULE).lineWidth(0.5).stroke();
      doc.y = y + h;
    };
    ensure(30);
    drawRow(headers, true);
    if (rows.length === 0) drawRow(headers.map((_, i) => (i === 0 ? "Nil" : "")), false);
    for (const r of rows) drawRow(r, false);
    doc.x = M;
    doc.moveDown(0.3);
  };

  // ---------------------------------------------------------------- Header
  doc.font("Helvetica-Bold").fontSize(15).fillColor(INK).text("RTS — Research, Teaching & Service Points", M, M, { width: W });
  doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(`${m.institution} · ${m.ay.label} (${fmtDate(m.ay.startDate)} – ${fmtDate(m.ay.endDate)})`);
  doc.text(
    `${m.kind === "FINAL" ? "Final (post-review) statement" : m.kind === "INITIAL" ? "Submission statement" : m.kind === "RECOMPUTED" ? "Recomputed statement (policy change)" : "Regenerated statement"} · Generated ${fmtDateTime(m.generatedAt)} · Template ${m.templateVersion} · Policy ${s.policyVersion}`,
  );
  doc.moveDown(0.5);

  h1("Faculty details");
  kv([
    ["Name", nil(f.displayName)],
    ["Designation", designationLabel(m.policy, f.designationKey)],
    ["Faculty category", f.facultyCategory === "JUNIOR" ? "Junior Faculty" : "Standard Faculty"],
    ["Date of joining", fmtDate(f.dateOfJoining)],
    ["Email (master record)", nil(f.email)],
    ["Research status", researchStatusLabel(m.policy, f.researchStatus)],
    ["Date of exit", f.dateOfExit ? fmtDate(f.dateOfExit) : "Nil"],
    ["Submission reference", s.id],
    ["Status", STATUS_LABEL[s.status] ?? s.status],
    ["Version", String(s.currentVersion)],
    ["Submitted at", fmtDateTime(s.submittedAt)],
    ...(final ? [["Approved at", fmtDateTime(s.approvedAt)] as [string, string]] : []),
  ]);

  // ---------------------------------------------------------------- Points summary
  const delta = (a: string, b: string) => {
    const d = Number(b) - Number(a);
    return d === 0 ? "—" : `${d > 0 ? "+" : ""}${fmtPoints(d)}`;
  };
  if (final) {
    h1("Points summary — submitted vs approved");
    // Remarks are printed wherever the approved category differs from the submitted one.
    const remark = (k: "R" | "T" | "S") => (Number(sub[k]) !== Number(appr[k]) ? nil(categoryRemark(s, k)) : "");
    table(
      ["Category", "Submitted", "Approved", "Difference", "Admin remarks"],
      [3, 1.6, 1.6, 1.6, 4.5],
      [
        ["Research (R)", fmtPoints(sub.R), fmtPoints(appr.R), delta(sub.R, appr.R), remark("R")],
        ["Teaching (T)", fmtPoints(sub.T), fmtPoints(appr.T), delta(sub.T, appr.T), remark("T")],
        ["Service (S)", fmtPoints(sub.S), fmtPoints(appr.S), delta(sub.S, appr.S), remark("S")],
        ["Total earned (R + T + S)", fmtPoints(totalOf(sub)), fmtPoints(totalOf(appr)), delta(totalOf(sub), totalOf(appr)), ""],
        ["Minimum required", fmtPoints(m.submittedElig.minimum), fmtPoints(m.approvedElig.minimum), "", ""],
        ["Points payable", fmtPoints(m.submittedElig.pointsPayable), fmtPoints(m.approvedElig.pointsPayable), delta(m.submittedElig.pointsPayable, m.approvedElig.pointsPayable), ""],
        ["Indicative points payment", fmtRs(m.submittedElig.payment), fmtRs(m.approvedElig.payment), "", ""],
      ],
      { size: 8, alignRightFrom: 1, alignRightTo: 3 },
    );
  } else {
    h1("Points summary — as submitted");
    table(
      ["Category", "Submitted"],
      [3, 2],
      [
        ["Research (R)", fmtPoints(sub.R)],
        ["Teaching (T)", fmtPoints(sub.T)],
        ["Service (S)", fmtPoints(sub.S)],
        ["Total earned (R + T + S)", fmtPoints(totalOf(sub))],
        ["Minimum required", fmtPoints(m.submittedElig.minimum)],
        ["Points payable", fmtPoints(m.submittedElig.pointsPayable)],
        ["Indicative points payment", fmtRs(m.submittedElig.payment)],
      ],
      { size: 8.5, alignRightFrom: 1 },
    );
    para("Provisional: these are the points you submitted. Approved points will be shown in the final statement after the Admin completes the review.", { muted: true });
  }
  h2(final ? "How the approved payment is calculated" : "How the indicative payment is calculated");
  for (const e of elig.explanation) para(`• ${e}`);
  para(
    `Rates: research rate ${fmtRs(elig.researchRate)} per point; designation rate ${fmtRs(elig.designationRate)} per point. Indicative only — Finance-entered paid amounts are recorded separately.`,
    { muted: true },
  );
  if (score.teachingInfo.cldCompensation !== null && Number(score.teachingInfo.cldHours) > 0) {
    para(`CLD: ${fmtPoints(score.teachingInfo.cldHours)} hours; separately calculated CLD amount ${fmtRs(score.teachingInfo.cldCompensation)} (not included in the points payment).`, { muted: true });
  }

  // ---------------------------------------------------------------- Teaching
  h1("A. Teaching");
  const cols = m.policy.teaching.columns;
  const types = m.policy.teaching.courseTypes;
  const typeLabel = (k: string) => nil(types?.find((t) => t.key === k)?.label ?? k);
  table(
    ["Course", ...(types ? ["Type"] : []), "Sec.", "Stud.", "Feedback", ...cols.map((c) => c.label), "Total h", "T pts"],
    [5, ...(types ? [3] : []), 1.3, 1.5, 1.8, ...cols.map(() => 1.6), 1.7, 1.6],
    s.content.teaching.map((r) => {
      const tot = cols.reduce((a, c) => a + (Number(r.hours[c.key]) || 0), 0);
      const ln = score.lines.find((l) => l.lineId === `T:${r.id}`);
      return [nil(r.courseName), ...(types ? [typeLabel(r.courseType)] : []), nil(r.sections), nil(r.students), nil(r.feedback), ...cols.map((c) => nil(r.hours[c.key])), fmtPoints(tot), ln ? fmtPoints(ln.points) : "Nil"];
    }),
    { size: 6.5, alignRightFrom: types ? 2 : 1 },
  );
  kv(
    [
      ["Total hours", fmtPoints(score.teachingInfo.totalHours)],
      ["Hours counted for T", fmtPoints(score.teachingInfo.hoursForPoints)],
      ["CLD hours", fmtPoints(score.teachingInfo.cldHours)],
      ["Hours counted towards cap / cap", `${fmtPoints(score.teachingInfo.hoursCountedForCap)} / ${fmtPoints(score.teachingInfo.capHours)}`],
      ["Contractual load (hours)", fmtPoints(score.teachingInfo.contractualLoadHours)],
      ["Teaching points (T, submitted)", fmtPoints(sub.T)],
    ],
    3,
  );

  // ---------------------------------------------------------------- Research
  h1("B. Research");
  const lineFor = (id: string): ScoreLine | undefined => score.lines.find((l) => l.lineId === id);
  for (const section of m.policy.researchSections) {
    const entries = s.content.research.filter((e) => e.sectionKey === section.key);
    h2(`${section.label} (${entries.length})`);
    if (entries.length === 0) {
      para("Nil", { muted: true });
      continue;
    }
    entries.forEach((e, idx) => {
      const ln = lineFor(`R:${e.id}`);
      const review = s.lineReviews[`R:${e.id}`];
      const rows: [string, string][] = section.fields
        .filter((fd) => !isHidden(fd, e.values))
        .map((fd) => {
          const v = e.values[fd.key];
          const shown = fd.type === "select" ? optionLabel(m.policy, fd, v) : fd.type === "date" ? (v ? fmtDate(String(v)) : "") : fd.type === "money" && v ? fmtRs(String(v)) : v;
          return [fd.label, nil(shown as string | boolean | null)];
        });
      rows.push(["Submitted points", ln ? fmtPoints(ln.points) : "Nil"]);
      if (final) rows.push(["Approved points", review?.approvedPoints != null ? fmtPoints(review.approvedPoints) : ln ? fmtPoints(ln.points) : "Nil"]);
      ensure(30);
      doc.font("Helvetica-Bold").fontSize(8).fillColor(MUTED).text(`#${idx + 1}`, M, doc.y);
      kv(rows, 3);
      if (ln) para(`Calculation: ${ln.explanation}`, { muted: true, size: 7.5 });
      if (final && review && (review.note || review.status !== "UNVERIFIED")) para(`Admin review: ${review.status}${review.note ? ` — ${review.note}` : ""}${review.reason ? ` (reason: ${review.reason})` : ""}`, { muted: true, size: 7.5 });
      doc.moveDown(0.3);
    });
  }

  // ---------------------------------------------------------------- Service
  h1("C. Service");
  table(
    ["Service activity / role", "Quantity", "Points each", "Points", "Description"],
    [5, 1.4, 1.4, 1.3, 4],
    m.policy.service.roles.map((r) => {
      const v = s.content.service.roles[r.key];
      const q = v?.quantity && Number(v.quantity) > 0 ? v.quantity : "";
      return [r.label, nil(q), fmtPoints(r.points), q ? fmtPoints(Number(q) * Number(r.points)) : "Nil", nil(v?.description)];
    }),
    { size: 7.5 },
  );
  h2("Unscored disclosures");
  para(m.policy.service.disclosureNote, { muted: true, size: 7.5 });
  kv(m.policy.service.disclosures.map((d) => [d.label, nil(s.content.service.disclosures[d.key])] as [string, string]), 2);

  // ---------------------------------------------------------------- Notes, warnings, declaration
  h1("Review notes");
  if (score.warnings.length === 0) para("Nil", { muted: true });
  for (const w of score.warnings) para(`• ${w.message}`, { size: 7.5 });
  for (const w of elig.warnings) para(`• ${w}`, { size: 7.5 });
  h2("Faculty notes");
  para(nil(s.content.facultyNotes));
  h2("Messages");
  // Internal Admin notes are never part of the faculty statement.
  const msgs = s.messages.filter((x) => x.kind !== "ADMIN_NOTE");
  if (msgs.length === 0) para("Nil", { muted: true });
  for (const msg of msgs) para(`${fmtDateTime(msg.at)} · ${msg.from === "ADMIN" ? "Admin" : "Faculty"} · ${msg.message}`, { size: 7.5 });
  h2("Declaration");
  para(s.declaration?.accepted ? `Accepted on ${fmtDateTime(s.declaration.acceptedAt)}: "I confirm the information entered is complete and accurate."` : "Nil");

  // Footer with page numbers
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // Writing inside the bottom margin would otherwise make pdfkit add a new page.
    doc.page.margins.bottom = 0;
    doc.font("Helvetica").fontSize(7).fillColor(MUTED).text(`${s.id} · ${m.templateVersion} · Page ${i + 1} of ${range.count}`, M, doc.page.height - M + 5, { width: W, align: "center", lineBreak: false });
  }
  doc.end();
  return done;
}
