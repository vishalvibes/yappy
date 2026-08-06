-- yaps: voice memories (STT transcript). Content generation is ephemeral — not stored here.

create table if not exists public.yaps (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    -- processing | ready | failed
    status text not null default 'processing',
    transcript text,
    language_code text,
    error text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint yaps_status_check check (status in ('processing', 'ready', 'failed'))
);

create index if not exists yaps_user_id_idx on public.yaps (user_id);
create index if not exists yaps_user_created_idx on public.yaps (user_id, created_at desc);

create trigger yaps_set_updated_at
    before update on public.yaps
    for each row
    execute function public.set_updated_at();

alter table public.yaps enable row level security;
