// Runs the plugin against recorded control-plane payloads. No network: the
// harness in host.mjs stands in for CodexBar's host `ctx`.

import { test } from "node:test";
import assert from "node:assert/strict";

import { PREFLIGHT, PROFILE, SUMMARY, host, loadPlugin, ok } from "./host.mjs";

const definition = loadPlugin();

const WINDOWS = (details) => details[0].rows;

test("the manifest is what the approval sheet lists", () => {
  assert.equal(definition.id, "opendesign");
  assert.equal(definition.name, "OpenDesign");
  assert.deepEqual(definition.icon, { monogram: "OD", tint: "#202020" });
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

test("a Go plan reads as one plan line and two remaining rows", async () => {
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

  // Nothing else: no rate windows with CodexBar's own "Primary"/"Secondary"
  // labels, no cost, no identity rows.
  assert.deepEqual(Object.keys(usage).sort(), ["dataConfidence", "details"]);
  assert.equal(usage.dataConfidence, "exact");
  assert.equal(usage.details.length, 1);
  assert.equal(usage.details[0].title, "Design Plan Go");

  const rows = WINDOWS(usage.details);
  assert.deepEqual(rows.map((row) => [row.label, row.value]), [
    ["5小时剩余量", "67.5%"],
    ["7天剩余量", "89.2%"],
  ]);
  assert.ok(Math.abs(rows[0].progress - 0.675) < 1e-9);
  assert.ok(Math.abs(rows[1].progress - 0.892) < 1e-9);
});

test("a plan with one window shows one row", async () => {
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

  assert.equal(usage.details[0].title, "Design Plan Pro");
  assert.deepEqual(WINDOWS(usage.details).map((row) => [row.label, row.value]), [
    ["7天剩余量", "89.2%"],
  ]);
});

test("every window the plan reports becomes its own row", async () => {
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

  assert.deepEqual(WINDOWS(usage.details).map((row) => row.label), [
    "5小时剩余量",
    "7天剩余量",
    "30天剩余量",
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

  assert.deepEqual(WINDOWS(usage.details).map((row) => [row.label, row.value]), [["7天剩余量", "75%"]]);
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
  assert.equal(WINDOWS(usage.details)[0].value, "50%");
});

test("an account with no Design Plan falls back to the wallet", async () => {
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

  assert.equal(usage.details[0].title, "Design Plan Go");
  assert.deepEqual(WINDOWS(usage.details), [{ label: "钱包余额", value: "$12.35" }]);
});

test("a workspace setting skips the workspace read", async () => {
  const { ctx, calls } = host(
    {
      "/workspaces/team9/billing/preflight": ok({
        codingPlan: {
          eligible: true,
          windows: [{ policyId: "weekly", durationSeconds: 604800, usedCredits: "1", limitCredits: "4" }],
        },
      }),
    },
    { CONTROL_KEY: "vela_ctrl_a", WORKSPACE_ID: "team9" },
  );
  const usage = await definition.fetchUsage(ctx);

  assert.deepEqual(calls, [
    "https://amr-api.open-design.ai/api/v1/workspaces/team9/billing/preflight",
    "https://amr-api.open-design.ai/api/v1/billing/summary",
  ]);
  assert.deepEqual(WINDOWS(usage.details).map((row) => row.value), ["75%"]);
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

test("a model-plane key is refused before any request", async () => {
  const { ctx, calls } = host({}, { CONTROL_KEY: "sk-amr-abc123" });
  await assert.rejects(definition.fetchUsage(ctx), (error) => {
    assert.equal(error.code, "authenticationExpired");
    assert.match(error.message, /vela_ctrl_/);
    return true;
  });
  assert.deepEqual(calls, []);
});

test("a key pasted into the workspace field is sent to the right field", async () => {
  const { ctx, calls } = host({}, { CONTROL_KEY: "vela_ctrl_a", WORKSPACE_ID: "vela_ctrl_b" });
  await assert.rejects(definition.fetchUsage(ctx), (error) => {
    assert.equal(error.code, "missingCredential");
    assert.match(error.message, /CONTROL_KEY/);
    return true;
  });
  assert.deepEqual(calls, []);
});

test("a failing summary never costs the allowance", async () => {
  const { ctx } = host({
    "/workspaces/current": ok(PROFILE),
    "/workspaces/ws1/billing/preflight": ok(PREFLIGHT),
    "/billing/summary": { status: 500, json: { error: "boom" } },
  });
  const usage = await definition.fetchUsage(ctx);

  assert.deepEqual(WINDOWS(usage.details).map((row) => row.value), ["67.5%", "89.2%"]);
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
