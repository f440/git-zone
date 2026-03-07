import type { WorktreeStatus } from "./types.js";

export function formatWorktreeTable(statuses: WorktreeStatus[]): string {
  const rows = statuses.map((status) => [
    status.current ? "*" : " ",
    status.branch ?? "detached",
    status.head.slice(0, 7),
    status.upstream ?? "-",
    formatDivergence(status.ahead, status.behind),
    status.dirty ? "dirty" : "clean",
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

function formatDivergence(
  ahead: number | null,
  behind: number | null,
): string {
  if (ahead === null || behind === null) {
    return "-";
  }
  if (ahead === 0 && behind === 0) {
    return "=";
  }
  if (ahead > 0 && behind === 0) {
    return `ahead ${ahead}`;
  }
  if (ahead === 0 && behind > 0) {
    return `behind ${behind}`;
  }
  return `ahead ${ahead}, behind ${behind}`;
}
