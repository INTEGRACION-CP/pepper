// api/get-context.js
import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const userId = req.query.user_id

  if (!userId) return res.status(400).json({ error: 'user_id requerido' })

  const supabase = createClient(supabaseUrl, supabaseKey)

  try {
    const [decisions, projects, contexts, resources] = await Promise.all([
      supabase.from('decisions').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(20),
      supabase.from('projects').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
      supabase.from('contexts').select('*').eq('user_id', userId).eq('estado', 'activo'),
      supabase.from('resources').select('*').eq('user_id', userId).eq('disponible', true)
    ])

    return res.status(200).json({
      decisions: decisions.data || [],
      projects: projects.data || [],
      contexts: contexts.data || [],
      resources: resources.data || []
    })
  } catch (error) {
    return res.status(500).json({ error: error.message })
  }
}
