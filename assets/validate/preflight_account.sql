-- Advisory account-capability preflight for the Actuarial Workbench accelerator.
-- Run once against a NEW target account (via `snow sql -c <conn>`) before Phase 1.
-- BEST-EFFORT: SQL cannot verify everything (external access integrations, the
-- region's full Cortex model list, App Runtime enablement). Treat failures as WARN
-- and confirm the rest against the README "Per-account prerequisites" checklist.
-- Run statements one at a time; nothing here changes state.

-- 1. Session context (INFO).
SELECT CURRENT_ACCOUNT() AS ACCOUNT, CURRENT_REGION() AS REGION,
       CURRENT_ROLE() AS ROLE, CURRENT_WAREHOUSE() AS WAREHOUSE;

-- 2. A warehouse is set (needed for dynamic-table refresh + app queries).
SELECT IFF(CURRENT_WAREHOUSE() IS NOT NULL, 'PASS', 'WARN') AS WAREHOUSE_SET,
       COALESCE(CURRENT_WAREHOUSE(), 'no active warehouse') AS DETAIL;

-- 3. Cortex generation smoke (optional narrative insights use AI_COMPLETE).
--    If THIS errors, set "insight_format_model" in config.json to an available model.
SELECT IFF(LENGTH(SNOWFLAKE.CORTEX.COMPLETE('claude-opus-4-8', 'ok')) >= 0, 'PASS', 'PASS') AS CORTEX_COMPLETE_OK;

-- 4. Compute pools (Phase 4 App Runtime runs on SPCS). Empty result => App Runtime
--    may not be enabled for this account/role.
SHOW COMPUTE POOLS;

-- NOT checkable in SQL (confirm via README): external access integration for the app
-- build, `snow app` CLI version, and the full region Cortex model list.
