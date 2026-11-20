-- CIE School ERP isolated schema. All objects use school_erp_ prefix.
-- This migration does not alter existing CIE Exam tables.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS school_erp_schools (
  id BIGSERIAL PRIMARY KEY,
  school_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  address TEXT,
  custom_domain TEXT UNIQUE,
  theme TEXT NOT NULL DEFAULT 'blue',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','pending')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS school_erp_users (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT REFERENCES school_erp_schools(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('super_admin','school_admin')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, email)
);
CREATE UNIQUE INDEX IF NOT EXISTS school_erp_one_super_admin_email
  ON school_erp_users(LOWER(email)) WHERE role='super_admin';
CREATE INDEX IF NOT EXISTS school_erp_users_school_idx
  ON school_erp_users(school_id, role, is_active);

CREATE TABLE IF NOT EXISTS school_erp_modules (
  school_id BIGINT NOT NULL REFERENCES school_erp_schools(id) ON DELETE CASCADE,
  module_key TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (school_id, module_key)
);

CREATE TABLE IF NOT EXISTS school_erp_admissions (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES school_erp_schools(id) ON DELETE CASCADE,
  admission_no TEXT,
  student_name TEXT NOT NULL,
  class_name TEXT,
  guardian_name TEXT,
  mobile TEXT,
  email TEXT,
  admission_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive','pending')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS school_erp_admission_no_school_uq
  ON school_erp_admissions(school_id, admission_no) WHERE admission_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS school_erp_admissions_school_date_idx
  ON school_erp_admissions(school_id, created_at DESC);

CREATE TABLE IF NOT EXISTS school_erp_fee_receipts (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES school_erp_schools(id) ON DELETE CASCADE,
  admission_id BIGINT,
  student_name TEXT NOT NULL,
  fee_head TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK(amount > 0),
  payment_mode TEXT NOT NULL CHECK(payment_mode IN ('cash','upi','bank','cheque','other')),
  receipt_no TEXT,
  paid_on DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY(admission_id) REFERENCES school_erp_admissions(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS school_erp_fees_school_date_idx
  ON school_erp_fee_receipts(school_id, paid_on DESC);

CREATE TABLE IF NOT EXISTS school_erp_vouchers (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES school_erp_schools(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  paid_to TEXT,
  amount NUMERIC(12,2) NOT NULL CHECK(amount > 0),
  voucher_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS school_erp_vouchers_school_date_idx
  ON school_erp_vouchers(school_id, voucher_date DESC);

CREATE TABLE IF NOT EXISTS school_erp_daybook (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES school_erp_schools(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  entry_type TEXT NOT NULL CHECK(entry_type IN ('income','expense')),
  amount NUMERIC(12,2) NOT NULL CHECK(amount > 0),
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS school_erp_daybook_school_date_idx
  ON school_erp_daybook(school_id, entry_date DESC);

CREATE TABLE IF NOT EXISTS school_erp_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT REFERENCES school_erp_schools(id) ON DELETE SET NULL,
  actor_user_id BIGINT REFERENCES school_erp_users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id BIGINT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS school_erp_audit_school_date_idx
  ON school_erp_audit_logs(school_id, created_at DESC);
