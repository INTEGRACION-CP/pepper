// api/setup-database.js
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Missing Supabase credentials' });
  }

  const queries = [
    `CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      nombre TEXT NOT NULL,
      email TEXT UNIQUE,
      perfil JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS projects (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      nombre TEXT NOT NULL,
      descripcion TEXT,
      estado TEXT DEFAULT 'activo' CHECK (estado IN ('activo', 'pausado', 'completado')),
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS decisions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
      contexto TEXT NOT NULL,
      propuesta TEXT NOT NULL,
      respuesta TEXT CHECK (respuesta IN ('OK', 'NO OK')),
      reasoning TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS resources (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      tipo TEXT NOT NULL CHECK (tipo IN ('herramienta', 'API', 'acceso', 'skill', 'otro')),
      nombre TEXT NOT NULL,
      detalles JSONB DEFAULT '{}',
      disponible BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS contexts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
      tema TEXT NOT NULL,
      estado TEXT DEFAULT 'activo' CHECK (estado IN ('activo', 'resuelto', 'pausado')),
      notas JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_decisions_user_id ON decisions(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_contexts_user_id ON contexts(user_id)`
  ];

  const results = [];
  for (const sql of queries) {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ sql })
    });
    results.push({ ok: response.ok, status: response.status });
  }

  return res.status(200).json({ message: 'Base de datos configurada', results });
}
