-- Table pour stocker blobs chiffrés
create table public.conversations (
  id text not null,
  type text not null,       -- 'title' | 'message'
  iv text not null,
  data text not null,
  created_at timestamptz default now()
);

-- index pour recherche par id
create index on public.conversations (id);

-- NOTE: par défaut, Supabase permet les requêtes avec la clé anon si policies autorisent.
-- Pour un déploiement simple démarrer avec RLS désactivé ou avec une policy publique:
-- (Option 1: RLS OFF) -- pas d'actions supplémentaires
-- (Option 2: RLS ON + policy publique)
-- Exemple policy (si vous activez RLS):
-- enable row level security first
-- ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

-- then allow inserts/select for anon:
-- CREATE POLICY "anon_read_write" ON public.conversations
-- FOR ALL USING (true) WITH CHECK (true);
