-- ตั้งค่าฐานข้อมูลกลางของแอพเช็คตู้ไข่ (รันใน Supabase → SQL Editor ครั้งเดียว)
-- ใครมีลิงก์แอพก็อ่าน/เขียนได้ (ไม่ต้องล็อกอิน) ตามที่เจ้าของต้องการส่งลิงก์ให้เพื่อน

create table if not exists public.cabinets (
  id          text primary key,
  name        text not null default '',
  location    text not null default '',
  key_number  text not null default '',
  note        text not null default '',
  photos      jsonb not null default '[]'::jsonb,
  created_at  bigint,
  updated_at  bigint
);

alter table public.cabinets enable row level security;

drop policy if exists "anon all cabinets" on public.cabinets;
create policy "anon all cabinets" on public.cabinets
  for all to anon, authenticated using (true) with check (true);

-- ให้ทุกเครื่องเห็นการเปลี่ยนแปลงแบบทันที
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'cabinets'
  ) then
    alter publication supabase_realtime add table public.cabinets;
  end if;
end $$;

-- ที่เก็บรูป (เปิดให้ดูรูปได้จากลิงก์ตรง)
insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do update set public = true;

drop policy if exists "anon read photos" on storage.objects;
drop policy if exists "anon insert photos" on storage.objects;
drop policy if exists "anon update photos" on storage.objects;
drop policy if exists "anon delete photos" on storage.objects;

create policy "anon read photos"   on storage.objects for select to anon, authenticated using (bucket_id = 'photos');
create policy "anon insert photos" on storage.objects for insert to anon, authenticated with check (bucket_id = 'photos');
create policy "anon update photos" on storage.objects for update to anon, authenticated using (bucket_id = 'photos');
create policy "anon delete photos" on storage.objects for delete to anon, authenticated using (bucket_id = 'photos');
