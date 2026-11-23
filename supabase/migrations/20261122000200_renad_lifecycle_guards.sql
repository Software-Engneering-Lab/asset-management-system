begin;

-- C6: permitted request transitions from Phase 3.
-- Existing workflow functions still enforce roles, ownership,
-- reasons, quantities, expiry and transaction locking.
create function public.renad_guard_request_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  allowed boolean := false;
begin
  if new.request_status = old.request_status then
    return new;
  end if;

  allowed := case old.request_status
    when 'Draft' then
      new.request_status in ('Submitted', 'Cancelled')

    when 'Submitted' then
      new.request_status in ('Under Review', 'Cancelled')

    when 'Under Review' then
      new.request_status in (
        'Approved',
        'Rejected',
        'Returned for Information'
      )

    when 'Returned for Information' then
      new.request_status in ('Submitted', 'Cancelled')

    when 'Approved' then
      new.request_status in ('Reserved', 'Cancelled')

    when 'Reserved' then
      new.request_status in (
        'In Transfer',
        'Approved',
        'Cancelled'
      )

    when 'In Transfer' then
      new.request_status = 'Fulfilled'

    -- Fulfilled, Rejected and Cancelled are terminal.
    else false
  end;

  if not allowed then
    raise exception 'Request cannot move from % to %.',
      old.request_status,
      new.request_status
      using errcode = '22023';
  end if;

  return new;
end;
$$;

create trigger renad_request_transition_guard
before update of request_status
on public.resource_request
for each row
execute function public.renad_guard_request_transition();


-- C6: permitted transfer transitions from Phase 3.
create function public.renad_guard_transfer_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  allowed boolean := false;
begin
  if new.transfer_status = old.transfer_status then
    return new;
  end if;

  allowed := case old.transfer_status
    when 'Approved' then
      new.transfer_status in ('Scheduled', 'Cancelled')

    when 'Scheduled' then
      new.transfer_status in ('Released', 'Cancelled')

    when 'Released' then
      new.transfer_status in (
        'Completed',
        'Receipt Discrepancy'
      )

    when 'Receipt Discrepancy' then
      new.transfer_status = 'Completed'

    -- Completed and Cancelled are terminal.
    else false
  end;

  if not allowed then
    raise exception 'Transfer cannot move from % to %.',
      old.transfer_status,
      new.transfer_status
      using errcode = '22023';
  end if;

  return new;
end;
$$;

create trigger renad_transfer_transition_guard
before update of transfer_status
on public.transfer
for each row
execute function public.renad_guard_transfer_transition();


-- C6: reservation records cannot be reactivated after ending.
-- A fresh reservation must be a new record.
create function public.renad_guard_reservation_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.reservation_status = old.reservation_status then
    return new;
  end if;

  if old.reservation_status <> 'Active'
     or new.reservation_status not in (
       'Expired',
       'Cancelled',
       'Consumed'
     ) then
    raise exception 'Reservation cannot move from % to %.',
      old.reservation_status,
      new.reservation_status
      using errcode = '22023';
  end if;

  return new;
end;
$$;

create trigger renad_reservation_transition_guard
before update of reservation_status
on public.reservation
for each row
execute function public.renad_guard_reservation_transition();


-- C6: asset lifecycle transitions.
-- The existing asset table represents a batch, not always one unit.
-- Receipt creates a separate linked row for the received units.
create function public.renad_guard_asset_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  allowed boolean := false;
begin
  -- A published asset must actually have eligible free stock.
  if new.is_published and (
    new.asset_state <> 'Available'
    or new.available_quantity <= 0
    or new.condition not in ('Good', 'Fair')
  ) then
    raise exception
      'Only Available assets with usable condition and free stock may be published.'
      using errcode = '22023';
  end if;

  if tg_op = 'INSERT' then
    -- Registration and receipt functions validate their own
    -- initial state, ownership, actor and quantity.
    return new;
  end if;

  if new.asset_state = old.asset_state then
    return new;
  end if;

  allowed := case old.asset_state
    when 'Draft' then
      new.asset_state in ('Registered', 'Cancelled')

    when 'Registered' then
      new.asset_state in (
        'Available',
        'Unavailable',
        'Under Inspection'
      )

    when 'Available' then
      new.asset_state in (
        'Reserved',
        'Under Inspection',
        'Under Maintenance',
        'Unavailable',
        'Retired'
      )

    when 'Reserved' then
      new.asset_state in (
        'Available',
        'In Transfer',
        'Unavailable'
      )

    when 'In Transfer' then
      new.asset_state in ('Registered', 'Unavailable')

    when 'Under Inspection' then
      new.asset_state in (
        'Available',
        'Under Maintenance',
        'Unavailable',
        'Unrepairable'
      )

    when 'Under Maintenance' then
      new.asset_state in (
        'Available',
        'Unavailable',
        'Unrepairable'
      )

    when 'Unavailable' then
      new.asset_state in (
        'Available',
        'Under Inspection',
        'Under Maintenance',
        'Retired'
      )

    when 'Unrepairable' then
      new.asset_state in (
        'Recycled',
        'Retired',
        'Disposed'
      )

    when 'Retired' then
      new.asset_state in (
        'Recycled',
        'Donated',
        'Disposed'
      )

    -- Donated, Recycled, Disposed and Cancelled are terminal.
    else false
  end;

  -- Batch exception:
  -- Another held unit may be returned to free stock while
  -- some units from this same source batch are in transit.
  if old.asset_state = 'In Transfer'
     and new.asset_state = 'Available'
     and new.available_quantity > 0
     and (
       new.available_quantity > old.available_quantity
       or new.quantity < old.quantity
     ) then
    allowed := true;
  end if;

  -- Batch exception:
  -- After receipt reduces the source batch, its remaining
  -- units can still belong to another active reservation.
  if old.asset_state = 'In Transfer'
     and new.asset_state = 'Reserved'
     and new.quantity < old.quantity
     and new.available_quantity = 0 then
    allowed := true;
  end if;

  if not allowed then
    raise exception 'Asset cannot move from % to %.',
      old.asset_state,
      new.asset_state
      using errcode = '22023';
  end if;

  return new;
end;
$$;

create trigger renad_asset_transition_guard
before insert or update
on public.asset
for each row
execute function public.renad_guard_asset_transition();


-- Trigger functions are not browser-callable APIs.
revoke all on function
  public.renad_guard_request_transition(),
  public.renad_guard_transfer_transition(),
  public.renad_guard_reservation_transition(),
  public.renad_guard_asset_transition()
from public, anon, authenticated;

commit;