import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

const DEFAULT_BASE_URL = "https://127.0.0.1:27124";
const DEFAULT_FALLBACK_BASE_URL = "http://127.0.0.1:27123";
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_OUTPUT_CHARS = 12000;

const READ_ACTIONS = new Set([
  "diagnose",
  "read",
  "readJson",
  "list",
  "searchSimple"
]);

const WRITE_ACTIONS = new Set([
  "create",
  "update",
  "append",
  "patch",
  "delete",
  "move"
]);

export const name = "obsidian_rest";

export const description = [
  "Use Obsidian Local REST API for vault operations.",
  "This is the preferred Obsidian path inside OpenHanako/HanaAgent because the native Obsidian CLI can SIGSEGV in the agent sandbox.",
  "Supports read, list, create, update, append, patch, delete, move, and simple search.",
  "Write operations require confirmWrite=true. Move uses Obsidian's fileManager path through Local REST API, so internal links are updated by Obsidian."
].join(" ");

export const parameters = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: [...READ_ACTIONS, ...WRITE_ACTIONS].sort(),
      description: "REST action to perform."
    },
    path: {
      type: "string",
      description: "Vault-relative file or directory path. Directories for list should omit the leading slash."
    },
    destinationPath: {
      type: "string",
      description: "Vault-relative destination for move. A trailing slash preserves the source filename."
    },
    content: {
      type: "string",
      description: "Markdown or text content for create, update, append, or patch."
    },
    query: {
      type: "string",
      description: "Search query for searchSimple."
    },
    contextLength: {
      type: "integer",
      minimum: 0,
      maximum: 1000,
      description: "Surrounding context characters for searchSimple."
    },
    allowOverwrite: {
      type: "boolean",
      description: "For create/move: allow replacing an existing destination."
    },
    contentType: {
      type: "string",
      enum: ["text/markdown", "text/plain", "application/json"],
      description: "Request content type. Defaults to text/markdown."
    },
    accept: {
      type: "string",
      enum: [
        "text/markdown",
        "application/json",
        "application/vnd.olrapi.note+json",
        "application/vnd.olrapi.document-map+json"
      ],
      description: "Accept header for read."
    },
    operation: {
      type: "string",
      enum: ["append", "prepend", "replace"],
      description: "PATCH operation header."
    },
    targetType: {
      type: "string",
      enum: ["heading", "block", "frontmatter"],
      description: "Optional PATCH/GET target type."
    },
    target: {
      type: "string",
      description: "Optional PATCH/GET target."
    },
    targetScope: {
      type: "string",
      enum: ["content", "marker", "markerAndContent"],
      description: "Optional PATCH target scope."
    },
    createTargetIfMissing: {
      type: "boolean",
      description: "For PATCH/append targeted operations, create a missing target."
    },
    confirmWrite: {
      type: "boolean",
      description: "Required true for create, update, append, patch, delete, and move."
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
  required: ["action"],
  additionalProperties: false
};

export async function execute(input = {}, ctx = {}) {
  const config = readPluginConfig(ctx);
  const action = clean(input.action);
  validateInput(action, input);

  const restConfig = resolveRestConfig(config, input);
  const startedAt = Date.now();
  const result = await runAction(action, input, restConfig);
  const elapsedMs = Date.now() - startedAt;
  const responseText = formatBody(result.body, result.maxOutputChars);

  const summary = [
    `Obsidian REST ${result.ok ? "ok" : "failed"}: ${action}`,
    `- method: ${result.method}`,
    `- endpoint: ${result.endpoint}`,
    `- statusCode: ${result.statusCode}`,
    `- elapsedMs: ${elapsedMs}`,
    result.contentLocation ? `- contentLocation: ${result.contentLocation}` : "",
    result.truncated ? "- output: truncated" : "",
    responseText ? `\nresponse:\n${responseText}` : ""
  ].filter(Boolean).join("\n");

  return {
    content: [{ type: "text", text: summary }],
    details: {
      ok: result.ok,
      action,
      method: result.method,
      endpoint: result.endpoint,
      statusCode: result.statusCode,
      elapsedMs,
      contentLocation: result.contentLocation,
      body: result.body,
      truncated: result.truncated,
    rest: {
        baseUrl: result.baseUrl,
        fallbackUsed: result.fallbackUsed,
        transport: result.transport,
        apiKeySource: restConfig.apiKeySource,
        hasApiKey: Boolean(restConfig.apiKey)
      }
    }
  };
}

async function runAction(action, input, config) {
  if (action === "diagnose") return diagnose(config);

  if (action === "read") {
    return request(config, {
      method: "GET",
      endpoint: vaultEndpoint(requiredPath(input.path), false),
      headers: buildTargetHeaders(input, {
        Accept: input.accept || "text/markdown"
      })
    });
  }

  if (action === "readJson") {
    return request(config, {
      method: "GET",
      endpoint: vaultEndpoint(requiredPath(input.path), false),
      headers: buildTargetHeaders(input, {
        Accept: "application/vnd.olrapi.note+json"
      })
    });
  }

  if (action === "list") {
    return request(config, {
      method: "GET",
      endpoint: vaultEndpoint(cleanPath(input.path || ""), true),
      headers: { Accept: "application/json" }
    });
  }

  if (action === "searchSimple") {
    const query = clean(input.query);
    if (!query) throw new Error("query is required for searchSimple.");
    const params = new URLSearchParams();
    params.set("query", query);
    if (input.contextLength !== undefined) params.set("contextLength", String(input.contextLength));
    return request(config, {
      method: "POST",
      endpoint: `/search/simple/?${params.toString()}`,
      headers: { Accept: "application/json" }
    });
  }

  if (action === "create") {
    const filePath = requiredPath(input.path);
    if (input.allowOverwrite !== true) {
      const existing = await request(config, {
        method: "GET",
        endpoint: vaultEndpoint(filePath, false),
        headers: { Accept: "text/markdown" },
        allowHttpError: true
      });
      if (existing.statusCode >= 200 && existing.statusCode < 300) {
        throw new Error(`Destination already exists: ${filePath}. Set allowOverwrite=true after explicit approval to replace it.`);
      }
    }
    return putFile(config, filePath, input);
  }

  if (action === "update") return putFile(config, requiredPath(input.path), input);

  if (action === "append") {
    return request(config, {
      method: "POST",
      endpoint: vaultEndpoint(requiredPath(input.path), false),
      headers: buildTargetHeaders(input, {
        "Content-Type": input.contentType || "text/markdown",
        Accept: "text/markdown"
      }),
      body: input.content ?? ""
    });
  }

  if (action === "patch") {
    return request(config, {
      method: "PATCH",
      endpoint: vaultEndpoint(requiredPath(input.path), false),
      headers: buildTargetHeaders(input, {
        Operation: input.operation || "append",
        "Content-Type": input.contentType || "text/markdown",
        Accept: "text/markdown"
      }),
      body: input.content ?? ""
    });
  }

  if (action === "delete") {
    return request(config, {
      method: "DELETE",
      endpoint: vaultEndpoint(requiredPath(input.path), false)
    });
  }

  if (action === "move") {
    const destinationPath = requiredDestinationPath(input.destinationPath);
    return request(config, {
      method: "MOVE",
      endpoint: vaultEndpoint(requiredPath(input.path), false),
      headers: {
        Destination: destinationPath,
        "Allow-Overwrite": input.allowOverwrite === true ? "true" : "false"
      }
    });
  }

  throw new Error(`Unsupported action: ${action}`);
}

async function putFile(config, filePath, input) {
  return request(config, {
    method: "PUT",
    endpoint: vaultEndpoint(filePath, false),
    headers: buildTargetHeaders(input, {
      "Content-Type": input.contentType || "text/markdown",
      Accept: "text/markdown"
    }),
    body: input.content ?? ""
  });
}

async function diagnose(config) {
  const attempts = [];
  for (const baseUrl of config.baseUrls) {
    const unauthenticated = await requestOnce({
      ...config,
      baseUrl,
      apiKey: ""
    }, {
      method: "GET",
      endpoint: "/",
      headers: { Accept: "application/json" }
    }).catch((error) => ({ ok: false, error: error.message }));

    let authenticated = null;
    if (config.apiKey) {
      authenticated = await requestOnce({
        ...config,
        baseUrl
      }, {
        method: "GET",
        endpoint: "/",
        headers: { Accept: "application/json" }
      }).catch((error) => ({ ok: false, error: error.message }));
    }

    attempts.push({
      baseUrl,
      unauthenticated: summarizeProbe(unauthenticated),
      authenticated: summarizeProbe(authenticated)
    });
  }

  return {
    ok: attempts.some((attempt) => attempt.authenticated?.ok || attempt.unauthenticated?.ok),
    method: "GET",
    endpoint: "/",
    statusCode: attempts.find((attempt) => attempt.authenticated?.statusCode)?.authenticated.statusCode || 0,
    body: {
      attempts,
      hasApiKey: Boolean(config.apiKey),
      apiKeySource: config.apiKeySource,
      note: "Root endpoint does not require authentication; authenticated=true confirms the configured API key works."
    },
    contentLocation: "",
    baseUrl: config.baseUrls[0],
    fallbackUsed: false,
    maxOutputChars: config.maxOutputChars,
    truncated: false
  };
}

function summarizeProbe(result) {
  if (!result) return null;
  if (result.error) return { ok: false, error: result.error };
  const body = typeof result.body === "object" ? result.body : {};
  return {
    ok: result.ok,
    statusCode: result.statusCode,
    authenticated: body.authenticated,
    status: body.status,
    service: body.service,
    versions: body.versions
  };
}

async function request(config, options) {
  const errors = [];
  for (const [index, baseUrl] of config.baseUrls.entries()) {
    try {
      const result = await requestOnce({ ...config, baseUrl }, options);
      result.fallbackUsed = index > 0;
      if (!options.allowHttpError && !result.ok) {
        throw new Error(formatHttpError(result));
      }
      return result;
    } catch (error) {
      errors.push(`${baseUrl}: ${error.message}`);
      if (!isRetryableError(error)) break;
    }
  }
  throw new Error(errors.join("; "));
}

function requestOnce(config, options) {
  if (config.transport === "curl") return requestOnceCurl(config, options);
  if (config.transport === "native") return requestOnceNative(config, options);

  return requestOnceNative(config, options).catch((error) => {
    if (!isRetryableError(error)) throw error;
    return requestOnceCurl(config, options);
  });
}

function requestOnceNative(config, options) {
  const base = new URL(config.baseUrl);
  const url = new URL(options.endpoint, base);
  const transport = url.protocol === "https:" ? https : http;
  const headers = {
    ...(options.headers || {})
  };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  if (options.body !== undefined && !headers["Content-Length"]) {
    headers["Content-Length"] = Buffer.byteLength(String(options.body));
  }

  return new Promise((resolve, reject) => {
    const req = transport.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method: options.method,
      headers,
      rejectUnauthorized: config.rejectUnauthorized
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const rawBody = Buffer.concat(chunks).toString("utf8");
        const contentType = String(res.headers["content-type"] || "");
        const parsedBody = parseBody(rawBody, contentType);
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          method: options.method,
          endpoint: options.endpoint,
          statusCode: res.statusCode,
          headers: res.headers,
          body: parsedBody,
          contentLocation: decodeHeader(res.headers["content-location"]),
          baseUrl: config.baseUrl,
          transport: "native",
          maxOutputChars: config.maxOutputChars,
          truncated: rawBody.length > config.maxOutputChars
        });
      });
    });

    req.on("error", reject);
    req.setTimeout(config.timeoutMs, () => {
      req.destroy(new Error(`Request timed out after ${config.timeoutMs}ms.`));
    });

    if (options.body !== undefined) req.write(String(options.body));
    req.end();
  });
}

async function requestOnceCurl(config, options) {
  const base = new URL(config.baseUrl);
  const url = new URL(options.endpoint, base);
  const headers = {
    ...(options.headers || {})
  };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

  const args = [
    "-sS",
    "-i",
    "--max-time",
    String(Math.ceil(config.timeoutMs / 1000)),
    "-X",
    options.method
  ];
  if (url.protocol === "https:" && config.rejectUnauthorized !== true) args.push("-k");
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined || value === null || value === "") continue;
    args.push("-H", `${key}: ${value}`);
  }
  if (options.body !== undefined) args.push("--data-binary", String(options.body));
  args.push(url.toString());

  let stdout = "";
  try {
    const result = await run("curl", args, {
      timeout: config.timeoutMs,
      maxBuffer: Math.max(config.maxOutputChars * 2, 1024 * 1024)
    });
    stdout = result.stdout || "";
  } catch (error) {
    const stderr = error?.stderr ? ` ${error.stderr}` : "";
    throw new Error(`curl failed:${stderr || ` ${error.message}`}`);
  }

  const parsed = parseCurlResponse(stdout);
  const body = parseBody(parsed.body, String(parsed.headers["content-type"] || ""));
  return {
    ok: parsed.statusCode >= 200 && parsed.statusCode < 300,
    method: options.method,
    endpoint: options.endpoint,
    statusCode: parsed.statusCode,
    headers: parsed.headers,
    body,
    contentLocation: decodeHeader(parsed.headers["content-location"]),
    baseUrl: config.baseUrl,
    transport: "curl",
    maxOutputChars: config.maxOutputChars,
    truncated: parsed.body.length > config.maxOutputChars
  };
}

function parseCurlResponse(stdout) {
  const marker = stdout.includes("\r\n\r\n") ? "\r\n\r\n" : "\n\n";
  const parts = stdout.split(marker).filter((part, index, all) => part || index === all.length - 1);
  if (parts.length < 2) throw new Error("curl response did not include HTTP headers.");
  const headerText = parts[parts.length - 2];
  const body = parts[parts.length - 1] || "";
  const lines = headerText.split(/\r?\n/).filter(Boolean);
  const statusMatch = lines[0]?.match(/^HTTP\/\S+\s+(\d+)/);
  if (!statusMatch) throw new Error("curl response did not include an HTTP status line.");
  const headers = {};
  for (const line of lines.slice(1)) {
    const index = line.indexOf(":");
    if (index < 0) continue;
    headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
  }
  return {
    statusCode: Number.parseInt(statusMatch[1], 10),
    headers,
    body
  };
}

function parseBody(rawBody, contentType) {
  if (!rawBody) return "";
  if (contentType.includes("json")) {
    try {
      return JSON.parse(rawBody);
    } catch {
      return rawBody;
    }
  }
  return rawBody;
}

function formatHttpError(result) {
  const body = typeof result.body === "object" ? JSON.stringify(result.body) : String(result.body || "");
  return `HTTP ${result.statusCode} from ${result.endpoint}${body ? `: ${body}` : ""}`;
}

function isRetryableError(error) {
  const message = String(error?.message || "");
  return /ECONNREFUSED|ECONNRESET|ENOTFOUND|EHOSTUNREACH|timed out|socket hang up|self-signed/i.test(message);
}

function validateInput(action, input) {
  if (!action) throw new Error("action is required.");
  if (!READ_ACTIONS.has(action) && !WRITE_ACTIONS.has(action)) {
    throw new Error(`Unsupported Obsidian REST action: ${action}`);
  }
  if (WRITE_ACTIONS.has(action) && input.confirmWrite !== true) {
    throw new Error(`Action ${action} requires confirmWrite=true after explicit user approval.`);
  }
}

function buildTargetHeaders(input, baseHeaders = {}) {
  const headers = { ...baseHeaders };
  if (input.targetType) headers["Target-Type"] = input.targetType;
  if (input.target) headers.Target = encodeHeaderValue(input.target);
  if (input.targetScope) headers["Target-Scope"] = input.targetScope;
  if (input.createTargetIfMissing === true) headers["Create-Target-If-Missing"] = "true";
  return headers;
}

function readPluginConfig(ctx) {
  const fromGetAll = ctx?.config?.getAll?.();
  if (fromGetAll && typeof fromGetAll === "object") return fromGetAll;
  const fromConfig = ctx?.config && typeof ctx.config === "object" ? ctx.config : {};
  return fromConfig;
}

function resolveRestConfig(config, input) {
  const baseUrl = clean(config.restBaseUrl) || clean(process.env.OBSIDIAN_REST_BASE_URL) || DEFAULT_BASE_URL;
  const fallbackBaseUrl = clean(config.restFallbackBaseUrl) || clean(process.env.OBSIDIAN_REST_FALLBACK_BASE_URL) || DEFAULT_FALLBACK_BASE_URL;
  const baseUrls = unique([baseUrl, fallbackBaseUrl].filter(Boolean).map(stripTrailingSlash));
  const keyResolution = resolveApiKey(config);
  return {
    baseUrls,
    apiKey: keyResolution.apiKey,
    apiKeySource: keyResolution.source,
    timeoutMs: clampInt(input.timeoutMs ?? config.restTimeoutMs ?? config.timeoutMs, 1000, 120000, DEFAULT_TIMEOUT_MS),
    maxOutputChars: clampInt(input.maxOutputChars ?? config.maxOutputChars, 1000, 50000, DEFAULT_MAX_OUTPUT_CHARS),
    rejectUnauthorized: config.restRejectUnauthorized === true,
    transport: normalizeTransport(config.restTransport || process.env.OBSIDIAN_REST_TRANSPORT)
  };
}

function normalizeTransport(value) {
  const transport = clean(value).toLowerCase();
  if (transport === "native" || transport === "curl") return transport;
  return "auto";
}

function resolveApiKey(config) {
  const direct = clean(config.restApiKey) || clean(process.env.OBSIDIAN_REST_API_KEY);
  if (direct) return { apiKey: direct, source: clean(config.restApiKey) ? "config.restApiKey" : "env.OBSIDIAN_REST_API_KEY" };

  const files = [
    clean(config.restApiKeyFile),
    clean(process.env.OBSIDIAN_REST_API_KEY_FILE),
    localRestDataPath(config.defaultVaultPath),
    localRestDataPath(process.env.OBSIDIAN_VAULT_PATH),
    ...discoverLocalRestDataFiles()
  ].filter(Boolean).map(expandHome);

  for (const file of files) {
    const apiKey = readApiKeyFile(file);
    if (apiKey) return { apiKey, source: file };
  }

  return { apiKey: "", source: "" };
}

function readApiKeyFile(file) {
  try {
    if (!fs.existsSync(file)) return "";
    const text = fs.readFileSync(file, "utf8").trim();
    if (!text) return "";
    if (text.startsWith("{")) {
      const data = JSON.parse(text);
      return clean(data.apiKey);
    }
    return text;
  } catch {
    return "";
  }
}

function localRestDataPath(vaultPath) {
  const root = clean(vaultPath);
  if (!root) return "";
  return path.join(expandHome(root), ".obsidian", "plugins", "obsidian-local-rest-api", "data.json");
}

function discoverLocalRestDataFiles() {
  const roots = [
    path.join(osHome(), "Documents"),
    path.join(osHome(), "Obsidian"),
    osHome()
  ].filter(Boolean);
  const results = [];
  for (const root of roots) {
    try {
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        const child = path.join(root, entry.name);
        if (!entry.isDirectory() && !isDirectorySymlink(child)) continue;
        const candidate = path.join(child, ".obsidian", "plugins", "obsidian-local-rest-api", "data.json");
        if (fs.existsSync(candidate)) results.push(candidate);
      }
    } catch {
      // Discovery is best-effort; explicit config wins.
    }
  }
  return results;
}

function isDirectorySymlink(value) {
  try {
    const stat = fs.statSync(value);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

function vaultEndpoint(vaultPath, directory) {
  const cleaned = cleanPath(vaultPath);
  if (!cleaned) return "/vault/";
  const encoded = cleaned.split("/").map(encodeURIComponent).join("/");
  return `/vault/${encoded}${directory && !encoded.endsWith("/") ? "/" : ""}`;
}

function requiredPath(value) {
  const cleaned = cleanPath(value);
  if (!cleaned) throw new Error("path is required.");
  return cleaned;
}

function requiredDestinationPath(value) {
  const cleaned = cleanPath(value, { allowTrailingSlash: true });
  if (!cleaned) throw new Error("destinationPath is required for move.");
  return cleaned;
}

function cleanPath(value, options = {}) {
  const raw = clean(value).replace(/\\/g, "/").replace(/\/+/g, "/");
  const cleaned = options.allowTrailingSlash ? raw.replace(/^\/+/, "") : raw.replace(/^\/+|\/+$/g, "");
  if (!cleaned) return "";
  if (cleaned === "." || cleaned.includes("../") || cleaned.includes("/..") || cleaned.startsWith("..")) {
    throw new Error(`Invalid vault-relative path: ${value}`);
  }
  return cleaned;
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function expandHome(value) {
  const input = clean(value);
  if (!input) return "";
  if (input === "~") return process.env.HOME || osHome();
  if (input.startsWith("~/")) return path.join(process.env.HOME || osHome(), input.slice(2));
  return input;
}

function osHome() {
  return process.env.HOME || process.env.USERPROFILE || "";
}

function stripTrailingSlash(value) {
  return clean(value).replace(/\/+$/, "");
}

function unique(values) {
  return [...new Set(values)];
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function decodeHeader(value) {
  if (!value) return "";
  try {
    return decodeURI(String(value));
  } catch {
    return String(value);
  }
}

function encodeHeaderValue(value) {
  return encodeURIComponent(String(value));
}

function formatBody(body, maxOutputChars) {
  const text = typeof body === "string" ? body : JSON.stringify(body, null, 2);
  if (!text) return "";
  if (text.length <= maxOutputChars) return text;
  return `${text.slice(0, maxOutputChars)}\n...<truncated>`;
}
