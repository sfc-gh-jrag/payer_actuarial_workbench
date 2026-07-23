---
name: app-deploy
description: "Phase 4 of the Actuarial Workbench deployment. Builds and deploys the bundled Next.js workbench app (Snowflake App Runtime) from assets/app/ on top of the Phase-3 derived data product, points it at the target schema via config, grants the app role read access, and smoke-tests it. Triggers: actuarial workbench app deploy, deploy actuarial app, phase 4 actuarial, stand up the workbench app."
---

# Phase 4 - Build & Deploy the Workbench App

Stand up the bundled workbench app (Next.js on Snowflake App Runtime) over the derived layer from Phase 3, wire it to the target schema from `config.json`, grant read access, and verify. The app is a thin client: it reads/writes the derived objects and calls the `SP_*` procedures (see `app_data_contract.md`) via the Node Snowflake SDK, authenticating with the SPCS service token (owner's rights).

## Preconditions
- Phases 1-3 built + validated (no FAILs); `SV_ACTUARIAL_INTELLIGENCE` and `AGT_ACTUARIAL_WORKBENCH` exist and are populated.
- **Snowflake App Runtime** enabled: an available **compute pool** and a **build external access integration** (`config.build_eai`) for the container `npm ci`/build (account setup, not a plugin defect if missing).
- `snow app` CLI available (`snow app --help` succeeds); `node`/`npm` available for local checks.

## Config keys consumed (config.json)
`app_name`, `app_database`, `app_schema` (where the app object lives), `app_warehouse` (query warehouse), `build_eai`, `code_workspace` (workspace to stage source), `app_role` (fallback grantee; the real grantee is auto-derived in step 5), and `target_database`/`target_schema` (the derived data product the app reads). Optional: `app_compute_pool` (SPCS pool used for both build and service; omit to let App Runtime auto-provision). App branding/target values: `app_valuation_date`, `app_signing_actuary`, `app_signing_actuary_initials`.

**Co-located default (recommended):** set `app_database`/`app_schema` = `target_database`/`target_schema` and `app_warehouse` = `warehouse`, so the app object lands in the derived schema (zero-config, matches the canonical accelerator pattern). A split layout (app in a different schema than the data) also works here because the data FQN is baked into `lib/app_target.ts` at deploy time — use it only when a separate app schema is required (e.g. a QA instance).

## Paths & connection (set once)
- `PLUGIN_DIR`, `CONFIG="$PLUGIN_DIR/config.json"`, `CONN`, `WORKDIR=$(mktemp -d)`.

## Steps
1. **Ensure the app schema exists.** `CREATE SCHEMA IF NOT EXISTS <app_database>.<app_schema>` (via `snow sql -c "$CONN"`). The code workspace (`code_workspace`) is auto-created by `snow app deploy` on first upload.
2. **Stage the app.** Copy the vendored source to the workdir (exclude build artifacts):
   `rsync -a --exclude node_modules --exclude .next "$PLUGIN_DIR/assets/app/" "$WORKDIR/"`
3. **Render the two app templates from config** (cfg-only; no conformance bindings). `snowflake.yml.j2 -> snowflake.yml` (app identifier/database/schema, `query_warehouse`, `build_eai`, `code_workspace`) and `lib/app_target.ts.j2 -> lib/app_target.ts` (SCHEMA = `target_database.target_schema`, valuation, signing actuary). Then delete the `*.j2` from the workdir so they are not uploaded:
   ```bash
   python3 - "$WORKDIR" "$CONFIG" <<'PY'
   import json, sys, jinja2, pathlib
   work, cfgp = pathlib.Path(sys.argv[1]), sys.argv[2]
   cfg = json.load(open(cfgp))
   env = jinja2.Environment(undefined=jinja2.StrictUndefined, keep_trailing_newline=True)
   for tpl, out in [("snowflake.yml.j2","snowflake.yml"), ("lib/app_target.ts.j2","lib/app_target.ts")]:
       (work/out).write_text(env.from_string((work/tpl).read_text()).render(cfg=cfg))
       (work/tpl).unlink()
   print("app templates rendered")
   PY
   ```
4. **Deploy.** From the workdir: `snow app deploy -c "$CONN"`. Three phases run in sequence (upload source to the code workspace -> server-side artifact build -> deploy the Application Service). `app.yml` drives the container (`npm ci` install, `node .next/standalone/server.js` run; `next.config.mjs` uses `output: standalone`). For a single phase use `--upload-only` / `--build-only` / `--promote-only`.
5. **Resolve the owner role (authoritative grantee).** The service queries with **owner's rights** — the role that OWNS the Application Service object, i.e. the role that ran `snow app deploy`, NOT necessarily `config.app_role`. Derive it from the deployed app and bake it into `config.app_role` so the grant render targets the right role:
   ```bash
   APP_NAME=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['app_name'])" "$CONFIG")
   APP_ROLE=$(snow sql -c "$CONN" --query "SHOW APPLICATION SERVICES;" --format json \
     | python3 -c "import json,sys;rows=json.load(sys.stdin);print(next(r for r in rows if r['name']==sys.argv[1])['owner'])" "$APP_NAME")
   python3 -c "import json,sys;c=json.load(open(sys.argv[1]));c['app_role']=sys.argv[2];json.dump(c,open(sys.argv[1],'w'),indent=2)" "$CONFIG" "$APP_ROLE"
   ```
6. **Grant read access.** Render + run `GRANT_APP_ACCESS` (`render.py --only GRANT_APP_ACCESS` then `snow sql -f`): `GRANT USAGE` on the derived DB/schema, `SELECT` on `ALL/FUTURE` views/DTs + the semantic view, and `USAGE` on `ALL/FUTURE` functions/procedures to `config.app_role`. No-op if that role already owns the derived objects.
7. **Smoke test.** `SHOW ENDPOINTS IN SERVICE ...` -> open the URL; confirm the Reserve / Study / Price surfaces load against the live derived layer and the agent rail answers a trace question over `SV_ACTUARIAL_INTELLIGENCE`.

## Validate
- Application Service is `RUNNING`; endpoint reachable.
- `GRANT_APP_ACCESS` ran without privilege errors.
- The app returns non-empty `V_CLAIM_TRIANGLE` / `DT_PMPM_HISTORY` rows for a chosen LOB + constituent, and work-paper create/branch/sign/delete round-trips through the `SP_*` procedures.

## Notes
- **Nothing hardcoded except config.json**: the app's data target lives in `lib/app_target.ts`, rendered from `target_database`/`target_schema`; the committed default keeps local `npm run dev` working. `snowflake.yml` is fully cfg-driven; the compute-pool blocks render only when `app_compute_pool` is set (otherwise App Runtime auto-provisions).
- The vendored `assets/app/` excludes `node_modules`, `.next`, `.git`, and secrets; `package-lock.json` is kept for a reproducible `npm ci`. `snowflake.yml.j2` and `lib/app_target.ts.j2` are both unlinked in step 3 and also listed in `artifacts.ignore` (belt-and-suspenders) so templates are never uploaded.
- **App-facing data contract:** `assets/app/app_data_contract.md` (every surface -> exact view/DT/procedure + columns) ships inside the app bundle.
- **Owner's-rights footgun:** the app has no `executeAsCaller`; every read/write runs as the app-owner role. If a least-privilege customer owns the derived objects with a different role than the deploy role, step 6 grants are required (not a no-op).

## Done
Give the user the app URL and a one-line recap: which LOBs/constituents are populated, the app schema it deployed into, and any Phase-3 WARNs (e.g., pharmacy trend runs hot on synthetic data).
