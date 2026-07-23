import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_OUTPUT_CHARS = 12000;

const SAFE_COMMANDS = new Set([
  "help",
  "version",
  "read",
  "search",
  "daily:read",
  "weekly:read",
  "monthly:read",
  "quarterly:read",
  "yearly:read",
  "tasks",
  "tags",
  "backlinks",
  "daily:path",
  "property:read",
  "dev:errors",
  "dev:console",
  "dev:dom",
  "dev:css",
  "diagnose"
]);

const WRITE_COMMANDS = new Set([
  "create",
  "append",
  "daily:append",
  "weekly:append",
  "monthly:append",
  "quarterly:append",
  "yearly:append",
  "property:set",
  "property:remove",
  "open",
  "plugin:reload"
]);

const DANGEROUS_COMMANDS = new Set([
  "eval",
  "dev:debug",
  "dev:screenshot",
  "dev:mobile"
]);

const ALLOWED_FLAGS = new Set([
  "all",
  "clear",
  "copy",
  "counts",
  "inline",
  "inner",
  "newtab",
  "open",
  "silent",
  "overwrite",
  "total",
  "json",
  "text",
  "markdown",
  "verbose",
  "active",
  "on",
  "off"
]);

const ALLOWED_PARAM_KEYS = new Set([
  "vault",
  "file",
  "path",
  "name",
  "content",
  "template",
  "folder",
  "query",
  "limit",
  "offset",
  "context",
  "heading",
  "block",
  "line",
  "tag",
  "status",
  "priority",
  "due",
  "property",
  "value",
  "id",
  "code",
  "selector",
  "level",
  "prop",
  "type",
  "paneType",
  "attr",
  "css",
  "format",
  "sort",
  "direction",
  "date"
]);

export const name = "obsidian_cli";

export const description = [
  "Legacy diagnostic fallback for running a controlled Obsidian CLI command.",
  "Prefer obsidian_rest for normal Obsidian vault operations inside OpenHanako/HanaAgent.",
  "The native Obsidian CLI may SIGSEGV in the agent sandbox because it still relies on Obsidian/Electron IPC.",
  "Read-only commands are allowed directly. Write/UI-changing commands require confirmWrite=true.",
  "High-risk developer commands such as eval and screenshot require confirmDangerous=true after explicit user approval."
].join(" ");

export const parameters = {
  type: "object",
  properties: {
    command: {
      type: "string",
      enum: [
        ...SAFE_COMMANDS,
        ...WRITE_COMMANDS,
        ...DANGEROUS_COMMANDS
      ].sort(),
      description: "Obsidian CLI command name, for example read, search, create, append, daily:read, property:remove, plugin:reload, eval."
    },
    vault: {
      type: "string",
      description: "Optional Obsidian vault name. Passed as vault=<name> before the command."
    },
    params: {
      type: "object",
      description: "Key/value parameters converted to key=value CLI arguments. Keys are restricted to a safe allowlist.",
      additionalProperties: {
        type: ["string", "number", "boolean"]
      }
    },
    flags: {
      type: "array",
      description: "Boolean CLI flags such as silent, overwrite, total, copy.",
      items: {
        type: "string",
        enum: [...ALLOWED_FLAGS].sort()
      }
    },
    confirmWrite: {
      type: "boolean",
      description: "Required true for commands that create, modify, open, reload, or otherwise change Obsidian state."
    },
    confirmDangerous: {
      type: "boolean",
      description: "Required true for eval, screenshot, or mobile-emulation developer commands after explicit user approval."
    },
    timeoutMs: {
      type: "integer",
      minimum: 1000,
      maximum: 120000,
      description: "Optional per-call timeout override."
    },
    maxOutputChars: {
      type: "integer",
      minimum: 1000,
      maximum: 50000,
      description: "Optional per-call output truncation override."
    }
  },
  required: ["command"],
  additionalProperties: false
};

export async function execute(input = {}, ctx = {}) {
  const config = readPluginConfig(ctx);
  const command = clean(input.command);
  validateCommand(command, input);

  const resolvedCli = resolveObsidianCli(config);
  const binPath = resolvedCli.path;
  if (!binPath) return diagnoseResult(resolvedCli);
  if (command === "diagnose") return diagnoseResult(resolvedCli);

  const args = buildArgs(input, config, command);
  const timeout = clampInt(input.timeoutMs ?? config.timeoutMs, 1000, 120000, DEFAULT_TIMEOUT_MS);
  const maxOutputChars = clampInt(input.maxOutputChars ?? config.maxOutputChars, 1000, 50000, DEFAULT_MAX_OUTPUT_CHARS);

  const startedAt = Date.now();
  const rawResult = await runCommand(binPath, args, { timeout, maxOutputChars });
  const semanticError = detectCliSemanticError(rawResult.stdout, rawResult.stderr);
  const result = {
    ...rawResult,
    ok: rawResult.ok && !semanticError,
    semanticError
  };
  const elapsedMs = Date.now() - startedAt;

  const summary = [
    `Obsidian CLI ${result.ok ? "ok" : "failed"}: ${command}`,
    `- command: ${formatCommand([binPath, ...args])}`,
    `- exitCode: ${result.code}`,
    `- elapsedMs: ${elapsedMs}`,
    result.semanticError ? `- semanticError: ${result.semanticError}` : "",
    result.stdout ? `\nstdout:\n${result.stdout}` : "",
    result.stderr ? `\nstderr:\n${result.stderr}` : ""
  ].filter(Boolean).join("\n");

  return {
    content: [{ type: "text", text: summary }],
    details: {
      ok: result.ok,
      cliResolution: resolvedCli,
      command,
      argv: [binPath, ...args],
      code: result.code,
      signal: result.signal || "",
      elapsedMs,
      stdout: result.stdout,
      stderr: result.stderr,
      semanticError: result.semanticError,
      truncated: result.truncated
    }
  };
}

function readPluginConfig(ctx) {
  const fromGetAll = ctx?.config?.getAll?.();
  if (fromGetAll && typeof fromGetAll === "object") return fromGetAll;
  const fromConfig = ctx?.config && typeof ctx.config === "object" ? ctx.config : {};
  return fromConfig;
}

function validateCommand(command, input) {
  if (!command) throw new Error("command is required.");
  if (!SAFE_COMMANDS.has(command) && !WRITE_COMMANDS.has(command) && !DANGEROUS_COMMANDS.has(command)) {
    throw new Error(`Unsupported Obsidian CLI command: ${command}`);
  }
  if (WRITE_COMMANDS.has(command) && input.confirmWrite !== true) {
    throw new Error(`Command ${command} requires confirmWrite=true after explicit user approval.`);
  }
  if (DANGEROUS_COMMANDS.has(command) && input.confirmDangerous !== true) {
    throw new Error(`Command ${command} requires confirmDangerous=true after explicit user approval.`);
  }
}

function resolveObsidianCli(config) {
  const candidates = [];
  const add = (source, value) => {
    const candidate = clean(value);
    if (!candidate) return;
    candidates.push({ source, path: expandHome(candidate) });
  };

  add("config.obsidianBinaryPath", config.obsidianBinaryPath);
  add("env.OBSIDIAN_CLI_PATH", process.env.OBSIDIAN_CLI_PATH);
  for (const candidate of pathCandidatesFromPathEnv()) add("PATH", candidate);
  for (const candidate of commonInstallCandidates()) add("common-install", candidate);

  const seen = new Set();
  const checked = [];
  for (const candidate of candidates) {
    const key = candidate.path.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const result = checkCliCandidate(candidate);
    checked.push(result);
    if (result.ok) return { ok: true, path: result.path, source: result.source, checked };
  }
  return { ok: false, path: "", source: "", checked };
}

function pathCandidatesFromPathEnv() {
  const names = process.platform === "win32"
    ? ["obsidian.cmd", "obsidian.exe", "Obsidian.exe"]
    : ["obsidian", "Obsidian"];
  const pathEnv = process.env.PATH || "";
  const delimiter = process.platform === "win32" ? ";" : ":";
  const result = [];
  for (const dir of pathEnv.split(delimiter)) {
    const base = clean(dir);
    if (!base) continue;
    for (const name of names) result.push(path.join(base, name));
  }
  return result;
}

function commonInstallCandidates() {
  if (process.platform === "darwin") {
    return [
      "/Applications/Obsidian.app/Contents/MacOS/obsidian",
      "/Applications/Obsidian.app/Contents/MacOS/Obsidian",
      path.join(os.homedir(), "Applications/Obsidian.app/Contents/MacOS/obsidian"),
      path.join(os.homedir(), "Applications/Obsidian.app/Contents/MacOS/Obsidian")
    ];
  }
  if (process.platform === "win32") {
    const roots = [
      process.env.LOCALAPPDATA,
      process.env.PROGRAMFILES,
      process.env["PROGRAMFILES(X86)"],
      path.join(os.homedir(), "AppData/Local")
    ].filter(Boolean);
    return roots.flatMap((root) => [
      path.join(root, "Obsidian/Obsidian.exe"),
      path.join(root, "Programs/Obsidian/Obsidian.exe")
    ]);
  }
  return [
    "/usr/bin/obsidian",
    "/usr/local/bin/obsidian",
    "/snap/bin/obsidian",
    "/opt/Obsidian/obsidian",
    "/var/lib/flatpak/exports/bin/md.obsidian.Obsidian",
    path.join(os.homedir(), ".local/bin/obsidian")
  ];
}

function checkCliCandidate(candidate) {
  if (!path.isAbsolute(candidate.path)) {
    return { ...candidate, ok: false, reason: "not_absolute" };
  }
  try {
    const stat = fs.statSync(candidate.path);
    if (!stat.isFile() && !stat.isSymbolicLink()) return { ...candidate, ok: false, reason: "not_file" };
    fs.accessSync(candidate.path, fs.constants.X_OK);
    return { ...candidate, ok: true, reason: "executable" };
  } catch (error) {
    return { ...candidate, ok: false, reason: error?.code || "not_accessible" };
  }
}

function diagnoseResult(resolution) {
  const checked = Array.isArray(resolution.checked) ? resolution.checked : [];
  const lines = [
    `Obsidian CLI auto-detect: ${resolution.ok ? "found" : "not found"}`,
    resolution.path ? `- path: ${resolution.path}` : "",
    resolution.source ? `- source: ${resolution.source}` : "",
    "- checked:",
    ...checked.slice(0, 40).map((item) => `  - ${item.source}: ${item.path} => ${item.ok ? "ok" : item.reason}`)
  ].filter(Boolean);
  if (checked.length > 40) lines.push(`  ... ${checked.length - 40} more candidates omitted`);
  return {
    content: [{ type: "text", text: lines.join("\n") }],
    details: resolution
  };
}

function buildArgs(input, config, command) {
  const args = [];
  const vault = clean(input.vault) || clean(config.defaultVault);
  if (vault) args.push(`vault=${vault}`);
  args.push(command);

  const params = normalizeParams(input.params && typeof input.params === "object" ? input.params : {}, command);
  for (const [key, value] of Object.entries(params)) {
    const paramKey = clean(key);
    if (!ALLOWED_PARAM_KEYS.has(paramKey)) {
      throw new Error(`Unsupported Obsidian CLI parameter: ${paramKey}`);
    }
    if (paramKey === "vault") continue;
    if (value === undefined || value === null || value === false) continue;
    if (value === true) {
      if (!ALLOWED_FLAGS.has(paramKey)) throw new Error(`Boolean parameter ${paramKey} is not an allowed flag.`);
      args.push(paramKey);
      continue;
    }
    const text = String(value);
    if (paramKey === "path" && isPathWritingCommand(command)) validateOutputPath(text);
    args.push(`${paramKey}=${text}`);
  }

  const flags = Array.isArray(input.flags) ? input.flags : [];
  for (const flag of flags) {
    const name = clean(flag);
    if (!ALLOWED_FLAGS.has(name)) throw new Error(`Unsupported Obsidian CLI flag: ${name}`);
    args.push(name);
  }
  return args;
}

function normalizeParams(params, command) {
  const normalized = { ...params };
  if (command !== "create") return normalized;

  const folder = clean(normalized.folder);
  const name = clean(normalized.name);
  if (folder && name) {
    delete normalized.folder;
    delete normalized.name;
    normalized.path = ensureMarkdownExtension(joinVaultPath(folder, name));
    return normalized;
  }
  if (!name || !hasPathSeparator(name)) return normalized;

  delete normalized.name;
  normalized.path = ensureMarkdownExtension(joinVaultPath(name));
  return normalized;
}

function ensureMarkdownExtension(value) {
  const text = clean(value);
  return /\.md$/i.test(text) ? text : `${text}.md`;
}

function detectCliSemanticError(stdout, stderr) {
  const meaningful = stripObsidianNoise(`${stdout || ""}\n${stderr || ""}`);
  const match = meaningful.match(/^Error:\s*([^\n]+)/m);
  return match ? `Error: ${match[1].trim()}` : "";
}

function stripObsidianNoise(value) {
  return String(value || "")
    .split(/\r?\n/)
    .filter((line) => !/Loading updated app package/.test(line))
    .filter((line) => !/Your Obsidian installer is out of date/.test(line))
    .join("\n")
    .trimStart();
}

function hasPathSeparator(value) {
  return /[\\/]/.test(clean(value));
}

function joinVaultPath(...parts) {
  return parts
    .map((part) => clean(part).replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
}

async function runCommand(binPath, args, options) {
  try {
    const result = await run(binPath, args, {
      timeout: options.timeout,
      maxBuffer: 1024 * 1024 * 8,
      windowsHide: true
    });
    return {
      ok: true,
      code: 0,
      stdout: truncate(result.stdout || "", options.maxOutputChars),
      stderr: truncate(result.stderr || "", options.maxOutputChars),
      truncated: wasTruncated(result.stdout, options.maxOutputChars) || wasTruncated(result.stderr, options.maxOutputChars)
    };
  } catch (error) {
    return {
      ok: false,
      code: typeof error.code === "number" ? error.code : 1,
      signal: error.signal || "",
      stdout: truncate(error.stdout || "", options.maxOutputChars),
      stderr: truncate(error.stderr || error.message || "", options.maxOutputChars),
      truncated: wasTruncated(error.stdout, options.maxOutputChars) || wasTruncated(error.stderr, options.maxOutputChars)
    };
  }
}

function isPathWritingCommand(command) {
  return command === "dev:screenshot";
}

function validateOutputPath(value) {
  const resolved = path.resolve(value);
  const allowed = [
    os.homedir(),
    "/tmp",
    "/private/tmp"
  ];
  if (!allowed.some((root) => resolved === root || resolved.startsWith(`${root}/`))) {
    throw new Error(`Output path is outside allowed roots: ${resolved}`);
  }
}

function truncate(value, maxChars) {
  const text = String(value || "");
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n...[truncated ${text.length - maxChars} chars]`;
}

function wasTruncated(value, maxChars) {
  return String(value || "").length > maxChars;
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function expandHome(value) {
  const text = clean(value);
  if (text === "~") return os.homedir();
  if (text.startsWith("~/") || text.startsWith("~\\")) return path.join(os.homedir(), text.slice(2));
  return text;
}

function formatCommand(argv) {
  return argv.map((item) => {
    const text = String(item);
    return /[\s"'\\$]/.test(text) ? JSON.stringify(text) : text;
  }).join(" ");
}
