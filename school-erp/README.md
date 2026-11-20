# CIE School ERP service (isolated module)

This is a new, self-contained School ERP service inside the separate `nits477/cie-multi-institute` repository. It does not modify the legacy CIE Exam production repository or its database.

## Included in this first backend milestone
- Super Admin bootstrap and login
- School creation and suspension/activation
- School Admin creation
- School-scoped admissions
- Fee receipts
- Expense vouchers
- Day Book
- School settings, module flags and custom-domain field
- Per-school JSON backup export
- Audit trail
- PostgreSQL schema with `school_erp_` prefixes

## Database safety
The service refuses to start unless the database name in `DATABASE_URL` is exactly `cie_multi_institute_demo_db` or `cie_test`. Do not point it at a production or legacy CIE database. The migration creates only `school_erp_*` objects and does not alter existing exam tables.

## Local run
1. Use Node.js 20+.
2. From this directory run `npm install`.
3. Copy `.env.example` to `.env`.
4. Set `DATABASE_URL` to the isolated demo database, `JWT_SECRET` to a random value of at least 32 characters, and `BOOTSTRAP_SECRET` to a one-time secret.
5. Run `npm start`.
6. Open `http://localhost:5001`.
7. Create the first Super Admin once using POST `/api/bootstrap/super-admin`, header `x-bootstrap-secret`, and JSON `{ "fullName":"CIE", "email":"...", "password":"..." }`. Remove BOOTSTRAP_SECRET after successful setup.

## Deployment
Deploy this folder as a separate Render Web Service with Root Directory `school-erp`, Build Command `npm install`, Start Command `npm start`, Health Check Path `/api/health`. Set secrets in Render. Do not deploy until the isolated database backup and tenant tests are complete.

## Not yet included
DNS provider automation/verification, SSL automation, public school websites, student/teacher portals, marksheets, WhatsApp delivery, CSV imports, and restore. A saved custom domain is only a requested hostname; it does not configure DNS or hosting.
