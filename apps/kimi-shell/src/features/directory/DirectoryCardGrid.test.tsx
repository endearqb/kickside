// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DirectoryCardGrid } from "./DirectoryCardGrid";

describe("DirectoryCardGrid", () => {
  afterEach(() => {
    cleanup();
  });

  it("uses a native button for the card opener", () => {
    const onOpen = vi.fn();
    render(
      <DirectoryCardGrid
        items={[{ id: "one", title: "/one", description: "Demo", onOpen }]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /\/one Demo/ }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("keeps corner actions separate from the card opener", () => {
    const onOpen = vi.fn();
    const onSelect = vi.fn();
    render(
      <DirectoryCardGrid
        items={[
          {
            id: "one",
            title: "/one",
            description: "Demo",
            onOpen,
            cornerAction: { label: "添加", onSelect },
          },
        ]}
      />,
    );

    expect(screen.getAllByRole("button")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "添加" }));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("does not bubble corner slots to the card", () => {
    const onOpen = vi.fn();
    const onSelect = vi.fn();
    render(
      <DirectoryCardGrid
        items={[
          {
            id: "one",
            title: "/one",
            description: "Demo",
            onOpen,
            cornerSlot: (
              <button type="button" onClick={onSelect}>
                更多
              </button>
            ),
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "更多" }));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("shows skeleton cards only when loading without existing items", () => {
    const { rerender } = render(<DirectoryCardGrid items={[]} loading />);

    expect(screen.getByLabelText("正在加载目录")).toBeTruthy();

    rerender(
      <DirectoryCardGrid
        items={[{ id: "one", title: "/one", description: "Demo", onOpen: vi.fn() }]}
        loading
      />,
    );

    expect(screen.queryByLabelText("正在加载目录")).toBeNull();
    expect(screen.getByRole("button", { name: /\/one Demo/ })).toBeTruthy();
  });
});
