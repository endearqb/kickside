// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyKimiCodeAccessInput } from "@/app/shellControllerDefaults";
import { KimiCodeAccessTaskContent } from "./KimiCodeAccessPanel";

describe("KimiCodeAccessTaskContent", () => {
  afterEach(() => cleanup());

  it("shows only the inline API configuration surface", () => {
    const onSave = vi.fn(async () => undefined);
    render(
      <KimiCodeAccessTaskContent
        dirty
        view={null}
        draft={createEmptyKimiCodeAccessInput()}
        testResult={null}
        testing={false}
        saving={false}
        onDraftChange={vi.fn()}
        onSave={onSave}
        onOpenConfigDir={vi.fn(async () => undefined)}
        onTestConnection={vi.fn(async () => undefined)}
      />,
    );

    expect(screen.getByText("Kimi Code 接入配置")).toBeTruthy();
    expect(screen.getByText("Web Search（可选）")).toBeTruthy();
    expect(screen.getByText("Web Fetch（可选）")).toBeTruthy();
    expect(screen.queryByText("配置文件")).toBeNull();
    expect(screen.queryByText("运行限制")).toBeNull();
    expect(screen.queryByText("恢复默认 URL")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "保存 API 配置" }));
    expect(onSave).toHaveBeenCalledOnce();
  });

  it("tracks service disclosure state without retaining the React event", () => {
    render(
      <KimiCodeAccessTaskContent
        dirty={false}
        view={null}
        draft={createEmptyKimiCodeAccessInput()}
        testResult={null}
        testing={false}
        saving={false}
        onDraftChange={vi.fn()}
        onSave={vi.fn(async () => undefined)}
        onOpenConfigDir={vi.fn(async () => undefined)}
        onTestConnection={vi.fn(async () => undefined)}
      />,
    );

    for (const label of ["Web Search（可选）", "Web Fetch（可选）"]) {
      const details = screen.getByText(label).closest("details");
      expect(details).toBeTruthy();

      details!.open = true;
      fireEvent(details!, new Event("toggle", { bubbles: true }));
      expect(details!.open).toBe(true);
      details!.open = false;
      fireEvent(details!, new Event("toggle", { bubbles: true }));
      expect(details!.open).toBe(false);
    }
  });
});
