const REVIEW_REQUIRED_MESSAGE =
  "BROWSER_CONNECT_REVIEW_REQUIRED: previous Chrome connection attempt failed; use the reviewed browser_bridge_start action once when the user is ready to answer the Chrome prompt";

const ATTEMPT_IN_PROGRESS_MESSAGE =
  "BROWSER_CONNECT_ATTEMPT_IN_PROGRESS: a reviewed Chrome connection attempt is already in progress";

const DENIAL_PATTERNS = [
  /\bCONSENT_DENIED\b/i,
  /Chrome user denied the browser connection/i,
  /\bHTTP[_ ]?(?:401|403)\b/i,
];

const CONNECTION_FAILURE_PATTERNS = [
  /Unable to connect to Chrome DevTools WebSocket/i,
  /\bSTALE_ENDPOINT\b/i,
  /remote debugging endpoint is unavailable/i,
  /Existing Chrome is not ready/i,
  /\bENDPOINT_MISSING\b/i,
  /DevToolsActivePort was not found/i,
  /Unable to enable Chrome target discovery/i,
  /Bridge is not connected/i,
  /\bNOT_CONNECTED\b/i,
  /\bEXPLICIT_RECONNECT_REQUIRED\b/i,
  /reconnect requires a reviewed bridge restart/i,
  /WebSocket.{0,80}(?:timeout|timed out|closed|not open)/i,
];

function safeErrorFields(value) {
  if (!value || typeof value !== "object") return "";
  const safeParts = [];
  for (const key of ["code", "causeCode", "errorCode", "error", "message"]) {
    const item = value[key];
    if (typeof item === "string") safeParts.push(item.slice(0, 512));
  }
  return safeParts.join("\n").slice(0, 2048);
}

function parseStructuredErrorText(text) {
  if (typeof text !== "string") return "";
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") return "";
    if (parsed.ok !== false && parsed.isError !== true) return "";
    return safeErrorFields(parsed);
  } catch {
    return "";
  }
}

function errorEvidence(value) {
  if (value instanceof Error) return `${value.name || "Error"}: ${value.message || ""}`.slice(0, 2048);
  if (!value || typeof value !== "object") return "";

  const topLevelError = value.isError === true || value.ok === false;
  const evidence = [];
  if (topLevelError) evidence.push(safeErrorFields(value));
  for (const item of Array.isArray(value.content) ? value.content : []) {
    if (item?.type !== "text" || typeof item.text !== "string") continue;
    const structured = parseStructuredErrorText(item.text);
    if (structured) evidence.push(structured);
    else if (topLevelError) evidence.push(item.text.slice(0, 1024));
  }
  return evidence.filter(Boolean).join("\n").slice(0, 2048);
}

export function classifyBrowserConnectFailure(value, { thrown = false } = {}) {
  const text = errorEvidence(value);
  if (DENIAL_PATTERNS.some((pattern) => pattern.test(text))) return "consent-denied";
  if (CONNECTION_FAILURE_PATTERNS.some((pattern) => pattern.test(text))) return "connection-failed";
  if (value && typeof value === "object" && value.isError === true) return "connection-failed";
  // MCP client/transport exceptions are not safe to retry automatically. Tool-level
  // failures from browser-bridge are returned as MCP content rather than thrown.
  if (thrown) return "connection-failed";
  return null;
}

function blockedError() {
  const error = new Error(REVIEW_REQUIRED_MESSAGE);
  error.code = "BROWSER_CONNECT_REVIEW_REQUIRED";
  return error;
}

function inProgressError() {
  const error = new Error(ATTEMPT_IN_PROGRESS_MESSAGE);
  error.code = "BROWSER_CONNECT_ATTEMPT_IN_PROGRESS";
  return error;
}

export class ExistingChromeConnectGuard {
  #state = null;

  #forKey(key) {
    if (!this.#state || this.#state.key !== key) {
      this.#state = {
        key,
        reviewedAttemptAvailable: false,
        connected: false,
        attemptInFlight: false,
        retryBlocked: false,
        retryBlockReason: null,
      };
    }
    return this.#state;
  }

  reviewedStart(key) {
    const state = this.#forKey(key);
    state.retryBlocked = false;
    state.retryBlockReason = null;
    if (!state.connected) state.reviewedAttemptAvailable = true;
    return this.status(key);
  }

  clear() {
    this.#state = null;
  }

  status(key) {
    const state = this.#state?.key === key ? this.#state : null;
    return {
      retryBlocked: state?.retryBlocked === true,
      retryBlockReason: state?.retryBlockReason || null,
      attemptInFlight: state?.attemptInFlight === true,
      browserConnected: state?.connected === true,
    };
  }

  async invoke(key, invokeTool) {
    const state = this.#forKey(key);
    if (state.retryBlocked) throw blockedError();

    const isConnectionAttempt = !state.connected;
    if (isConnectionAttempt) {
      if (state.attemptInFlight) throw inProgressError();
      if (!state.reviewedAttemptAvailable) throw blockedError();
      state.reviewedAttemptAvailable = false;
      state.attemptInFlight = true;
    }

    try {
      const result = await invokeTool();
      const reason = classifyBrowserConnectFailure(result);
      if (reason) {
        state.connected = false;
        state.retryBlocked = true;
        state.retryBlockReason = reason;
      } else if (isConnectionAttempt) {
        state.connected = true;
      }
      return result;
    } catch (error) {
      state.connected = false;
      state.retryBlocked = true;
      state.retryBlockReason = classifyBrowserConnectFailure(error, { thrown: true });
      throw error;
    } finally {
      if (isConnectionAttempt) state.attemptInFlight = false;
    }
  }
}

export const BROWSER_CONNECT_REVIEW_REQUIRED_MESSAGE = REVIEW_REQUIRED_MESSAGE;
