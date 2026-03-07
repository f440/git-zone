import type { WorktreeStatus } from "./types.js";

export function formatWorktreeTable(statuses: WorktreeStatus[]): string {
  const rows = statuses.map((status) => [
    status.marker,
    status.branchLabel,
    status.shortHead,
    status.upstream,
    status.divergence,
    status.dirty,
    status.path,
  ]);

  const widths = rows[0]
    ? rows[0].map((_, index) =>
        Math.max(...rows.map((row) => row[index]!.length)),
      )
    : [1, 1, 1, 1, 1, 1, 1];

  return rows
    .map((row) =>
      row
        .map((cell, index) =>
          index === row.length - 1 ? cell : cell.padEnd(widths[index]!),
        )
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}
