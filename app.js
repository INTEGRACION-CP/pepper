const SUPABASE_URL = 'https://bhwfgbdgrdzrrrzxwihg.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJod2ZnYmRncmR6cnJyenh3aWhnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyMDgyNTUsImV4cCI6MjA5Njc4NDI1NX0.oeIVLL30O6vXbvFcns-mtHcuRxZium-SrMmz3lkTi9o';
const USER_ID = 'dade339f-6c98-416c-ab50-03af40905ce2';

const SYSTEM_PROMPT = `Sos PEPPER (Personalized & Efficient Personal Assistant with Enhanced Reasoning), una IA asistente creada para ayudar a tu usuario a desarrollar proyectos que mejoren la vida de las personas.

Tu personalidad:
- Hablás en español rioplatense, de manera clara, cálida y directa
- Sos proactiva: si ves soluciones que el usuario no ve, las proponés
- Siempre recordás que el usuario decide: vos proponés, él aprueba con OK o NO OK
- Evaluás riesgos antes de actuar y los comunicás con honestidad
- Sos concisa: máximo 3-4 oraciones antes de una propuesta
- Cuando mostrás código, siempre usá bloques con triple backtick y el lenguaje

Tu flujo de trabajo:
1. Al iniciar revisás la memoria disponible para recordar el contexto del usuario
2. Recibís la necesidad del usuario
3. La interpretás y comparás con mejores prácticas y benchmarks reales
4. Si es una tarea concreta, generás una PROPUESTA estructurada
5. Esperás el OK del usuario antes de continuar
6. Si algo puede dañar a alguien, no avanzás y lo comunicás claramente

Formato de propuesta:
[PROPUESTA]
título: (título corto)
pasos: (pasos separados por |)
riesgo: (bajo|medio|alto — descripción)
[/PROPUESTA]`;

let conversationHistory = [];
let attachedFile = null;
let isListening = false;
let recognition = null;
let currentSessionMessages = [];
let memoryCache = null;

const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('user-input');
const btnSend = document.getElementById('btn-send');
const btnVoice = document.getElementById('btn-voice');
const btnFile = document.getElementById('btn-file');
const fileInput = document.getElementById('file-input');
const btnClear = document.getElementById('btn-clear');
const btnSettings = document.getElementById('btn-settings');
const modalSettings = document.getElementById('modal-settings');
const modalClose = document.getElementById('modal-close');
const apiKeyInput = document.getElementById('api-key-input');
const btnSaveKey = document.getElementById('btn-save-key');

function getApiKey() { return localStorage.getItem('pepper_api_key') || ''; }

// ── Supabase ──────────────────────────────────────────────────

async function sbGet(clave) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/memoria?clave=eq.${clave}&select=valor`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.length > 0 ? data[0].valor : null;
}

async function sbSet(clave, valor) {
  // Intentar UPDATE primero
  const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/memoria?clave=eq.${clave}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({ valor, actualizado_at: new Date().toISOString() })
  });
  // Si no existia, hacer INSERT
  if (updateRes.status === 404 || updateRes.headers.get('content-range') === '*/0') {
    await fetch(`${SUPABASE_URL}/rest/v1/memoria`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ clave, valor, actualizado_at: new Date().toISOString() })
    });
  }
}

async function saveDecision(contexto, propuesta, respuesta) {
  try {
    await fetch('/api/save-decision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: USER_ID, contexto, propuesta, respuesta, reasoning: '' })
    });
  } catch(e) { console.error('Error guardando decision:', e); }
}

// ── Memoria ───────────────────────────────────────────────────

async function loadMemory() {
  try {
    const data = await sbGet('memoria_principal');
    return data || { proyectos: [], conversaciones: [], perfil: {} };
  } catch (e) {
    return { proyectos: [], conversaciones: [], perfil: {} };
  }
}

async function extractMemoryWithClaude(messages, currentMemory) {
  const apiKey = getApiKey();
  if (!apiKey || messages.length === 0) return currentMemory;

  const conversationText = messages.map(m => `${m.rol.toUpperCase()}: ${m.mensaje}`).join('\n');
  const currentMemoryText = JSON.stringify(currentMemory, null, 2);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 4000,
      system: `Sos un extractor de memoria para PEPPER, un asistente de IA personal.
Tu tarea es analizar una conversación y actualizar la memoria estructurada del usuario.
Devolvé SOLO un JSON válido con esta estructura exacta, sin texto adicional:
{
  "perfil": {
    "nombre": "string o null",
    "ocupacion": "string o null", 
    "contexto": "string o null",
    "preferencias": "string o null"
  },
  "proyectos": [
    {
      "nombre": "string",
      "descripcion": "string",
      "estado": "activo|pausado|completado",
      "detalles": "string"
    }
  ],
  "conversaciones": [
    {
      "fecha": "ISO date string",
      "resumen": "resumen detallado de 2-3 oraciones de lo más importante",
      "temas": ["tema1", "tema2"]
    }
  ],
  "aprendizajes": ["cosa importante 1", "cosa importante 2"]
}
Mantené toda la información existente y agregá/actualizá con lo nuevo de la conversación.`,
      messages: [{
        role: 'user',
        content: `MEMORIA ACTUAL:\n${currentMemoryText}\n\nCONVERSACIÓN A ANALIZAR:\n${conversationText}\n\nActualizá la memoria con la información de esta conversación.`
      }]
    })
  });

  if (!response.ok) return currentMemory;

  const data = await response.json();
  const text = data.content.map(b => b.text || '').join('').trim();
  
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch(e) { console.error('Error parsing memory:', e); }
  
  return currentMemory;
}

async function saveCurrentSession(memory) {
  if (currentSessionMessages.length === 0) return;
  try {
    const updatedMemory = await extractMemoryWithClaude(currentSessionMessages, memory);
    await sbSet('memoria_principal', updatedMemory);
    memoryCache = updatedMemory;
  } catch(e) {
    console.error('Error guardando sesion:', e);
    // Fallback: guardar resumen básico
    const session = {
      fecha: new Date().toISOString(),
      resumen: currentSessionMessages.slice(0, 2).map(m => m.mensaje).join(' | ').substring(0, 300),
      mensajes: currentSessionMessages
    };
    memory.conversaciones = memory.conversaciones || [];
    memory.conversaciones.unshift(session);
    if (memory.conversaciones.length > 20) memory.conversaciones = memory.conversaciones.slice(0, 20);
    await sbSet('memoria_principal', memory);
  }
}

function buildMemoryContext(memory) {
  const partes = [];
  
  // Perfil del usuario
  if (memory.perfil && Object.keys(memory.perfil).length > 0) {
    const p = memory.perfil;
    const perfilTexto = Object.entries(p)
      .filter(([k, v]) => v)
      .map(([k, v]) => `- ${k}: ${v}`)
      .join('\n');
    if (perfilTexto) partes.push('PERFIL DEL USUARIO:\n' + perfilTexto);
  }

  // Proyectos
  if (memory.proyectos && memory.proyectos.length > 0) {
    const proyectosTexto = memory.proyectos.map(p => 
      `- ${p.nombre} (${p.estado}): ${p.descripcion || ''}${p.detalles ? ' — ' + p.detalles : ''}`
    ).join('\n');
    partes.push('PROYECTOS:\n' + proyectosTexto);
  }

  // Aprendizajes
  if (memory.aprendizajes && memory.aprendizajes.length > 0) {
    partes.push('LO QUE SÉ DEL USUARIO:\n' + memory.aprendizajes.map(a => `- ${a}`).join('\n'));
  }

  // Conversaciones recientes
  if (memory.conversaciones && memory.conversaciones.length > 0) {
    const ultimas = memory.conversaciones.slice(0, 3);
    partes.push('CONVERSACIONES RECIENTES:\n' + ultimas.map(c => 
      `- ${c.fecha ? c.fecha.split('T')[0] : 'reciente'}: ${c.resumen}`
    ).join('\n'));
  }

  if (partes.length === 0) return '';
  return '\n\n[MEMORIA PERSISTENTE — usá esta información para personalizar tus respuestas]\n' + partes.join('\n\n');
}

// ── Render ────────────────────────────────────────────────────

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderMarkdown(text) {
  // Primero escapamos el HTML del texto completo excepto los bloques de código
  let parts = [];
  let lastIndex = 0;
  // Regex para bloques de código
  const codeBlockRegex = /```([a-zA-Z0-9]*)\n?([\s\S]*?)```/g;
  let match;
  
  while ((match = codeBlockRegex.exec(text)) !== null) {
    // Texto antes del bloque de código
    if (match.index > lastIndex) {
      let chunk = escapeHtml(text.slice(lastIndex, match.index));
      chunk = chunk.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      chunk = chunk.replace(/`([^`]+)`/g, '<code>$1</code>');
      chunk = chunk.replace(/\n/g, '<br>');
      parts.push(chunk);
    }
    // Bloque de código
    const lang = match[1] || 'plaintext';
    const code = escapeHtml(match[2].trim());
    parts.push(`<pre><code class="language-${lang}">${code}</code></pre>`);
    lastIndex = match.index + match[0].length;
  }
  
  // Resto del texto después del último bloque
  if (lastIndex < text.length) {
    let chunk = escapeHtml(text.slice(lastIndex));
    chunk = chunk.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    chunk = chunk.replace(/`([^`]+)`/g, '<code>$1</code>');
    chunk = chunk.replace(/\n/g, '<br>');
    parts.push(chunk);
  }
  
  return parts.join('');
}

// ── API ───────────────────────────────────────────────────────

async function callPepper(userMessage) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('NO_KEY');

  conversationHistory.push({ role: 'user', content: userMessage });
  currentSessionMessages.push({ rol: 'usuario', mensaje: userMessage, hora: new Date().toISOString() });

  const systemWithMemory = SYSTEM_PROMPT + buildMemoryContext(memoryCache || {});

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 1500,
      system: systemWithMemory,
      messages: conversationHistory
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Error ${response.status}`);
  }

  const data = await response.json();
  const text = data.content.map(b => b.text || '').join('');
  conversationHistory.push({ role: 'assistant', content: text });
  currentSessionMessages.push({ rol: 'pepper', mensaje: text, hora: new Date().toISOString() });
  return text;
}

// ── UI ────────────────────────────────────────────────────────

function parseResponse(text) {
  const propMatch = text.match(/\[PROPUESTA\]([\s\S]*?)\[\/PROPUESTA\]/);
  const cleanText = text.replace(/\[PROPUESTA\][\s\S]*?\[\/PROPUESTA\]/, '').trim();
  let proposal = null;
  if (propMatch) {
    const raw = propMatch[1];
    const titulo = (raw.match(/título:\s*(.+)/) || [])[1]?.trim() || 'Propuesta';
    const pasos = (raw.match(/pasos:\s*(.+)/) || [])[1]?.trim().split('|').map(s => s.trim()).filter(Boolean) || [];
    const riesgo = (raw.match(/riesgo:\s*(.+)/) || [])[1]?.trim() || 'bajo';
    proposal = { titulo, pasos, riesgo };
  }
  return { cleanText, proposal };
}

function addMessage(role, text, proposal = null, fileName = null) {
  const wrap = document.createElement('div');
  wrap.className = `msg ${role}`;
  const av = document.createElement('div');
  av.className = 'msg-av';
  av.textContent = role === 'pepper' ? 'P' : 'Vos';
  const body = document.createElement('div');
  body.style.cssText = 'display:flex;flex-direction:column;min-width:0;';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  
  if (role === 'pepper') {
    bubble.innerHTML = renderMarkdown(text);
    setTimeout(() => {
      bubble.querySelectorAll('pre code').forEach(block => {
        if (window.hljs) window.hljs.highlightElement(block);
      });
    }, 0);
  } else {
    bubble.textContent = text;
  }

  if (fileName) {
    const badge = document.createElement('div');
    badge.className = 'file-badge';
    badge.innerHTML = `<i class="ti ti-file"></i>${fileName}`;
    bubble.appendChild(badge);
  }
  body.appendChild(bubble);
  if (proposal) body.appendChild(buildProposalCard(proposal));
  wrap.appendChild(av);
  wrap.appendChild(body);
  messagesEl.appendChild(wrap);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function buildProposalCard(proposal) {
  const riskColor = proposal.riesgo.startsWith('bajo') ? '#1D9E75'
    : proposal.riesgo.startsWith('alto') ? '#E24B4A' : '#BA7517';
  const card = document.createElement('div');
  card.className = 'proposal-card';
  const title = document.createElement('div');
  title.className = 'proposal-title';
  title.innerHTML = `<i class="ti ti-checklist"></i>${proposal.titulo}`;
  const steps = document.createElement('div');
  steps.className = 'proposal-steps';
  steps.innerHTML = proposal.pasos.map((p, i) => `${i + 1}. ${p}`).join('<br>');
  const risk = document.createElement('div');
  risk.className = 'proposal-risk';
  risk.style.color = riskColor;
  risk.innerHTML = `<i class="ti ti-shield-check"></i>Riesgo: ${proposal.riesgo}`;
  const actions = document.createElement('div');
  actions.className = 'proposal-actions';
  const btnOk = document.createElement('button');
  btnOk.className = 'btn-ok';
  btnOk.textContent = 'OK — adelante';
  const btnNok = document.createElement('button');
  btnNok.className = 'btn-nok';
  btnNok.textContent = 'NO OK — buscar alternativa';
  btnOk.onclick = () => handleDecision('ok', proposal.titulo, actions);
  btnNok.onclick = () => handleDecision('nok', proposal.titulo, actions);
  actions.appendChild(btnOk);
  actions.appendChild(btnNok);
  card.appendChild(title);
  card.appendChild(steps);
  card.appendChild(risk);
  card.appendChild(actions);
  return card;
}

function addTyping() {
  const wrap = document.createElement('div');
  wrap.className = 'msg pepper';
  wrap.id = 'typing-indicator';
  wrap.innerHTML = `<div class="msg-av">P</div><div><div class="bubble typing-dots"><span></span><span></span><span></span></div></div>`;
  messagesEl.appendChild(wrap);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function removeTyping() { document.getElementById('typing-indicator')?.remove(); }

function showWelcome(memory) {
  const proyectos = (memory.proyectos || []).filter(p => p.estado === 'activo');
  const conversaciones = memory.conversaciones || [];
  let msg = 'Hola! Soy PEPPER. Contame qué necesitás resolver hoy y lo analizamos juntos.';
  if (conversaciones.length > 0 || proyectos.length > 0) {
    const proyectosActivos = proyectos.length > 0 ? ` Tengo ${proyectos.length} proyecto(s) activo(s): ${proyectos.map(p => p.nombre).join(', ')}.` : '';
    msg = `Hola de nuevo Matías.${proyectosActivos} ¿En qué te ayudo hoy?`;
  }
  addMessage('pepper', msg);
}

function addNoKeyNotice() {
  const wrap = document.createElement('div');
  wrap.className = 'msg pepper';
  wrap.innerHTML = `<div class="msg-av">P</div><div><div class="notice"><i class="ti ti-key"></i><div>Para activarme necesitás configurar tu API Key de Anthropic. Hacé clic en el ícono <strong>⚙</strong> arriba a la derecha.</div></div></div>`;
  messagesEl.appendChild(wrap);
}

async function handleDecision(decision, titulo, actionsEl) {
  actionsEl.innerHTML = decision === 'ok'
    ? `<span style="color:#1D9E75;font-size:13px;display:flex;align-items:center;gap:5px"><i class="ti ti-check"></i>Aprobado</span>`
    : `<span style="color:#E24B4A;font-size:13px;display:flex;align-items:center;gap:5px"><i class="ti ti-x"></i>Buscando alternativa...</span>`;
  
  await saveDecision(titulo, titulo, decision === 'ok' ? 'OK' : 'NO OK');
  
  const msg = decision === 'ok'
    ? `OK, adelante con: ${titulo}`
    : `NO OK para: ${titulo}. Por favor buscá una alternativa diferente.`;
  addMessage('user', decision === 'ok' ? 'OK — adelante' : 'NO OK — buscá otra alternativa');
  addTyping();
  try {
    const reply = await callPepper(msg);
    removeTyping();
    const { cleanText, proposal } = parseResponse(reply);
    addMessage('pepper', cleanText, proposal);
    speakText(cleanText);
  } catch (e) {
    removeTyping();
    addMessage('pepper', handleError(e));
  }
}

async function sendMessage() {
  const text = inputEl.value.trim();
  if (!text && !attachedFile) return;
  const fileName = attachedFile?.name || null;
  addMessage('user', text, null, fileName);
  const messageToSend = attachedFile ? `${text}\n\n[Archivo adjunto: ${attachedFile.name}]` : text;
  inputEl.value = '';
  inputEl.style.height = 'auto';
  attachedFile = null;
  inputEl.placeholder = 'Contale a PEPPER qué necesitás resolver...';
  addTyping();
  try {
    const reply = await callPepper(messageToSend);
    removeTyping();
    const { cleanText, proposal } = parseResponse(reply);
    addMessage('pepper', cleanText, proposal);
    speakText(cleanText);
    // Autoguardado después de cada respuesta
    const memory = memoryCache || await loadMemory();
    await saveCurrentSession(memory);
    memoryCache = memory;
  } catch (e) {
    removeTyping();
    addMessage('pepper', handleError(e));
  }
}

function handleError(e) {
  if (e.message === 'NO_KEY') return 'Necesitás configurar tu API Key. Hacé clic en ⚙ arriba a la derecha.';
  if (e.message.includes('401')) return 'La API Key no es válida. Revisala en la configuración.';
  return `Hubo un error: ${e.message}. Intentá de nuevo.`;
}

function speakText(text) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'es-ES';
  utter.rate = 1.05;
  const voices = window.speechSynthesis.getVoices();
  const spanish = voices.find(v => v.lang.startsWith('es'));
  if (spanish) utter.voice = spanish;
  window.speechSynthesis.speak(utter);
}

function startVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { alert('Tu navegador no soporta voz. Usá Chrome.'); return; }
  recognition = new SR();
  recognition.lang = 'es-ES';
  recognition.interimResults = false;
  recognition.onstart = () => { isListening = true; btnVoice.classList.add('listening'); };
  recognition.onresult = (e) => { inputEl.value = e.results[0][0].transcript; sendMessage(); };
  recognition.onend = () => { isListening = false; btnVoice.classList.remove('listening'); };
  recognition.onerror = () => { isListening = false; btnVoice.classList.remove('listening'); };
  recognition.start();
}

// Events
btnSend.addEventListener('click', sendMessage);
btnVoice.addEventListener('click', () => { isListening ? recognition?.stop() : startVoice(); });
fileInput.addEventListener('change', (e) => {
  attachedFile = e.target.files[0];
  if (attachedFile) inputEl.placeholder = `Archivo listo: ${attachedFile.name}`;
});
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});
inputEl.addEventListener('input', () => {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
});
btnClear.addEventListener('click', async () => {
  const memory = memoryCache || await loadMemory();
  await saveCurrentSession(memory);
  memoryCache = memory;
  conversationHistory = [];
  currentSessionMessages = [];
  messagesEl.innerHTML = '';
  showWelcome(memory);
});
btnSettings.addEventListener('click', () => modalSettings.classList.remove('hidden'));
modalClose.addEventListener('click', () => modalSettings.classList.add('hidden'));
modalSettings.addEventListener('click', (e) => { if (e.target === modalSettings) modalSettings.classList.add('hidden'); });
btnSaveKey.addEventListener('click', () => {
  const key = apiKeyInput.value.trim();
  if (key) {
    localStorage.setItem('pepper_api_key', key);
    modalSettings.classList.add('hidden');
    if (messagesEl.querySelector('.notice')) { messagesEl.innerHTML = ''; showWelcome(memoryCache || {}); }
  }
});

window.addEventListener('beforeunload', async () => {
  const memory = memoryCache || await loadMemory();
  await saveCurrentSession(memory);
});

async function init() {
  if (!getApiKey()) { addNoKeyNotice(); return; }
  apiKeyInput.value = getApiKey();
  addMessage('pepper', 'Cargando memoria...');
  memoryCache = await loadMemory();
  messagesEl.innerHTML = '';
  showWelcome(memoryCache);
}

window.speechSynthesis?.getVoices();
init();