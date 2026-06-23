-- Fase 2a (push mobile): tabella dei token FCM dei device + RPC di registrazione.
--
-- NON applicata da Claude Code: Matteo la applica a mano su produzione
-- (Supabase è ambiente unico live). Finché tabella/RPC non esistono, la
-- registrazione lato app fallisce in modo graceful (catch + console.warn) senza
-- rompere il login. Una riga per token FCM; uniqueness sul token (un device =
-- un token, ri-assegnabile a un altro utente sullo stesso device via upsert).

create table if not exists public.push_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  token      text not null,
  platform   text not null default 'android' check (platform in ('android','ios','web')),
  enabled    boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uniq_push_tokens_token on public.push_tokens (token);
create index if not exists idx_push_tokens_user on public.push_tokens (user_id);
alter table public.push_tokens enable row level security;
create policy "push_tokens_select_own" on public.push_tokens
  for select using (auth.uid() = user_id);
create policy "push_tokens_delete_own" on public.push_tokens
  for delete using (auth.uid() = user_id);
create or replace function public.register_push_token(p_token text, p_platform text default 'android')
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  delete from public.push_tokens where token = p_token and user_id <> auth.uid();
  insert into public.push_tokens (user_id, token, platform, updated_at)
  values (auth.uid(), p_token, coalesce(p_platform,'android'), now())
  on conflict (token) do update
    set user_id = excluded.user_id, platform = excluded.platform, enabled = true, updated_at = now();
end; $$;
revoke all on function public.register_push_token(text, text) from public, anon;
grant execute on function public.register_push_token(text, text) to authenticated;
