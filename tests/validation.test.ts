import { describe, expect, it } from "vitest";
import {
  commandSchema,
  serverSchema,
  settingsSchema,
} from "../src/shared/validation";
import { parseAgentResponse } from "../src/main/agent";
describe("untrusted input validation", () => {
  it("rejects invalid ports, host control characters and missing private keys", () => {
    const value = {
      name: "test",
      host: "example.test",
      port: 22,
      username: "user",
      group: "",
      authType: "agent",
    };
    expect(serverSchema.safeParse({ ...value, port: 70000 }).success).toBe(
      false,
    );
    expect(
      serverSchema.safeParse({ ...value, host: "host\ncommand" }).success,
    ).toBe(false);
    expect(serverSchema.safeParse({ ...value, authType: "key" }).success).toBe(
      false,
    );
  });
  it("accepts local models but rejects remote cleartext and URL credentials", () => {
    const check = (baseUrl: string) =>
      settingsSchema.safeParse({ baseUrl, model: "test" }).success;
    expect(check("http://127.0.0.1:11434/v1")).toBe(true);
    expect(check("https://api.example.test/v1")).toBe(true);
    expect(check("http://api.example.test/v1")).toBe(false);
    expect(check("https://user:password@api.example.test/v1")).toBe(false);
  });
  it("rejects NUL commands and malformed model proposals", () => {
    expect(commandSchema.safeParse("echo\0bad").success).toBe(false);
    expect(
      parseAgentResponse(
        '{"text":"Advice","proposals":[{"command":"pwd","explanation":"Read cwd"},{"command":123}]}',
      ).proposals,
    ).toHaveLength(1);
    expect(parseAgentResponse("plain text")).toEqual({
      text: "plain text",
      proposals: [],
    });
  });
});
