# Corelight Azure Deployer

A **local, one-button web app** for Corelight SEs to deploy a Fleet Manager + N Software
Sensors into Azure. Runs entirely on your machine (bound to `127.0.0.1`), inherits your
`az login` session, and streams live progress in the browser.

> **Status: M1 (scaffold).** The UI, preflight checks, and live-log streaming work.
> Actual provisioning (Terraform + Fleet/sensor orchestration) lands in M2–M4.

## Prerequisites (any OS — Windows, macOS, Linux)
- **Node.js** LTS (18+)
- **Terraform** on your `PATH`
- **Azure CLI**, already logged in: `az login`
- An SSH keypair (used later to reach the VMs)

## Setup & run
```bash
npm run setup     # installs root + server + web deps
npm run dev       # dev mode: Vite UI (5173) + backend (8787), hot reload
# or
npm start         # builds the UI, serves it from the backend, opens the browser
```
Dev mode: open http://127.0.0.1:5173  ·  `npm start`: open http://127.0.0.1:8787

## What M1 does
- **Preflight**: verifies `az login`, Terraform, and detects your public IP (used later to
  scope NSG SSH/UI rules). Prefills the subscription ID from your Azure session.
- **Deploy form**: subscription, region (dropdown), VM size (dropdown), sensor count,
  "Deploy Fleet" toggle, repo tokens, PEM/license uploads, community string.
- **Live log**: the Deploy button opens an SSE stream and renders a demo run — proving the
  end-to-end pipe the real orchestrator will use.

## Design (see also the plan in project memory)
- **Frontend**: React + Vite. **Backend**: Node/Express, localhost-only, SSE for progress.
- **Azure auth**: reuses `az login` — only the subscription ID is requested.
- **Cross-platform**: SSH/SCP via the `ssh2` Node lib (M2+), secret cleanup via Node `fs`
  overwrite, `path` for all paths — no reliance on Unix shell tools locally. Target VMs are
  AlmaLinux, so remote commands are consistent regardless of your OS.
- **Secrets**: tokens/PEM/license stay local, written to a gitignored per-run `runs/`
  workspace and shredded after the run. Nothing is baked into the repo — each SE brings
  their own credentials.

## Roadmap
- **M1** ✅ scaffold + preflight + UI shell + live-log channel
- **M2** Terraform module (new VNet + Fleet + N sensors) driven from the form; Destroy
- **M3** Fleet bring-up: install → PEM → start → create admin
- **M4** per-sensor token minting + pairing + verify → **end-to-end one button**
- **M5** existing-Fleet path + polish
