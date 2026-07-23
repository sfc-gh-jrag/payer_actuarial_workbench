-- Conformance contract tables for the Actuarial Workbench accelerator.
-- These three tables are the ONLY customer-specific structured input the accelerator needs.
-- Discovery (Phase 1) populates them as PROPOSED; Review (Phase 2) promotes to APPROVED;
-- Build (Phase 3) binds templates to them to generate the derived actuarial data product.
--
-- Parameterized: replace {{TARGET_DATABASE}}.{{TARGET_SCHEMA}} at deploy time.

CREATE SCHEMA IF NOT EXISTS {{TARGET_DATABASE}}.{{TARGET_SCHEMA}};

-- 1. ELEMENTS — which source column / stage path fills each logical element the accelerator needs.
CREATE TABLE IF NOT EXISTS {{TARGET_DATABASE}}.{{TARGET_SCHEMA}}.ACCELERATOR_CORE_ELEMENTS (
  ELEMENT_ID           STRING       NOT NULL,           -- canonical logical element id (contract-defined)
  ELEMENT_NAME         STRING,                          -- business-readable label
  ELEMENT_TIER         STRING,                          -- STRUCTURED | UNSTRUCTURED
  LOGICAL_OBJECT       STRING,                          -- canonical logical object this element belongs to (see logical_objects.json)
  SOURCE_DATABASE      STRING,
  SOURCE_SCHEMA        STRING,
  SOURCE_OBJECT        STRING,                          -- customer physical table/view
  SOURCE_COLUMN        STRING,                          -- customer physical column
  STAGE_PATH           STRING,                          -- for UNSTRUCTURED elements
  FULLY_QUALIFIED_REF  STRING,
  DATA_TYPE            STRING,
  SOURCE_GRAIN         STRING,
  TRANSFORM_EXPRESSION STRING,                          -- optional SQL expr wrapping the column (cast/derive); {a} = table alias
  TRANSFORM_NOTES      STRING,
  IS_REQUIRED          BOOLEAN,
  MAPPING_STATUS       STRING       DEFAULT 'PROPOSED',  -- PROPOSED | APPROVED
  CREATED_AT           TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
  UPDATED_AT           TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
  CONSTRAINT PK_ACCEL_ELEMENTS PRIMARY KEY (ELEMENT_ID)
);

-- 2. RELATIONSHIPS — canonical, target-agnostic join graph between the source objects.
CREATE TABLE IF NOT EXISTS {{TARGET_DATABASE}}.{{TARGET_SCHEMA}}.ACCELERATOR_CORE_RELATIONSHIPS (
  RELATIONSHIP_ID      STRING       NOT NULL,
  RELATIONSHIP_TYPE    STRING,                          -- TABLE_JOIN | LOOKUP
  REL_KIND             STRING       DEFAULT 'equi',      -- equi | expression | temporal
  LEFT_OBJECT          STRING,
  LEFT_COLUMN          STRING,
  RIGHT_OBJECT         STRING,
  RIGHT_COLUMN         STRING,
  CARDINALITY          STRING,                          -- e.g., MANY_TO_ONE
  JOIN_CONDITION       STRING,                          -- resolved ON clause
  PURPOSE              STRING,
  IS_REQUIRED          BOOLEAN,
  MAPPING_STATUS       STRING       DEFAULT 'PROPOSED',
  CREATED_AT           TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
  UPDATED_AT           TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
  CONSTRAINT PK_ACCEL_RELATIONSHIPS PRIMARY KEY (RELATIONSHIP_ID)
);

-- 3. CODE CROSSWALK — raw coded value -> canonical value, so the derived product is code-agnostic.
CREATE TABLE IF NOT EXISTS {{TARGET_DATABASE}}.{{TARGET_SCHEMA}}.ACCELERATOR_CORE_CODE_CROSSWALK (
  ELEMENT_ID           STRING       NOT NULL,           -- FK to ACCELERATOR_CORE_ELEMENTS
  SOURCE_VALUE         STRING       NOT NULL,           -- raw value in the customer source
  CANONICAL_VALUE      STRING,                          -- accelerator canonical vocabulary
  SEMANTIC_ROLE        STRING,                          -- FLAG | CATEGORY | INCLUDE_FILTER
  NOTES                STRING,
  MAPPING_STATUS       STRING       DEFAULT 'PROPOSED',
  CREATED_AT           TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
  UPDATED_AT           TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
  CONSTRAINT PK_ACCEL_CROSSWALK PRIMARY KEY (ELEMENT_ID, SOURCE_VALUE)
);
