// api/create-user.js
import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Missing Supabase credentials' })
  }

  const supabase = createClient(supabaseUrl, supabaseKey)

  const { nombre, email } = req.body

  if (!nombre) {
    return res.status(400).json({ error: 'nombre is required' })
  }

  try {
    const { data, error } = await supabase
      .from('users')
      .insert([{ nombre, email }])
      .select()

    if (error) throw error

    return res.status(200).json({ success: true, user: data[0] })
  } catch (error) {
    return res.status(500).json({ error: error.message })
  }
}
