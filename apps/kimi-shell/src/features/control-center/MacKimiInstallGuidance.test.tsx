// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAC_KIMI_INSTALL_COMMAND,
  MAC_KIMI_UPGRADE_COMMAND,
  MacKimiInstallGuidance,
} from "./MacKimiInstallGuidance";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("MacKimiInstallGuidance", () => {
  it("copies exact commands and opens Terminal without executing either command", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const onOpenTerminal = vi.fn(async () => undefined);

    render(
      <MacKimiInstallGuidance
        onOpenTerminal={onOpenTerminal}
        onOpenDocs={vi.fn(async () => undefined)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "复制安装命令" }));
    fireEvent.click(screen.getByRole("button", { name: "复制升级命令" }));
    fireEvent.click(screen.getByRole("button", { name: "打开 Terminal" }));

    await waitFor(() => {
      expect(writeText).toHaveBeenNthCalledWith(1, MAC_KIMI_INSTALL_COMMAND);
      expect(writeText).toHaveBeenNthCalledWith(2, MAC_KIMI_UPGRADE_COMMAND);
      expect(onOpenTerminal).toHaveBeenCalledOnce();
    });
  });

  it("reports clipboard failure inline", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn(async () => Promise.reject(new Error("denied"))) },
    });

    render(
      <MacKimiInstallGuidance
        onOpenTerminal={vi.fn(async () => undefined)}
        onOpenDocs={vi.fn(async () => undefined)}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "复制安装命令" }));

    expect((await screen.findByRole("status")).textContent).toContain("复制失败");
  });
});
