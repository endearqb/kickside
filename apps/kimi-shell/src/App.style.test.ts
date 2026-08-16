// @vitest-environment node
// @ts-expect-error The app tsconfig intentionally excludes Node types; Vitest still runs this file in Node.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appCss = readFileSync(new URL("./App.css", import.meta.url), "utf8") as string;
const appSource = readFileSync(new URL("./App.tsx", import.meta.url), "utf8") as string;
const shellControllerSource = readFileSync(
  new URL("./app/useShellController.ts", import.meta.url),
  "utf8",
) as string;

function declarationBlock(selectorPattern: RegExp) {
  const match = appCss.match(new RegExp(`${selectorPattern.source}\\s*\\{([^}]*)\\}`));
  expect(match, `missing CSS rule for ${selectorPattern.source}`).toBeTruthy();
  return match?.[1] ?? "";
}

function declarationBlocks(selectorPattern: RegExp) {
  const matches = [
    ...appCss.matchAll(new RegExp(`${selectorPattern.source}\\s*\\{([^}]*)\\}`, "g")),
  ].map((match) => match[1] ?? "");
  expect(matches.length, `missing CSS rule for ${selectorPattern.source}`).toBeGreaterThan(0);
  return matches;
}

describe("control-center layout contracts", () => {
  it("keeps the full control center on theme tokens in dark mode", () => {
    expect(appCss).not.toContain("background: rgba(248, 248, 246, 0.92)");
    expect(appCss).not.toContain("background: rgba(248, 248, 246, 0.96)");
    expect(appCss).not.toContain("background: rgba(248, 248, 246, 0.9)");
    expect(appCss).toMatch(
      /\.theme-dark \.control-center-shell\s*\{[^}]*--primary-foreground:\s*#171a1c[^}]*color-scheme:\s*dark/s,
    );
    expect(appCss).toMatch(
      /\.theme-dark \.control-center-shell \.cc-unified-rail-footer[^}]*background:\s*var\(--cc-rail\)/s,
    );
  });

  it("aligns runtime actions without changing their business control", () => {
    const action = declarationBlock(/\.cc-settings-row-action/);
    const runtimeButton = declarationBlock(
      /\.cc-runtime-settings-row \.cc-settings-row-action \.cc-action-btn/,
    );
    const runtimeSwitch = declarationBlock(/\.cc-runtime-settings-row \.cc-dsh-toggle/);

    expect(action).toContain("min-width: 126px");
    expect(runtimeButton).toContain("min-width: 126px");
    expect(runtimeSwitch).toContain("width: 126px");
  });

  it("keeps the active preserved page as a definite-height grid item", () => {
    expect(appCss.length).toBeGreaterThan(10_000);
    expect(appCss).toContain(".control-center-shell .cc-main");
    const main = declarationBlocks(/\.control-center-shell \.cc-main/);
    const preservedPage = declarationBlock(/\.cc-preserved-page:not\(\[hidden\]\)/);

    expect(main.some((block) => block.includes("grid-template-rows: minmax(0, 1fr)"))).toBe(true);
    expect(preservedPage).toContain("display: block");
    expect(preservedPage).toContain("min-height: 0");
    expect(preservedPage).toContain("height: 100%");
    expect(preservedPage).not.toContain("display: contents");
  });

  it("keeps the Skill filter popover above the independently scrolling directory", () => {
    const surface = declarationBlock(
      /\.control-center-shell \.skill-center-page \.skill-center-directory-surface/,
    );
    const toolbar = declarationBlock(/\.control-center-shell \.skill-center-directory-toolbar/);
    const popover = declarationBlock(
      /\.control-center-shell \.skill-center-directory-filter-popover/,
    );

    expect(surface).toContain("overflow: visible");
    expect(toolbar).toContain("z-index: 10");
    expect(popover).toContain("z-index: 20");
  });

  it("scopes the two-row Skill page layout to the outer page shell", () => {
    const outerPage = declarationBlock(
      /\.control-center-shell \.cc-image-detail-page\.skill-center-page/,
    );

    expect(outerPage).toContain("grid-template-rows: auto minmax(0, 1fr)");
    expect(appCss).not.toMatch(
      /\.control-center-shell \.skill-center-page\s*\{[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\)/,
    );
  });

  it("removes the Skill directory search shadow and outline", () => {
    const focus = declarationBlock(
      /\.control-center-shell input\.skill-center-directory-search:focus-visible/,
    );

    expect(focus).toContain("outline: none");
    expect(focus).toContain("box-shadow: none");
  });

  it("renders workspace Skill groups as continuous row lists", () => {
    const section = declarationBlock(/\.skill-center-workspace-section/);
    const list = declarationBlock(/\.skill-center-workspace-list/);
    const item = declarationBlock(/\.skill-center-workspace-item/);
    const divider = declarationBlock(
      /\.skill-center-workspace-item \+ \.skill-center-workspace-item/,
    );

    expect(section).not.toContain("border-radius");
    expect(section).not.toContain("background:");
    expect(list).toContain("gap: 0");
    expect(list).toContain("border: 1px solid var(--cc-border)");
    expect(item).toContain("border-radius: 0");
    expect(item).toContain("background: transparent");
    expect(divider).toContain("border-top: 1px solid var(--cc-border)");
  });
});

describe("shutdown view contracts", () => {
  it("keeps one elapsed-time shutdown overlay without random tips", () => {
    expect(appSource).toContain('className="shutdown-overlay"');
    expect(appSource).toContain("shell.shutdownElapsedMs");
    expect(appSource).not.toContain("shutdown-tip-card");
    expect(appCss).not.toContain(".shutdown-tip-card");
  });

  it("does not clear the overlay while graceful shutdown is active", () => {
    expect(shellControllerSource).toContain("shutdownActiveRef.current =");
    expect(shellControllerSource).toContain(
      '!shutdownActiveRef.current && data.state !== "stopping"',
    );
  });
});
