// A stand-in for CodexBar's host `ctx`, and the control plane's recorded
// answers. Shared by the unit tests and the host-level render check.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** Load opendesign.js the way the plugin runtime does: one call to defineProvider. */
export function loadPlugin() {
  const source = readFileSync(join(here, "..", "opendesign.js"), "utf8");
  let definition = null;
  new Function("defineProvider", source)((value) => {
    definition = value;
  });
  return definition;
}

// As the vela CLI and the desktop daemon read the control plane.
export const PROFILE = { activeWorkspaceId: "ws1", name: "Ada's workspace", personalMembershipTier: "go" };
export const PREFLIGHT = {
  schemaVersion: 1,
  workspaceId: "ws1",
  balanceUsd: "1.5000",
  funding: "coding_plan",
  codingPlan: {
    eligible: true,
    tier: "go",
    // Deliberately out of order: the plugin's sort is what puts 5 hours first.
    windows: [
      {
        policyId: "weekly",
        durationSeconds: 604800,
        usedCredits: "16251",
        remainingCredits: "133749",
        limitCredits: "150000",
        resetsAt: "2026-10-18T06:36:14.000Z",
      },
      {
        policyId: "session",
        durationSeconds: 18000,
        usedCredits: "16251",
        remainingCredits: "33749",
        limitCredits: "50000",
        resetsAt: "2026-10-11T11:36:14.000Z",
      },
    ],
  },
};
export const SUMMARY = {
  membershipTier: "go",
  subscriptionStatus: "active",
  subscriptionCancelAtPeriodEnd: false,
  subscriptionCurrentPeriodEnd: "2026-11-11T06:36:14.000Z",
  balanceUsd: "1.5000",
};

export const ok = (json) => ({ json });

const failure = (code) => (message, options) => Object.assign(new Error(message), { code, options });

/** A host ctx answering the given paths (`/workspaces/current` → route). */
export function host(routes, settings = { CONTROL_KEY: "vela_ctrl_a" }) {
  const calls = [];
  return {
    calls,
    ctx: {
      http: {
        async getJSON(url) {
          calls.push(url);
          const path = String(url).replace("https://amr-api.open-design.ai/api/v1", "");
          const route = routes[path];
          if (!route) return { url, status: 404, headers: {}, json: { error: "not found" } };
          return { url, status: route.status ?? 200, headers: route.headers ?? {}, json: route.json };
        },
      },
      settings: {
        get: (key) => settings[key] ?? null,
        getSecret: (key) => settings[key] ?? null,
      },
      fail: {
        authenticationExpired: failure("authenticationExpired"),
        missingCredential: failure("missingCredential"),
        permissionDenied: failure("permissionDenied"),
        rateLimited: failure("rateLimited"),
        providerUnavailable: failure("providerUnavailable"),
        parseFailure: failure("parseFailure"),
        networkFailure: failure("networkFailure"),
        apiFailure: failure("apiFailure"),
      },
      format: {
        usd: (value) => "$" + value.toFixed(2),
        monthDay: (value) => String(value).slice(0, 10),
      },
      log() {},
    },
  };
}
