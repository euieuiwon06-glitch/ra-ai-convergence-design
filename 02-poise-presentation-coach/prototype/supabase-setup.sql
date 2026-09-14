-- ================================================================
-- Poise · Supabase 초기 설정
-- Supabase 대시보드 → SQL Editor 에 통째로 붙여넣고 [Run]
-- (프로토타입: 로그인 없이 익명 anon 키로 읽기/쓰기 허용 — 아래 "주의" 참고)
-- ================================================================

-- 1) 세션 기록 테이블 ------------------------------------------------
create table if not exists public.sessions (
  id           text primary key,
  created_at   timestamptz not null default now(),
  date         timestamptz not null,
  duration_sec int         not null,
  counts       jsonb       not null,
  total        int         not null,
  timeline     jsonb       not null default '[]'::jsonb,
  video_path   text
);

alter table public.sessions enable row level security;

drop policy if exists "poise anon select sessions" on public.sessions;
drop policy if exists "poise anon insert sessions" on public.sessions;
create policy "poise anon select sessions" on public.sessions
  for select to anon, authenticated using (true);
create policy "poise anon insert sessions" on public.sessions
  for insert to anon, authenticated with check (true);

-- 2) 녹화 영상 저장용 Storage 버킷 (public 읽기) ----------------------
insert into storage.buckets (id, name, public)
values ('recordings', 'recordings', true)
on conflict (id) do update set public = true;

drop policy if exists "poise upload recordings" on storage.objects;
drop policy if exists "poise read recordings"   on storage.objects;
create policy "poise upload recordings" on storage.objects
  for insert to anon, authenticated with check (bucket_id = 'recordings');
create policy "poise read recordings" on storage.objects
  for select using (bucket_id = 'recordings');

-- ================================================================
-- 주의(프로토타입 한정): 위 정책은 "로그인 없이 누구나" 기록/영상을
-- 올리고 볼 수 있게 합니다. 데모/교수님 시연용으로는 충분하지만,
-- 실제 서비스로 가면 Supabase Auth 로그인 + 사용자별 RLS로 바꿔야 합니다.
-- ================================================================
