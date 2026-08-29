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
      mode: "local",
      switching: false,
      runtimeOwnership: "owned_by_shell",
      runtimeReady: true,
      canChange: true,
      lanAddresses: [],
      remoteControlSupported: true,
      remoteControlState: "disabled",
      remoteUrlAvailable: false,
    },
    error: null,
    busy: false,
    refresh: vi.fn(async () => null),
    setMode: vi.fn(async () => null),
    getLaunchUrl: vi.fn(async () => null),
    getRemoteLaunchUrl: vi.fn(async () => null),
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
        mode: "local",
        switching: false,
        runtimeOwnership: "reused_external",
        runtimeReady: true,
        canChange: false,
        lanAddresses: [],
        remoteControlSupported: true,
        remoteControlState: "disabled",
        remoteUrlAvailable: false,
      },
    });
    render(<ul><LanAccessSettingsPanel lanAccess={lanAccess} expanded onExpandedChange={vi.fn()} /></ul>);

    expect(screen.getByText("外部进程管理 · 无法切换")).toBeTruthy();
    expect(screen.getByText(/不会停止或修改它/)).toBeTruthy();
    expect((screen.getByRole("radio", { name: /仅本机/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("requires the trusted-network warning before enabling", async () => {
    const setMode = vi.fn(async () => null);
    const lanAccess = controller({ setMode });
    render(<ul><LanAccessSettingsPanel lanAccess={lanAccess} expanded onExpandedChange={vi.fn()} /></ul>);

    fireEvent.click(screen.getByRole("radio", { name: /局域网/ }));
    await waitFor(() => expect(askDialog).toHaveBeenCalledTimes(1));
    expect(setMode).toHaveBeenCalledWith("lan");
  });

  it("creates and clears the secret launch projection only on demand", async () => {
    const getLaunchUrl = vi.fn(async () => ({
      url: "http://192.168.1.8:58627/?kimi_onboarded=1#token=fake",
      qrSvg: "<svg aria-label=\"fixture\"></svg>",
    }));
    const lanAccess = controller({
      status: {
        mode: "lan",
        switching: false,
        runtimeOwnership: "owned_by_shell",
        runtimeReady: true,
        canChange: true,
        port: 58627,
        lanAddresses: [{ name: "Wi-Fi", ip: "192.168.1.8", url: "http://192.168.1.8:58627" }],
        remoteControlSupported: true,
        remoteControlState: "disabled",
        remoteUrlAvailable: false,
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

  it("shows official remote actions without exposing the URL until requested", async () => {
    const getRemoteLaunchUrl = vi.fn(async () => ({
      url: "https://www.kimi.com/remote/device-fixture?code=secret",
      qrSvg: "<svg aria-label=\"remote-fixture\"></svg>",
    }));
    const lanAccess = controller({
      status: {
        mode: "kimi_remote",
        switching: false,
        runtimeOwnership: "owned_by_shell",
        runtimeReady: true,
        canChange: true,
        lanAddresses: [],
        remoteControlSupported: true,
        remoteControlState: "connected",
        remoteUrlAvailable: true,
      },
      getRemoteLaunchUrl,
    });
    render(<ul><LanAccessSettingsPanel lanAccess={lanAccess} expanded onExpandedChange={vi.fn()} /></ul>);

    expect(screen.queryByText(/device-fixture/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "显示二维码" }));
    await waitFor(() => expect(getRemoteLaunchUrl).toHaveBeenCalledOnce());
    expect(screen.getByRole("dialog", { name: "Kimi 官方远程二维码" })).toBeTruthy();
    expect(screen.queryByText(/192\.168\./)).toBeNull();
  });
});
