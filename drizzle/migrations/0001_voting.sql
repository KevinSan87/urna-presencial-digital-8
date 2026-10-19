CREATE TABLE IF NOT EXISTS voting_config (
  id INT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  logo TEXT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'open',
  sheets_url TEXT NOT NULL,
  sheets_id VARCHAR(255) NOT NULL,
  sheets_tab VARCHAR(255) NOT NULL,
  sheets_baseline INT NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS voting_groups (
  id VARCHAR(32) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  logo TEXT NULL,
  description TEXT NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS voting_votes (
  id VARCHAR(64) PRIMARY KEY,
  group_id VARCHAR(32) NOT NULL,
  created_at DATETIME NOT NULL,
  request_id VARCHAR(64) NULL UNIQUE,
  synced TINYINT(1) NOT NULL DEFAULT 1,
  INDEX voting_votes_group_idx (group_id),
  INDEX voting_votes_created_idx (created_at)
);
