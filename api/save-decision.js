import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const { user_id, contexto, propuesta, respuesta } = req.body

  if (!user_id || !contexto || !propuesta || !respuesta)
    return res.status(400).json({ error: 'Faltan campos requeridos' })

  try {
    const { data, error } = await supabase
      .from('decisions')
      .insert([{ user_id, contexto, propuesta, respuesta }])
      .select()
    if (error) throw error
    return res.status(200).json({ success: true, decision: data[0] })
  } catch (error) {
    return res.status(500).json({ error: error.message })
  }
}
