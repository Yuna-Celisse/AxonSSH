import { it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../src/main/store";
import { executeLocal } from "../src/main/local-command";

it("runs in the project directory and records nonzero exit and output on the local target", async () => {
  const dir = mkdtempSync(join(tmpdir(), "axon-local-command-"));
  const store = await Store.open(join(dir, "test.sqlite"), {
    encrypt: (v) => v,
    decrypt: (v) => v,
  });
  try {
    const workspaceId = randomUUID();
    const project = store.saveProject({
      workspaceId,
      name: "Local",
      directory: dir,
    });
    const session = store.createSession(
      workspaceId,
      undefined,
      "builtin",
      project.id,
    );
    const command = `"${process.execPath}" -e "process.stdout.write(require('fs').realpathSync('.'));process.stderr.write('LOCAL_ERROR');process.exit(7)"`;
    const result = await executeLocal(
      store,
      command,
      session.id,
      "test",
      "confirmed",
    );
    expect(result.stdout.toLowerCase()).toBe(dir.toLowerCase());
    expect(result.stderr).toBe("LOCAL_ERROR");
    expect(result.code).toBe(7);
    expect(store.activity(session.id)[0]).toMatchObject({
      targetKey: "local",
      code: 7,
      approval: "confirmed",
      proposalKey: "test",
    });
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
