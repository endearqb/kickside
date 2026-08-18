// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LanAccessControllerModel } from "@/app/useLanAccessController";
import { LanAccessSettingsPanel } from "./LanAccessSettingsPanel";

const askDialog = vi.hoisted(() => vi.fn(async () => true));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: askDialog }));

function controller(overrides: Partial<LanAccessControllerModel> = {}): LanAccessControllerModel {
  return {
    status: {
      enabled: false,
      switching: false,
      runtimeOwnership: "owned_by_shell",
      runtimeReady: true,
      canToggle: true,
      addresses: [],
      tokenAvailable: true,
    },
    error: null,
    busy: false,
    refresh: vi.fn(async () => null),
    toggle: vi.fn(async () => null),
    getLaunchUrl: vi.fn(async () => null),
    ...overrides,
  };
}

describe("LanAccessSettingsPanel", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("keeps external runtimes read-only", () => {
    const lanAccess = controller({
      status: {
        enabled: false,
        switching: false,
        runtimeOwnership: "reused_external",
        runtimeReady: true,
        canToggle: false,
        addresses: [],
        tokenAvailable: true,
      },
    });
    render(<ul><LanAccessSettingsPanel lanAccess={lanAccess} expanded onExpandedChange={vi.fn()} /></ul>);

    expect(screen.getByText("外部进程管理 · 无法切换")).toBeTruthy();
    expect(screen.getByText(/不会停止或修改它/)).toBeTruthy();
    expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);
  });

  it("requires the trusted-network warning before enabling", async () => {
    const toggle = vi.fn(async () => null);
    const lanAccess = controller({ toggle });
    render(<ul><LanAccessSettingsPanel lanAccess={lanAccess} expanded={false} onExpandedChange={vi.fn()} /></ul>);

    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(askDialog).toHaveBeenCalledTimes(1));
    expect(toggle).toHaveBeenCalledWith(true);
  });

  it("creates and clears the secret launch projection only on demand", async () => {
    const getLaunchUrl = vi.fn(async () => ({
      url: "http://192.168.1.8:58627/?kimi_onboarded=1#token=fake",
      qrSvg: "<svg aria-label=\"fixture\"></svg>",
    }));
    const lanAccess = controller({
      status: {
        enabled: true,
        switching: false,
        runtimeOwnership: "owned_by_shell",
        runtimeReady: true,
        canToggle: true,
        port: 58627,
        addresses: [{ name: "Wi-Fi", ip: "192.168.1.8", url: "http://192.168.1.8:58627" }],
        tokenAvailable: true,
      },
      getLaunchUrl,
    });
    render(<ul><LanAccessSettingsPanel lanAccess={lanAccess} expanded onExpandedChange={vi.fn()} /></ul>);

    expect(screen.queryByRole("dialog", { name: "Kimi Code 局域网二维码" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "显示二维码" }));
    await waitFor(() => expect(getLaunchUrl).toHaveBeenCalledWith("192.168.1.8"));
    expect(screen.getByRole("dialog", { name: "Kimi Code 局域网二维码" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "关闭二维码" }));
    expect(screen.queryByRole("dialog", { name: "Kimi Code 局域网二维码" })).toBeNull();
  });
});
