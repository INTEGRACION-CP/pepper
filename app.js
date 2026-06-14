// ── Configuración ─────────────────────────────────────────────
const SUPABASE_URL = 'https://bhwfgbdgrdzrrrzxwihg.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJod2ZnYmRncmR6cnJyenh3aWhnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyMDgyNTUsImV4cCI6MjA5Njc4NDI1NX0.oeIVLL30O6vXbvFcns-mtHcuRxZium-SrMmz3lkTi9o';
const USER_ID = 'dade339f-6c98-416c-ab50-03af40905ce2';
const AGENT_SECRET = 'pepper-secret-local';
let AGENT_URL = localStorage.getItem('pepper_agent_url') || '';

const SYSTEM_PROMPT = `Sos PEPPER (Personalized & Efficient Personal Assistant with Enhanced Reasoning).
Tu misión: ayudar a Matías a desarrollar proyectos que mejoren la vida de las personas.

Personalidad:
- Hablás en español rioplatense, directo y cálido
- Proactiva: proponés soluciones que Matías no ve
- Matías decide siempre: vos proponés, él aprueba con OK o NO OK
- Evaluás riesgos antes de actuar
- Cuando mostrás código, usás bloques con triple backtick y el lenguaje

Flujo:
1. Cargás memoria al iniciar para conocer el contexto
2. Recibís la necesidad, la analizás
3. Si es tarea concreta, generás PROPUESTA estructurada
4. Esperás OK antes de continuar
5. Si algo puede dañar a alguien, no avanzás

Formato de propuesta:
[PROPUESTA]
título: (título corto)
pasos: (pasos separados por |)
riesgo: (bajo|medio|alto — descripción)
[/PROPUESTA]

Cuando el agente local esté conectado podés:
- Leer archivos del proyecto
- Ejecutar comandos Python
- Listar directorios
- Escribir y modificar código
Siempre pedí OK antes de escribir o ejecutar algo.`;

// ── Estado ────────────────────────────────────────────────────
let conversationHistory = [];
let currentSessionMessages = [];
let memoryCache = null;
let attachedFile = null;
let isListening = false;
let recognition = null;

// ── DOM ───────────────────────────────────────────────────────
const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('user-input');
const statusEl = document.getElementById('status-text');
const btnSend = document.getElementById('btn-send');
const btnVoice = document.getElementById('btn-voice');
const btnFile = document.getElementById('btn-file');
const fileInput = document.getElementById('file-input');
const btnClear = document.getElementById('btn-clear');
const btnSave = document.getElementById('btn-save');
const btnSettings = document.getElementById('btn-settings');
const modalSettings = document.getElementById('modal-settings');
const modalClose = document.getElementById('modal-close');
const apiKeyInput = document.getElementById('api-key-input');
const btnSaveKey = document.getElementById('btn-save-key');

function getApiKey() { return localStorage.getItem('pepper_api_key') || ''; }
function setStatus(text) { if (statusEl) statusEl.textContent = text; }

// ── Supabase ──────────────────────────────────────────────────
async function sbGet(clave) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/memoria?clave=eq.${clave}&select=valor`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.length > 0 ? data[0].valor : null;
  } catch(e) { return null; }
}

async function sbSet(clave, valor) {
  try {
    // Borrar si existe
    await fetch(`${SUPABASE_URL}/rest/v1/memoria?clave=eq.${encodeURIComponent(clave)}`, {
      method: 'DELETE',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    });
    // Insertar nuevo
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
  } catch(e) { console.error('Error sbSet:', e); }
}

// ── Memoria ───────────────────────────────────────────────────
async function loadMemory() {
  try {
    const data = await sbGet('memoria_principal');
    return data || { nombre: null, pais: null, ocupacion: null, contexto: null, proyectos: '', aprendizajes: '', conversaciones: [] };
  } catch(e) {
    return { nombre: null, pais: null, ocupacion: null, contexto: null, proyectos: '', aprendizajes: '', conversaciones: [] };
  }
}

// Extrae memoria usando texto plano — robusto, sin JSON
async function extractMemory(messages, currentMemory) {
  const apiKey = getApiKey();
  if (!apiKey || messages.length === 0) return currentMemory;

  const texto = messages.map(m => `${m.rol.toUpperCase()}: ${m.mensaje}`).join('\n');
  const memoriaActual = `
NOMBRE: ${currentMemory.nombre || 'desconocido'}
PAIS: ${currentMemory.pais || 'desconocido'}
OCUPACION: ${currentMemory.ocupacion || 'desconocido'}
CONTEXTO: ${currentMemory.contexto || 'ninguno'}
PROYECTOS: ${currentMemory.proyectos || 'ninguno'}
APRENDIZAJES: ${currentMemory.aprendizajes || 'ninguno'}`.trim();

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
      max_tokens: 1000,
      system: `Sos un extractor de memoria. Analizás conversaciones y actualizás un perfil estructurado.
Devolvé ÚNICAMENTE el perfil actualizado en este formato exacto (una línea por campo, sin explicaciones):
NOMBRE: [nombre]
PAIS: [país]
OCUPACION: [ocupación]
CONTEXTO: [descripción breve del contexto de trabajo]
PROYECTOS: [proyecto1 (estado) | proyecto2 (estado) | ...]
APRENDIZAJES: [dato importante 1 | dato importante 2 | ...]
RESUMEN_SESION: [resumen de 2 oraciones de esta conversación]`,
      messages: [{
        role: 'user',
        content: `MEMORIA ACTUAL:\n${memoriaActual}\n\nCONVERSACIÓN:\n${texto}\n\nActualizá la memoria con la información nueva.`
      }]
    })
  });

  if (!response.ok) return currentMemory;

  const data = await response.json();
  const text = data.content.map(b => b.text || '').join('').trim();

  // Parser robusto — nunca falla
  const parsed = { ...currentMemory };
  const lineas = text.split('\n');
  for (const linea of lineas) {
    const idx = linea.indexOf(':');
    if (idx === -1) continue;
    const clave = linea.substring(0, idx).trim().toUpperCase();
    const valor = linea.substring(idx + 1).trim();
    if (!valor || valor === 'desconocido' || valor === 'ninguno') continue;
    switch(clave) {
      case 'NOMBRE': parsed.nombre = valor; break;
      case 'PAIS': parsed.pais = valor; break;
      case 'OCUPACION': parsed.ocupacion = valor; break;
      case 'CONTEXTO': parsed.contexto = valor; break;
      case 'PROYECTOS': parsed.proyectos = valor; break;
      case 'APRENDIZAJES': parsed.aprendizajes = valor; break;
      case 'RESUMEN_SESION':
        parsed.conversaciones = parsed.conversaciones || [];
        parsed.conversaciones.unshift({ fecha: new Date().toISOString().split('T')[0], resumen: valor });
        if (parsed.conversaciones.length > 10) parsed.conversaciones = parsed.conversaciones.slice(0, 10);
        break;
    }
  }
  return parsed;
}

function buildMemoryContext(memory) {
  if (!memory) return '';
  const partes = [];
  if (memory.nombre) partes.push(`Nombre: ${memory.nombre}`);
  if (memory.pais) partes.push(`País: ${memory.pais}`);
  if (memory.ocupacion) partes.push(`Ocupación: ${memory.ocupacion}`);
  if (memory.contexto) partes.push(`Contexto: ${memory.contexto}`);
  if (memory.proyectos) partes.push(`Proyectos: ${memory.proyectos}`);
  if (memory.aprendizajes) partes.push(`Aprendizajes: ${memory.aprendizajes}`);
  if (memory.conversaciones && memory.conversaciones.length > 0) {
    const ultimas = memory.conversaciones.slice(0, 3).map(c => `- ${c.fecha}: ${c.resumen}`).join('\n');
    partes.push(`Conversaciones recientes:\n${ultimas}`);
  }
  if (partes.length === 0) return '';
  return '\n\n[MEMORIA DE MATÍAS]\n' + partes.join('\n');
}

async function processAndSaveMemory() {
  if (currentSessionMessages.length === 0) return;
  setStatus('procesando memoria...');
  try {
    const memory = memoryCache || await loadMemory();
    const updated = await extractMemory(currentSessionMessages, memory);
    await sbSet('memoria_principal', updated);
    memoryCache = updated;
    setStatus('memoria guardada ✓');
    setTimeout(() => setStatus('lista para ayudarte'), 2000);
  } catch(e) {
    console.error('Error procesando memoria:', e);
    setStatus('lista para ayudarte');
  }
}

// ── Agente Local ─────────────────────────────────────────────
function getAgentToken() {
  // Hash simple del secret para el token
  return AGENT_SECRET;
}

async function agentCall(endpoint, data = null) {
  if (!AGENT_URL) throw new Error('Agente no configurado');
  const url = `${AGENT_URL}${endpoint}`;
  const opts = {
    method: data ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getAgentToken()}`,
      'ngrok-skip-browser-warning': 'true'
    }
  };
  if (data) opts.body = JSON.stringify(data);
  const res = await fetch(url, opts);
  return res.json();
}

async function agentHealth() {
  try {
    const res = await agentCall('/health');
    return res.status === 'ok';
  } catch(e) { return false; }
}

async function agentListProjects() {
  return agentCall('/projects');
}

async function agentReadFile(path) {
  return agentCall('/read-file', { path });
}

async function agentWriteFile(path, content) {
  return agentCall('/write-file', { path, content });
}

async function agentRunCommand(command, cwd = null) {
  return agentCall('/run-command', { command, cwd, timeout: 60 });
}

async function agentListDir(path) {
  return agentCall('/list-dir', { path });
}

// ── API Anthropic ─────────────────────────────────────────────
async function callPepper(userMessage) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('NO_KEY');

  conversationHistory.push({ role: 'user', content: userMessage });
  currentSessionMessages.push({ rol: 'usuario', mensaje: userMessage });

  const system = SYSTEM_PROMPT + buildMemoryContext(memoryCache);

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
      system,
      messages: conversationHistory
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Error ${response.status}`);
  }

  const data = await response.json();
  let text = data.content.map(b => b.text || '').join('');
  
  // Procesar tags del agente si hay URL configurada
  if (AGENT_URL) {
    text = await processAgentTags(text);
  }
  
  conversationHistory.push({ role: 'assistant', content: text });
  currentSessionMessages.push({ rol: 'pepper', mensaje: text });
  return text;
}

// ── Procesador de tags del agente ────────────────────────────
async function processAgentTags(text) {
  if (!AGENT_URL) return text;
  
  let processed = text;
  let results = [];

  // list_directory
  const listMatches = [...text.matchAll(/<list_directory><path>(.*?)<\/path><\/list_directory>/g)];
  for (const match of listMatches) {
    const path = match[1];
    const res = await agentListDir(path);
    let output = '';
    if (res.success) {
      output = res.items.map(i => `${i.type === 'dir' ? '📁' : '📄'} ${i.name}`).join('
');
    } else {
      output = `Error: ${res.error}`;
    }
    results.push({ tag: match[0], result: `[Contenido de ${path}]
${output}` });
  }

  // read_file
  const readMatches = [...text.matchAll(/<read_file><path>(.*?)<\/path><\/read_file>/g)];
  for (const match of readMatches) {
    const path = match[1];
    const res = await agentReadFile(path);
    let output = res.success ? res.content : `Error: ${res.error}`;
    results.push({ tag: match[0], result: `[Archivo: ${path}]
${output}` });
  }

  // write_file
  const writeMatches = [...text.matchAll(/<write_file><path>(.*?)<\/path><content>([\s\S]*?)<\/content><\/write_file>/g)];
  for (const match of writeMatches) {
    const path = match[1];
    const fileContent = match[2];
    const res = await agentWriteFile(path, fileContent);
    let output = res.success ? `✅ Archivo guardado: ${path}` : `Error: ${res.error}`;
    results.push({ tag: match[0], result: output });
  }

  // run_command
  const cmdMatches = [...text.matchAll(/<run_command><cmd>(.*?)<\/cmd>(?:<cwd>(.*?)<\/cwd>)?<\/run_command>/g)];
  for (const match of cmdMatches) {
    const cmd = match[1];
    const cwd = match[2] || null;
    const res = await agentRunCommand(cmd, cwd);
    let output = '';
    if (res.success) {
      output = res.stdout || res.stderr || '✅ Comando ejecutado sin output';
      if (res.returncode !== 0) output += `
⚠️ Exit code: ${res.returncode}`;
    } else {
      output = `Error: ${res.error}`;
    }
    results.push({ tag: match[0], result: `[Comando: ${cmd}]
${output}` });
  }

  // Reemplazar tags con resultados
  for (const { tag, result } of results) {
    processed = processed.replace(tag, result);
  }

  return processed;
}

// ── Render ────────────────────────────────────────────────────
function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderMarkdown(text) {
  const parts = [];
  let lastIndex = 0;
  const codeBlockRegex = /```([a-zA-Z0-9]*)\n?([\s\S]*?)```/g;
  let match;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      let chunk = escapeHtml(text.slice(lastIndex, match.index));
      chunk = chunk.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      chunk = chunk.replace(/`([^`]+)`/g, '<code>$1</code>');
      chunk = chunk.replace(/\n/g, '<br>');
      parts.push(chunk);
    }
    const lang = match[1] || 'plaintext';
    parts.push(`<pre><code class="language-${lang}">${escapeHtml(match[2].trim())}</code></pre>`);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    let chunk = escapeHtml(text.slice(lastIndex));
    chunk = chunk.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    chunk = chunk.replace(/`([^`]+)`/g, '<code>$1</code>');
    chunk = chunk.replace(/\n/g, '<br>');
    parts.push(chunk);
  }
  return parts.join('');
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
  const riskColor = proposal.riesgo.startsWith('bajo') ? '#1D9E75' : proposal.riesgo.startsWith('alto') ? '#E24B4A' : '#BA7517';
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

function addTyping() {
  const wrap = document.createElement('div');
  wrap.className = 'msg pepper';
  wrap.id = 'typing-indicator';
  wrap.innerHTML = `<div class="msg-av">P</div><div><div class="bubble typing-dots"><span></span><span></span><span></span></div></div>`;
  messagesEl.appendChild(wrap);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}
function removeTyping() { document.getElementById('typing-indicator')?.remove(); }

function addNoKeyNotice() {
  const wrap = document.createElement('div');
  wrap.className = 'msg pepper';
  wrap.innerHTML = `<div class="msg-av">P</div><div><div class="notice"><i class="ti ti-key"></i><div>Para activarme necesitás configurar tu API Key de Anthropic. Hacé clic en <strong>⚙</strong> arriba a la derecha.</div></div></div>`;
  messagesEl.appendChild(wrap);
}

// ── Handlers ──────────────────────────────────────────────────
async function handleDecision(decision, titulo, actionsEl) {
  actionsEl.innerHTML = decision === 'ok'
    ? `<span style="color:#1D9E75;font-size:13px;display:flex;align-items:center;gap:5px"><i class="ti ti-check"></i>Aprobado</span>`
    : `<span style="color:#E24B4A;font-size:13px;display:flex;align-items:center;gap:5px"><i class="ti ti-x"></i>Buscando alternativa...</span>`;

  // Guardar decisión en Supabase
  fetch('/api/save-decision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: USER_ID, contexto: titulo, propuesta: titulo, respuesta: decision === 'ok' ? 'OK' : 'NO OK' })
  }).catch(() => {});

  const msg = decision === 'ok' ? `OK, adelante con: ${titulo}` : `NO OK para: ${titulo}. Buscá una alternativa.`;
  addMessage('user', decision === 'ok' ? 'OK — adelante' : 'NO OK — buscá otra alternativa');
  addTyping();
  try {
    const reply = await callPepper(msg);
    removeTyping();
    const { cleanText, proposal } = parseResponse(reply);
    addMessage('pepper', cleanText, proposal);
    speakText(cleanText);
  } catch(e) {
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
  } catch(e) {
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

// ── Eventos ───────────────────────────────────────────────────
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
btnSave.addEventListener('click', async () => {
  await processAndSaveMemory();
});
btnClear.addEventListener('click', async () => {
  await processAndSaveMemory();
  conversationHistory = [];
  currentSessionMessages = [];
  messagesEl.innerHTML = '';
  const memory = memoryCache || {};
  const nombre = memory.nombre || 'Matías';
  addMessage('pepper', `Listo ${nombre}, empezamos una nueva conversación. ¿En qué te ayudo?`);
});
btnSettings.addEventListener('click', () => modalSettings.classList.remove('hidden'));
modalClose.addEventListener('click', () => modalSettings.classList.add('hidden'));
modalSettings.addEventListener('click', (e) => { if (e.target === modalSettings) modalSettings.classList.add('hidden'); });
btnSaveKey.addEventListener('click', async () => {
  const key = apiKeyInput.value.trim();
  const agentUrl = document.getElementById('agent-url-input')?.value.trim().replace(/\/$/, '');
  if (key) {
    localStorage.setItem('pepper_api_key', key);
    if (agentUrl) {
      localStorage.setItem('pepper_agent_url', agentUrl);
      AGENT_URL = agentUrl;
      // Verificar conexión con agente
      const ok = await agentHealth();
      setStatus(ok ? 'agente conectado ✓' : 'agente no disponible');
      setTimeout(() => setStatus('lista para ayudarte'), 3000);
    }
    modalSettings.classList.add('hidden');
    if (messagesEl.querySelector('.notice')) { messagesEl.innerHTML = ''; init(); }
  }
});
window.addEventListener('beforeunload', () => { processAndSaveMemory(); });

// ── Init ──────────────────────────────────────────────────────
async function init() {
  if (!getApiKey()) { addNoKeyNotice(); setStatus('necesita configuración'); return; }
  apiKeyInput.value = getApiKey();
  const savedAgentUrl = localStorage.getItem('pepper_agent_url');
  if (savedAgentUrl) {
    AGENT_URL = savedAgentUrl;
    const agentInput = document.getElementById('agent-url-input');
    if (agentInput) agentInput.value = savedAgentUrl;
    const ok = await agentHealth();
    if (ok) setStatus('agente conectado ✓');
  }
  setStatus('cargando memoria...');
  memoryCache = await loadMemory();
  const nombre = memoryCache.nombre || '';
  setStatus('lista para ayudarte');
  const saludo = nombre
    ? `Hola ${nombre}! ¿En qué te ayudo hoy?`
    : 'Hola! Soy PEPPER. Contame qué necesitás resolver hoy.';
  addMessage('pepper', saludo);
}

window.speechSynthesis?.getVoices();
init();
