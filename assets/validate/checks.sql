-- Phase 3 post-build validation for the Actuarial Workbench accelerator.
-- STRUCTURAL PASS/FAIL over the deployed derived objects (+ WARN for soft signals).
-- FAIL-if-empty applies only to REQUIRED-backed objects; optional-backed content WARNs.
-- Refresh-mode checks confirm the facts are INCREMENTAL and RAF is FULL (by design).
-- Parameterized: replace {{TARGET_DATABASE}}.{{TARGET_SCHEMA}} at run time.

WITH c AS (
  SELECT
    (SELECT COUNT(*) FROM {{TARGET_DATABASE}}.{{TARGET_SCHEMA}}.DT_MEMBER_MONTHS)     AS mm,
    (SELECT COUNT(*) FROM {{TARGET_DATABASE}}.{{TARGET_SCHEMA}}.DT_PAID_FACT)         AS fact,
    (SELECT COUNT(*) FROM {{TARGET_DATABASE}}.{{TARGET_SCHEMA}}.DT_PMPM_HISTORY)      AS pmpm,
    (SELECT COUNT(*) FROM {{TARGET_DATABASE}}.{{TARGET_SCHEMA}}.V_CLAIM_TRIANGLE)     AS tri,
    (SELECT COUNT(*) FROM {{TARGET_DATABASE}}.{{TARGET_SCHEMA}}.V_IBNR_COMPLETION)    AS ibnr,
    (SELECT COUNT(*) FROM {{TARGET_DATABASE}}.{{TARGET_SCHEMA}}.DT_MEMBER_RISK_SCORE) AS raf
),
modes AS (
  SELECT name, refresh_mode
  FROM {{TARGET_DATABASE}}.INFORMATION_SCHEMA.DYNAMIC_TABLES
  WHERE schema_name = '{{TARGET_SCHEMA}}'
)
-- Required-backed objects: FAIL if empty
SELECT 'DT_MEMBER_MONTHS_NONEMPTY' AS CHECK_NAME, IFF(mm   > 0,'PASS','FAIL') AS STATUS, 'rows='||mm   AS DETAIL FROM c
UNION ALL SELECT 'DT_PAID_FACT_NONEMPTY',   IFF(fact > 0,'PASS','FAIL'), 'rows='||fact FROM c
UNION ALL SELECT 'DT_PMPM_HISTORY_NONEMPTY',IFF(pmpm > 0,'PASS','FAIL'), 'rows='||pmpm FROM c
UNION ALL SELECT 'V_CLAIM_TRIANGLE_NONEMPTY',IFF(tri > 0,'PASS','FAIL'), 'rows='||tri  FROM c
UNION ALL SELECT 'V_IBNR_COMPLETION_NONEMPTY',IFF(ibnr> 0,'PASS','FAIL'), 'rows='||ibnr FROM c
-- Refresh-mode intent
UNION ALL SELECT 'DT_PAID_FACT_INCREMENTAL',
  IFF((SELECT refresh_mode FROM modes WHERE name='DT_PAID_FACT') = 'INCREMENTAL','PASS','WARN'),
  'refresh_mode='||COALESCE((SELECT refresh_mode FROM modes WHERE name='DT_PAID_FACT'),'?')||' (want INCREMENTAL)' FROM c
UNION ALL SELECT 'DT_PMPM_HISTORY_INCREMENTAL',
  IFF((SELECT refresh_mode FROM modes WHERE name='DT_PMPM_HISTORY') = 'INCREMENTAL','PASS','WARN'),
  'refresh_mode='||COALESCE((SELECT refresh_mode FROM modes WHERE name='DT_PMPM_HISTORY'),'?') FROM c
UNION ALL SELECT 'DT_MEMBER_RISK_SCORE_FULL',
  IFF((SELECT refresh_mode FROM modes WHERE name='DT_MEMBER_RISK_SCORE') = 'FULL','PASS','FAIL'),
  'refresh_mode='||COALESCE((SELECT refresh_mode FROM modes WHERE name='DT_MEMBER_RISK_SCORE'),'?')||' (must be FULL)' FROM c
-- Optional-backed: WARN if empty
UNION ALL SELECT 'DT_MEMBER_RISK_SCORE_POPULATED', IFF(raf > 0,'PASS','WARN'), 'rows='||raf||' (optional: MEMBER_ENROLLMENT / cost experience)' FROM c
ORDER BY DECODE(STATUS,'FAIL',0,'WARN',1,'PASS',2), CHECK_NAME;
