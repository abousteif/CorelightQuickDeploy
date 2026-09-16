// In-app Azure authentication (P3 zero-prereq) — replaces the `az login` dependency.
//
// Flow:
//   1. startDeviceLogin() → begins a device-code sign-in and returns the code + URL to show
//      the operator. Token acquisition runs in the background and blocks until they finish.
//   2. getLoginStatus() / listSubscriptions() → the UI polls until authenticated, then lists
//      the subscriptions the signed-in user can see so they can pick one.
//   3. provisionServicePrincipal() → at deploy time, creates a short-lived service principal
//      scoped (Contributor) to the chosen subscription and returns ARM_* credentials. Terraform
//      can't consume a user's browser token, but it CAN use a service principal — so we mint one.
//
// Graph + ARM are called with plain fetch using tokens from @azure/identity (no heavy SDKs).
import { DeviceCodeCredential, ClientSecretCredential } from "@azure/identity";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";

const ARM = "https://management.azure.com";
const ARM_SCOPE = `${ARM}/.default`;
const GRAPH = "https://graph.microsoft.com/v1.0";
const GRAPH_SCOPE = "https://graph.microsoft.com/.default";
// Azure CLI's well-known public client id: pre-consented for ARM + Graph delegated perms and
// supports device-code flow. Piggybacking on it avoids registering our own app up front.
const AZ_CLI_CLIENT_ID = "04b07795-8ddb-461a-bbee-02f9e1bf7b46";
// Built-in "Contributor" role — enough to create the RG, network, and VMs.
const CONTRIBUTOR_ROLE_ID = "b24988ac-6180-42a0-ab88-46d3f6a3f11a";

const sessions = new Map(); // sessionId -> session

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function decodeJwt(token) {
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
  } catch {
    return {};
  }
}

function requireAuthed(sessionId) {
  const s = sessions.get(sessionId);
  if (!s) throw new Error("Azure session not found (sign in again).");
  if (s.status !== "authenticated" || !s.credential) throw new Error("Azure sign-in not complete.");
  return s;
}

// Start a device-code sign-in. Returns { sessionId, userCode, verificationUri, message, expiresOn }.
export async function startDeviceLogin({ tenantId } = {}) {
  const id = randomUUID();
  const session = {
    id, status: "pending", createdAt: Date.now(),
    deviceInfo: null, credential: null, subscriptions: null,
    user: null, tenantId: null, error: null,
  };
  sessions.set(id, session);

  const credential = new DeviceCodeCredential({
    tenantId: tenantId || process.env.AZURE_TENANT_ID || "organizations",
    clientId: process.env.AZURE_CLIENT_ID || AZ_CLI_CLIENT_ID,
    userPromptCallback: (info) => {
      session.deviceInfo = {
        userCode: info.userCode, verificationUri: info.verificationUri,
        message: info.message, expiresOn: info.expiresOn,
      };
    },
  });

  // getToken blocks until the operator completes the browser step; run it in the background.
  (async () => {
    try {
      const token = await credential.getToken(ARM_SCOPE);
      const claims = decodeJwt(token?.token || "");
      session.credential = credential;
      session.user = claims.upn || claims.preferred_username || claims.unique_name || null;
      session.tenantId = claims.tid || null;
      session.status = "authenticated";
    } catch (e) {
      session.status = "error";
      session.error = String(e?.message || e);
    }
  })();

  // Wait briefly for the SDK to hand us the device code (or fail fast).
  for (let i = 0; i < 100 && !session.deviceInfo && session.status === "pending"; i++) await sleep(100);
  if (session.error) throw new Error(session.error);
  if (!session.deviceInfo) throw new Error("Timed out obtaining a device code from Azure.");
  return { sessionId: id, ...session.deviceInfo };
}

export function getLoginStatus(sessionId) {
  const s = sessions.get(sessionId);
  if (!s) return { status: "unknown" };
  return { status: s.status, user: s.user, tenantId: s.tenantId, error: s.error, hasSubscriptions: !!s.subscriptions };
}

// List subscriptions the signed-in user can access.
export async function listSubscriptions(sessionId) {
  const s = requireAuthed(sessionId);
  const token = (await s.credential.getToken(ARM_SCOPE)).token;
  const r = await fetch(`${ARM}/subscriptions?api-version=2020-01-01`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Listing subscriptions failed: HTTP ${r.status} ${await r.text()}`);
  const j = await r.json();
  s.subscriptions = (j.value || [])
    .filter((x) => x.state === "Enabled")
    .map((x) => ({ subscriptionId: x.subscriptionId, displayName: x.displayName, tenantId: x.tenantId }));
  return s.subscriptions;
}

// List the resource groups the operator can see in a subscription, so they can pick an
// EXISTING one to deploy into (needed when they only have Contributor on a specific RG, not
// the whole subscription — creating a new RG would 403). Works for both auth paths: if an
// in-app sign-in session is present we use its ARM token; otherwise we fall back to the
// operator's `az login` session via the CLI (the same session Terraform's fallback uses).
export async function listResourceGroups({ sessionId, subscriptionId } = {}) {
  if (!subscriptionId) throw new Error("subscriptionId is required to list resource groups.");
  const s = sessionId ? sessions.get(sessionId) : null;
  if (s?.status === "authenticated" && s.credential) {
    const token = (await s.credential.getToken(ARM_SCOPE)).token;
    const r = await fetch(`${ARM}/subscriptions/${subscriptionId}/resourcegroups?api-version=2021-04-01`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) throw new Error(`Listing resource groups failed: HTTP ${r.status} ${await r.text()}`);
    const j = await r.json();
    return (j.value || []).map((x) => ({ name: x.name, location: x.location })).sort((a, b) => a.name.localeCompare(b.name));
  }
  // No sign-in session → use the Azure CLI session.
  return listResourceGroupsViaCli(subscriptionId);
}

function listResourceGroupsViaCli(subscriptionId) {
  return new Promise((resolve, reject) => {
    execFile("az", ["group", "list", "--subscription", subscriptionId, "-o", "json"],
      { windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          return reject(new Error("Couldn't list resource groups via the Azure CLI. Sign in with your browser above, or run `az login` and retry."));
        }
        try {
          const arr = JSON.parse(stdout || "[]");
          resolve(arr.map((x) => ({ name: x.name, location: x.location })).sort((a, b) => a.name.localeCompare(b.name)));
        } catch (e) {
          reject(new Error(`Couldn't parse resource groups: ${e?.message || e}`));
        }
      });
  });
}

async function graph(session, method, path, body) {
  const token = (await session.credential.getToken(GRAPH_SCOPE)).token;
  const r = await fetch(`${GRAPH}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) {
    let msg = text;
    try { msg = JSON.parse(text)?.error?.message || text; } catch {}
    throw new Error(`Graph ${method} ${path} → HTTP ${r.status}: ${msg}`);
  }
  return text ? JSON.parse(text) : {};
}

// Wait until Contributor role can be PUT for the freshly-created SP (AAD replication lag).
async function assignContributor(session, subscriptionId, principalId, log) {
  const token = (await session.credential.getToken(ARM_SCOPE)).token;
  const guid = randomUUID();
  const url = `${ARM}/subscriptions/${subscriptionId}/providers/Microsoft.Authorization/roleAssignments/${guid}?api-version=2022-04-01`;
  const body = {
    properties: {
      roleDefinitionId: `/subscriptions/${subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/${CONTRIBUTOR_ROLE_ID}`,
      principalId,
      principalType: "ServicePrincipal",
    },
  };
  const deadline = Date.now() + 120000; // up to 2 min for the principal to propagate
  let attempt = 0;
  while (true) {
    attempt++;
    const r = await fetch(url, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.ok) return;
    const text = await r.text();
    if (/RoleAssignmentExists/i.test(text)) return; // already there
    const retryable = /PrincipalNotFound|does not exist in the directory/i.test(text) || r.status === 404;
    if (!retryable || Date.now() > deadline) {
      throw new Error(`Role assignment failed: HTTP ${r.status}: ${text}`);
    }
    log?.(`Waiting for the service principal to propagate (attempt ${attempt})…`);
    await sleep(5000);
  }
}

// Confirm the SP credentials actually work before handing them to Terraform (AAD lag).
async function waitForSpToken(tenantId, clientId, clientSecret, log) {
  const cred = new ClientSecretCredential(tenantId, clientId, clientSecret);
  const deadline = Date.now() + 120000;
  let attempt = 0;
  while (true) {
    attempt++;
    try {
      await cred.getToken(ARM_SCOPE);
      return;
    } catch (e) {
      if (Date.now() > deadline) throw new Error(`Service principal credentials never became usable: ${e?.message || e}`);
      log?.(`Waiting for the new credentials to activate (attempt ${attempt})…`);
      await sleep(5000);
    }
  }
}

// Create a short-lived service principal scoped (Contributor) to the subscription.
// Returns { clientId, clientSecret, tenantId, subscriptionId, appObjectId, spObjectId, displayName }.
export async function provisionServicePrincipal(sessionId, subscriptionId, { displayName, log } = {}) {
  const s = requireAuthed(sessionId);
  const name = displayName || `cqd-${Date.now().toString(36)}`;
  // Tenant for the SP creds = the subscription's tenant (fall back to the user's home tenant).
  const subTenant = s.subscriptions?.find((x) => x.subscriptionId === subscriptionId)?.tenantId;
  const tenantId = subTenant || s.tenantId;
  if (!tenantId) throw new Error("Could not determine the tenant for this subscription.");

  log?.(`Creating a service principal '${name}' for Terraform…`);
  const app = await graph(s, "POST", "/applications", { displayName: name, signInAudience: "AzureADMyOrg" });
  const appObjectId = app.id;
  const clientId = app.appId;

  const endDateTime = new Date(Date.now() + 24 * 3600 * 1000).toISOString(); // 24h secret
  const pw = await graph(s, "POST", `/applications/${appObjectId}/addPassword`, {
    passwordCredential: { displayName: "cqd-terraform", endDateTime },
  });
  const clientSecret = pw.secretText;

  const sp = await graph(s, "POST", "/servicePrincipals", { appId: clientId });
  const spObjectId = sp.id;

  log?.("Granting Contributor on the subscription…");
  await assignContributor(s, subscriptionId, spObjectId, log);
  await waitForSpToken(tenantId, clientId, clientSecret, log);
  log?.("Service principal ready.");

  return { clientId, clientSecret, tenantId, subscriptionId, appObjectId, spObjectId, displayName: name };
}

// Best-effort cleanup: delete the app registration (removes the SP too). Never throws.
export async function deleteApplication(sessionId, appObjectId) {
  try {
    const s = sessions.get(sessionId);
    if (!s?.credential || !appObjectId) return false;
    await graph(s, "DELETE", `/applications/${appObjectId}`);
    return true;
  } catch {
    return false;
  }
}
