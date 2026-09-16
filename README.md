# Corelight Azure Deployer

A **local, one-button web app** for Corelight SEs to deploy a Fleet Manager + N Software
Sensors into Azure. Runs entirely on your machine (bound to `127.0.0.1`), inherits your
`az login` session, and streams live progress in the browser.

> **Status: M4 (end-to-end, deploy-Fleet path).** One button provisions the infra (new VNet,
> subnet, NSG, Fleet VM + N sensor VMs), brings up the Fleet Manager (install → PEM → start →
> admin), then for each sensor mints a pairing token, installs `corelight-sensor`, writes
> `corelightctl.yaml`, and deploys + pairs it — all streamed live. Pairing sensors to an
> **existing** Fleet (deploy-Fleet unchecked) is still M5.

## Prerequisites (any OS — Windows, macOS, Linux)
- **Node.js** LTS (18+)
- **Terraform** on your `PATH`
- **Azure CLI**, already logged in: `az login`
- **`ssh-keygen`** on your `PATH` (ships with OpenSSH on macOS, Linux, and Windows 10+) — the
  app generates a fresh per-run keypair for the VMs

## Setup & run
```bash
npm run setup     # installs root + server + web deps
npm run dev       # dev mode: Vite UI (5173) + backend (8787), hot reload
# or
npm start         # builds the UI, serves it from the backend, opens the browser
```
Dev mode: open http://127.0.0.1:5173  ·  `npm start`: open http://127.0.0.1:8787

## What it does today (M2)
- **Preflight**: verifies `az login`, Terraform, and detects your public IP (used to scope the
  NSG SSH/UI rules). Prefills the subscription ID from your Azure session.
- **Deploy form**: subscription, region (dropdown), VM size (dropdown), sensor count,
  "Deploy Fleet" toggle, repo tokens, PEM/license uploads, community string.
- **Preview**: runs `terraform plan` and streams it — safe, creates nothing.
- **Deploy**: creates a per-run workspace under `runs/<id>/`, generates an SSH keypair, renders
  tfvars from the form, and runs `terraform init` + `apply -auto-approve`, streaming output live.
  On success a results card shows the Fleet UI URL, the sensor list, and ready-to-copy SSH commands.

## Tearing down
Each deployment lands in its own resource group named `cqd-<runid>-rg`. To remove everything, delete
that resource group (Azure Portal or `az group delete -n cqd-<runid>-rg`), or run
`terraform destroy` inside the run's workspace at `runs/<id>/tf/`.

## Design (see also the plan in project memory)
- **Frontend**: React + Vite. **Backend**: Node/Express, localhost-only, SSE for progress.
- **Azure auth**: reuses `az login` — only the subscription ID is requested.
- **Terraform module** (`terraform/`): new resource group, VNet (`10.50.0.0/16`), subnet, NSG
  (SSH/UI scoped to your public IP; sensor↔Fleet 1443 rides the default intra-VNet rule), an
  optional Fleet VM, and N sensor VMs (each with an eth0 management NIC + eth1 monitoring NIC),
  all AlmaLinux 9 / DHCP.
- **Cross-platform**: SSH/SCP via the `ssh2` Node lib (M3+), secret cleanup via Node `fs`
  overwrite, `path` for all paths — no reliance on Unix shell tools locally. Target VMs are
  AlmaLinux, so remote commands are consistent regardless of your OS.
- **Secrets**: tokens/PEM/license stay local, written to a gitignored per-run `runs/`
  workspace. Nothing is baked into the repo — each SE brings their own credentials.

## Roadmap
- **M1** ✅ scaffold + preflight + UI shell + live-log channel
- **M2** ✅ Terraform module (new VNet + optional Fleet + N sensors) driven from the form, per-run
  workspace, live `terraform` streaming, results card
- **M3** ✅ Fleet bring-up: install → PEM → start → create admin
- **M4** ✅ per-sensor token minting + pairing + verify → **end-to-end one button** (deploy-Fleet path)
- **M5** existing-Fleet path (operator-supplied Fleet address + creds) + polish

*Teardown is intentionally SE-managed (delete the `cqd-<runid>-rg` resource group) — there is no Destroy button.*
