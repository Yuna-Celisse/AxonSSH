import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { generateKeyPairSync } from "node:crypto";
import { Server } from "ssh2";
import type { AddressInfo } from "node:net";

test("desktop: real local PTY, SSH profile, model proposal, native approval, exec and history", async () => {
  const dir = mkdtempSync(join(tmpdir(), "axon-desktop-"));
  const keys = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const keyPath = join(dir, "test-key.pem");
  writeFileSync(keyPath, keys.privateKey, { mode: 0o600 });
  let executions = 0;
  const ssh = new Server({ hostKeys: [keys.privateKey] }, (client) => {
    client.on("error", () => {});
    client.on("authentication", (context) =>
      context.method === "publickey" ? context.accept() : context.reject(),
    );
    client.on("ready", () =>
      client.on("session", (accept) => {
        const session = accept();
        session.on("pty", (accept) => accept());
        session.on("window-change", (accept) => accept?.());
        session.on("shell", (accept) => {
          const channel = accept();
          channel.write("SSH_FIXTURE_CONNECTED\r\n");
        });
        session.on("exec", (accept, _reject, info) => {
          executions++;
          const channel = accept();
          channel.write(`fixture: ${info.command}\n`);
          channel.exit(0);
          channel.end();
        });
      }),
    );
  });
  await new Promise<void>((resolve) => ssh.listen(0, "127.0.0.1", resolve));
  const model = createServer((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                text: "先检查负载。",
                proposals: [
                  { command: "uptime", explanation: "只读取当前负载。" },
                ],
              }),
            },
          },
        ],
      }),
    );
  });
  await new Promise<void>((resolve) => model.listen(0, "127.0.0.1", resolve));
  const application = await electron.launch({
    args: [
      "--no-sandbox",
      "--disable-gpu",
      `--user-data-dir=${join(dir, "profile")}`,
      join(process.cwd(), "out/main/index.js"),
    ],
  });
  try {
    const page = await application.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await expect(page.getByText("从连接，到解决问题。")).toBeVisible();
    expect(
      await application.evaluate(({ app }) => app.getPath("userData")),
    ).toBe(join(dir, "profile"));
    await page
      .getByRole("button", { name: "打开本地终端", exact: true })
      .click();
    await expect(page.locator(".xterm")).toBeVisible();
    const ptyOutput = await page.evaluate(async () => {
      const terminal = await window.axon.terminal.open();
      const result = new Promise<string>((resolve, reject) => {
        let text = "";
        const timeout = setTimeout(() => {
          stop();
          reject(new Error("PTY output timeout"));
        }, 5000);
        const stop = window.axon.onEvent((e) => {
          if (e.type === "terminal:data" && e.id === terminal) {
            text += e.data;
            if (text.includes("AXON_REAL_PTY_OK")) {
              clearTimeout(timeout);
              stop();
              resolve(text);
            }
          }
        });
      });
      await window.axon.terminal.write(
        terminal,
        "printf 'AXON_REAL_PTY_OK\\n'\r",
      );
      const text = await result;
      await window.axon.terminal.close(terminal);
      return text;
    });
    expect(ptyOutput).toContain("AXON_REAL_PTY_OK");
    await page
      .getByRole("button", { name: "添加服务器", exact: true })
      .first()
      .click();
    await page.getByLabel("名称", { exact: true }).fill("Integration server");
    await page.getByLabel("主机地址").fill("127.0.0.1");
    await page
      .getByLabel("端口", { exact: true })
      .fill(String((ssh.address() as AddressInfo).port));
    await page.getByLabel("认证方式").selectOption("key");
    await page.getByLabel("私钥路径").fill(keyPath);
    await page.getByRole("button", { name: "保存服务器" }).click();
    await expect(
      page.getByRole("button", { name: "打开终端", exact: true }),
    ).toBeVisible();
    await application.evaluate(({ dialog }) => {
      (globalThis as any).__axonDialogs = [];
      dialog.showMessageBox = (async (...args: any[]) => {
        (globalThis as any).__axonDialogs.push(args.at(-1));
        return { response: 1, checkboxChecked: false };
      }) as typeof dialog.showMessageBox;
    });
    await page.getByRole("button", { name: "打开终端", exact: true }).click();
    await expect(page.getByText("会话已打开", { exact: true })).toBeVisible();
    expect(
      await page.evaluate(
        async () => (await window.axon.servers.list())[0].fingerprint,
      ),
    ).toMatch(/^SHA256:/);
    await page.getByRole("button", { name: "设置与模型", exact: true }).click();
    await page
      .getByLabel("API Base URL")
      .fill(`http://127.0.0.1:${(model.address() as AddressInfo).port}/v1`);
    await page.getByLabel("模型", { exact: true }).fill("fixture-model");
    await page.getByRole("button", { name: "保存设置" }).click();
    await expect(page.getByText("已保存", { exact: true })).toBeVisible();
    await page
      .getByRole("button", { name: "关闭", exact: true })
      .last()
      .click();
    await page.getByLabel("运维任务").fill("检查负载");
    await page.getByRole("button", { name: "发送任务" }).click();
    await expect(page.getByText("先检查负载。")).toBeVisible();
    expect(executions).toBe(0);
    await page.getByRole("button", { name: "审批并执行" }).click();
    await expect(page.getByText("退出码：0")).toBeVisible();
    expect(executions).toBe(1);
    const dialogs = await application.evaluate(
      () =>
        (globalThis as any).__axonDialogs as {
          title: string;
          detail: string;
        }[],
    );
    expect(dialogs.map((d) => d.title)).toEqual([
      "首次连接：确认主机密钥",
      "确认远程执行",
    ]);
    expect(dialogs[1].detail).toContain("uptime");
    await page.getByRole("button", { name: /执行记录/ }).click();
    await expect(page.locator(".activity-row code")).toHaveText("uptime");
    expect(errors).toEqual([]);
  } finally {
    await application.close();
    model.closeAllConnections();
    model.close();
    ssh.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
