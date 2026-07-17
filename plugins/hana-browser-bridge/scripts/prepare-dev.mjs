// Run both development preparation steps in one Node process so CLI source-selection
// arguments such as --bridge-dir are visible to sync-bridge and generate-tools alike.
await import("./sync-bridge.mjs");
await import("./generate-tools.mjs");
