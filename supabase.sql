-- КБЖУ: схема для облачной синхронизации в Supabase.
-- Выполните целиком в Supabase Dashboard -> SQL Editor -> New query -> Run.
--
-- Каждая таблица хранит запись приложения в поле data (jsonb).
-- updated_at  — время изменения на устройстве (мс, last-write-wins);
-- deleted     — мягкое удаление;
-- server_updated_at — серверная метка, по ней устройства забирают изменения.

create or replace function public.kbzhu_touch()
returns trigger
language plpgsql
as $$
begin
  -- Не даём более старой версии перезаписать более новую (last-write-wins).
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return null;
  end if;
  new.server_updated_at := clock_timestamp();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['products', 'dishes', 'diary_entries', 'settings'] loop
    execute format($f$
      create table if not exists public.%1$I (
        user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
        id text not null,
        data jsonb not null default '{}'::jsonb,
        updated_at bigint not null default 0,
        deleted boolean not null default false,
        server_updated_at timestamptz not null default clock_timestamp(),
        primary key (user_id, id)
      )$f$, t);

    execute format('create index if not exists %1$I on public.%2$I (user_id, server_updated_at)', t || '_pull_idx', t);

    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists "own rows select" on public.%I', t);
    execute format('drop policy if exists "own rows insert" on public.%I', t);
    execute format('drop policy if exists "own rows update" on public.%I', t);
    execute format('drop policy if exists "own rows delete" on public.%I', t);

    execute format('create policy "own rows select" on public.%I for select to authenticated using (auth.uid() = user_id)', t);
    execute format('create policy "own rows insert" on public.%I for insert to authenticated with check (auth.uid() = user_id)', t);
    execute format('create policy "own rows update" on public.%I for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)', t);
    execute format('create policy "own rows delete" on public.%I for delete to authenticated using (auth.uid() = user_id)', t);

    execute format('drop trigger if exists kbzhu_touch on public.%I', t);
    execute format('create trigger kbzhu_touch before insert or update on public.%I for each row execute function public.kbzhu_touch()', t);

    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end;
$$;

-- Необязательно: окончательно удалить записи, помеченные удалёнными более 90 дней назад.
-- delete from public.products      where deleted and server_updated_at < now() - interval '90 days';
-- delete from public.dishes        where deleted and server_updated_at < now() - interval '90 days';
-- delete from public.diary_entries where deleted and server_updated_at < now() - interval '90 days';
