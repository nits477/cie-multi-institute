# CIE Multi-Institute — implementation audit

## Scope and safety
- Working branch: `work/multi-institute-tenant`
- Base: `build/cie-full-copy-multitenant` (full CIE V3.9.8 website copy)
- Production service and production database are out of scope.
- Do not deploy this branch until tenant authorization and isolation tests pass.

## Verified legacy behavior
- Student identity is currently global: `verifyStudent(mobile, pin)` queries students by mobile only.
- Registration uses global `ON CONFLICT(mobile)`.
- Admin session payload contains only `adminId`; it does not load role or institute ownership from the database.
- Admin routes are protected by login, but queries are not scoped to an institute.
- Student exam, session, question, result, PIN reset, leaderboard, wallet, referral, old-paper and order paths need explicit tenant review.
- The existing CIE site includes public pages, admin pages, Excel question import, results, PIN resets, promotions, student popups, wallet/referrals, app configuration/releases and old papers. Preserve these features.

## Required implementation rules
1. Resolve the institute from a normalized Institute Code on student registration/login; never accept a client-supplied numeric institute_id as authority.
2. Student identity key is `(institute_id, mobile)`, allowing the same mobile in different institutes.
3. Admin session must be resolved from the database and carry `role` and `institute_id`; institute admins are restricted to their own institute.
4. Every student-facing query must filter by the authenticated student's `institute_id`.
5. Every institute-admin query and mutation must filter by the authenticated admin's `institute_id`, including nested resources and file downloads.
6. Super Admin routes must be separate and explicitly authorized; they may access cross-institute data.
7. Maintain a default CIE institute for legacy records. Do not silently move legacy records to another institute.
8. Keep global public configuration separate from institute-owned configuration where the product requirement is genuinely global.

## API areas requiring tenant scoping
- Student: register, login, forgot PIN, available exams, start exam, submit result, my results, leaderboard, question reports, student account, popup image.
- Admin: students/export/delete, exams CRUD/live/thumbnail, questions/sets/import/delete, results/export/delete, PIN reset, question reports, popups, wallet/transactions, referrals, old-paper categories/papers/orders.
- Public: public exams, promotions, old papers and old-paper ordering must be reviewed for whether content is global or institute-specific.

## Database migration status
- The saved `001_multi_institute_tenant_scope.sql` is a draft foundation only.
- It has not been executed or validated against the isolated demo database.
- Before applying it, compare every referenced table/column and existing constraint against a restored copy of the supplied backup.
- A migration run must be transactional and verified with pre/post row counts; production must never be a target.

## Test gates before deployment
- Same mobile can register at two different institutes but not twice within one institute.
- Institute A admin cannot list, read, change, delete, export, or download Institute B data.
- Institute A student cannot see/start Institute B exams or read B results.
- Cross-institute exam/session/question/result relationships are rejected by the database.
- Super Admin can manage institutes and institute admins, approve/reject applications, and inspect institute-level summaries.
- Existing CIE features and Hindi/Excel workflows continue to work for the default CIE institute.
