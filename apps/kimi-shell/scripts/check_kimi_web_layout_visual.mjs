import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appDirectory = resolve(scriptDirectory, "..");
const fixtureUrl = pathToFileURL(
  join(appDirectory, "tests", "kimi-web-layout", "index.html"),
);
const baselineDirectory = join(
  appDirectory,
  "tests",
  "kimi-web-layout",
  "baselines",
);
const updateBaselines = process.argv.includes("--update");
const outputDirectory = updateBaselines
  ? baselineDirectory
  : mkdtempSync(join(tmpdir(), "kickside-kimi-layout-"));

const cases = [
  { width: 480, mode: "narrow", theme: "light", mobile: true },
  { width: 800, mode: "narrow", theme: "light" },
  { width: 959, mode: "narrow", theme: "dark" },
  { width: 960, mode: "compact", theme: "light" },
  { width: 960, mode: "compact", theme: "light", expanded: true },
  { width: 1179, mode: "compact", theme: "dark" },
  { width: 1179, mode: "compact", theme: "light", sidebar: true },
  { width: 1180, mode: "wide", theme: "light" },
  { width: 1280, mode: "wide", theme: "dark", expanded: true },
  { width: 1440, mode: "wide", theme: "light" },
];

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ].filter(Boolean);
  const chrome = candidates.find((candidate) => existsSync(candidate));
  if (!chrome) {
    throw new Error("Chrome was not found. Set CHROME_PATH to run the visual gate.");
  }
  return chrome;
}

function renderCase(chrome, visualCase) {
  const name = `${visualCase.width}-${visualCase.mode}-${visualCase.theme}${
    visualCase.expanded ? "-expanded" : ""
  }${visualCase.sidebar ? "-sidebar" : ""}.png`;
  const outputPath = join(outputDirectory, name);
  const url = new URL(fixtureUrl);
  url.searchParams.set("theme", visualCase.theme);
  url.searchParams.set("expected", visualCase.mode);
  if (visualCase.expanded) {
    url.searchParams.set("expanded", "true");
  }
  if (visualCase.mobile) {
    url.searchParams.set("mobile", "true");
  }
  if (visualCase.sidebar) {
    url.searchParams.set("sidebar", "on");
  }

  execFileSync(
    chrome,
    [
      "--headless=new",
      "--allow-file-access-from-files",
      "--disable-gpu",
      "--force-device-scale-factor=1",
      "--hide-scrollbars",
      "--run-all-compositor-stages-before-draw",
      "--virtual-time-budget=1200",
      `--window-size=${visualCase.width},720`,
      `--screenshot=${outputPath}`,
      url.href,
    ],
    { stdio: "pipe" },
  );
  return { name, outputPath };
}

mkdirSync(outputDirectory, { recursive: true });
const chrome = findChrome();
const rendered = cases.map((visualCase) => renderCase(chrome, visualCase));

if (updateBaselines) {
  console.log(`Updated ${rendered.length} Kimi Web layout baselines.`);
} else {
  const mismatches = rendered.filter(({ name, outputPath }) => {
    const baselinePath = join(baselineDirectory, name);
    return (
      !existsSync(baselinePath) ||
      !readFileSync(baselinePath).equals(readFileSync(outputPath))
    );
  });
  rmSync(outputDirectory, { recursive: true, force: true });
  if (mismatches.length) {
    throw new Error(
      `Kimi Web visual baselines changed: ${mismatches.map(({ name }) => name).join(", ")}. ` +
        "Inspect the fixture and run this script with --update when the change is intentional.",
    );
  }
  console.log(`Verified ${rendered.length} Kimi Web layout baselines.`);
}
