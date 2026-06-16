# Supabase (CLI)

This repo uses the [Supabase CLI](https://supabase.com/docs/guides/cli).

## Migrations (CLI-managed)

Versioned SQL lives in **`migrations/`** (timestamp prefix). Apply to a linked project:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

Local stack (optional):

```bash
supabase start
supabase db reset   # runs migrations; seed disabled in config unless you add seed.sql
```

## Legacy SQL in this folder

Numbered files such as `001_*.sql` … `020_*.sql` and `INSTALL_*.sql` are **historical / paste-to-dashboard** scripts. They are **not** executed automatically by the CLI. New schema changes should be added as **new files under `migrations/`** (e.g. `supabase migration new my_change`).
