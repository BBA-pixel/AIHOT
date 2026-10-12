-- One-shot: move industry-tagged version/season/DLC pieces into category `updates`.
-- Safe to re-run. Does NOT re-run structure LLM — only tag-based remap for already-stored rows.
-- Forward-looking taxonomy already routes new analyses via industry/taxonomy.ts guides.
--
-- Usage (on a throwaway or production DB you intend to change):
--   psql "$DATABASE_URL" -f scripts/reclassify-updates-category.sql

BEGIN;

-- Publications (what the website filters on)
UPDATE publications
SET category = 'updates'
WHERE category = 'industry'
  AND tags && ARRAY['版本更新', '赛季/活动', 'DLC/资料片']::text[];

-- Analyses (latest structure output kept for audits / re-publish)
UPDATE analyses a
SET category = 'updates'
WHERE category = 'industry'
  AND tags && ARRAY['版本更新', '赛季/活动', 'DLC/资料片']::text[];

COMMIT;
