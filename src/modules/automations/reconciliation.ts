import { all, run, transaction } from "@/platform/db/database";
import { serverToolRegistry } from "@/modules/automations/registry";

type Candidate = { id: string; target_id: string; revision: number; created_at: string; input_payload_json: string; output_payload_json: string | null };

export type ReconciliationReport = { scanned: number; reconciled: number; conflicted: number };

/** Idempotently closes request-bound Runs whose in-process executor can no longer exist. */
export function reconcileInterruptedAutomationRuns(input: { now?: Date; batchSize?: number } = {}): ReconciliationReport {
  const currentTime = input.now ?? new Date();
  const batchSize = Math.max(1, Math.min(input.batchSize ?? 100, 500));
  const report: ReconciliationReport = { scanned: 0, reconciled: 0, conflicted: 0 };
  for (const [targetId, tool] of Object.entries(serverToolRegistry)) {
    if (tool.executionPolicy.mode !== "request") continue;
    const cutoff = new Date(currentTime.getTime() - tool.executionPolicy.staleAfterMs).toISOString();
    const candidates = all<Candidate>(
      `SELECT id, target_id, revision, created_at, input_payload_json, output_payload_json FROM automation_runs
        WHERE target_id = ? AND status = 'running' AND created_at < ? AND trashed_at IS NULL
        ORDER BY created_at ASC, id ASC LIMIT ?`,
      targetId, cutoff, batchSize,
    );
    report.scanned += candidates.length;
    transaction(() => {
      for (const candidate of candidates) {
        const recovered = "recoverInterruptedRun" in tool ? tool.recoverInterruptedRun(candidate) : null;
        if (recovered) {
          const result = run(
            `UPDATE automation_runs SET status = 'completed', output_summary = ?, output_payload_json = ?, error_code = NULL,
               error_message = NULL, completed_at = ?, revision = revision + 1
             WHERE id = ? AND target_id = ? AND status = 'running' AND created_at < ? AND trashed_at IS NULL AND revision = ?`,
            recovered.outputSummary, JSON.stringify(recovered.outputPayload), currentTime.toISOString(), candidate.id, targetId, cutoff, candidate.revision,
          );
          if (Number(result.changes) === 1) report.reconciled += 1; else report.conflicted += 1;
          continue;
        }
        const result = run(
          `UPDATE automation_runs SET status = 'failed', error_code = 'execution_interrupted',
             error_message = '应用在运行完成前中断，未提交任何新结果。', completed_at = ?, revision = revision + 1
           WHERE id = ? AND target_id = ? AND status = 'running' AND created_at < ? AND trashed_at IS NULL AND revision = ?`,
          currentTime.toISOString(), candidate.id, targetId, cutoff, candidate.revision,
        );
        if (Number(result.changes) === 1) report.reconciled += 1;
        else report.conflicted += 1;
      }
    });
  }
  return report;
}
