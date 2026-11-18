# CIE Multi-Institute — Integration & Security Audit
Date: 2026-11-18
Branch reviewed: work/multi-institute-tenant

## Decision
Do not deploy this branch yet. Do not run migrations against any database yet. The production CIE service and production database must remain untouched.

## Verified blocking findings

1. The repository start command is `node server.js`. It does not start `backend/server.js`.
   - Therefore the separate JWT-based multi-institute API under `backend/` is not the service currently launched by the Render start command.
   - The root `server.js` remains the active application entry point.

2. There are two incompatible application/database models in the same branch.
   - Root application: legacy CIE schema uses student columns such as `name`, `father_name`, `pin_hash`, and a legacy `admins` table.
   - `backend/server.js`: separate schema expects columns such as `full_name`, `password_hash`, `status`, `super_admins`, `courses`, and a different admin model.
   - The new student endpoints in `backend/server.js` cannot be assumed to work against the root application's schema.

3. The root application has only a partial tenant migration.
   - Students, exams, questions, results, and exam_sessions receive `institute_id`.
   - The migration shown in `initDb()` does not yet add and backfill tenant ownership for every dependent table, including question_reports, pin_reset_requests, referrals, wallet_transactions, and old-paper orders where institute separation may be required.
   - Every read/write route must be reviewed; adding columns alone does not enforce tenant isolation.

4. The standalone backend has dependency and contract risks.
   - Its source imports `dotenv`, `helmet`, and `jsonwebtoken`, which are not listed in the root `package.json`.
   - Its student API uses a four-digit PIN but stores it in `password_hash`; the root app uses `pin_hash`. This is another sign that the two backends are not yet integrated.
   - Application approval and login use different institute status conventions in different parts of the repository (`active` versus `approved`). These must be standardized before integration.

5. Existing student authentication must be checked end-to-end.
   - Root `verifyStudent(mobile,pin,instituteCode)` now requires a code, but all callers and browser/app clients must send it consistently.
   - Existing result, exam-session, PIN reset, referral, and wallet flows must retain the correct institute context.
   - A successful login alone is not sufficient proof of tenant isolation.

## Safe next implementation sequence

1. Keep the root `server.js` as the single application entry point to preserve the complete CIE website and existing features.
2. Integrate Master Admin and Institute Admin routes into that same server and reuse one consistent schema.
3. Add tenant ownership/backfill for all dependent records, with explicit handling for legacy CIE data.
4. Add tenant-scoped admin CRUD for students, courses, subjects, exams, questions, results, reports, PIN reset, referrals, and wallet.
5. Update every student client flow to send Institute Code and retain institute identity in the session.
6. Add automated tests proving that Institute A cannot read or modify Institute B's records, plus legacy CIE regression tests.
7. Only after local/static checks and isolated-demo database backup, apply migrations to the demo DB and deploy the demo service.

## Explicit safety boundary
Never change the production Render service `cie-exam-backend`, production domain `exam.cie.co.in`, or its database. All implementation and tests must stay on the isolated demo branch/service/database.
