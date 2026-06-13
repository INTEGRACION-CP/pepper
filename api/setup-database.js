// api/setup-database.js
import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Missing Supabase credentials' })
  }

  const supabase = createClient(supabaseUrl, supabaseKey)

  try {
    const tables = ['users', 'projects', 'decisions', 'resources', 'contexts']
    const results = {}

    for (const table of tables) {
      const { count, error } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true })
      results[table] = error ? `❌ Error: ${error.message}` : `✅ OK (${count} registros)`
    }

    return res.status(200).json({ status: 'Database ready', tables: results })
  } catch (error) {
    return res.status(500).json({ error: error.message })
  }
}
