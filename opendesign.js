// OpenDesign (open-design.ai) usage for CodexBar: the Design Plan's 5-hour and
// 7-day credit windows, the wallet balance and the subscription.
//
// It reads the Vela control plane (amr-api.open-design.ai) with the account's
// control key (vela_ctrl_…), the key the Open Design desktop app and the vela
// CLI sign in with — ~/.amr/config.json, profiles.<profile>.controlKey. An
// sk-amr- model key cannot read the plan: the control plane rejects it.
//
// Install: copy this one file into ~/.config/codexbar/providers/, or use
// Settings → Plugins → Install…. Then approve https://amr-api.open-design.ai,
// paste the control key into the plugin's settings and enable the plugin.
//
// CLI: CODEXBAR_PLUGIN_OPENDESIGN_CONTROL_KEY=vela_ctrl_… \
//        codexbar plugins fetch opendesign

const API = "https://amr-api.open-design.ai/api/v1";
const HOUR = 3600;
const DAY = 86400;

const str = (value) => (typeof value === "string" && value.trim() ? value.trim() : "");
const num = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const digits = (value) => typeof value === "string" && /^[0-9]+$/.test(value);

// A window's length in the vendor's own words: "5 hours", "7 days".
function windowTitle(seconds) {
  const span = num(seconds);
  if (span === null || span <= 0) return "Allowance";
  const say = (count, one, many) => count + " " + (count === 1 ? one : many);
  if (span % DAY === 0) return say(span / DAY, "day", "days");
  if (span % HOUR === 0) return say(span / HOUR, "hour", "hours");
  return say(Math.round(span / 60), "minute", "minutes");
}

// How much of a window is spent, as a percentage. Plan pools are decimal
// strings that can pass Number.MAX_SAFE_INTEGER, so the ratio is taken in
// BigInt before it ever becomes a float. A window with nothing to divide is
// dropped instead of being shown as full.
function usedPercent(used, limit) {
  if (digits(used) && digits(limit)) {
    const whole = BigInt(limit);
    if (whole <= 0n) return null;
    return Math.min(100, Number((BigInt(used) * 10000n) / whole) / 100);
  }
  const spent = num(used);
  const allowed = num(limit);
  if (spent === null || allowed === null || allowed <= 0) return null;
  return Math.min(100, Math.round((spent / allowed) * 10000) / 100);
}

// 16251 credits read as "16.3k", as the vendor's own card rounds them.
function credits(value) {
  const count = num(value);
  if (count === null) return str(value);
  const whole = Math.round(count);
  const size = Math.abs(whole);
  if (size < 10000) return String(whole);
  if (size < 1000000) return Math.round(whole / 100) / 10 + "k";
  return Math.round(whole / 100000) / 10 + "M";
}

// The vendor's own error wording, never a page of HTML.
function said(body, fallback) {
  const raw = body && (body.error?.message ?? body.message ?? body.error);
  const text = str(raw);
  if (!text || text.charAt(0) === "<") return fallback;
  return text.length > 160 ? text.slice(0, 160) + "…" : text;
}

function planLabel(coding, summary) {
  const tier = str(coding?.tier) || str(summary?.membershipTier);
  return tier ? "Design Plan " + tier.charAt(0).toUpperCase() + tier.slice(1) : "OpenDesign";
}

defineProvider({
  id: "opendesign",
  name: "OpenDesign",
  icon: { monogram: "OD", tint: "#6E56CF" },
  endpoints: ["https://amr-api.open-design.ai"],
  auth: { type: "bearer", secret: "CONTROL_KEY" },
  // The plugin classifies the status itself, so a refused key reads as a
  // refused key instead of a generic HTTP error.
  capabilities: ["http-status"],
  settings: [
    {
      key: "CONTROL_KEY",
      title: "OpenDesign control key",
      subtitle: "vela_ctrl_… from ~/.amr/config.json (profiles.<profile>.controlKey).",
      type: "secure",
    },
    {
      key: "WORKSPACE_ID",
      title: "Workspace ID (optional)",
      subtitle: "Blank reads the account's active workspace.",
      type: "plain",
    },
  ],

  async fetchUsage(ctx) {
    const controlKey = ctx.settings.getSecret("CONTROL_KEY");
    if (!controlKey) {
      throw ctx.fail.missingCredential("Add the OpenDesign control key (vela_ctrl_…) in this plugin's settings.");
    }
    // A model-plane key is a real OpenDesign key, just the wrong one: the
    // control plane answers 401 to it in every header form, so say so now
    // instead of spending a request to learn it.
    if (controlKey.startsWith("sk-amr-")) {
      throw ctx.fail.authenticationExpired(
        "That is a model-plane API key (sk-amr-…). The Design Plan allowance and wallet live on the control plane, which only takes the account control key (vela_ctrl_…).",
      );
    }

    // One read of the control plane, classified: http-status means the host
    // handed us the status instead of failing the request itself.
    const get = async (path, what) => {
      const response = await ctx.http.getJSON(API + path);
      const status = response.status;
      if (status === 401 || status === 403) {
        throw ctx.fail.authenticationExpired(
          what + ": OpenDesign answered " + status +
            ". Use the account control key (vela_ctrl_…), not an sk-amr- model key.",
        );
      }
      if (status === 429) {
        throw ctx.fail.rateLimited(what + ": OpenDesign rate limited the read.", {
          retryAfterSeconds: num(response.headers["retry-after"]) ?? 5,
        });
      }
      if (status >= 500) throw ctx.fail.providerUnavailable(what + ": OpenDesign answered " + status + ".");
      if (status !== 200) {
        const detail = said(response.json, "");
        throw ctx.fail.apiFailure(what + ": OpenDesign answered " + status + (detail ? " " + detail : ""));
      }
      return response.json;
    };

    let workspaceID = str(ctx.settings.get("WORKSPACE_ID"));
    let workspaceName = "";
    if (!workspaceID) {
      const current = await get("/workspaces/current", "The workspace read");
      workspaceID = str(current?.activeWorkspaceId) || str(current?.workspaceId);
      workspaceName = str(current?.name) || str(current?.workspaceName);
      if (!workspaceID) throw ctx.fail.apiFailure("OpenDesign reported no active workspace for this account.");
    }

    const preflight = await get(
      "/workspaces/" + encodeURIComponent(workspaceID) + "/billing/preflight",
      "The Design Plan read",
    );
    const coding = preflight?.codingPlan ?? null;

    // The summary only adds the plan label and the renewal date; the allowance
    // itself is already read, so a failing summary is logged, not fatal.
    let summary = null;
    try {
      summary = await get("/billing/summary", "The billing summary read");
    } catch (error) {
      if (error?.transportClass === "cancelled") throw error;
      ctx.log("billing summary unavailable:", String(error?.message ?? error));
    }

    const windows = (Array.isArray(coding?.windows) ? coding.windows : [])
      .map((window) => {
        const used = usedPercent(window?.usedCredits, window?.limitCredits);
        if (used === null) return null;
        const seconds = num(window?.durationSeconds) ?? 0;
        return {
          seconds: seconds,
          id: str(window?.policyId) || String(seconds),
          title: windowTitle(seconds),
          usedPercent: used,
          windowMinutes: seconds > 0 ? Math.max(1, Math.round(seconds / 60)) : null,
          resetsAt: str(window?.resetsAt) || null,
          usedCredits: str(window?.usedCredits),
          limitCredits: str(window?.limitCredits),
        };
      })
      .filter((window) => window !== null)
      .sort((left, right) => left.seconds - right.seconds);

    const windowFields = (window) => ({
      usedPercent: window.usedPercent,
      ...(window.windowMinutes ? { windowMinutes: window.windowMinutes } : {}),
      ...(window.resetsAt ? { resetsAt: window.resetsAt } : {}),
    });

    const usage = { dataConfidence: "exact" };
    if (windows[0]) usage.primary = windowFields(windows[0]);
    if (windows[1]) usage.secondary = windowFields(windows[1]);
    if (windows.length > 2) {
      usage.extraWindows = windows.slice(2).map((window) => ({
        id: window.id,
        title: window.title,
        ...windowFields(window),
      }));
    }

    const balance = num(preflight?.balanceUsd ?? summary?.balanceUsd);
    const windowRows = windows.map((window) => ({
      label: window.title,
      value: credits(window.usedCredits) + " / " + credits(window.limitCredits) + " credits",
      secondaryValue: window.resetsAt ? "resets " + ctx.format.monthDay(window.resetsAt) : null,
      progress: window.usedPercent / 100,
      usageValue: num(window.usedCredits),
    }));

    const plan = planLabel(coding, summary);
    const accountRows = [];
    if (balance !== null) accountRows.push({ label: "Wallet balance", value: ctx.format.usd(balance) });
    if (coding && coding.eligible === false) {
      accountRows.push({ label: "Design Plan", value: "not included — requests draw on the wallet balance" });
    }
    const subscription = str(summary?.subscriptionStatus);
    if (subscription) {
      accountRows.push({
        label: "Subscription",
        value: subscription + (summary?.subscriptionCancelAtPeriodEnd ? " (cancels at period end)" : ""),
      });
    }
    accountRows.push({ label: "Workspace", value: workspaceName || workspaceID });

    usage.details = [];
    if (windowRows.length) usage.details.push({ title: "Design Plan windows", rows: windowRows });
    usage.details.push({ title: "Account", rows: accountRows });

    // CodexBar renders loginMethod as the plan line, as the bundled providers do.
    usage.identity = { loginMethod: plan, accountID: workspaceID };
    if (workspaceName) usage.identity.organization = workspaceName;

    const periodEnd = str(summary?.subscriptionCurrentPeriodEnd);
    if (periodEnd) {
      if (summary?.subscriptionCancelAtPeriodEnd) usage.subscriptionExpiresAt = periodEnd;
      else usage.subscriptionRenewsAt = periodEnd;
    }

    return usage;
  },
});
