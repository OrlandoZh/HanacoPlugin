// Compatibility entry point. Runtime routes use the versioned module to avoid
// stale ESM exports during HanaAgent 0.412.7 community-plugin reloads.
export * from "./architecture-generator-v2.js";
