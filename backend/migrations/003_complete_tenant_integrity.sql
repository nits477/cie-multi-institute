-- 003: Complete tenant ownership for dependent legacy CIE data.
-- Runs only after root server.js has created the legacy tables and the CIE0001 tenant.
-- Fully transactional and re-runnable. Any orphan/cross-tenant relationship aborts.
BEGIN;
DO $$
DECLARE cie_id BIGINT;
DECLARE t TEXT;
DECLARE has_col BOOLEAN;
BEGIN
 SELECT id INTO cie_id FROM institutes WHERE institute_code='CIE0001';
 IF cie_id IS NULL THEN RAISE EXCEPTION 'CIE0001 default institute is missing'; END IF;

 -- Tenant-owned tables that were omitted from the first foundation.
 FOREACH t IN ARRAY ARRAY[
   'question_reports','pin_reset_requests','wallet_transactions','referrals',
   'old_paper_categories','old_papers','old_paper_orders','promotions','student_popups'
 ] LOOP
   IF to_regclass(t) IS NOT NULL THEN
     EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS institute_id BIGINT',t);
   END IF;
 END LOOP;

 -- Derive ownership from the actual student/exam/paper relationship wherever possible.
 IF to_regclass('question_reports') IS NOT NULL THEN
   UPDATE question_reports q SET institute_id=s.institute_id FROM students s
     WHERE q.student_id=s.id;
   UPDATE question_reports q SET institute_id=e.institute_id FROM exams e
     WHERE q.exam_id=e.id;
 END IF;
 IF to_regclass('pin_reset_requests') IS NOT NULL THEN
   UPDATE pin_reset_requests p SET institute_id=s.institute_id FROM students s
     WHERE p.student_id=s.id;
 END IF;
 IF to_regclass('wallet_transactions') IS NOT NULL THEN
   UPDATE wallet_transactions w SET institute_id=s.institute_id FROM students s
     WHERE w.student_id=s.id;
 END IF;
 IF to_regclass('referrals') IS NOT NULL THEN
   UPDATE referrals r SET institute_id=s.institute_id FROM students s
     WHERE r.referrer_id=s.id;
 END IF;
 IF to_regclass('old_papers') IS NOT NULL THEN
   UPDATE old_papers p SET institute_id=c.institute_id FROM old_paper_categories c
     WHERE p.category_id=c.id;
 END IF;
 IF to_regclass('old_paper_orders') IS NOT NULL THEN
   UPDATE old_paper_orders o SET institute_id=p.institute_id FROM old_papers p
     WHERE o.paper_id=p.id;
 END IF;

 -- Core dependent records may have inherited the old default CIE tenant in an earlier run.
 -- Re-derive them from their owning student/paper on every idempotent run.
 UPDATE exam_sessions x SET institute_id=s.institute_id FROM students s WHERE x.student_id=s.id;
 UPDATE results x SET institute_id=s.institute_id FROM students s WHERE x.student_id=s.id;
 -- Remaining historical/global content belongs to the legacy CIE tenant.
 FOREACH t IN ARRAY ARRAY[
   'question_reports','pin_reset_requests','wallet_transactions','referrals',
   'old_paper_categories','old_papers','old_paper_orders','promotions','student_popups'
 ] LOOP
   IF to_regclass(t) IS NOT NULL THEN
     EXECUTE format('UPDATE %I SET institute_id=$1 WHERE institute_id IS NULL',t) USING cie_id;
     EXECUTE format('ALTER TABLE %I ALTER COLUMN institute_id SET NOT NULL',t);
     EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I(institute_id)', 'idx_'||t||'_institute',t);
   END IF;
 END LOOP;

 -- Role is explicit in the database; existing legacy CIE admins remain Master Admins.
 ALTER TABLE admins ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'super_admin';
 UPDATE admins SET role='super_admin' WHERE role IS NULL OR role='';
 ALTER TABLE admins ADD CONSTRAINT admins_role_check CHECK(role IN ('super_admin')) NOT VALID;
 EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Composite keys allow the database to reject cross-institute relationships.
CREATE UNIQUE INDEX IF NOT EXISTS uq_students_id_institute ON students(id,institute_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_exams_id_institute ON exams(id,institute_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_questions_id_institute ON questions(id,institute_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_categories_id_institute ON old_paper_categories(id,institute_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_old_papers_id_institute ON old_papers(id,institute_id);

DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='exam_sessions_student_tenant_fk') THEN
  ALTER TABLE exam_sessions ADD CONSTRAINT exam_sessions_student_tenant_fk FOREIGN KEY(student_id,institute_id) REFERENCES students(id,institute_id) NOT VALID;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='exam_sessions_exam_tenant_fk') THEN
  ALTER TABLE exam_sessions ADD CONSTRAINT exam_sessions_exam_tenant_fk FOREIGN KEY(exam_id,institute_id) REFERENCES exams(id,institute_id) NOT VALID;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='results_student_tenant_fk') THEN
  ALTER TABLE results ADD CONSTRAINT results_student_tenant_fk FOREIGN KEY(student_id,institute_id) REFERENCES students(id,institute_id) NOT VALID;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='results_exam_tenant_fk') THEN
  ALTER TABLE results ADD CONSTRAINT results_exam_tenant_fk FOREIGN KEY(exam_id,institute_id) REFERENCES exams(id,institute_id) NOT VALID;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='question_reports_student_tenant_fk') THEN
  ALTER TABLE question_reports ADD CONSTRAINT question_reports_student_tenant_fk FOREIGN KEY(student_id,institute_id) REFERENCES students(id,institute_id) NOT VALID;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='question_reports_exam_tenant_fk') THEN
  ALTER TABLE question_reports ADD CONSTRAINT question_reports_exam_tenant_fk FOREIGN KEY(exam_id,institute_id) REFERENCES exams(id,institute_id) NOT VALID;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='wallet_transactions_student_tenant_fk') THEN
  ALTER TABLE wallet_transactions ADD CONSTRAINT wallet_transactions_student_tenant_fk FOREIGN KEY(student_id,institute_id) REFERENCES students(id,institute_id) NOT VALID;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='referrals_referrer_tenant_fk') THEN
  ALTER TABLE referrals ADD CONSTRAINT referrals_referrer_tenant_fk FOREIGN KEY(referrer_id,institute_id) REFERENCES students(id,institute_id) NOT VALID;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='referrals_referred_tenant_fk') THEN
  ALTER TABLE referrals ADD CONSTRAINT referrals_referred_tenant_fk FOREIGN KEY(referred_student_id,institute_id) REFERENCES students(id,institute_id) NOT VALID;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='pin_reset_student_tenant_fk') THEN
  ALTER TABLE pin_reset_requests ADD CONSTRAINT pin_reset_student_tenant_fk FOREIGN KEY(student_id,institute_id) REFERENCES students(id,institute_id) NOT VALID;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='old_papers_category_tenant_fk') THEN
  ALTER TABLE old_papers ADD CONSTRAINT old_papers_category_tenant_fk FOREIGN KEY(category_id,institute_id) REFERENCES old_paper_categories(id,institute_id) NOT VALID;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='old_paper_orders_paper_tenant_fk') THEN
  ALTER TABLE old_paper_orders ADD CONSTRAINT old_paper_orders_paper_tenant_fk FOREIGN KEY(paper_id,institute_id) REFERENCES old_papers(id,institute_id) NOT VALID;
 END IF;
END $$;

-- Fail the migration if any legacy rows violate tenant relationships.
ALTER TABLE exam_sessions VALIDATE CONSTRAINT exam_sessions_student_tenant_fk;
ALTER TABLE exam_sessions VALIDATE CONSTRAINT exam_sessions_exam_tenant_fk;
ALTER TABLE results VALIDATE CONSTRAINT results_student_tenant_fk;
ALTER TABLE results VALIDATE CONSTRAINT results_exam_tenant_fk;
ALTER TABLE question_reports VALIDATE CONSTRAINT question_reports_student_tenant_fk;
ALTER TABLE question_reports VALIDATE CONSTRAINT question_reports_exam_tenant_fk;
ALTER TABLE wallet_transactions VALIDATE CONSTRAINT wallet_transactions_student_tenant_fk;
ALTER TABLE referrals VALIDATE CONSTRAINT referrals_referrer_tenant_fk;
ALTER TABLE referrals VALIDATE CONSTRAINT referrals_referred_tenant_fk;
ALTER TABLE pin_reset_requests VALIDATE CONSTRAINT pin_reset_student_tenant_fk;
ALTER TABLE old_papers VALIDATE CONSTRAINT old_papers_category_tenant_fk;
ALTER TABLE old_paper_orders VALIDATE CONSTRAINT old_paper_orders_paper_tenant_fk;
COMMIT;
