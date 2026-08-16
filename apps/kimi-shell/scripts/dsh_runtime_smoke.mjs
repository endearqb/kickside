import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const DSH_PACKAGE = "@deepseek-ai/dsh";
const DEFAULT_PIN = "0.1.0-rc.6";
const ENTRY_RELATIVE = path.join("node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
const OUTPUT_LIMIT = 256 * 1024;
const HTTP_BODY_LIMIT = 512 * 1024;
const DSH_BOOT_MARKER = "__DSH_BOOT__";
const READY_TIMEOUT_MS = 90_000;
const STOP_TIMEOUT_MS = 8_000;

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1]?.trim();
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function integerOption(name, fallback, minimum, maximum) {
  const raw = option(name, String(fallback));
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function boundedCollector(stream) {
  const chunks = [];
  let size = 0;
  let truncated = false;
  stream?.on("data", (chunk) => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const remaining = Math.max(0, OUTPUT_LIMIT - size);
    if (remaining > 0) {
      chunks.push(bytes.subarray(0, remaining));
      size += Math.min(bytes.length, remaining);
    }
    truncated ||= bytes.length > remaining;
  });
  return () => {
    const text = Buffer.concat(chunks).toString("utf8");
    return truncated ? `${text}\n[output truncated]` : text;
  };
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: options.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    if (options.inherit) {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal, stdout: "", stderr: "" }));
      return;
    }
    const stdout = boundedCollector(child.stdout);
    const stderr = boundedCollector(child.stderr);
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      resolve({ code, signal, stdout: stdout(), stderr: stderr() }),
    );
  });
}

async function allocatePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  if (!Number.isInteger(port) || port <= 0) throw new Error("failed to allocate loopback port");
  return port;
}

function probeDshHttp(port) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const request = http.get(
      { hostname: "127.0.0.1", port, path: "/", timeout: 1_000 },
      (response) => {
        const statusReady = response.statusCode >= 200 && response.statusCode < 400;
        if (!statusReady) {
          response.resume();
          finish(false);
          return;
        }
        response.setEncoding("utf8");
        let body = "";
        response.on("data", (chunk) => {
          if (settled) return;
          body += chunk;
          if (body.includes(DSH_BOOT_MARKER)) {
            response.destroy();
            finish(true);
          } else if (Buffer.byteLength(body, "utf8") > HTTP_BODY_LIMIT) {
            response.destroy();
            finish(false);
          }
        });
        response.once("end", () => finish(body.includes(DSH_BOOT_MARKER)));
        response.once("error", () => finish(false));
      },
    );
    request.once("timeout", () => request.destroy());
    request.once("error", () => finish(false));
  });
}

function probePort(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(500);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => socket.destroy());
    socket.once("error", () => resolve(false));
    socket.once("close", (hadError) => {
      if (!hadError) resolve(false);
    });
  });
}

async function waitUntil(check, expected, timeoutMs, childExit) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await check()) === expected) return true;
    if (childExit && childExit()) return false;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

function safeRuntimeEnvironment(dshHome) {
  const allowed = [
    "PATH",
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "TEMP",
    "TMP",
    "SystemRoot",
    "SYSTEMROOT",
    "COMSPEC",
    "PATHEXT",
    "LANG",
    "LC_ALL",
    "NO_PROXY",
    "no_proxy",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "http_proxy",
    "https_proxy",
  ];
  const env = Object.fromEntries(
    allowed.filter((name) => process.env[name] !== undefined).map((name) => [name, process.env[name]]),
  );
  env.DSH_HOME = dshHome;
  return env;
}

async function resolveSiblingNpmCli() {
  const executableDirectory = path.dirname(process.execPath);
  const candidates = [
    path.join(executableDirectory, "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(
      path.dirname(executableDirectory),
      "lib",
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js",
    ),
  ];
  for (const candidate of candidates) {
    try {
      await readFile(candidate);
      return candidate;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  throw new Error("npm-cli.js was not found next to the active Node runtime");
}

async function stopTree(child) {
  const pid = child.pid;
  if (!Number.isInteger(pid) || pid <= 1) throw new Error(`refusing to stop invalid pid ${pid}`);

  if (process.platform === "win32") {
    await run("taskkill", ["/PID", String(pid), "/T"]);
  } else {
    try {
      process.kill(-pid, "SIGTERM");
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
  }

  const exitedSoftly = await waitUntil(
    async () => child.exitCode !== null || child.signalCode !== null,
    true,
    STOP_TIMEOUT_MS,
  );
  if (!exitedSoftly) {
    if (process.platform === "win32") {
      await run("taskkill", ["/PID", String(pid), "/T", "/F"]);
    } else {
      try {
        process.kill(-pid, "SIGKILL");
      } catch (error) {
        if (error?.code !== "ESRCH") throw error;
      }
    }
    await waitUntil(
      async () => child.exitCode !== null || child.signalCode !== null,
      true,
      2_000,
    );
  }
  return { forced: !exitedSoftly };
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[midpoint - 1] + sorted[midpoint]) / 2
    : sorted[midpoint];
}

async function runRuntimeSample({ entry, workspace, dshHome, setActiveChild }) {
  const port = await allocatePort();
  const startedAt = Date.now();
  const child = spawn(process.execPath, [entry, "web", "--port", String(port)], {
    cwd: workspace,
    env: safeRuntimeEnvironment(dshHome),
    detached: true,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  setActiveChild(child);
  const stdout = boundedCollector(child.stdout);
  const stderr = boundedCollector(child.stderr);
  child.once("error", (error) => {
    process.stderr.write(`DSH spawn error: ${error.message}\n`);
  });

  try {
    const ready = await waitUntil(
      () => probeDshHttp(port),
      true,
      READY_TIMEOUT_MS,
      () => child.exitCode !== null || child.signalCode !== null,
    );
    if (!ready) {
      throw new Error(
        `DSH did not become ready (exit=${child.exitCode}, signal=${child.signalCode})\n${stderr() || stdout()}`,
      );
    }
    const readyMs = Date.now() - startedAt;
    const stopStartedAt = Date.now();
    const stop = await stopTree(child);
    const portClosed = await waitUntil(() => probePort(port), false, 3_000);
    if (!portClosed) throw new Error(`DSH loopback port ${port} remained open after tree stop`);
    return {
      readyMs,
      stopMs: Date.now() - stopStartedAt,
      forced: stop.forced,
      portClosed,
    };
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      await stopTree(child).catch(() => undefined);
    }
    setActiveChild(undefined);
  }
}

async function main() {
  if (!["darwin", "win32"].includes(process.platform)) {
    throw new Error(`unsupported smoke-test platform ${process.platform}`);
  }
  const requestedVersion = option("--version", DEFAULT_PIN);
  const sampleCount = integerOption("--samples", 1, 1, 10);
  const root = await mkdtemp(path.join(os.tmpdir(), "kickside-dsh-smoke-"));
  const prefix = path.join(root, "prefix");
  const workspace = path.join(root, "workspace");
  const dshHome = path.join(root, "dsh-home");
  await Promise.all([mkdir(prefix), mkdir(workspace), mkdir(dshHome)]);

  let child;
  try {
    const npmCli = await resolveSiblingNpmCli();
    const installStartedAt = Date.now();
    const install = await run(process.execPath, [
      npmCli,
      "install",
      "--no-audit",
      "--no-fund",
      "--prefix",
      prefix,
      `${DSH_PACKAGE}@${requestedVersion}`,
    ]);
    if (install.code !== 0) {
      throw new Error(`npm install failed (exit=${install.code}):\n${install.stderr || install.stdout}`);
    }
    const installMs = Date.now() - installStartedAt;

    const packagePath = path.join(prefix, "node_modules", "@deepseek-ai", "dsh", "package.json");
    const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
    if (requestedVersion !== "latest" && packageJson.version !== requestedVersion) {
      throw new Error(`installed DSH ${packageJson.version}; expected ${requestedVersion}`);
    }
    const entry = path.join(prefix, ENTRY_RELATIVE);
    await readFile(entry);
    const samples = [];
    for (let index = 0; index < sampleCount; index += 1) {
      samples.push(
        await runRuntimeSample({
          entry,
          workspace,
          dshHome,
          setActiveChild(value) {
            child = value;
          },
        }),
      );
    }

    process.stdout.write(
      `${JSON.stringify({
        package: DSH_PACKAGE,
        requestedVersion,
        installedVersion: packageJson.version,
        node: process.version,
        platform: `${process.platform}-${process.arch}`,
        installMs,
        sampleCount,
        readyMedianMs: median(samples.map((sample) => sample.readyMs)),
        stopMedianMs: median(samples.map((sample) => sample.stopMs)),
        forced: samples.some((sample) => sample.forced),
        portClosed: samples.every((sample) => sample.portClosed),
        samples,
      })}\n`,
    );
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      await stopTree(child).catch(() => undefined);
    }
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
