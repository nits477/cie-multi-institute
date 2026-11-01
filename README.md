# CIE Multi-Institute Examination Management System

A new, independent platform for Career Institute of Education (CIE).

## Safety boundary

- This repository is separate from the legacy `cie-exam-backend` repository.
- Never configure this project with the legacy production database URL.
- Use only the new `cie-multi-institute` Neon project for development and demo.
- Do not commit credentials, database URLs, tokens, student data, or backup files.

## Current foundation

- Node.js 20+
- Express API
- PostgreSQL connection pool for Neon
- Helmet security headers
- CORS configuration
- Health endpoint: `GET /api/health`

## Local setup

1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env`.
4. Set `DATABASE_URL` to the NEW Neon project's connection string.
5. Set a long random `JWT_SECRET`.
6. Run `npm run dev`.

## Planned modules

- CIE Super Admin
- Institute registration, review and approval
- Institute Admin accounts and institute-scoped dashboard
- Student registration and login
- Courses and subjects
- Question bank and spreadsheet import
- Exam scheduling, delivery and submissions
- Results, reports and exports
- Notifications and audit trail

## Security principles

Institute ownership must be checked by the API for every institute-owned record. Frontend-only access restrictions are not sufficient. Public signup must never create a Super Admin account. Passwords must be stored as secure hashes.

## Deployment

Deploy this repository as a NEW Render service. Configure environment variables there using the NEW Neon database credentials. Do not reuse the legacy Render service or production environment variables.
