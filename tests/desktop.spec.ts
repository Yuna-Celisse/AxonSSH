import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { generateKeyPairSync } from "node:crypto";
import { Server } from "ssh2";
import type { AddressInfo } from "node:net";

test("Session context menu cancels or deletes and restores a valid selection", async () => {
  const dir = mkdtempSync(join(tmpdir(), "axon-session-delete-"));
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
    await page.locator(".session-row.selected").waitFor();
    const original = await page
      .locator(".session-row.selected")
      .getAttribute("data-session-id");
    await application.evaluate(({ Menu, dialog }) => {
      (globalThis as any).__deleteResponse = 0;
      (globalThis as any).__menuLabel = "";
      Menu.prototype.popup = function (options: any) {
        (globalThis as any).__menuLabel = this.items[0].label;
        this.items[0].click(
          undefined as any,
          undefined as any,
          undefined as any,
        );
        options.callback?.();
      };
      dialog.showMessageBox = (async () => ({
        response: (globalThis as any).__deleteResponse,
        checkboxChecked: false,
      })) as typeof dialog.showMessageBox;
    });
    await page.locator(".session-row.selected").click({ button: "right" });
    await expect
      .poll(() => application.evaluate(() => (globalThis as any).__menuLabel))
      .toBe("删除 Session");
    await expect(page.locator(".session-row")).toHaveCount(1);
    await page
      .getByRole("button", { name: "新建 Session", exact: true })
      .click();
    await expect(page.locator(".session-row")).toHaveCount(2);
    await application.evaluate(() => {
      (globalThis as any).__deleteResponse = 1;
    });
    await page
      .locator(`[data-session-id="${original}"]`)
      .click({ button: "right" });
    await expect(page.locator(`[data-session-id="${original}"]`)).toHaveCount(
      0,
    );
    await expect(page.locator(".session-row.selected")).toHaveCount(1);
    const last = await page
      .locator(".session-row.selected")
      .getAttribute("data-session-id");
    await page.locator(".session-row.selected").click({ button: "right" });
    await expect(page.locator(`[data-session-id="${last}"]`)).toHaveCount(0);
    await expect(page.locator(".session-row.selected")).toHaveCount(1);
    await page.reload();
    await expect(page.locator(".session-row.selected")).toHaveCount(1);
    await expect(page.locator(`[data-session-id="${original}"]`)).toHaveCount(
      0,
    );
    await expect(page.locator(`[data-session-id="${last}"]`)).toHaveCount(0);
  } finally {
    await application.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

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
        session.on("sftp", (accept) => {
          const sftp = accept();
          sftp.on("OPEN", (id, path, flags) => {
            if (flags !== 1) {
              sftp.status(id, 3);
              return;
            }
            sftp.handle(id, Buffer.from(path));
          });
          sftp.on("READ", (id, handle, offset, length) => {
            const data = Buffer.from(
              handle.toString() === "/proc/loadavg"
                ? "0.10 0.20 0.30 1/100 42\n"
                : "fixture readonly status\n",
            );
            if (offset >= data.length) sftp.status(id, 1);
            else sftp.data(id, data.subarray(offset, offset + length));
          });
          sftp.on("CLOSE", (id) => sftp.status(id, 0));
        });
      }),
    );
  });
  await new Promise<void>((resolve) => ssh.listen(0, "127.0.0.1", resolve));
  const modelRequests: { messages: { role: string; content: string }[] }[] = [];
  const model = createServer((req, res) => {
    let body = "";
    req.on("data", (data) => {
      body += data;
    });
    req.on("end", () => {
      modelRequests.push(JSON.parse(body));
    });
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
      await window.axon.terminal.write(terminal, "echo AXON_REAL_PTY_OK\r");
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
    await page.getByRole("combobox", { name: "认证方式", exact: true }).click();
    await expect(
      page.getByRole("option", { name: "SSH Agent（推荐）", exact: true }),
    ).toBeFocused();
    await page
      .getByRole("option", { name: "SSH Agent（推荐）", exact: true })
      .press("ArrowDown");
    await page
      .getByRole("option", { name: "私钥文件", exact: true })
      .press("Enter");
    await expect(
      page.getByRole("combobox", { name: "认证方式", exact: true }),
    ).toHaveAttribute("data-value", "key");
    await page.getByLabel("私钥路径").fill(keyPath);
    await page.getByRole("button", { name: "保存服务器" }).click();
    await page.locator(".server-row").first().click();
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
    const tabsBeforeConnect = await page.locator(".terminal-tab").count();
    await page.getByRole("button", { name: "连接", exact: true }).click();
    await expect(page.locator(".server-toolbar .badge")).toHaveText("已连接");
    await expect(page.locator(".terminal-tab")).toHaveCount(tabsBeforeConnect);
    await page.getByRole("button", { name: "打开终端", exact: true }).click();
    await expect(page.getByText("已连接", { exact: true })).toBeVisible();
    expect(
      await page.evaluate(
        async () => (await window.axon.servers.list())[0].fingerprint,
      ),
    ).toMatch(/^SHA256:/);
    await page.getByRole("button", { name: "设置与模型", exact: true }).click();
    await expect(page.locator(".settings-page")).toBeVisible();
    await expect(page.locator(".modal-overlay")).toHaveCount(0);
    await expect(page.locator(".sidebar")).toBeVisible();
    await expect(page.locator(".session-toolbar")).toBeHidden();
    await page
      .getByLabel("API Base URL")
      .fill(`http://127.0.0.1:${(model.address() as AddressInfo).port}/v1`);
    await page.getByLabel("模型", { exact: true }).fill("fixture-model");
    await page.getByRole("button", { name: "保存设置" }).click();
    await expect(page.getByText("已保存", { exact: true })).toBeVisible();
    await page
      .getByRole("button", { name: "返回会话", exact: true })
      .last()
      .click();
    await page.getByLabel("运维任务").fill("检查负载");
    await page.getByRole("button", { name: "发送任务" }).click();
    await expect(page.getByText("先检查负载。")).toBeVisible();
    expect(executions).toBe(0);
    await expect(page.getByText("本地优先", { exact: true })).toHaveCount(0);
    await expect(page.getByText("数据保存在本机", { exact: true })).toHaveCount(
      0,
    );
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
      "确认服务器执行",
    ]);
    expect(dialogs[1].detail).toContain("uptime");
    const firstSession = await page
      .locator(".session-row.selected")
      .getAttribute("data-session-id");
    await expect(page.locator(".sidebar-actions")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Session 执行记录", exact: true })
      .click();
    await expect(
      page.locator(".activity-row code").filter({ hasText: /^uptime$/ }),
    ).toHaveText("uptime");
    await page
      .getByRole("button", { name: "新建 Session", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Session 执行记录", exact: true })
      .click();
    await expect(page.locator(".activity-row code")).toHaveCount(0);
    await page
      .locator(`.session-row[data-session-id="${firstSession}"]`)
      .click();
    await expect(page.getByText("先检查负载。", { exact: true })).toBeVisible();
    await page
      .getByRole("button", { name: "Session 执行记录", exact: true })
      .click();
    await expect(
      page.locator(".activity-row code").filter({ hasText: /^uptime$/ }),
    ).toHaveText("uptime");
    await page.reload();
    await expect(
      page.locator(".activity-row code").filter({ hasText: /^uptime$/ }),
    ).toHaveText("uptime");
    await page.getByRole("button", { name: "对话", exact: true }).click();
    await expect(page.getByText("退出码：0", { exact: true })).toBeVisible();
    await page.getByLabel("运维任务").fill("继续分析这个问题");
    await page.getByRole("button", { name: "发送任务", exact: true }).click();
    await expect(
      page.locator(".message.assistant .message-text").last(),
    ).toHaveText("先检查负载。");
    expect(modelRequests).toHaveLength(2);
    expect(modelRequests[1].messages).toHaveLength(
      modelRequests[0].messages.length + 3,
    );
    expect(modelRequests[0].messages.at(-1)!.content).toContain("检查负载");
    expect(
      modelRequests[1].messages.slice(0, modelRequests[0].messages.length),
    ).toEqual(modelRequests[0].messages);
    expect(
      modelRequests[1].messages[modelRequests[0].messages.length].role,
    ).toBe("assistant");
    expect(modelRequests[1].messages.at(-1)!.content).toContain(
      "0.10 0.20 0.30",
    );
    await expect(page.locator(".diagnostics-card")).toHaveCount(2);
    expect(
      modelRequests[1].messages[modelRequests[0].messages.length + 1].content,
    ).toContain('"command": "uptime"');
    expect(
      modelRequests[1].messages[modelRequests[0].messages.length + 1].content,
    ).not.toContain("fixture: uptime");
    await page.getByRole("combobox", { name: "权限策略", exact: true }).click();
    await page.getByRole("option", { name: "只读", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "审批并执行" }).first(),
    ).toBeDisabled();
    const blocked = await page.evaluate(async () => {
      const w = JSON.parse(localStorage.getItem("axonssh.workspaces.v1")!)
        .workspaces[0];
      const s = (await window.axon.sessions.list(w.id)).find(
        (s) => s.id === w.activeSessionId,
      )!;
      try {
        await window.axon.remote.propose(s.serverId!, "uptime", s.id);
        return false;
      } catch {
        return true;
      }
    });
    expect(blocked).toBe(true);
    await page.getByRole("combobox", { name: "权限策略", exact: true }).click();
    await page
      .getByRole("option", { name: "Bypass permissions", exact: true })
      .click();
    await page
      .getByRole("button", { name: "直接执行", exact: true })
      .first()
      .click();
    expect(executions).toBe(2);
    expect(
      await application.evaluate(
        () => (globalThis as any).__axonDialogs.length,
      ),
    ).toBe(2);
    const bypassRecorded = await page.evaluate(async () => {
      const w = JSON.parse(localStorage.getItem("axonssh.workspaces.v1")!)
        .workspaces[0];
      return (await window.axon.activity.list(w.activeSessionId)).some(
        (a) => a.approval === "bypassed",
      );
    });
    expect(bypassRecorded).toBe(true);
    await page.reload();
    await expect(
      page.getByRole("combobox", { name: "权限策略", exact: true }),
    ).toHaveAttribute("data-value", "bypass");
    await page
      .getByRole("button", { name: "新建 Session", exact: true })
      .click();
    await expect(
      page.getByRole("combobox", { name: "权限策略", exact: true }),
    ).toHaveAttribute("data-value", "ask");
    expect(errors).toEqual([]);
  } finally {
    await application.close();
    model.closeAllConnections();
    model.close();
    ssh.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("workspace panels preserve live terminals, isolate drafts and persist layouts", async ({}, testInfo) => {
  const dir = mkdtempSync(join(tmpdir(), "axon-layout-"));
  const launch = () =>
    electron.launch({
      args: [
        "--no-sandbox",
        "--disable-gpu",
        `--user-data-dir=${join(dir, "profile")}`,
        join(process.cwd(), "out/main/index.js"),
      ],
    });
  let application = await launch();
  try {
    let page = await application.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await expect(page.getByLabel("工作空间", { exact: true })).toHaveAttribute(
      "data-workspace-id",
      /.+/,
    );
    const originalWorkspace = await page
      .getByLabel("工作空间", { exact: true })
      .getAttribute("data-workspace-id");
    await page
      .getByRole("combobox", { name: "工作空间", exact: true })
      .press("ArrowDown");
    await expect(
      page.getByRole("listbox", { name: "选择工作空间" }),
    ).toBeVisible();
    await page
      .getByRole("option", { name: "我的工作空间", exact: true })
      .press("Escape");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(
      page.getByRole("combobox", { name: "工作空间", exact: true }),
    ).toBeFocused();
    await page.getByRole("combobox", { name: "工作空间", exact: true }).click();
    await page.getByLabel("运维任务").click();
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(page.locator(".terminal-section")).toBeHidden();
    await page
      .getByRole("combobox", { name: "智能体引擎", exact: true })
      .click();
    await expect(
      page.getByRole("listbox", { name: "选择智能体引擎" }),
    ).toBeVisible();
    await expect(
      page.getByRole("option", { name: "内置运维助手", exact: true }),
    ).toBeFocused();
    await page
      .getByRole("option", { name: "内置运维助手", exact: true })
      .press("Escape");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await page.getByLabel("运维任务").fill("原工作空间的草稿");
    await page
      .getByRole("button", { name: "打开本地终端", exact: true })
      .click();
    await expect(page.locator(".terminal-section")).toBeVisible();
    const terminalId = await page
      .locator(".terminal-canvas")
      .getAttribute("data-terminal-id");
    expect(terminalId).toBeTruthy();
    await page.evaluate(() => {
      (window as any).__originalTerminal =
        document.querySelector(".terminal-canvas");
    });
    const command =
      process.platform === "win32"
        ? "$axonPanelSession = 19; Write-Output ('READY_' + ($axonPanelSession * 37))\r"
        : "AXON_PANEL_SESSION=19; printf 'READY_%s\\n' \"$((AXON_PANEL_SESSION * 37))\"\r";
    const run = async (command: string, expected: string) =>
      page.evaluate(
        async ({ id, command, expected }) => {
          const result = new Promise<string>((resolve, reject) => {
            let output = "";
            const timer = setTimeout(() => {
              stop();
              reject(new Error("Live terminal command timed out"));
            }, 10000);
            const stop = window.axon.onEvent((e) => {
              if (e.type === "terminal:data" && e.id === id) {
                output += e.data;
                if (output.includes(expected)) {
                  clearTimeout(timer);
                  stop();
                  resolve(output);
                }
              }
            });
          });
          await window.axon.terminal.write(id!, command);
          return result;
        },
        { id: terminalId, command, expected },
      );
    await run(command, "READY_703");
    await expect(
      page.getByRole("button", { name: "底部终端", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "移到底部", exact: true }),
    ).toHaveCount(0);
    await expect(page.locator(".workspace-layout")).toHaveClass(/dock-right/);
    const terminalBounds = await page
      .locator(".terminal-section")
      .boundingBox();
    const conversationBounds = await page
      .locator(".conversation")
      .boundingBox();
    expect(terminalBounds!.x).toBeGreaterThan(
      conversationBounds!.x + conversationBounds!.width - 1,
    );
    await page.getByRole("button", { name: "收起终端面板" }).click();
    await expect(page.locator(".terminal-section")).toBeHidden();
    await run(
      process.platform === "win32"
        ? "Write-Output ('HIDDEN_' + ($axonPanelSession * 37))\r"
        : "printf 'HIDDEN_%s\\n' \"$((AXON_PANEL_SESSION * 37))\"\r",
      "HIDDEN_703",
    );
    await page.getByRole("button", { name: "右侧终端", exact: true }).click();
    await expect(page.locator(".terminal-section")).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          (window as any).__originalTerminal ===
          document.querySelector(".terminal-canvas"),
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "终端作为主视图" }).click();
    await expect(page.locator(".conversation")).toBeHidden();
    await page.getByRole("button", { name: "右侧智能体", exact: true }).click();
    await expect(page.getByLabel("运维任务")).toHaveValue("原工作空间的草稿");
    await page.screenshot({
      path: testInfo.outputPath("terminal-with-agent.png"),
    });
    await page.getByRole("button", { name: "收起智能体面板" }).click();
    await expect(page.locator(".conversation")).toBeHidden();
    await page.getByRole("button", { name: "收起侧边栏", exact: true }).click();
    await expect(page.locator(".sidebar")).toBeHidden();
    await page.getByRole("button", { name: "展开侧边栏", exact: true }).click();
    await page
      .getByRole("button", { name: "新建工作空间", exact: true })
      .click();
    await page.getByLabel("工作空间名称").fill("开发环境");
    await page
      .getByRole("button", { name: "创建工作空间", exact: true })
      .click();
    await expect(page.getByLabel("运维任务")).toHaveValue("");
    await expect(page.locator(".terminal-section")).toBeHidden();
    await page.getByLabel("运维任务").fill("开发环境的草稿");
    await page
      .getByRole("button", { name: "添加服务器", exact: true })
      .first()
      .click();
    await page.getByLabel("名称", { exact: true }).fill("Dev server");
    await page.getByLabel("主机地址").fill("127.0.0.1");
    await page.getByRole("button", { name: "保存服务器", exact: true }).click();
    await expect(page.locator(".server-row")).toContainText("Dev server");
    const devWorkspace = await page
      .getByLabel("工作空间", { exact: true })
      .getAttribute("data-workspace-id");
    await page.getByRole("combobox", { name: "工作空间", exact: true }).click();
    await expect(
      page.getByRole("option", { name: "开发环境", exact: true }),
    ).toBeFocused();
    await page
      .getByRole("option", { name: "开发环境", exact: true })
      .press("Home");
    await page
      .getByRole("option", { name: "我的工作空间", exact: true })
      .press("Enter");
    await expect(
      page.getByRole("combobox", { name: "工作空间", exact: true }),
    ).toHaveAttribute("data-workspace-id", originalWorkspace!);
    await expect(page.locator(".server-row")).toHaveCount(0);
    await expect(page.locator(".terminal-canvas:visible")).toHaveAttribute(
      "data-terminal-id",
      terminalId!,
    );
    await page.getByRole("button", { name: "右侧智能体", exact: true }).click();
    await expect(page.getByLabel("运维任务")).toHaveValue("原工作空间的草稿");
    await run(
      process.platform === "win32"
        ? "Write-Output ('RESTORED_' + ($axonPanelSession * 37))\r"
        : "printf 'RESTORED_%s\\n' \"$((AXON_PANEL_SESSION * 37))\"\r",
      "RESTORED_703",
    );
    await page.getByRole("combobox", { name: "工作空间", exact: true }).click();
    await page.getByRole("option", { name: "开发环境", exact: true }).click();
    await expect(page.getByLabel("运维任务")).toHaveValue("开发环境的草稿");
    await page.getByRole("button", { name: "右侧终端", exact: true }).click();
    await page
      .getByRole("button", { name: "收起终端面板", exact: true })
      .click();
    await expect(page.locator(".terminal-section")).toBeHidden();
    await page.getByRole("button", { name: "右侧终端", exact: true }).click();
    await page.getByRole("button", { name: "收起侧边栏", exact: true }).click();
    await page.screenshot({
      path: testInfo.outputPath("workspace-with-terminal.png"),
    });
    expect(errors).toEqual([]);
    await application.close();
    application = await launch();
    page = await application.firstWindow();
    await expect(page.locator(".sidebar")).toBeHidden();
    await expect(page.locator(".workspace-layout")).toHaveClass(/dock-right/);
    await expect(page.locator(".terminal-section")).toBeVisible();
    await page.getByRole("button", { name: "展开侧边栏", exact: true }).click();
    await expect(page.getByLabel("工作空间", { exact: true })).toHaveAttribute(
      "data-workspace-id",
      devWorkspace!,
    );
    await expect(page.locator(".server-row")).toContainText("Dev server");
    await expect(page.locator(".terminal-tab")).toHaveCount(0);
  } finally {
    await application.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("theme modes follow system changes, preserve terminals, and survive restart", async ({}, testInfo) => {
  const dir = mkdtempSync(join(tmpdir(), "axon-theme-"));
  const launch = () =>
    electron.launch({
      args: [
        "--no-sandbox",
        "--disable-gpu",
        `--user-data-dir=${join(dir, "profile")}`,
        join(process.cwd(), "out/main/index.js"),
      ],
    });
  let application = await launch();
  try {
    let page = await application.firstWindow();
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.getByLabel("运维任务").fill("主题切换保留草稿");
    await page
      .getByRole("button", { name: "打开本地终端", exact: true })
      .click();
    const terminalId = await page
      .locator(".terminal-canvas")
      .getAttribute("data-terminal-id");
    await page.evaluate(() => {
      (window as any).__themeTerminal =
        document.querySelector(".terminal-canvas");
    });
    await page.getByRole("button", { name: "设置与模型", exact: true }).click();
    await expect(
      page.getByRole("combobox", { name: "主题", exact: true }),
    ).toHaveAttribute("data-value", "system");
    const choose = async (name: string) => {
      await page.getByRole("combobox", { name: "主题", exact: true }).click();
      await page.getByRole("option", { name, exact: true }).click();
    };
    await choose("暗");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.emulateMedia({ colorScheme: "dark" });
    await choose("亮");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.locator(".sidebar")).toHaveCSS(
      "background-color",
      "rgb(243, 242, 240)",
    );
    await page
      .getByRole("button", { name: "返回会话", exact: true })
      .last()
      .click();
    await expect(page.getByLabel("运维任务")).toHaveValue("主题切换保留草稿");
    await expect(page.locator(".terminal-canvas")).toHaveAttribute(
      "data-terminal-id",
      terminalId!,
    );
    expect(
      await page.evaluate(
        () =>
          (window as any).__themeTerminal ===
          document.querySelector(".terminal-canvas"),
      ),
    ).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("light-theme.png") });
    await page.getByRole("button", { name: "设置与模型", exact: true }).click();
    await choose("随系统");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await choose("暗");
    await page
      .getByRole("button", { name: "返回会话", exact: true })
      .last()
      .click();
    await page.screenshot({ path: testInfo.outputPath("dark-theme.png") });
    await application.close();
    application = await launch();
    page = await application.firstWindow();
    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByRole("button", { name: "设置与模型", exact: true }).click();
    await expect(
      page.getByRole("combobox", { name: "主题", exact: true }),
    ).toHaveAttribute("data-value", "dark");
  } finally {
    await application.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("projects organize sessions, choose real directories, set local PTY cwd and survive restart", async ({}, testInfo) => {
  const dir = mkdtempSync(join(tmpdir(), "axon-projects-"));
  const cwdMarker = `axon-cwd-${crypto.randomUUID()}.txt`,
    cwdToken = crypto.randomUUID();
  writeFileSync(join(dir, cwdMarker), cwdToken);
  const launch = () =>
    electron.launch({
      args: [
        "--no-sandbox",
        "--disable-gpu",
        `--user-data-dir=${join(dir, "profile")}`,
        join(process.cwd(), "out/main/index.js"),
      ],
    });
  let application = await launch();
  try {
    let page = await application.firstWindow();
    await page.locator(".session-row.selected").waitFor();
    const original = await page
      .locator(".session-row.selected")
      .getAttribute("data-session-id");
    await application.evaluate(({ dialog }, directory) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [directory],
      })) as typeof dialog.showOpenDialog;
    }, dir);
    await page.getByRole("button", { name: "新建项目", exact: true }).click();
    await page.getByLabel("项目名称", { exact: true }).fill("Development");
    await page.getByRole("button", { name: "浏览", exact: true }).click();
    await expect(page.getByLabel("项目目录", { exact: true })).toHaveValue(dir);
    await page.getByRole("button", { name: "保存项目", exact: true }).click();
    await expect(
      page.locator(".project-group[data-project-id] .session-row"),
    ).toHaveCount(1);
    const projectId = await page
      .locator(".project-group")
      .getAttribute("data-project-id");
    const first = await page
      .locator(".session-row.selected")
      .getAttribute("data-session-id");
    expect(first).not.toBe(original);
    await expect(
      page.getByRole("combobox", { name: "Session 项目", exact: true }),
    ).toContainText("Development");
    await page.getByLabel("运维任务").fill("project draft");
    await page
      .getByRole("button", { name: "打开本地终端", exact: true })
      .click();
    const terminalId = await page
      .locator(".terminal-canvas")
      .getAttribute("data-terminal-id");
    const output = await page.evaluate(
      async ({ id, marker, token, windows }) => {
        const done = new Promise<string>((resolve, reject) => {
          let text = "";
          const timer = setTimeout(() => {
            stop();
            reject(new Error("Project PTY cwd timeout"));
          }, 10000);
          const stop = window.axon.onEvent((event) => {
            if (event.type === "terminal:data" && event.id === id) {
              text += event.data;
              if (
                text.includes("PROJECT_CWD_OK") ||
                text.includes("PROJECT_CWD_WRONG")
              ) {
                clearTimeout(timer);
                stop();
                resolve(text);
              }
            }
          });
        });
        await window.axon.terminal.write(
          id!,
          windows
            ? `if ((Test-Path -LiteralPath './${marker}') -and (Get-Content -LiteralPath './${marker}' -Raw) -eq '${token}') { Write-Output ('PROJECT_' + 'CWD_OK') } else { Write-Output ('PROJECT_' + 'CWD_WRONG') }\r`
            : `if [ "$(cat '${marker}' 2>/dev/null)" = '${token}' ]; then printf 'PROJECT_%s\\n' 'CWD_OK'; else printf 'PROJECT_%s\\n' 'CWD_WRONG'; fi\r`,
        );
        return done;
      },
      {
        id: terminalId,
        marker: cwdMarker,
        token: cwdToken,
        windows: process.platform === "win32",
      },
    );
    expect(output).toContain("PROJECT_CWD_OK");
    await page
      .getByRole("button", { name: "新建 Session", exact: true })
      .click();
    await expect(page.locator(".project-group .session-row")).toHaveCount(2);
    await expect(page.getByLabel("运维任务")).toHaveValue("");
    await page.locator(`.session-row[data-session-id="${first}"]`).click();
    await expect(page.getByLabel("运维任务")).toHaveValue("project draft");
    await page
      .getByRole("combobox", { name: "Session 项目", exact: true })
      .click();
    await page.getByRole("option", { name: "未归类", exact: true }).click();
    await expect(page.locator(".project-group .session-row")).toHaveCount(1);
    await page
      .getByRole("button", { name: "管理项目：Development", exact: true })
      .click();
    await page.getByLabel("项目名称", { exact: true }).fill("Renamed project");
    await page.getByRole("button", { name: "保存项目", exact: true }).click();
    await expect(page.locator(".project-collapse")).toContainText(
      "Renamed project",
    );
    await page.screenshot({ path: testInfo.outputPath("project-sidebar.png") });
    await application.close();
    application = await launch();
    page = await application.firstWindow();
    await expect(
      page.locator(`.project-group[data-project-id="${projectId}"]`),
    ).toBeVisible();
    await expect(page.locator(".project-collapse")).toContainText(
      "Renamed project",
    );
    await expect(page.locator(".project-group .session-row")).toHaveCount(1);
    await expect(
      page.locator(`.session-row[data-session-id="${original}"]`),
    ).toBeVisible();
  } finally {
    await application.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("server projects select multiple associated hosts and persist the chosen Session target", async ({}, testInfo) => {
  const dir = mkdtempSync(join(tmpdir(), "axon-server-project-"));
  const launch = () =>
    electron.launch({
      args: [
        "--no-sandbox",
        "--disable-gpu",
        `--user-data-dir=${join(dir, "profile")}`,
        join(process.cwd(), "out/main/index.js"),
      ],
    });
  let application = await launch();
  try {
    let page = await application.firstWindow();
    await page.locator(".session-row.selected").waitFor();
    const servers = await page.evaluate(async () => {
      const profiles = [];
      for (const name of ["Alpha", "Beta", "Unrelated"])
        profiles.push(
          await window.axon.servers.save({
            name,
            host: name.toLowerCase() + ".example.test",
            port: 22,
            username: "root",
            authType: "agent",
            group: "Test",
          }),
        );
      return profiles;
    });
    await page.reload();
    await expect(page.locator(".server-row")).toHaveCount(3);
    await page.getByRole("button", { name: "新建项目", exact: true }).click();
    await page
      .getByLabel("项目名称", { exact: true })
      .fill("Production cluster");
    await expect(
      page.getByRole("combobox", { name: "项目位置", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("checkbox", { name: "关联本地", exact: true }),
    ).toBeChecked();
    await page.getByLabel("项目目录", { exact: true }).fill(dir);
    await page.getByRole("checkbox", { name: /^Alpha/ }).check();
    await page.getByRole("checkbox", { name: /^Beta/ }).check();
    await page
      .getByLabel("远程项目目录", { exact: true })
      .fill("/srv/my-project");
    await page.getByRole("button", { name: "保存项目", exact: true }).click();
    await expect(
      page.getByRole("combobox", { name: "处理位置", exact: true }),
    ).toContainText("本机");
    await page.getByRole("combobox", { name: "处理位置", exact: true }).click();
    await page.getByRole("option", { name: "Alpha", exact: true }).click();
    await expect(page.locator(".server-row")).toHaveCount(2);
    await expect(page.locator(".server-toolbar strong")).toHaveText("Alpha");
    await page.getByRole("combobox", { name: "处理位置", exact: true }).click();
    await page.getByRole("option", { name: "Beta", exact: true }).click();
    await expect(page.locator(".server-toolbar strong")).toHaveText("Beta");
    await page
      .getByRole("button", { name: "新建 Session", exact: true })
      .click();
    await expect(page.locator(".project-group .session-row")).toHaveCount(2);
    const id = await page
      .locator(".session-row.selected")
      .getAttribute("data-session-id");
    const snapshot = await page.evaluate(async (id) => {
      const w = JSON.parse(localStorage.getItem("axonssh.workspaces.v1")!)
        .workspaces[0].id;
      return (await window.axon.sessions.list(w)).find((s) => s.id === id)!;
    }, id);
    expect(snapshot.serverId).toBeUndefined();
    await page.getByRole("combobox", { name: "处理位置", exact: true }).click();
    await page.getByRole("option", { name: "Beta", exact: true }).click();
    const project = await page.evaluate(
      async (id) =>
        (await window.axon.projects.list()).find((p) => p.id === id)!,
      snapshot.projectId,
    );
    expect(project).toMatchObject({
      includeLocal: true,
      serverIds: [servers[0].id, servers[1].id],
      remoteDirectory: "/srv/my-project",
    });
    expect(project.directory).toBeTruthy();
    await expect(page.locator(".terminal-tab")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("server-project.png") });
    await application.close();
    application = await launch();
    page = await application.firstWindow();
    await expect(
      page.getByRole("combobox", { name: "处理位置", exact: true }),
    ).toContainText("Beta");
    await expect(page.locator(".project-group .session-row")).toHaveCount(2);
    await expect(page.locator(".server-row")).toHaveCount(2);
    await page.getByRole("combobox", { name: "处理位置", exact: true }).click();
    await page.getByRole("option", { name: "本机", exact: true }).click();
    await expect(page.locator(".server-toolbar")).toHaveCount(0);
    await expect(
      page.getByRole("combobox", { name: "处理位置", exact: true }),
    ).toContainText("本机");
  } finally {
    await application.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("local is the default target and permissions govern real local command execution", async () => {
  const dir = mkdtempSync(join(tmpdir(), "axon-modes-"));
  const requests: any[] = [];
  const model = createServer((req, res) => {
    let body = "";
    req.on("data", (data) => {
      body += data;
    });
    req.on("end", () => {
      requests.push(JSON.parse(body));
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  text: "mode verified",
                  proposals: [{ command: "uptime", explanation: "fixture" }],
                }),
              },
            },
          ],
        }),
      );
    });
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
    await page.locator(".session-row.selected").waitFor();
    await page.evaluate(
      (baseUrl) =>
        window.axon.settings.save({
          baseUrl,
          model: "fixture",
          provider: "compatible",
        }),
      `http://127.0.0.1:${(model.address() as AddressInfo).port}/v1`,
    );
    await expect(
      page.getByRole("combobox", { name: "操作模式", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("combobox", { name: "处理位置", exact: true }),
    ).toHaveAttribute("data-value", "");
    await application.evaluate(({ dialog }) => {
      dialog.showMessageBox = (async () => ({
        response: 1,
        checkboxChecked: false,
      })) as typeof dialog.showMessageBox;
    });
    await page.getByLabel("运维任务").fill("check local");
    await page.getByRole("button", { name: "发送任务" }).click();
    await expect(page.locator(".diagnostics-card")).toHaveCount(1);
    expect(requests[0].messages.at(-1).content).toContain("cpuCount");
    expect(requests[0].messages.at(-1).content).toContain("当前处理位置：本机");
    const owner = await page
      .locator(".session-row.selected")
      .getAttribute("data-session-id");
    const result = await page.evaluate(async (id) => {
      const ticket = await window.axon.remote.propose(
        undefined,
        "echo AXON_LOCAL_TARGET",
        id!,
        "local-test",
      );
      return window.axon.remote.execute(ticket);
    }, owner);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("AXON_LOCAL_TARGET");
    await page.getByRole("combobox", { name: "权限策略", exact: true }).click();
    await page.getByRole("option", { name: "只读", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "审批并执行" }),
    ).toBeDisabled();
    await page.reload();
    await expect(
      page.getByRole("combobox", { name: "权限策略", exact: true }),
    ).toHaveAttribute("data-value", "read-only");
    await expect(
      page.getByRole("combobox", { name: "操作模式", exact: true }),
    ).toHaveCount(0);
  } finally {
    await application.close();
    model.closeAllConnections();
    model.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
