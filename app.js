const SYSTEM_PROMPT = `Sos PEPPER (Personalized & Efficient Personal Assistant with Enhanced Reasoning), una IA asistente creada para ayudar a tu usuario a desarrollar proyectos que mejoren la vida de las personas.

Tu personalidad:
- Hablás en español rioplatense, de manera clara, cálida y directa
- Sos proactiva: si ves soluciones que el usuario no ve, las proponés
- Siempre recordás que el usuario decide: vos proponés, él aprueba con OK o NO OK
- Evaluás riesgos antes de actuar y los comunicás con honestidad
- Sos concisa: máximo 3-4 oraciones antes de una propuesta

Tu flujo de trabajo:
1. Al iniciar, revisás la memoria disponible para recordar el contexto del usuario
2. Recibís la necesidad del usuario
3. La interpretás y comparás con mejores prácticas y benchmarks reales
4. Si es una tarea concreta, generás una PROPUESTA estructurada
5. Esperás el OK del usuario antes de continuar
6. Si algo puede dañar a alguien, no avanzás y lo comunicás claramente

Formato de propuesta — usalo cuando tengas un plan concreto:
[PROPUESTA]
título: (título corto de la propuesta)
pasos: (cada paso separado por el carácter |)
riesgo: (bajo|medio|alto — descripción de una línea)
[/PROPUESTA]

No uses el bloque PROPUESTA para respuestas conversacionales o cuando solo estás haciendo preguntas de clarificación.`;

let conversationHistory = [];
let attachedFile = null;
let isListening = false;
let recognition = null;
let memoryData = { perfil: {}, proyectos: [], conversaciones: [] };
let currentSessionMessages = [];

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
const ghTokenInput = document.getElementById('gh-token-input');
const btnSaveKey = document.getElementById('btn-save-key');

function getApiKey() { return localStorage.getItem('pepper_api_key') || ''; }
function getGhToken() { return localStorage.getItem('pepper_gh_token') || ''; }
function getGhRepo() { return 'INTEGRACION-CP/pepper'; }

async function init() {
  const key = getApiKey();
  if (key) {
    apiKeyInput.value = key;
    if (ghTokenInput && getGhToken()) ghTokenInput.value = getGhToken();
    await loadMemory();
    addWelcomeMessage();
  } else {
    addNoKeyNotice();
  }
}

// ── GitHub Storage ──────────────────────────────────────────────

async function githubRequest(path, method = 'GET', body = null) {
  const token = getGhToken();
  if (!token) return null;
  const url = `https://api.github.com/repos/${getGhRepo()}/contents/${path}`;
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Accept': 'application/vnd.github+json'
  };
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (!res.ok && res.status !== 404) return null;
  if (res.status === 404) return null;
  return res.json();
}

async function loadMemory() {
  try {
    const file = await githubRequest('memory/memory.json');
    if (file && file.content) {
      const decoded = atob(file.content.replace(/\n/g, ''));
      memoryData = JSON.parse(decoded);
    }
  } catch (e) {
    memoryData = { perfil: {}, proyectos: [], conversaciones: [] };
  }
}

async function saveMemory() {
  try {
    const token = getGhToken();
    if (!token) return;
    const content = btoa(unescape(encodeURIComponent(JSON.stringify(memoryData, null, 2))));
    const existing = await githubRequest('memory/memory.json');
    const body = {
      message: `memoria: actualización ${new Date().toISOString().split('T')[0]}`,
      content,
      ...(existing ? { sha: existing.sha } : {})
    };
    await githubRequest('memory/memory.json', 'PUT', body);
  } catch (e) {
    console.error('Error guardando memoria:', e);
  }
}

async function saveFile(path, contentStr, commitMsg) {
  try {
    const token = getGhToken();
    if (!token) return false;
    const content = btoa(unescape(encodeURIComponent(contentStr)));
    const existing = await githubRequest(path);
    const body = {
      message: commitMsg || `pepper: guardar ${path}`,
      content,
      ...(existing ? { sha: existing.sha } : {})
    };
    const res = await githubRequest(path, 'PUT', body);
    return !!res;
  } catch (e) {
    return false;
  }
}

async function saveConversation() {
  if (currentSessionMessages.length === 0) return;
  const date = new Date();
  const dateStr = date.toISOString().split('T')[0];
  const timeStr = date.toTimeString().split(' ')[0].replace(/:/g, '-');
  const path = `conversaciones/${dateStr}/${timeStr}.json`;
  const session = {
    fecha: date.toISOString(),
    mensajes: currentSessionMessages
  };
  await saveFile(path, JSON.stringify(session, null, 2), `conversación ${dateStr} ${timeStr}`);

  // Actualizar memoria con resumen de la sesión
  memoryData.conversaciones = memoryData.conversaciones || [];
  memoryData.conversaciones.unshift({ fecha: date.toISOString(), mensajes: currentSessionMessages.length });
  if (memoryData.conversaciones.length > 50) memoryData.conversaciones = memoryData.conversaciones.slice(0, 50);
  await saveMemory();
}

function buildMemoryContext() {
  if (!memoryData || Object.keys(memoryData.perfil || {}).length === 0) return '';
  const proyectos = (memoryData.proyectos || []).map(p => `- ${p.nombre}: ${p.estado}`).join('\n');
  return `\n\n[MEMORIA DE CONVERSACIONES ANTERIORES]\nProyectos conocidos:\n${proyectos || 'Ninguno aún'}\nPerfil: ${JSON.stringify(memoryData.perfil)}`;
}

// ── API Call ──────────────────────────────────────────────────

async function callPepper(userMessage) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('NO_KEY');

  conversationHistory.push({ role: 'user', content: userMessage });
  currentSessionMessages.push({ rol: 'usuario', mensaje: userMessage, hora: new Date().toISOString() });

  const systemWithMemory = SYSTEM_PROMPT + buildMemoryContext();

  const messages = [
    { role: 'system', content: systemWithMemory },
    ...conversationHistory
  ];

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 1000,
      messages
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Error ${response.status}`);
  }

  const data = await response.json();
  const text = data.choices[0].message.content;
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
  bubble.textContent = text;
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

function addWelcomeMessage() {
  const proyectos = (memoryData.proyectos || []).filter(p => p.estado === 'activo');
  let msg = 'Hola! Soy PEPPER. Contame qué necesitás resolver hoy y lo analizamos juntos.';
  if (proyectos.length > 0) {
    msg = `Hola de nuevo! Tengo en memoria ${proyectos.length} proyecto(s) activo(s): ${proyectos.map(p => p.nombre).join(', ')}. ¿Continuamos con alguno o arrancamos algo nuevo?`;
  }
  addMessage('pepper', msg);
}

function addNoKeyNotice() {
  const wrap = document.createElement('div');
  wrap.className = 'msg pepper';
  wrap.innerHTML = `<div class="msg-av">P</div><div><div class="notice"><i class="ti ti-key"></i><div>Para activarme necesitás configurar tu API Key de Groq y tu GitHub Token. Hacé clic en el ícono <strong>⚙</strong> arriba a la derecha.</div></div></div>`;
  messagesEl.appendChild(wrap);
}

async function handleDecision(decision, titulo, actionsEl) {
  actionsEl.innerHTML = decision === 'ok'
    ? `<span style="color:#1D9E75;font-size:13px;display:flex;align-items:center;gap:5px"><i class="ti ti-check"></i>Aprobado</span>`
    : `<span style="color:#E24B4A;font-size:13px;display:flex;align-items:center;gap:5px"><i class="ti ti-x"></i>Buscando alternativa...</span>`;
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
  await saveConversation();
  conversationHistory = [];
  currentSessionMessages = [];
  messagesEl.innerHTML = '';
  addWelcomeMessage();
});
btnSettings.addEventListener('click', () => modalSettings.classList.remove('hidden'));
modalClose.addEventListener('click', () => modalSettings.classList.add('hidden'));
modalSettings.addEventListener('click', (e) => { if (e.target === modalSettings) modalSettings.classList.add('hidden'); });
btnSaveKey.addEventListener('click', () => {
  const key = apiKeyInput.value.trim();
  const ghToken = ghTokenInput ? ghTokenInput.value.trim() : '';
  if (key) {
    localStorage.setItem('pepper_api_key', key);
    if (ghToken) localStorage.setItem('pepper_gh_token', ghToken);
    modalSettings.classList.add('hidden');
    if (messagesEl.querySelector('.notice')) { messagesEl.innerHTML = ''; addWelcomeMessage(); }
  }
});

// Guardar conversación al cerrar
window.addEventListener('beforeunload', () => { saveConversation(); });

window.speechSynthesis?.getVoices();
init();