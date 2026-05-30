PRAGMA foreign_keys = ON;

ALTER TABLE elements ADD COLUMN bypass_noise_gate INTEGER NOT NULL DEFAULT 0;
