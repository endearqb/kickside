import { beforeEach, describe, expect, it, vi } from "vitest";

const { ask } = vi.hoisted(() => ({ ask: vi.fn() }));

vi.mock("@tauri-apps/plugin-dialog", () => ({ ask }));

import { requestKimiUpgradeConfirmation } from "./useInstallController";

describe("requestKimiUpgradeConfirmation", () => {
  beforeEach(() => {
    ask.mockReset();
  });

  it("uses the native warning dialog and explains stop, re-check and restart", async () => {
    ask.mockResolvedValue(true);

    await expect(requestKimiUpgradeConfirmation()).resolves.toBe(true);
    expect(ask).toHaveBeenCalledOnce();
    const [message, options] = ask.mock.calls[0];
    expect(message).toContain("停止 KickSide 管理的 Kimi 后端");
    expect(message).toContain("重新检测");
    expect(message).toContain("自动重启");
    expect(options).toMatchObject({
      title: "升级 Kimi Code",
      kind: "warning",
      okLabel: "开始升级",
      cancelLabel: "取消",
    });
  });
});
