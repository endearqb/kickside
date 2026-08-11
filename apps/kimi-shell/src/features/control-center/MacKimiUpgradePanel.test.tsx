// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyInstallSessionSnapshot } from "@/app/types";
import { MacKimiUpgradePanel } from "./MacKimiUpgradePanel";

afterEach(cleanup);

describe("MacKimiUpgradePanel", () => {
  it("shows streamed upgrade output and exposes cancellation while running", () => {
    const onCancel = vi.fn(async () => undefined);
    render(
      <MacKimiUpgradePanel
        session={{
          ...createEmptyInstallSessionSnapshot(),
          taskId: "upgrade_kimi",
          status: "running",
          stage: "execute_step",
          currentStepTitle: "Upgrade Kimi Code",
          message: "Running updater",
          logs: [
            {
              taskId: "upgrade_kimi",
              stepId: "upgrade_kimi",
              source: "official",
              stream: "stdout",
              text: "Downloading update",
              at: "2026-08-11T00:00:00Z",
            },
          ],
        }}
        detectedKimiPath="/Users/example/.kimi-code/bin/kimi"
        upgradeLabel="升级到 v1.2.3"
        upgradeDisabled={false}
        onUpgrade={vi.fn(async () => undefined)}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByRole("log", { name: "Kimi Code 升级日志" }).textContent).toContain(
      "Downloading update",
    );
    fireEvent.click(screen.getByRole("button", { name: "取消升级" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("starts the managed upgrade from an idle state", () => {
    const onUpgrade = vi.fn(async () => undefined);
    render(
      <MacKimiUpgradePanel
        session={createEmptyInstallSessionSnapshot()}
        detectedKimiPath="/Users/example/.kimi-code/bin/kimi"
        upgradeLabel="升级 Kimi"
        upgradeDisabled={false}
        onUpgrade={onUpgrade}
        onCancel={vi.fn(async () => undefined)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "升级 Kimi" }));
    expect(onUpgrade).toHaveBeenCalledOnce();
  });
});
