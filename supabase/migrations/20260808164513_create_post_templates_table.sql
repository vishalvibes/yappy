-- post_templates: reusable post intents/patterns captured from posts the user
-- engages with (screenshot + yap). Prefer viral / patterned posts. Stored for
-- later create-mode use; not consumed by generation yet.

create table if not exists public.post_templates (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    -- Platform / channel the template came from (twitter, linkedin, …).
    channel text not null,
    -- Short reusable intent/pattern (not a long dump). May include IMAGE: …
    template text not null,
    -- Optional short label (hot_take_ranking, grind_plan, dark_one_liner, …).
    pattern text,
    -- Visible engagement on the source post (null if not readable).
    likes integer,
    replies integer,
    reposts integer,
    views integer,
    has_image boolean not null default false,
    image_detail text,
    -- Approx hours old when captured (from UI "3h" / "23h" / date).
    age_hours double precision,
    -- active | archived | deleted
    lifecycle text not null default 'active',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint post_templates_channel_check check (
        channel in (
            'twitter',
            'linkedin',
            'threads',
            'bluesky',
            'reddit',
            'instagram',
            'facebook',
            'other'
        )
    ),
    constraint post_templates_lifecycle_check check (
        lifecycle in ('active', 'archived', 'deleted')
    )
);

create index if not exists post_templates_user_id_idx
    on public.post_templates (user_id);

create index if not exists post_templates_user_channel_idx
    on public.post_templates (user_id, channel)
    where lifecycle = 'active';

create trigger post_templates_set_updated_at
    before update on public.post_templates
    for each row
    execute function public.set_updated_at();

alter table public.post_templates enable row level security;
