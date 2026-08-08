-- Split viewpoint (transcript) from reference context; persist screen_kind.

alter table public.yaps
    add column if not exists reference text,
    add column if not exists screen_kind text;

alter table public.yaps
    drop constraint if exists yaps_screen_kind_check;

alter table public.yaps
    add constraint yaps_screen_kind_check
    check (screen_kind is null or screen_kind in ('social_post', 'other'));
