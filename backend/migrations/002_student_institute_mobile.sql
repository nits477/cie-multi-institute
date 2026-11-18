-- Student login identity: one mobile number per institute, not globally.
-- Run ONLY on the isolated CIE Multi-Institute demo database after confirming a backup.
BEGIN;

DO $$
DECLARE c RECORD;
DECLARE mobile_att smallint;
BEGIN
  SELECT attnum INTO mobile_att
  FROM pg_attribute
  WHERE attrelid='students'::regclass AND attname='mobile' AND NOT attisdropped;

  IF mobile_att IS NULL THEN
    RAISE EXCEPTION 'students.mobile column is missing; migration stopped';
  END IF;

  -- Remove UNIQUE constraints that cover only mobile. Keep composite constraints.
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid='students'::regclass
      AND contype='u'
      AND conkey=ARRAY[mobile_att]::smallint[]
  LOOP
    EXECUTE format('ALTER TABLE students DROP CONSTRAINT %I', c.conname);
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM students
    GROUP BY institute_id,mobile
    HAVING COUNT(*)>1
  ) THEN
    RAISE EXCEPTION 'Duplicate mobile numbers exist inside an institute; resolve duplicates before continuing';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_students_institute_mobile
  ON students(institute_id,mobile);

CREATE INDEX IF NOT EXISTS idx_students_institute_status
  ON students(institute_id,status,created_at DESC);

COMMIT;
