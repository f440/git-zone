import { describe, expect, test } from "bun:test";

import { main } from "./cli.js";

describe("cli add parsing", () => {
  test("shows add help with new branch flags", async () => {
    const stdout: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdout.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
      return true;
    }) as typeof process.stdout.write;

    try {
      const exitCode = await main(["add", "--help"]);
      expect(exitCode).toBe(0);
      expect(stdout.join("")).toContain("git-zone add <target> -b <branch-name>");
      expect(stdout.join("")).toContain("git-zone add <target> -B <branch-name>");
      expect(stdout.join("")).toContain("git-zone add [<target>] --detach");
    } finally {
      process.stdout.write = originalWrite;
    }
  });
});
