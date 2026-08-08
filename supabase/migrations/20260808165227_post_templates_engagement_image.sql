-- Engagement + image metadata for post_templates (virality-gated capture).

alter table public.post_templates
    add column if not exists likes integer,
    add column if not exists replies integer,
    add column if not exists reposts integer,
    add column if not exists views integer,
    add column if not exists has_image boolean not null default false,
    add column if not exists image_detail text;

comment on column public.post_templates.template is
    'Short reusable intent/pattern (not a long dump). May note IMAGE: …';
comment on column public.post_templates.likes is
    'Visible like count on the source post when captured';
comment on column public.post_templates.replies is
    'Visible reply/comment count on the source post when captured';
