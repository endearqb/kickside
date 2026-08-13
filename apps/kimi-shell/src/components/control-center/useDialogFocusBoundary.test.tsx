// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useDialogFocusBoundary } from "./useDialogFocusBoundary";

function DialogHarness({ open }: { open: boolean }) {
  const dialogRef = useDialogFocusBoundary(open);
  return open ? (
    <div ref={dialogRef} role="dialog" tabIndex={-1}>
      <button type="button">第一个</button>
      <button type="button">最后一个</button>
      <div hidden aria-hidden="true" inert>
        <button type="button">隐藏页面按钮</button>
      </div>
    </div>
  ) : null;
}

afterEach(cleanup);

describe("useDialogFocusBoundary", () => {
  it("cycles Tab focus inside the dialog and restores the previous focus", () => {
    const { rerender } = render(
      <>
        <button type="button">打开设置</button>
        <DialogHarness open={false} />
      </>,
    );
    const trigger = screen.getByRole("button", { name: "打开设置" });
    trigger.focus();

    rerender(
      <>
        <button type="button">打开设置</button>
        <DialogHarness open />
      </>,
    );

    const first = screen.getByRole("button", { name: "第一个" });
    const last = screen.getByRole("button", { name: "最后一个" });
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);

    rerender(
      <>
        <button type="button">打开设置</button>
        <DialogHarness open={false} />
      </>,
    );
    expect(document.activeElement).toBe(trigger);
  });
});
