-- Add accept/pending flow to connections
ALTER TABLE connections ADD COLUMN IF NOT EXISTS accepted SMALLINT NOT NULL DEFAULT 0;
-- Treat all existing rows as accepted (legacy auto-accept)
UPDATE connections SET accepted = 1 WHERE accepted = 0;
CREATE INDEX IF NOT EXISTS connections_pending_idx ON connections (user_b, accepted);
