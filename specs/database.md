# Database Design

Generic schema + query + migration rules. Stack-specific DB access lives in `CLAUDE.md`.

## Schema design

- **Soft-delete via lifecycle**: mandatory lifecycle column (`active`, `archived`, `deleted`). Never a `deleted` boolean.
- **One state column**: any entity with state transitions gets a single state column — model it as a state machine with one variable unless truly impossible.
- **Labels vs tags**: mandatory labels get their own columns; optional binary tags all live in one `tags` array column. Add `updated_at` only if needed; keep `created_at`.
- **State lives in the app layer**: the client gets back the state it set, instantly. State changes from later background processes are fine.
- **No bi-directional references** between two tables. Use joins to fetch related IDs and counts. Denormalize only for clearly-defined M×N relationships or prohibitively expensive joins — model M×N with a dedicated junction table.

## Query patterns

- Keep the selected-rows list on one line.
- Use nesting in select queries for joins.
- For any `IN (values)` filter where `values` grows with usage, batch it. An unbounded list encoded into the request URL eventually hits `414 URI Too Long`.

## Migrations

- If a migration edits an existing table, back-port the same change into that table's **original** migration. Treat edit-migrations as temporary; the schema change is permanent.
