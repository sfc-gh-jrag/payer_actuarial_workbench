-- Phase 2 readiness gate for the Actuarial Workbench accelerator.
-- STRUCTURAL, self-contained PASS/FAIL over the 3 conformance tables. No customer
-- data values are hard-coded. Run before Phase 3 (derived-build). Every row:
--   CHECK_NAME | STATUS ('PASS' | 'FAIL') | DETAIL
-- Deterministic because Phase 1 SEEDS one row per REQUIRED contract element/relationship.
-- Parameterized: replace {{TARGET_DATABASE}}.{{TARGET_SCHEMA}} at run time.

WITH
elem AS (SELECT * FROM {{TARGET_DATABASE}}.{{TARGET_SCHEMA}}.ACCELERATOR_CORE_ELEMENTS),
rel  AS (SELECT * FROM {{TARGET_DATABASE}}.{{TARGET_SCHEMA}}.ACCELERATOR_CORE_RELATIONSHIPS),
xw   AS (SELECT * FROM {{TARGET_DATABASE}}.{{TARGET_SCHEMA}}.ACCELERATOR_CORE_CODE_CROSSWALK),

req_elem_unmet AS (
  SELECT ELEMENT_ID FROM elem
  WHERE IS_REQUIRED = TRUE
    AND ( MAPPING_STATUS <> 'APPROVED'
          OR ( (SOURCE_OBJECT IS NULL OR SOURCE_COLUMN IS NULL)
               AND (STAGE_PATH IS NULL OR TRIM(STAGE_PATH) = '') ) )
),
req_rel_unmet AS (
  SELECT RELATIONSHIP_ID FROM rel
  WHERE IS_REQUIRED = TRUE
    AND ( MAPPING_STATUS <> 'APPROVED'
          OR LEFT_COLUMN IS NULL OR RIGHT_COLUMN IS NULL
          OR LEFT_OBJECT IS NULL OR RIGHT_OBJECT IS NULL )
),
xw_gap AS (
  SELECT ELEMENT_ID, SOURCE_VALUE FROM xw
  WHERE MAPPING_STATUS = 'APPROVED'
    AND (CANONICAL_VALUE IS NULL OR TRIM(CANONICAL_VALUE) = '')
)

SELECT 'REQUIRED_ELEMENTS_MAPPED' AS CHECK_NAME,
       IFF(COUNT(*) = 0, 'PASS', 'FAIL') AS STATUS,
       IFF(COUNT(*) = 0, 'All required elements approved and bound',
           COUNT(*) || ' required element(s) unmapped/un-approved: ' || LISTAGG(ELEMENT_ID, ', ')) AS DETAIL
FROM req_elem_unmet
UNION ALL
SELECT 'REQUIRED_RELATIONSHIPS_MAPPED',
       IFF(COUNT(*) = 0, 'PASS', 'FAIL'),
       IFF(COUNT(*) = 0, 'All required relationships approved with both endpoints',
           COUNT(*) || ' required relationship(s) incomplete: ' || LISTAGG(RELATIONSHIP_ID, ', '))
FROM req_rel_unmet
UNION ALL
SELECT 'CROSSWALK_CANONICAL_COVERAGE',
       IFF(COUNT(*) = 0, 'PASS', 'FAIL'),
       IFF(COUNT(*) = 0, 'Every approved crosswalk row has a canonical value',
           COUNT(*) || ' approved crosswalk row(s) missing CANONICAL_VALUE')
FROM xw_gap
ORDER BY STATUS DESC, CHECK_NAME;
