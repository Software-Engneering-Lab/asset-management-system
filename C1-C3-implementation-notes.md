## What this adds
- C1: login checks app_user profile + active account; server-side role checks (requireRole); admin page to create profiles, assign roles, activate/deactivate accounts
- C2: admin departments page; asset registration form with validation; history + audit entries
- C3: publish surplus (blocks Poor / non-Registered assets); search with keyword + category/condition/department filters

## Database
- Migration 20261114090000_budoor_access_and_assets.sql (already applied to Supabase): read grants + RLS policies, has_role(), current_department_id(), write_audit(), register_asset(), publish_asset(), profile/role functions
- Seed: 4 demo users (password shared privately), 8 fictional assets

## Tested
Login, register (with validation), publish, search, Poor asset blocked, requester blocked from /assets/new

## For Shaikha & Renad
Use AuthService.requireUser()/requireRole() and lib/constants.ts. Asset changes must go through SECURITY DEFINER functions (asset is read-only for users). Pages reading the user must be inside <Suspense> (Cache Components).
