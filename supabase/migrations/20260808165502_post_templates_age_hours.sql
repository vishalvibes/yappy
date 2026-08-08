-- Approximate age of the source post when the template was captured.

alter table public.post_templates
    add column if not exists age_hours double precision;

comment on column public.post_templates.age_hours is
    'Approx hours since the source post was published (from UI timestamp)';
