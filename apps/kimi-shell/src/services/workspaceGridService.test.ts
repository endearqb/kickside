import { describe, expect, it, vi } from "vitest";
import { resolveCurrentPaneWorkDir } from "./workspaceGridService";

describe("resolveCurrentPaneWorkDir", () => {
  it("returns a work directory only after the same session is confirmed twice", async () => {
    const querySessionId = vi.fn().mockResolvedValue("session-a");

    await expect(
      resolveCurrentPaneWorkDir(querySessionId, async () => ({
        sessionId: "session-a",
        workDir: " D:\\workspace-a ",
        isRunning: true,
      })),
    ).resolves.toBe("D:\\workspace-a");
    expect(querySessionId).toHaveBeenCalledTimes(2);
  });

  it("rejects when the iframe switches from A to B during directory lookup", async () => {
    const querySessionId = vi
      .fn()
      .mockResolvedValueOnce("session-a")
      .mockResolvedValueOnce("session-b");

    await expect(
      resolveCurrentPaneWorkDir(querySessionId, async () => ({
        sessionId: "session-a",
        workDir: "D:\\workspace-a",
        isRunning: true,
      })),
    ).rejects.toThrow("查询期间会话已切换，请重试。");
  });

  it("rejects API errors, mismatched sessions, and empty work directories", async () => {
    const querySessionId = vi.fn().mockResolvedValue("session-a");

    await expect(
      resolveCurrentPaneWorkDir(querySessionId, async () => {
        throw new Error("404");
      }),
    ).rejects.toThrow("404");
    await expect(
      resolveCurrentPaneWorkDir(querySessionId, async () => ({
        sessionId: "session-b",
        workDir: "D:\\workspace-b",
        isRunning: false,
      })),
    ).rejects.toThrow("会话目录查询返回了不匹配的会话。");
    await expect(
      resolveCurrentPaneWorkDir(querySessionId, async () => ({
        sessionId: "session-a",
        isRunning: false,
      })),
    ).rejects.toThrow("当前会话没有可用工作目录。");
  });
});
