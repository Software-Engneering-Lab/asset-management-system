-- =====================================================================
-- Budoor – bootstrap profiles + fictional sample assets (NFR-SE08: no real records)
-- Run ONCE in Supabase SQL Editor AFTER the 20261114090000 migration.
--
-- FIRST create these 4 login users:
--   Supabase → Authentication → Users → Add user → Create new user
--   (tick "Auto Confirm User"; password e.g. Demo@12345)
--     admin@demo.ku.ac.ae      custodian@demo.ku.ac.ae
--     requester@demo.ku.ac.ae  approver@demo.ku.ac.ae
-- =====================================================================
begin;

-- Extra fictional categories (the foundation already has Furniture, IT Equipment, Laboratory Equipment)
insert into public.asset_category (name) values ('Audio-Visual'), ('Office Supplies')
on conflict (name) do nothing;

-- Profiles for the 4 Auth users (departments come from the foundation migration)
insert into public.app_user (user_id, full_name, email, department_id, account_status)
select au.id, v.full_name, v.email, d.department_id, 'active'
from (values
  ('admin@demo.ku.ac.ae',     'Demo Admin',     'DEMO-ADM'),
  ('requester@demo.ku.ac.ae', 'Demo Requester', 'DEMO-IT'),
  ('custodian@demo.ku.ac.ae', 'Demo Custodian', 'DEMO-ENG'),
  ('approver@demo.ku.ac.ae',  'Demo Approver',  'DEMO-ADM')
) as v(email, full_name, dept_code)
join auth.users au        on lower(au.email) = v.email
join public.department d  on d.code = v.dept_code
on conflict (user_id) do nothing;

-- Roles. The first admin is bootstrapped here (team rule); after this, only the admin screen assigns roles.
insert into public.user_role (user_id, role_id, assigned_by)
select u.user_id, r.role_id, (select user_id from public.app_user where email = 'admin@demo.ku.ac.ae')
from (values
  ('admin@demo.ku.ac.ae',     'admin'),
  ('requester@demo.ku.ac.ae', 'requester'),
  ('custodian@demo.ku.ac.ae', 'custodian'),
  ('custodian@demo.ku.ac.ae', 'requester'),
  ('approver@demo.ku.ac.ae',  'approver')
) as v(email, role_name)
join public.app_user u on u.email = v.email
join public.role r     on r.role_name = v.role_name
on conflict (user_id, role_id) do nothing;

-- 8 fictional assets owned by DEMO-ENG (6 published, 2 registered only)
with c as (select user_id from public.app_user where email = 'custodian@demo.ku.ac.ae'),
ins as (
  insert into public.asset (name, description, category_id, quantity, available_quantity,
                            purchase_date, estimated_value, owning_department_id, custodian_id,
                            location, condition, asset_state, is_published,
                            material_type, weight_kg, expected_end_of_life)
  select v.name, v.descr, (select category_id from public.asset_category where name = v.cat),
         v.qty, v.qty, v.bought::date, v.value,
         (select department_id from public.department where code = 'DEMO-ENG'),
         (select user_id from c), v.loc, v.cond, v.state, v.state = 'Available',
         v.material, v.weight, v.eol::date
  from (values
    ('Dell 24-inch monitor',   'Dell P2419H 24-inch IPS monitor, small scratch on bezel', 'IT Equipment',         4,  '2022-03-10',  650.00, 'Building A, Room 1102', 'Good', 'Available',  'Mixed electronics', 6.0,  '2028-03-10'),
    ('Ergonomic office chair', 'Adjustable mesh office chair with armrests',              'Furniture',            10, '2021-09-01',  480.00, 'Building A, Store 2',    'Good', 'Available',  'Steel and fabric',  15.0, '2029-09-01'),
    ('Epson projector EB-X51', 'Classroom projector 3800 lumens, HDMI',                   'Audio-Visual',         2,  '2020-01-15', 1800.00, 'Building B, Room 204',   'Fair', 'Available',  'Mixed electronics', 2.5,  '2026-12-31'),
    ('Lab microscope',         'Binocular compound microscope 40x-1000x',                 'Laboratory Equipment', 3,  '2019-05-20', 2200.00, 'Lab 3, Building C',      'Good', 'Available',  'Metal and glass',   7.0,  '2030-05-20'),
    ('Mobile whiteboard',      'Magnetic whiteboard 180x120 cm on wheels',                'Furniture',            2,  '2023-02-01',  350.00, 'Building A, Store 2',    'Good', 'Available',  'Steel',             20.0, '2033-02-01'),
    ('HP LaserJet printer',    'HP LaserJet Pro M404dn, duplex, network',                 'IT Equipment',         1,  '2021-11-11',  900.00, 'Building A, Room 1010',  'Good', 'Available',  'Mixed electronics', 9.0,  '2027-11-11'),
    ('Desktop PC (i5, 8GB)',   'Lenovo ThinkCentre i5, 8 GB RAM, 256 GB SSD',             'IT Equipment',         5,  '2020-08-01', 2500.00, 'Building A, IT Store',   'Fair', 'Registered', 'Mixed electronics', 5.0,  '2026-08-01'),
    ('Broken lab centrifuge',  'Benchtop centrifuge, motor fault reported',               'Laboratory Equipment', 1,  '2017-04-04', 4000.00, 'Lab 1, Building C',      'Poor', 'Registered', 'Metal',             25.0, '2025-04-04')
  ) as v(name, descr, cat, qty, bought, value, loc, cond, state, material, weight, eol)
  where not exists (select 1 from public.asset a where a.name = v.name)
  returning asset_id, asset_state, custodian_id
)
insert into public.asset_history_event (asset_id, event_type, previous_state, new_state, details, performed_by, event_at)
select asset_id, 'REGISTERED', null, 'Registered', 'Sample data (fictional)', custodian_id, now() - interval '1 day' from ins
union all
select asset_id, 'PUBLISHED', 'Registered', 'Available', 'Sample data (fictional)', custodian_id, now()
from ins where asset_state = 'Available';

commit;

-- Check: expect 4 profiles, 5 role links, 8 assets
select (select count(*) from public.app_user) as profiles,
       (select count(*) from public.user_role) as role_links,
       (select count(*) from public.asset) as assets;
