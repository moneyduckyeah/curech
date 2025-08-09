#!/usr/bin/env bash
set -e

# Génère env.js pour l'app client à partir des variables d'environnement Netlify
cat > ./env.js <<EOF
window.__ENV = {
  SUPABASE_URL: "${SUPABASE_URL}",
  SUPABASE_ANON_KEY: "${SUPABASE_ANON_KEY}"
};
EOF

# copy static files to publish (Netlify publish dir is defaulted in netlify.toml)
# Ici on assume que les fichiers sont à la racine et seront publiés tels quels.
