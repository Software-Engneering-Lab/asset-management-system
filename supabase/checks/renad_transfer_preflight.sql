-- READ ONLY. Run before applying new migrations. This does not prove a migration's full contents are installed.
select name, to_regprocedure(signature) is not null as present
from (values
 ('Existing approval workflow','public.renad_approve_and_reserve(uuid,uuid,text,timestamp with time zone)'),
 ('Shaikha matching eligibility','public.shaikha_evidence_eligible(jsonb,jsonb)'),
 ('Shaikha request confirmation','public.shaikha_require_requester(uuid,uuid)'),
 ('New eligibility correction','public.renad_confirm_item_type(uuid,text)'),
 ('New transfer workflow','public.renad_transfer_workspace()')
) checks(name,signature);
-- If either NEW function is already present, do not rerun that migration blindly.
-- Check its full definition/application record first. Existing foundation files must not be rerun.
