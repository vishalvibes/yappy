-- Sync STT: yaps are inserted as ready|failed; default processing was misleading.
alter table public.yaps alter column status set default 'ready';
