-- Run AFTER 20261112000100_shared_foundation.sql. Apply once.
-- Foundation constraints and reference data, not feature implementation.
begin;

-- A request can be rejected/returned before an asset is selected.
alter table public.approval alter column asset_id drop not null;
alter table public.approval add constraint approval_decision_allowed
 check (decision in ('Approved','Rejected','Returned for Information'));
alter table public.approval add constraint approved_allocation_required
 check (decision <> 'Approved' or (asset_id is not null and approved_quantity is not null));
-- AI-down/manual report drafts must not invent a model identity.
alter table public.report_summary alter column model_version_id drop not null;

alter table public.asset add constraint asset_state_allowed check(asset_state in
 ('Draft','Registered','Available','Reserved','In Transfer','Under Inspection',
 'Under Maintenance','Unavailable','Unrepairable','Donated','Recycled','Retired','Disposed','Cancelled'));
alter table public.resource_request add constraint request_status_allowed check(request_status in
 ('Draft','Submitted','Under Review','Returned for Information','Approved','Reserved','In Transfer',
 'Fulfilled','Rejected','Cancelled'));
alter table public.transfer add constraint transfer_status_allowed check(transfer_status in
 ('Approved','Scheduled','Released','Receipt Discrepancy','Completed','Cancelled'));
-- Reservation labels are implementation conventions; Phase 3 does not enumerate these.
alter table public.reservation add constraint reservation_status_allowed check(reservation_status in
 ('Active','Expired','Cancelled','Consumed'));
alter table public.match_recommendation add constraint match_review_allowed
 check(review_status in ('pending','accepted','rejected'));
alter table public.match_recommendation add constraint match_rejection_reason
 check(review_status <> 'rejected' or nullif(btrim(review_reason),'') is not null);
alter table public.match_recommendation add constraint match_review_actor
 check(review_status = 'pending' or (reviewed_by is not null and reviewed_at is not null));
alter table public.report_summary add constraint report_review_allowed
 check(review_status in ('draft','reviewed','published'));
alter table public.report_summary add constraint publication_review_required
 check(review_status <> 'published' or
 (reviewed_by is not null and reviewed_at is not null and published_at is not null
 and nullif(btrim(published_text),'') is not null));

insert into public.role(role_name,description) values
 ('requester','Submit and track own requests; confirm authorized receipts'),
 ('custodian','Manage assigned assets and authorized release'),
 ('approver','Review allocations without self-approval'),
 ('admin','Administer accounts and review/publish reports')
 on conflict(role_name) do nothing;
-- Fictional demonstration departments and categories.
insert into public.department(code,name) values
 ('DEMO-IT','Demo Information Technology'),('DEMO-ENG','Demo Engineering'),
 ('DEMO-ADM','Demo Administration') on conflict(code) do nothing;
insert into public.asset_category(name) values
 ('Furniture'),('IT Equipment'),('Laboratory Equipment')
 on conflict(name) do nothing;

-- Index foreign keys used by the main feature joins.
create index user_role_by_role on public.user_role(role_id);
create index approvals_by_request on public.approval(request_id);
create index transfers_by_request on public.transfer(request_id);
create index transfers_by_asset on public.transfer(asset_id);
create index discrepancies_by_transfer on public.transfer_discrepancy(transfer_id);
commit;

