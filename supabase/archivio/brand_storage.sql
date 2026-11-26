-- Logo, icone PWA e flag di riepilogo Telegram.
-- Incollalo nell'editor SQL di Supabase. È idempotente.
-- La service role carica i file e ignora la RLS. Il browser non scrive sul bucket.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'brand-assets',
  'brand-assets',
  true,
  2097152,
  array['image/png', 'image/svg+xml', 'image/webp']
)
on conflict (id) do update
set public = true,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists brand_assets_public_read on storage.objects;
create policy brand_assets_public_read on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'brand-assets');

alter table public.system_settings
  add column if not exists brand_logo_url text not null default '',
  add column if not exists brand_icon_192_url text not null default '',
  add column if not exists brand_icon_512_url text not null default '',
  add column if not exists brand_accent_color text not null default '#c6f531',
  add column if not exists notify_on_sync_success boolean not null default true;

alter table public.sync_logs drop constraint if exists sync_logs_job_type_check;
alter table public.sync_logs
  add constraint sync_logs_job_type_check
  check (job_type in ('votes', 'availability', 'kickoffs'));
