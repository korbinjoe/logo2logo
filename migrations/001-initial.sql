CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,credits INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS identities(provider TEXT,subject TEXT,user_id TEXT REFERENCES users(id),PRIMARY KEY(provider,subject));
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),expires INTEGER);
    CREATE TABLE IF NOT EXISTS oauth(state TEXT PRIMARY KEY,browser TEXT,provider TEXT,verifier TEXT,expires INTEGER);
    CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),plan TEXT,amount INTEGER,credits INTEGER,currency TEXT,session TEXT UNIQUE,paid INTEGER DEFAULT 0,refunded INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS refunds(id TEXT PRIMARY KEY,session TEXT,amount INTEGER);
    CREATE TABLE IF NOT EXISTS ledger(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),delta INTEGER,reason TEXT,created INTEGER);
    CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),status TEXT,output TEXT UNIQUE,created INTEGER);
    CREATE TABLE IF NOT EXISTS rate_limits(user_id TEXT,bucket INTEGER,count INTEGER,PRIMARY KEY(user_id,bucket));
CREATE INDEX IF NOT EXISTS jobs_user_history ON jobs(user_id,status,created DESC,id DESC);
CREATE TABLE IF NOT EXISTS cloud_jobs(
  id TEXT PRIMARY KEY REFERENCES jobs(id), fingerprint TEXT NOT NULL,
  input TEXT NOT NULL, endpoint TEXT NOT NULL, request_id TEXT,
  lease TEXT, lease_until INTEGER NOT NULL DEFAULT 0, error TEXT,
  metadata TEXT, callback_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS planning_sessions(
  id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, data TEXT NOT NULL,
  expires INTEGER NOT NULL, lease TEXT, lease_until INTEGER NOT NULL DEFAULT 0
);
