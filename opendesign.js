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

// What a window's row is called on the card: "5小时剩余量", "7天剩余量".
function windowLabel(seconds) {
  const span = num(seconds);
  if (span === null || span <= 0) return "额度剩余量";
  if (span % DAY === 0) return span / DAY + "天剩余量";
  if (span % HOUR === 0) return span / HOUR + "小时剩余量";
  return Math.round(span / 60) + "分钟剩余量";
}

const percentText = (percent) => Math.round(percent * 10) / 10 + "%";

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
  // CodexBar draws a plugin's icon as a monogram on a tinted square — no
  // file or SVG icons for installed plugins. This is the palette the official
  // site uses (--ink/--paper #202020, accent #63FE13); the badge text is
  // always white, so the dark surface is the one that stays legible.
  icon: { monogram: "OD", tint: "#202020" },
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
      throw ctx.fail.missingCredential(
        "No control key yet. Open CodexBar's Settings → Plugins, find this plugin's section and paste the OpenDesign control key (vela_ctrl_…) into the CONTROL_KEY field, then press Refresh — the install sheet only asks for the plain settings, so the key is entered there afterwards.",
      );
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
    // The install sheet only offers the plain settings, so the key ends up
    // here often enough to be worth catching by name.
    if (workspaceID.startsWith("vela_ctrl_") || workspaceID.startsWith("sk-amr-")) {
      throw ctx.fail.missingCredential(
        "The Workspace ID field holds a key, not a workspace id. Move it to the CONTROL_KEY field; leave Workspace ID empty to use the account's active workspace.",
      );
    }
    if (!workspaceID) {
      const current = await get("/workspaces/current", "The workspace read");
      workspaceID = str(current?.activeWorkspaceId) || str(current?.workspaceId);
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
          label: windowLabel(seconds),
          remainingPercent: Math.round((100 - used) * 10) / 10,
        };
      })
      .filter((window) => window !== null)
      .sort((left, right) => left.seconds - right.seconds);

    const balance = num(preflight?.balanceUsd ?? summary?.balanceUsd);
    const rows = windows.map((window) => ({
      label: window.label,
      value: percentText(window.remainingPercent),
      // The bar is the row's own number: what is left, not what is spent.
      progress: window.remainingPercent / 100,
    }));

    // CodexBar's plugin card draws the two rate windows with its own fixed
    // "Primary"/"Secondary" labels and shows nothing else this plugin could
    // rename, so the two quantities live in a detail section instead: its rows
    // take their label from here, and the section title carries the plan.
    return {
      dataConfidence: "exact",
      details: [
        {
          title: planLabel(coding, summary),
          rows: rows.length > 0
            ? rows
            : [{ label: "钱包余额", value: balance === null ? "—" : ctx.format.usd(balance) }],
        },
      ],
    };
  },
});
