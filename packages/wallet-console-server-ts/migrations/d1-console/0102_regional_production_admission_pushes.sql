-- The last production admission that every regional runtime of a lane accepted.
-- The Console pushes a new decision when the Free plan state changes.
CREATE TABLE regional_production_admission_pushes (
  deployment_lane TEXT PRIMARY KEY,
  new_work TEXT NOT NULL CHECK (new_work IN ('open', 'paused')),
  revision INTEGER NOT NULL CHECK (revision > 0),
  pushed_at_ms INTEGER NOT NULL CHECK (pushed_at_ms > 0)
);
