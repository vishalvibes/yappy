-- yaps: user viewpoints (transcript) + reference context. Tweets are ephemeral.

create table if not exists public.yaps (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    -- ready | failed (sync STT). `processing` kept in check for legacy rows only.
    status text not null default 'ready',
    -- User viewpoint only (the yap worth remembering).
    transcript text,
    -- Screen vision + other-speaker audio (context, not opinion).
    reference text,
    -- social_post | other — from screenshot vision (null if no image).
    screen_kind text,
    language_code text,
    error text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint yaps_status_check check (status in ('processing', 'ready', 'failed')),
    constraint yaps_screen_kind_check
        check (screen_kind is null or screen_kind in ('social_post', 'other'))
);

create index if not exists yaps_user_id_idx on public.yaps (user_id);
create index if not exists yaps_user_created_idx on public.yaps (user_id, created_at desc);

create trigger yaps_set_updated_at
    before update on public.yaps
    for each row
    execute function public.set_updated_at();

alter table public.yaps enable row level security;
