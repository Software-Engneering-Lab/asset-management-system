-- Shared mandatory-feature foundation. Workflow RPCs and access policies follow separately.
-- Apply once to an empty Supabase public schema.
begin;
create table public.department (
 department_id uuid primary key default gen_random_uuid(), code varchar(20) unique not null,
 name varchar(120) not null, is_active boolean not null default true);
create table public.app_user (
 user_id uuid primary key references auth.users(id), full_name varchar(120) not null,
 email varchar(150) unique not null, department_id uuid not null references public.department,
 account_status text not null default 'active' check(account_status in ('active','inactive')),
 created_at timestamptz not null default now());
create table public.role (
 role_id uuid primary key default gen_random_uuid(), role_name varchar(60) unique not null, description text);
create table public.user_role (
 user_role_id uuid primary key default gen_random_uuid(), user_id uuid not null references public.app_user,
 role_id uuid not null references public.role, assigned_by uuid not null references public.app_user,
 assigned_at timestamptz not null default now(), unique(user_id,role_id));
create table public.asset_category (
 category_id uuid primary key default gen_random_uuid(), name varchar(100) not null unique,
 parent_category_id uuid references public.asset_category, check(parent_category_id is distinct from category_id));
create table public.asset (
 asset_id uuid primary key default gen_random_uuid(), name varchar(150) not null, description text not null,
 category_id uuid not null references public.asset_category, quantity integer not null check(quantity>=0),
 available_quantity integer not null check(available_quantity>=0 and available_quantity<=quantity),
 purchase_date date, estimated_value numeric(12,2) check(estimated_value>=0),
 owning_department_id uuid not null references public.department, custodian_id uuid references public.app_user,
 location varchar(150) not null, condition varchar(30) not null, asset_state varchar(30) not null default 'Registered',
 is_published boolean not null default false, material_type varchar(60),
 weight_kg numeric(10,2) check(weight_kg>=0), expected_end_of_life date,
 source_asset_id uuid references public.asset, created_at timestamptz not null default now(),
 check(source_asset_id is distinct from asset_id));
create table public.resource_request (
 request_id uuid primary key default gen_random_uuid(),
 requesting_department_id uuid not null references public.department,
 submitted_by uuid not null references public.app_user,
 requested_category_id uuid not null references public.asset_category,
 specifications text not null, quantity integer not null check(quantity>0), preferred_condition varchar(30),
 purpose text not null, urgency varchar(20) not null, preferred_location varchar(150),
 required_date date, request_status varchar(30) not null default 'Draft',
 created_at timestamptz not null default now(), submitted_at timestamptz);
create table public.approval (
 approval_id uuid primary key default gen_random_uuid(), approval_type varchar(30) not null,
 approver_id uuid not null references public.app_user, request_id uuid not null references public.resource_request,
 asset_id uuid not null references public.asset, decision varchar(30) not null,
 approved_quantity integer check(approved_quantity>0), reason text not null,
 decided_at timestamptz not null default now());
create table public.reservation (
 reservation_id uuid primary key default gen_random_uuid(),
 request_id uuid not null references public.resource_request, asset_id uuid not null references public.asset,
 approval_id uuid not null references public.approval, reserved_by uuid not null references public.app_user,
 reserved_quantity integer not null check(reserved_quantity>0), expires_at timestamptz not null,
 reservation_status varchar(30) not null, created_at timestamptz not null default now(),
 check(expires_at>created_at));
create table public.transfer (
 transfer_id uuid primary key default gen_random_uuid(), request_id uuid not null references public.resource_request,
 asset_id uuid not null references public.asset, approval_id uuid not null references public.approval,
 approver_id uuid not null references public.app_user,
 reservation_id uuid not null unique references public.reservation,
 sending_department_id uuid not null references public.department,
 receiving_department_id uuid not null references public.department,
 quantity integer not null check(quantity>0), transfer_status varchar(30) not null,
 collection_date date, arrangement_notes text,
 released_by uuid references public.app_user, released_at timestamptz,
 received_by uuid references public.app_user, received_at timestamptz,
 received_quantity integer check(received_quantity>=0 and received_quantity<=quantity),
 received_condition varchar(30), destination_location varchar(150),
 transfer_cost numeric(12,2) check(transfer_cost>=0), reason text);
create table public.transfer_discrepancy (
 discrepancy_id uuid primary key default gen_random_uuid(), transfer_id uuid not null references public.transfer,
 reported_by uuid not null references public.app_user, discrepancy_type varchar(30) not null,
 description text not null, reported_at timestamptz not null default now(), resolution text,
 resolved_by uuid references public.app_user, resolved_at timestamptz);
create table public.asset_history_event (
 event_id uuid primary key default gen_random_uuid(), asset_id uuid not null references public.asset,
 transfer_id uuid references public.transfer, event_type varchar(40) not null,
 previous_state varchar(30), new_state varchar(30), details text,
 performed_by uuid not null references public.app_user, event_at timestamptz not null default now());
create table public.request_status_history (
 history_id uuid primary key default gen_random_uuid(), request_id uuid not null references public.resource_request,
 from_status varchar(30), to_status varchar(30) not null, changed_by uuid not null references public.app_user,
 changed_at timestamptz not null default now(), reason text);
create table public.model_version (
 model_version_id uuid primary key default gen_random_uuid(), provider varchar(60) not null,
 model_name varchar(80) not null, version_label varchar(80) not null, ai_function varchar(40) not null,
 released_at timestamptz, is_active boolean not null default true);
create table public.match_recommendation (
 recommendation_id uuid primary key default gen_random_uuid(), request_id uuid not null references public.resource_request,
 asset_id uuid not null references public.asset, model_version_id uuid not null references public.model_version,
 rank_position integer not null check(rank_position between 1 and 5),
 compatibility_score numeric(5,2) not null check(compatibility_score between 0 and 100),
 confidence numeric(4,3) check(confidence between 0 and 1), explanation text not null,
 missing_data_flags text, review_status varchar(30) not null default 'pending',
 reviewed_by uuid references public.app_user, review_reason text, reviewed_at timestamptz,
 created_at timestamptz not null default now());
create table public.report_summary (
 summary_id uuid primary key default gen_random_uuid(), report_type varchar(40) not null,
 period_start date not null, period_end date not null, draft_text text not null,
 model_version_id uuid not null references public.model_version,
 review_status varchar(30) not null default 'draft', reviewed_by uuid references public.app_user,
 reviewed_at timestamptz, created_at timestamptz not null default now(),
 calculated_figures jsonb not null default '{}'::jsonb, published_text text, published_at timestamptz,
 check(period_end>=period_start));
create table public.audit_log (
 audit_id uuid primary key default gen_random_uuid(), actor_id uuid not null references public.app_user,
 action varchar(60) not null, record_type varchar(40) not null, record_id uuid not null,
 previous_value jsonb, new_value jsonb, reason text, model_version_id uuid references public.model_version,
 occurred_at timestamptz not null default now());
-- No client table privileges until scoped policies and authorized workflow functions are installed.
do $$
declare t text;
begin
 foreach t in array array['department','app_user','role','user_role','asset_category','asset',
 'resource_request','approval','reservation','transfer','transfer_discrepancy',
 'asset_history_event','request_status_history','model_version','match_recommendation','report_summary','audit_log']
 loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on table public.%I from anon, authenticated',t);
 end loop;
end $$;
create index asset_search_filters on public.asset(category_id,condition,owning_department_id) where is_published;
create index requests_by_user on public.resource_request(submitted_by,created_at);
create index reservations_by_asset on public.reservation(asset_id,reservation_status);
create index asset_history_by_asset on public.asset_history_event(asset_id,event_at);
create index request_history_by_request on public.request_status_history(request_id,changed_at);
create index matches_by_request on public.match_recommendation(request_id,created_at,rank_position);
commit;

