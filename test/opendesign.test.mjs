// Runs the plugin against recorded control-plane payloads. No network: the
// harness in host.mjs stands in for CodexBar's host `ctx`.

import { test } from "node:test";
import assert from "node:assert/strict";

import { PREFLIGHT, PROFILE, SUMMARY, host, loadPlugin, ok } from "./host.mjs";

const definition = loadPlugin();

test("the manifest is what the approval sheet lists", () => {
  assert.equal(definition.id, "opendesign");
  assert.equal(definition.name, "OpenDesign");
  assert.deepEqual(definition.endpoints, ["https://amr-api.open-design.ai"]);
  assert.deepEqual(definition.auth, { type: "bearer", secret: "CONTROL_KEY" });
  assert.deepEqual(definition.capabilities, ["http-status"]);
  assert.deepEqual(
    definition.settings.map((setting) => [setting.key, setting.type]),
    [
      ["CONTROL_KEY", "secure"],
      ["WORKSPACE_ID", "plain"],
    ],
  );
});

test("a Go plan reads as 5 hours over 7 days, plus the wallet", async () => {
  const { ctx, calls } = host({
    "/workspaces/current": ok(PROFILE),
    "/workspaces/ws1/billing/preflight": ok(PREFLIGHT),
    "/billing/summary": ok(SUMMARY),
  });
  const usage = await definition.fetchUsage(ctx);

  assert.deepEqual(calls, [
    "https://amr-api.open-design.ai/api/v1/workspaces/current",
    "https://amr-api.open-design.ai/api/v1/workspaces/ws1/billing/preflight",
    "https://amr-api.open-design.ai/api/v1/billing/summary",
  ]);

  assert.deepEqual(usage.primary, {
    usedPercent: 32.5,
    windowMinutes: 300,
    resetsAt: "2026-10-11T11:36:14.000Z",
  });
  assert.deepEqual(usage.secondary, {
    usedPercent: 10.83,
    windowMinutes: 10080,
    resetsAt: "2026-10-18T06:36:14.000Z",
  });
  assert.equal(usage.extraWindows, undefined);
  assert.equal(usage.dataConfidence, "exact");
  assert.equal(usage.subscriptionRenewsAt, "2026-11-11T06:36:14.000Z");
  assert.deepEqual(usage.identity, {
    loginMethod: "Design Plan Go",
    accountID: "ws1",
    organization: "Ada's workspace",
  });

  const windowSection = usage.details[0];
  assert.equal(windowSection.title, "Design Plan windows");
  assert.deepEqual(windowSection.rows.map((row) => [row.label, row.value, row.secondaryValue, row.usageValue]), [
    ["5 hours", "16.3k / 50k credits", "resets 2026-10-11", 16251],
    ["7 days", "16.3k / 150k credits", "resets 2026-10-18", 16251],
  ]);
  assert.ok(Math.abs(windowSection.rows[0].progress - 0.325) < 1e-9);
  assert.ok(Math.abs(windowSection.rows[1].progress - 0.1083) < 1e-9);
  assert.deepEqual(usage.details[1].rows, [
    { label: "Wallet balance", value: "$1.50" },
    { label: "Subscription", value: "active" },
    { label: "Workspace", value: "Ada's workspace" },
  ]);
});

test("a plan with one window shows one window", async () => {
  const { ctx } = host({
    "/workspaces/current": ok(PROFILE),
    "/workspaces/ws1/billing/preflight": ok({
      balanceUsd: "0",
      codingPlan: {
        eligible: true,
        tier: "pro",
        windows: [
          { policyId: "weekly", durationSeconds: 604800, usedCredits: "16251", limitCredits: "150000" },
        ],
      },
    }),
    "/billing/summary": ok({}),
  });
  const usage = await definition.fetchUsage(ctx);

  assert.equal(usage.secondary, undefined);
  assert.equal(usage.extraWindows, undefined);
  // No reset date reported means no reset date invented.
  assert.deepEqual(usage.primary, { usedPercent: 10.83, windowMinutes: 10080 });
  assert.equal(usage.details[0].rows[0].secondaryValue, null);
  assert.deepEqual(usage.details[1].rows, [
    { label: "Wallet balance", value: "$0.00" },
    { label: "Workspace", value: "Ada's workspace" },
  ]);
});

test("a third window is kept as a named window", async () => {
  const { ctx } = host({
    "/workspaces/current": ok(PROFILE),
    "/workspaces/ws1/billing/preflight": ok({
      codingPlan: {
        eligible: true,
        windows: [
          { policyId: "monthly", durationSeconds: 2592000, usedCredits: "1", limitCredits: "100" },
          { policyId: "session", durationSeconds: 18000, usedCredits: "1", limitCredits: "100" },
          { policyId: "weekly", durationSeconds: 604800, usedCredits: "1", limitCredits: "100" },
        ],
      },
    }),
  });
  const usage = await definition.fetchUsage(ctx);

  assert.equal(usage.primary.windowMinutes, 300);
  assert.equal(usage.secondary.windowMinutes, 10080);
  assert.deepEqual(usage.extraWindows, [
    { id: "monthly", title: "30 days", usedPercent: 1, windowMinutes: 43200 },
  ]);
});

test("a window with nothing to divide is left out", async () => {
  const { ctx } = host({
    "/workspaces/current": ok(PROFILE),
    "/workspaces/ws1/billing/preflight": ok({
      codingPlan: {
        eligible: true,
        windows: [
          { policyId: "broken", durationSeconds: 18000, usedCredits: "3", limitCredits: "0" },
          { policyId: "weekly", durationSeconds: 604800, usedCredits: "1", limitCredits: "4" },
        ],
      },
    }),
  });
  const usage = await definition.fetchUsage(ctx);

  assert.equal(usage.primary.usedPercent, 25);
  assert.equal(usage.primary.windowMinutes, 10080);
  assert.equal(usage.details[0].rows.length, 1);
});

test("credit pools past Number.MAX_SAFE_INTEGER keep their share", async () => {
  const { ctx } = host({
    "/workspaces/current": ok(PROFILE),
    "/workspaces/ws1/billing/preflight": ok({
      codingPlan: {
        eligible: true,
        windows: [
          {
            policyId: "team",
            durationSeconds: 604800,
            usedCredits: "10000000000000000001",
            limitCredits: "20000000000000000000",
          },
        ],
      },
    }),
  });
  const usage = await definition.fetchUsage(ctx);
  assert.equal(usage.primary.usedPercent, 50);
});

test("an account with no Design Plan still shows the wallet", async () => {
  const { ctx } = host({
    "/workspaces/current": ok(PROFILE),
    "/workspaces/ws1/billing/preflight": ok({
      balanceUsd: "12.3456",
      funding: "wallet",
      codingPlan: { eligible: false, tier: "go", windows: [] },
    }),
    "/billing/summary": ok({ membershipTier: "go", subscriptionStatus: "past_due" }),
  });
  const usage = await definition.fetchUsage(ctx);

  assert.equal(usage.primary, undefined);
  assert.equal(usage.details[0].title, "Account");
  assert.deepEqual(usage.details[0].rows, [
    { label: "Wallet balance", value: "$12.35" },
    { label: "Design Plan", value: "not included — requests draw on the wallet balance" },
    { label: "Subscription", value: "past_due" },
    { label: "Workspace", value: "Ada's workspace" },
  ]);
});

test("a workspace setting skips the workspace read", async () => {
  const { ctx, calls } = host(
    {
      "/workspaces/team9/billing/preflight": ok({
        codingPlan: { eligible: true, windows: [{ policyId: "weekly", durationSeconds: 604800, usedCredits: "1", limitCredits: "4" }] },
      }),
    },
    { CONTROL_KEY: "vela_ctrl_a", WORKSPACE_ID: "team9" },
  );
  const usage = await definition.fetchUsage(ctx);

  assert.deepEqual(calls, [
    "https://amr-api.open-design.ai/api/v1/workspaces/team9/billing/preflight",
    "https://amr-api.open-design.ai/api/v1/billing/summary",
  ]);
  assert.equal(usage.identity.accountID, "team9");
  assert.equal(usage.identity.organization, undefined);
});

test("a refused key reads as a refused key", async () => {
  const { ctx } = host({
    "/workspaces/current": { status: 401, json: { error: "unauthenticated" } },
  });
  await assert.rejects(definition.fetchUsage(ctx), (error) => {
    assert.equal(error.code, "authenticationExpired");
    assert.match(error.message, /vela_ctrl_/);
    return true;
  });
});

test("the API-key-only case is refused with the same words", async () => {
  const { ctx } = host({
    "/workspaces/current": ok(PROFILE),
    "/workspaces/ws1/billing/preflight": { status: 403, json: { error: "forbidden" } },
  });
  await assert.rejects(definition.fetchUsage(ctx), { code: "authenticationExpired" });
});

test("no key at all asks for one", async () => {
  const { ctx } = host({}, {});
  await assert.rejects(definition.fetchUsage(ctx), { code: "missingCredential" });
});

test("a failing summary never costs the allowance", async () => {
  const { ctx } = host({
    "/workspaces/current": ok(PROFILE),
    "/workspaces/ws1/billing/preflight": ok(PREFLIGHT),
    "/billing/summary": { status: 500, json: { error: "boom" } },
  });
  const usage = await definition.fetchUsage(ctx);

  assert.equal(usage.primary.usedPercent, 32.5);
  assert.deepEqual(usage.details[1].rows, [
    { label: "Wallet balance", value: "$1.50" },
    { label: "Workspace", value: "Ada's workspace" },
  ]);
});

test("rate limiting asks for the host's retry", async () => {
  const { ctx } = host({
    "/workspaces/current": { status: 429, headers: { "retry-after": "3" }, json: {} },
  });
  await assert.rejects(definition.fetchUsage(ctx), (error) => {
    assert.equal(error.code, "rateLimited");
    assert.deepEqual(error.options, { retryAfterSeconds: 3 });
    return true;
  });
});
