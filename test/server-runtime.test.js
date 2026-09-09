import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test(
  "TypeScript development entry serves React and drains after SIGTERM",
  { timeout: 20000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "logo-ts-runtime-"));
    const child = spawn(process.execPath, ["server.ts", "--dev"], {
      env: {
        ...process.env,
        NODE_ENV: "development",
        PORT: "0",
        ACCOUNTS_DB: join(directory, "accounts.sqlite"),
        OUTPUT_DIR: join(directory, "outputs"),
        LOG_DIR: join(directory, "logs"),
      },
      stdio: ["ignore", "pipe", "ignore"],
    });
    const exited = once(child, "exit");
    try {
      const base = await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(Error("Development startup timed out")),
          12000,
        );
        child.once("exit", () => {
          clearTimeout(timer);
          reject(Error("Development server exited during startup"));
        });
        child.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        let output = "";
        child.stdout.on("data", (chunk) => {
          output += chunk;
          const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
          if (match) {
            clearTimeout(timer);
            resolve(match[0]);
          }
        });
      });
      for (const path of [
        "/",
        "/src/main.tsx",
        "/@vite/client",
        "/api/account",
      ]) {
        const response = await fetch(base + path, {
          signal: AbortSignal.timeout(5000),
        });
        assert.equal(response.status, 200, path);
        const body = await response.text();
        if (path === "/") assert.match(body, /@vite\/client/);
      }
      child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
      try {
        const [code, signal] = await exited;
        assert.equal(
          signal,
          null,
          "Development service must exit without a forced kill",
        );
        assert.equal(code, 0);
      } finally {
        clearTimeout(timer);
      }
    } finally {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
      await exited;
      await rm(directory, { recursive: true, force: true });
    }
  },
);
