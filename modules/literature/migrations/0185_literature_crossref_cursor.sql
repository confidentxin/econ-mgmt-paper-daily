-- The literature module's Crossref cursor: the last deposit day (inclusive) its collection read. The
-- collection reads again a few days behind it, so the cursor is all a restart needs.
CREATE TABLE literature_cursors (
  name text PRIMARY KEY,
  created_through date NOT NULL,
  runs integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
