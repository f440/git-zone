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
      expect(stdout.join("")).toContain("git-zone add <target> --detach");
      expect(stdout.join("")).toContain("git-zone add <target> -d");
      expect(stdout.join("")).toContain("git-zone add <target> -f");
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  test("rejects add without a target", async () => {
    const stderr: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderr.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      const exitCode = await main(["add"]);
      expect(exitCode).toBe(1);
      expect(stderr.join("")).toContain("add requires a target; implicit HEAD is not supported");
    } finally {
      process.stderr.write = originalWrite;
    }
  });

  test("accepts -d as a detach shorthand", async () => {
    const stderr: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderr.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      const exitCode = await main(["add", "-d"]);
      expect(exitCode).toBe(1);
      expect(stderr.join("")).toContain("add requires a target; implicit HEAD is not supported");
    } finally {
      process.stderr.write = originalWrite;
    }
  });

  test("accepts -f as an add flag without conflicting with remove", async () => {
    const stderr: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderr.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      const exitCode = await main(["add", "HEAD", "-f"]);
      expect(exitCode).toBe(1);
      expect(stderr.join("")).not.toContain("unknown option: -f");
    } finally {
      process.stderr.write = originalWrite;
    }
  });
});
