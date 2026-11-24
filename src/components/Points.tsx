import type { RTS } from "@/server/domain/schemas";
import type { Eligibility } from "@/server/scoring/engine";
import { fmtINR, fmtPoints } from "@/lib/format";

/** Submitted vs approved R/T/S, each derived independently. Pure presentation. */
export function PointsComparison({ submitted, approved, subElig, apprElig }: { submitted: RTS; approved: RTS; subElig: Eligibility | null; apprElig: Eligibility | null }) {
  const total = (p: RTS) => Number(p.R) + Number(p.T) + Number(p.S);
  const diff = (a: number, b: number) => {
    const d = Math.round((b - a) * 10000) / 10000;
    if (d === 0) return <span className="muted">—</span>;
    return <span style={{ color: d < 0 ? "var(--bad)" : "var(--ok)", fontWeight: 600 }}>{`${d > 0 ? "+" : ""}${fmtPoints(d)}`}</span>;
  };
  const rows: [string, number, number][] = [
    ["Research (R)", Number(submitted.R), Number(approved.R)],
    ["Teaching (T)", Number(submitted.T), Number(approved.T)],
    ["Service (S)", Number(submitted.S), Number(approved.S)],
  ];
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Points</th>
            <th className="num">Submitted</th>
            <th className="num">Approved</th>
            <th className="num">Difference</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, s, a]) => (
            <tr key={k}>
              <td>{k}</td>
              <td className="num">{fmtPoints(s)}</td>
              <td className="num">{fmtPoints(a)}</td>
              <td className="num">{diff(s, a)}</td>
            </tr>
          ))}
          <tr className="total">
            <td>Total earned</td>
            <td className="num">{fmtPoints(total(submitted))}</td>
            <td className="num">{fmtPoints(total(approved))}</td>
            <td className="num">{diff(total(submitted), total(approved))}</td>
          </tr>
          <tr>
            <td>Minimum required</td>
            <td className="num">{fmtPoints(subElig?.minimum)}</td>
            <td className="num">{fmtPoints(apprElig?.minimum)}</td>
            <td />
          </tr>
          <tr>
            <td>Points payable</td>
            <td className="num">{fmtPoints(subElig?.pointsPayable)}</td>
            <td className="num">{fmtPoints(apprElig?.pointsPayable)}</td>
            <td className="num">{subElig && apprElig ? diff(Number(subElig.pointsPayable), Number(apprElig.pointsPayable)) : null}</td>
          </tr>
          <tr>
            <td>Indicative points payment</td>
            <td className="num">{fmtINR(subElig?.payment)}</td>
            <td className="num strong">{fmtINR(apprElig?.payment)}</td>
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** Submitted values only — what faculty see until the Admin gives final approval. */
export function SubmittedPoints({ submitted, elig }: { submitted: RTS; elig: Eligibility | null }) {
  const total = Number(submitted.R) + Number(submitted.T) + Number(submitted.S);
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr><th>Points</th><th className="num">Submitted</th></tr>
        </thead>
        <tbody>
          <tr><td>Research (R)</td><td className="num">{fmtPoints(submitted.R)}</td></tr>
          <tr><td>Teaching (T)</td><td className="num">{fmtPoints(submitted.T)}</td></tr>
          <tr><td>Service (S)</td><td className="num">{fmtPoints(submitted.S)}</td></tr>
          <tr className="total"><td>Total earned</td><td className="num">{fmtPoints(total)}</td></tr>
          <tr><td>Minimum required</td><td className="num">{fmtPoints(elig?.minimum)}</td></tr>
          <tr><td>Points payable</td><td className="num">{fmtPoints(elig?.pointsPayable)}</td></tr>
          <tr><td>Indicative points payment</td><td className="num strong">{fmtINR(elig?.payment)}</td></tr>
        </tbody>
      </table>
    </div>
  );
}

export function PaymentExplanation({ elig }: { elig: Eligibility }) {
  return (
    <div className="explain">
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {elig.explanation.map((e) => (
          <li key={e}>{e}</li>
        ))}
      </ul>
      {elig.warnings.length > 0 && (
        <ul style={{ margin: "6px 0 0", paddingLeft: 18, color: "var(--warn)" }}>
          {elig.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
