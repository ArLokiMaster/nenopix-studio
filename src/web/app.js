/* Nenopix Studio — front-end controller
   Vanilla JS over Socket.IO. Sections: state, helpers, theme, socket,
   routing, sidebar, composer, dropdown menu, generation, branching,
   projects, modals, gallery, lightbox. */

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion:reduce)').matches;
const SPRING = 'cubic-bezier(.22,1,.36,1)';

let socket;

// ── Reactive State Manager ───────────────────────────────────────────────────
const STATE_MAP = {
  providers: ['optbar'],
  models: ['optbar'],
  projects: ['sidebar', 'topbar', 'project'],
  sessions: ['sidebar'],
  session: ['chat', 'topbar'],
  currentUser: ['auth'],
  route: ['sidebar', 'topbar', 'project'],
  view: ['sidebar', 'topbar'],
  opts: ['optbar'],
  search: ['sidebar'],
  refs: ['refs'],
};

const pendingUpdates = new Set();
let renderScheduled = false;

function scheduleRender(viewName) {
  pendingUpdates.add(viewName);
  if (!renderScheduled) {
    renderScheduled = true;
    queueMicrotask(() => {
      renderScheduled = false;
      const updates = Array.from(pendingUpdates);
      pendingUpdates.clear();
      updates.forEach(up => {
        try {
          if (up === 'sidebar') renderSidebar();
          else if (up === 'topbar') renderTopbar();
          else if (up === 'chat') renderChat();
          else if (up === 'optbar') renderOptBar();
          else if (up === 'auth') renderAuthUI();
          else if (up === 'refs') renderRefs();
          else if (up === 'project' && state.route.kind === 'project') renderProject(state.route.id);
        } catch (e) {
          console.error('[reactive render error]', e);
        }
      });
    });
  }
}

function makeReactive(obj, callback, topLevelKey = null) {
  return new Proxy(obj, {
    get(target, key) {
      const val = target[key];
      if (val && typeof val === 'object' && !(val instanceof Set) && !(val instanceof Date)) {
        return makeReactive(val, callback, topLevelKey || key);
      }
      return val;
    },
    set(target, key, value) {
      const oldVal = target[key];
      target[key] = value;
      if (oldVal !== value) {
        callback(topLevelKey || key);
      }
      return true;
    }
  });
}

const rawState = {
  providers: [], models: [], projects: [], sessions: [], config: {},
  session: null,                 // full tree of the open chat
  currentUser: null,             // { id, username, role, allowedProviders, costLimit, costUsed, genLimit, genUsed }
  authMode: 'solo',              // 'solo' | 'team'
  route: { kind: 'new', id: null },
  theme: localStorage.getItem('if-theme') || 'system',
  view: 'chat',
  busy: false,
  pendingNew: false,
  pendingProjectId: null,        // creating a chat inside a project
  expandedProjects: new Set(),
  search: '',
  refs: [],                      // [{full, thumb}]
  opts: {
    provider: '', model: '', size: '1024x1024', quality: 'standard',
    style: '', count: 1, enhance: true, negative: '',
    seed: '', steps: '', cfgScale: '', format: 'png',
  },
};

const state = makeReactive(rawState, (key) => {
  const views = STATE_MAP[key];
  if (views) {
    views.forEach(v => scheduleRender(v));
  }
});

// Aspect-ratio tiles → representative pixel sizes (providers snap as needed)
const RATIOS = [
  { r: '1:1',  size: '1024x1024', w: 22, h: 22 },
  { r: '16:9', size: '1792x1024', w: 26, h: 15 },
  { r: '9:16', size: '1024x1792', w: 15, h: 26 },
  { r: '4:3',  size: '1024x768',  w: 24, h: 18 },
  { r: '3:4',  size: '768x1024',  w: 18, h: 24 },
  { r: '3:2',  size: '1216x832',  w: 25, h: 17 },
  { r: '2:3',  size: '832x1216',  w: 17, h: 25 },
];
const ratioFor = (size) => (RATIOS.find(x => x.size === size) || { r: 'Custom' }).r;

const QUALITIES = [
  { value: 'standard', label: 'Standard', hint: 'Balanced' },
  { value: 'hd',       label: 'HD',       hint: 'Higher fidelity' },
  { value: 'draft',    label: 'Draft',    hint: 'Fast preview' },
];
const STYLES = [
  { value: '', label: 'No style' },
  { value: 'photorealistic', label: 'Photorealistic' },
  { value: 'cinematic', label: 'Cinematic' },
  { value: 'anime', label: 'Anime' },
  { value: 'concept', label: 'Concept Art' },
  { value: 'watercolor', label: 'Watercolor' },
  { value: '3d', label: '3D Render' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'dark', label: 'Dark Fantasy' },
];
const COUNTS = [1, 2, 4].map(n => ({ value: n, label: n + (n > 1 ? ' images' : ' image') }));
const FORMATS = ['png', 'jpg', 'webp'].map(f => ({ value: f, label: f.toUpperCase() }));
const SIZES = ['1024x1024','1792x1024','1024x1792','1152x896','1216x832','768x768','512x512']
  .map(s => ({ value: s, label: s.replace('x', '×') }));
const NEG_PRESETS = ['blurry','low quality','watermark','text','deformed','extra fingers',
  'bad anatomy','jpeg artifacts','oversaturated','cropped','duplicate','ugly'];
const QUICK_CARDS = [
  { p: 'hyperrealistic portrait of an astronaut on Mars at golden hour, NASA photo style, 8K', t: 'Astronaut on Mars', s: 'Photorealistic · Space', i: '<circle cx="12" cy="12" r="10"/><path d="M12 2a15 15 0 014 10 15 15 0 01-4 10 15 15 0 01-4-10 15 15 0 014-10"/><path d="M2 12h20"/>' },
  { p: 'aerial view of ancient Japanese temple surrounded by cherry blossoms, misty morning, drone photography', t: 'Japanese Temple', s: 'Cinematic · Architecture', i: '<path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>' },
  { p: 'cyberpunk samurai warrior in neon-lit Tokyo alley at night, rain reflections, ultra detailed', t: 'Cyberpunk Samurai', s: 'Dark fantasy · Action', i: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>' },
  { p: 'macro photography of a dewdrop on a spiderweb at sunrise, golden bokeh, National Geographic', t: 'Dewdrop Macro', s: 'Nature · Photography', i: '<path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/>' },
];

// ── Helpers ──────────────────────────────────────────────────────────────────
const esc = (s) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
function ago(ts){ if(!ts) return ''; const d=Date.now()-new Date(ts).getTime();
  if(d<60000) return 'just now'; if(d<3600000) return Math.floor(d/60000)+'m ago';
  if(d<86400000) return Math.floor(d/3600000)+'h ago'; return Math.floor(d/86400000)+'d ago'; }
function toast(msg){ const t=$('#toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(t._t); t._t=setTimeout(()=>t.classList.remove('show'),2800); }
function autosize(el){ el.style.height='auto'; el.style.height=Math.min(el.scrollHeight,200)+'px'; }
function scrollBottom(){ const s=$('#scroll'); requestAnimationFrame(()=>{ s.scrollTop=s.scrollHeight; }); }
const SVG = (inner, n='icon') => `<span class="${n}"><svg viewBox="0 0 24 24">${inner}</svg></span>`;
const I = {
  chip:'<path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>',
  star:'<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  layers:'<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  sliders:'<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  copy:'<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>',
  check:'<polyline points="20 6 9 17 4 12"/>',
  trash:'<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>',
  edit:'<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4z"/>',
  folder:'<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>',
  redo:'<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>',
};

// ── Theme ────────────────────────────────────────────────────────────────────
function applyTheme(val){
  state.theme = val; localStorage.setItem('if-theme', val);
  document.documentElement.setAttribute('data-theme', val);
  $$('#themeSwitch button').forEach(b => b.classList.toggle('active', b.dataset.themeVal === val));
}

// ── Socket ───────────────────────────────────────────────────────────────────
function wireSocket(){
  socket.on('connect', () => {
    socket.emit('get:providers'); socket.emit('get:projects');
    socket.emit('get:sessions'); socket.emit('get:config');
  });
  socket.on('connect_error', () => { if (state.currentUser) return; authFailed(); });
  socket.on('auth:me', (u) => { state.currentUser = u; renderAuthUI(); });
  socket.on('providers:data', (ps) => {
    state.providers = ps || []; fillSettingsProviders(); renderProviderKeys();
    // Only auto-load models once a provider is explicitly chosen — otherwise wait
    // for config:data so we don't load the wrong (first) provider's models.
    if (state.opts.provider) loadModels(state.opts.provider);
    renderOptBar();
  });
  socket.on('projects:data', (p) => { state.projects = p || []; renderSidebar(); if (state.route.kind === 'project') renderProject(state.route.id); });
  socket.on('sessions:data', (s) => { state.sessions = s || []; renderSidebar(); if (state.session) { const current = state.sessions.find(x => x.id === state.session.id); if (current && state.session.title !== current.title) { state.session.title = current.title; renderTopbar(); } } });
  socket.on('session:data', (s) => onSessionData(s));
  socket.on('models:data', (m) => {
    state.models = m || [];
    // Reset selection if it doesn't belong to this provider's list (guards against
    // a stale model from a previously-loaded provider).
    const valid = state.opts.model && state.models.some(x => x.id === state.opts.model);
    if (!valid) { const rec = state.models.find(x => x.recommended); state.opts.model = rec ? rec.id : ''; }
    renderOptBar();
  });
  socket.on('config:data', (cfg) => onConfig(cfg));
  socket.on('generate:start', () => {});
  socket.on('generate:done', (r) => { setBusy(false); stopThinking(); if (state.route.kind !== 'chat') state.pendingNew = true; });
  socket.on('generate:error', (m) => { setBusy(false); removeOptimistic(); toast(m || 'Generation failed'); if (state.route.kind === 'new' || !state.session) { state.pendingNew = false; showHero(); } });
  socket.on('enhance:result', ({ enhanced }) => onEnhanced(enhanced));
  socket.on('enhance:error', (m) => { magicDone(); toast(m || 'Enhance failed'); });
  socket.on('dialog:folderPicked', ({ dir }) => { if (dir) { $('#cfgOutput').value = dir; checkAndSetOutputDir(dir); } });
  socket.on('outputDir:result', (r) => onOutputDirResult(r));
  socket.on('provider:keyResult', (r) => onProviderKeyResult(r));
  socket.on('gallery:data', (imgs) => renderGalleryImages(imgs || []));
}

function onConfig(cfg){
  state.config = cfg || {};
  if (cfg.defaultProvider) {
    state.opts.provider = cfg.defaultProvider;
  }
  if (cfg.defaultModel) {
    state.opts.model = cfg.defaultModel;
  }
  state.opts.size = cfg.defaultSize || state.opts.size;
  state.opts.quality = cfg.defaultQuality || state.opts.quality;
  state.opts.enhance = cfg.enhancePrompts !== false;
  $('#cfgSize').value = cfg.defaultSize || '1024x1024';
  $('#cfgQuality').value = cfg.defaultQuality || 'standard';
  $('#cfgOutput').value = cfg.outputDir || '';
  $('#cfgEnhance').value = cfg.enhanceProvider || 'rule-based';
  if (cfg.defaultProvider) $('#cfgProvider').value = cfg.defaultProvider;
  // Now that the default provider is known, load its models (resets any stale pick).
  loadModels(activeProviderId());
  renderOptBar();
}

function onSessionData(s){
  const isCurrent = (state.route.kind === 'chat' && state.route.id === s.id) || state.pendingNew;
  if (!isCurrent) return;
  state.session = s;

  // Sync composer options (state.opts) to match the loaded session's last generation settings
  if (s.activeLeafId && s.nodes && s.nodes[s.activeLeafId]) {
    let node = s.nodes[s.activeLeafId];
    if (node.role === 'user' && node.parentId && s.nodes[node.parentId]) {
      node = s.nodes[node.parentId];
    }
    const r = node.result || {};
    if (r.provider || r.model) {
      state.opts.provider = r.provider || state.opts.provider;
      state.opts.model = r.model || state.opts.model;
      state.opts.size = r.size || state.opts.size;
      state.opts.quality = r.quality || state.opts.quality;
      state.opts.style = r.style || state.opts.style;
      state.opts.count = r.count || state.opts.count;
      state.opts.enhance = r.enhance !== false;
      state.opts.negative = r.negativePrompt || r.negative || state.opts.negative;
      state.opts.seed = r.seed != null ? r.seed : '';
      state.opts.steps = r.steps != null ? r.steps : '';
      state.opts.cfgScale = r.cfgScale != null ? r.cfgScale : '';
      state.opts.format = r.format || state.opts.format;
      loadModels(state.opts.provider);
    }
  }

  if (state.route.kind !== 'chat' || state.route.id !== s.id) {
    state.pendingNew = false; state.pendingProjectId = null;
    navigate('#/c/' + s.id);          // router will renderChat
  } else {
    renderChat();
  }
}

// ── Routing ──────────────────────────────────────────────────────────────────
function navigate(hash){ if (location.hash === hash) router(); else location.hash = hash; }
function parseHash(){
  const h = location.hash.replace(/^#/, '');
  const m = h.match(/^\/c\/(.+)$/); if (m) return { kind: 'chat', id: m[1] };
  const p = h.match(/^\/p\/(.+)$/); if (p) return { kind: 'project', id: p[1] };
  return { kind: 'new', id: null };
}
function router(){
  state.route = parseHash();
  setView(state.route.kind === 'project' ? 'project' : state.view === 'gallery' ? 'gallery' : 'chat', true);
  renderSidebar(); renderTopbar();
  if (state.route.kind === 'chat') {
    if (state.session && state.session.id === state.route.id) renderChat();
    else { state.session = null; socket.emit('get:session', state.route.id); $('#msgs').innerHTML = ''; dockComposer(false); $('#hero').classList.add('hide'); }
  } else if (state.route.kind === 'project') {
    renderProject(state.route.id);
  } else {
    state.session = null; showHero();
  }
}
window.addEventListener('hashchange', router);

// ── View switching (chat / gallery / project) ────────────────────────────────
function setView(v, fromRouter){
  if (v !== 'project') state.view = v;
  $('#chatview').style.display = v === 'chat' ? 'flex' : 'none';
  $('#gallery').style.display = v === 'gallery' ? 'block' : 'none';
  $('#projview').style.display = v === 'project' ? 'block' : 'none';
  $$('#viewTabs .vtab').forEach(t => t.classList.toggle('active', t.dataset.view === v));
  if (v === 'gallery'){ $('#galGrid').innerHTML = galleryLoadingHTML(); socket.emit('get:gallery'); }
}

// ── Sidebar ──────────────────────────────────────────────────────────────────
function thumbHTML(t){ return t ? `<img src="${esc(t)}" loading="lazy">`
  : SVG('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>','icon-sm'); }
const thumbWrapClass = (t) => t ? 'has-img' : '';

function sessionRow(s){
  return `<div class="ses-item ${state.route.id===s.id?'active':''}" data-act="open-chat" data-id="${s.id}">
    <div class="ses-thumb ${thumbWrapClass(s.thumbnail)}">${thumbHTML(s.thumbnail)}</div>
    <div class="ses-meta"><div class="ses-title">${esc(s.title||'Untitled')}</div><div class="ses-time">${ago(s.updatedAt)}</div></div>
    <button class="ses-menu" data-act="chat-menu" data-id="${s.id}" title="Options">${SVG('<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>','icon-sm')}</button>
  </div>`;
}
function renderSidebar(){
  const q = state.search.trim().toLowerCase();
  const match = (s) => !q || (s.title || '').toLowerCase().includes(q);
  // Projects
  $('#projectsSection').style.display = state.projects.length ? '' : 'none';
  $('#projectsList').innerHTML = state.projects.map(p => {
    const chats = state.sessions.filter(s => s.projectId === p.id && match(s));
    const open = state.expandedProjects.has(p.id);
    return `<div class="proj-row ${open?'open':''} ${state.route.kind==='project'&&state.route.id===p.id?'active':''}" data-id="${p.id}">
      <span class="proj-caret" data-act="toggle-project" data-id="${p.id}">${SVG('<path d="M9 18l6-6-6-6"/>')}</span>
      <span class="proj-dot" style="background:${esc(p.color)}"></span>
      <span class="proj-name" data-act="open-project" data-id="${p.id}">${esc(p.name)}</span>
      <span class="proj-count">${chats.length}</span>
    </div>
    <div class="proj-children" style="max-height:${open?(chats.length*46+6):0}px">${chats.map(sessionRow).join('')}</div>`;
  }).join('');
  // Ungrouped chats
  const loose = state.sessions.filter(s => !s.projectId && match(s));
  $('#chatsList').innerHTML = loose.length ? loose.map(sessionRow).join('')
    : `<div class="empty-note">No chats yet.<br>Start a new generation above.</div>`;
}

// ── Topbar ───────────────────────────────────────────────────────────────────
function renderTopbar(){
  let name = 'New generation';
  if (state.route.kind === 'chat' && state.session) name = state.session.title || 'Chat';
  else if (state.route.kind === 'project') { const p = state.projects.find(x => x.id === state.route.id); name = p ? p.name : 'Project'; }
  const proj = state.session && state.session.projectId ? state.projects.find(p => p.id === state.session.projectId) : null;
  $('#sesName').innerHTML = (proj ? `<span class="crumb">${esc(proj.name)} ›</span> ` : '') + esc(name);
}

// ── Composer placement + options ──────────────────────────────────────────────
function showHero(){
  $('#hero').classList.remove('hide'); $('#dock').classList.add('hide');
  $('#msgs').innerHTML = '';
  const c = $('#composer'); c.style.display = ''; $('#heroSlot').appendChild(c);

  // Reset composer options to default configuration settings
  const cfg = state.config || {};
  state.opts.provider = cfg.defaultProvider || '';
  state.opts.model = cfg.defaultModel || '';
  state.opts.size = cfg.defaultSize || '1024x1024';
  state.opts.quality = cfg.defaultQuality || 'standard';
  state.opts.enhance = cfg.enhancePrompts !== false;
  state.opts.style = '';
  state.opts.count = 1;
  state.opts.negative = '';
  state.opts.seed = '';
  state.opts.steps = '';
  state.opts.cfgScale = '';
  state.opts.format = 'png';
  loadModels(activeProviderId());

  setView('chat'); renderTopbar(); renderQuickCards(); $('#prompt').focus();
}
function dockComposer(animate){
  const c = $('#composer'); c.style.display = '';
  if (c.parentElement === $('#dockSlot') && $('#dock').classList.contains('hide') === false) return;
  const first = c.getBoundingClientRect();
  $('#hero').classList.add('hide'); $('#dock').classList.remove('hide');
  $('#dockSlot').appendChild(c);
  if (animate && !reduceMotion()){
    const last = c.getBoundingClientRect();
    const dx = first.left - last.left, dy = first.top - last.top;
    if (dx || dy) c.animate([{ transform:`translate(${dx}px,${dy}px)` }, { transform:'none' }], { duration: 540, easing: SPRING });
  }
}
function renderQuickCards(){
  $('#quickGrid').innerHTML = QUICK_CARDS.map((c, i) => `
    <div class="qcard" data-act="quick" data-prompt="${esc(c.p)}" style="animation-delay:${0.12+i*0.05}s">
      <div class="qcard-icon">${SVG(c.i)}</div>
      <div class="qcard-title">${esc(c.t)}</div><div class="qcard-sub">${esc(c.s)}</div>
    </div>`).join('');
}

function activeProviderId(){ return state.opts.provider || state.config.defaultProvider || (state.providers[0] && state.providers[0].id) || ''; }
function activeProvider(){ return state.providers.find(p => p.id === activeProviderId()); }
function providerSupports(feat){ const p = activeProvider(); return p ? (p.features || []).includes(feat) : true; }

function pill(id, iconHTML, label, opts = {}){
  return `<button class="pill ${opts.active?'active':''} ${opts.disabled?'disabled':''}" data-pill="${id}" ${opts.title?`title="${esc(opts.title)}"`:''}>
    ${iconHTML||''}<span>${esc(label)}</span>${opts.caret!==false?SVG('<path d="M6 9l6 6 6-6"/>','caret'):''}</button>`;
}
function renderOptBar(){
  const o = state.opts;
  const modelName = o.model ? ((state.models.find(m=>m.id===o.model)||{}).name || o.model) : 'Default model';
  const count = o.count + (o.count>1?' images':' image');
  const hasExtras = !!(o.provider || o.style || o.negative || o.seed || o.steps || o.cfgScale || o.quality !== 'standard');
  $('#optBar').innerHTML =
    pill('model', SVG(I.star,'icon-xs'), modelName) +
    pill('ratio', `<span class="ratio-glyph"></span>`, ratioFor(o.size)) +
    pill('count', '', count) +
    `<span class="opt-spacer"></span>` +
    `<button class="gear-btn ${hasExtras?'has-extras':''}" id="gearBtn" data-act="open-gen-settings" title="More generation settings">${SVG('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>','icon-sm')}</button>`;
  // Attach button capability gate
  const canAttach = providerSupports('image-to-image');
  const ab = $('#attachBtn'); ab.disabled = !canAttach;
  ab.title = canAttach ? 'Attach reference image (PNG, JPG, WEBP · up to 10MB)' : `${(activeProvider()||{}).name||'This provider'} can't use reference images`;
  if (genPopupEl) renderGenPopupBody();
}

// ── Generation settings popup (provider / quality / style / negative / advanced) ─
let genPopupEl = null;
function closeGenPopup(){ if (genPopupEl){ genPopupEl.remove(); genPopupEl = null; document.removeEventListener('pointerdown', onGenPopupDocDown, true); } }
function onGenPopupDocDown(e){ if (genPopupEl && !genPopupEl.contains(e.target) && !e.target.closest('#gearBtn')) closeGenPopup(); }
function genPopupBodyHTML(){
  const o = state.opts;
  const negSupported = providerSupports('negative-prompts');
  return `
    <div class="gp-head">${SVG('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>','icon-sm')}Generation settings</div>
    <div class="gp-row"><label>Provider</label><select id="gpProvider">
      <option value="">Auto (smart routing)</option>
      ${state.providers.map(p=>`<option value="${esc(p.id)}" ${o.provider===p.id?'selected':''}>${esc(p.name)}${p.status==='available'?'':' (not configured)'}</option>`).join('')}
    </select></div>
    <div class="gp-row"><label>Quality</label><select id="gpQuality">
      ${QUALITIES.map(q=>`<option value="${q.value}" ${o.quality===q.value?'selected':''}>${esc(q.label)}</option>`).join('')}
    </select></div>
    <div class="gp-row"><label>Style</label><select id="gpStyle">
      ${STYLES.map(s=>`<option value="${esc(s.value)}" ${o.style===s.value?'selected':''}>${esc(s.label)}</option>`).join('')}
    </select></div>
    <div class="gp-row"><label>Format</label><select id="gpFormat">
      ${FORMATS.map(f=>`<option value="${f.value}" ${o.format===f.value?'selected':''}>${esc(f.label)}</option>`).join('')}
    </select></div>
    <div class="gp-row"><label>Exact size</label><select id="gpSize">
      ${SIZES.map(s=>`<option value="${s.value}" ${o.size===s.value?'selected':''}>${esc(s.label)}</option>`).join('')}
    </select></div>
    <label class="gp-toggle"><span>Auto-enhance prompt</span><input type="checkbox" id="gpEnhance" style="display:none" ${o.enhance?'checked':''}><span class="sw" id="gpEnhanceSw"></span></label>
    <button class="gp-neg-btn ${o.negative?'active':''}" id="gpNegBtn" ${negSupported?'':'disabled title="This provider ignores negative prompts"'}>
      <span>${o.negative?'Negative prompt set ✓':'Set negative prompt…'}</span>${SVG('<path d="M9 18l6-6-6-6"/>','icon-xs')}</button>
    <div class="gp-sep"></div>
    <div class="gp-sec-label">Advanced</div>
    <div class="gp-adv-row">
      <span class="adv-field">Seed<input id="gpSeed" type="number" placeholder="random" value="${esc(o.seed)}"></span>
      <button class="gp-dice" id="gpDice" title="Random seed">${SVG('<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.3"/><circle cx="16" cy="16" r="1.3"/><circle cx="16" cy="8" r="1.3"/><circle cx="8" cy="16" r="1.3"/>','icon-xs')}</button>
      <span class="adv-field">Steps<input id="gpSteps" type="number" placeholder="auto" value="${esc(o.steps)}"></span>
      <span class="adv-field">CFG<input id="gpCfg" type="number" step="0.5" placeholder="auto" value="${esc(o.cfgScale)}"></span>
    </div>`;
}
function wireGenPopupBody(){
  const o = state.opts;
  $('#gpProvider', genPopupEl).onchange = e => { o.provider = e.target.value; o.model=''; state.models=[]; loadModels(activeProviderId()); renderOptBar(); };
  $('#gpQuality', genPopupEl).onchange = e => { o.quality = e.target.value; renderOptBar(); };
  $('#gpStyle', genPopupEl).onchange = e => { o.style = e.target.value; renderOptBar(); };
  $('#gpFormat', genPopupEl).onchange = e => { o.format = e.target.value; renderOptBar(); };
  $('#gpSize', genPopupEl).onchange = e => { o.size = e.target.value; renderOptBar(); };
  const encSw = $('#gpEnhanceSw', genPopupEl);
  encSw.closest('.gp-toggle').classList.toggle('on', o.enhance);
  encSw.closest('.gp-toggle').onclick = () => { o.enhance = !o.enhance; renderOptBar(); };
  $('#gpNegBtn', genPopupEl).onclick = () => { closeGenPopup(); openNegative(); };
  $('#gpSeed', genPopupEl).oninput = e => o.seed = e.target.value;
  $('#gpSteps', genPopupEl).oninput = e => o.steps = e.target.value;
  $('#gpCfg', genPopupEl).oninput = e => o.cfgScale = e.target.value;
  $('#gpDice', genPopupEl).onclick = () => { o.seed = Math.floor(Math.random()*1e9); $('#gpSeed', genPopupEl).value = o.seed; renderOptBar(); };
}
function renderGenPopupBody(){ genPopupEl.innerHTML = genPopupBodyHTML(); wireGenPopupBody(); }
function openGenPopup(anchor){
  if (genPopupEl){ closeGenPopup(); return; }
  const p = document.createElement('div'); p.className = 'gp-panel';
  document.body.appendChild(p); genPopupEl = p;
  renderGenPopupBody();
  const r = anchor.getBoundingClientRect();
  p.style.left = Math.max(8, Math.min(r.left, window.innerWidth - p.offsetWidth - 8)) + 'px';
  const top = r.top - p.offsetHeight - 8;
  if (top > 12) p.style.top = top + 'px'; else p.style.top = Math.min(r.bottom + 8, window.innerHeight - p.offsetHeight - 8) + 'px';
  requestAnimationFrame(() => p.classList.add('open'));
  setTimeout(() => document.addEventListener('pointerdown', onGenPopupDocDown, true), 0);
}

// ── Dropdown menu (modern, animated) ──────────────────────────────────────────
let openMenuEl = null;
function closeMenu(){ if (openMenuEl){ openMenuEl.remove(); openMenuEl = null; document.removeEventListener('pointerdown', onDocDown, true); } }
function onDocDown(e){ if (openMenuEl && !openMenuEl.contains(e.target)) closeMenu(); }
function openMenu(anchor, { items, value, onPick, search, custom }){
  closeMenu();
  const m = document.createElement('div'); m.className = 'menu';
  if (custom === 'ratio'){
    m.innerHTML = `<div class="ratio-grid">${RATIOS.map(x => `
      <div class="ratio-tile ${x.size===value?'sel':''}" data-val="${x.size}">
        <span class="ratio-box" style="width:${x.w}px;height:${x.h}px"></span>${x.r}</div>`).join('')}</div>`;
  } else {
    const useSearch = search && items.length > 8;
    const body = items.map((it, i) => `
      <div class="menu-item ${it.value===value?'sel':''} ${it.disabled?'disabled':''}" data-val="${esc(it.value)}" data-i="${i}">
        ${it.dotColor!=null?`<span class="proj-dot" style="background:${esc(it.dotColor)}"></span>`:(it.icon?`<span class="mi-icon">${it.icon}</span>`:'')}
        <span class="mi-body"><span class="mi-label">${esc(it.label)}</span>${it.hint?`<span class="mi-hint">${esc(it.hint)}</span>`:''}</span>
        <span class="mi-check">${SVG(I.check,'icon-sm')}</span>
      </div>`).join('');
    m.innerHTML = (useSearch ? `<div class="menu-search">${SVG('<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.3-4.3"/>','icon-sm')}<input type="text" placeholder="Search…"></div>` : '')
      + `<div class="menu-items">${body}</div>`;
  }
  document.body.appendChild(m); openMenuEl = m;
  // position above the anchor (pills sit near the bottom), clamped to the viewport
  const r = anchor.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(r.left, window.innerWidth - m.offsetWidth - 8)) + 'px';
  const top = r.top - m.offsetHeight - 8;
  if (top > 12){ m.style.top = top + 'px'; m.style.transformOrigin = 'bottom left'; }
  else { m.style.top = Math.min(r.bottom + 8, window.innerHeight - m.offsetHeight - 8) + 'px'; m.style.transformOrigin = 'top left'; }
  requestAnimationFrame(() => m.classList.add('open'));
  m.addEventListener('click', (e) => {
    const it = e.target.closest('[data-val]'); if (!it || it.classList.contains('disabled')) return;
    onPick(it.dataset.val); closeMenu();
  });
  const si = m.querySelector('.menu-search input');
  if (si){ si.focus(); si.addEventListener('input', () => {
    const q = si.value.toLowerCase();
    $$('.menu-item', m).forEach(el => { el.style.display = el.querySelector('.mi-label').textContent.toLowerCase().includes(q) ? '' : 'none'; });
  }); }
  setTimeout(() => document.addEventListener('pointerdown', onDocDown, true), 0);
}

function onPillClick(id, anchor){
  const o = state.opts;
  if (id === 'model'){
    const items = [{ value:'', label:'Default model', hint:'Provider default' },
      ...state.models.map(m => ({ value:m.id, label:(m.recommended?'★ ':'')+m.name, hint:m.costPerImage||'' }))];
    openMenu(anchor, { items, value:o.model, search:true, onPick:(v)=>{ o.model=v; renderOptBar(); } });
  } else if (id === 'ratio'){
    openMenu(anchor, { custom:'ratio', value:o.size, onPick:(v)=>{ o.size=v; renderOptBar(); } });
  } else if (id === 'count'){
    openMenu(anchor, { items:COUNTS, value:o.count, onPick:(v)=>{ o.count=parseInt(v); renderOptBar(); } });
  }
}
function loadModels(id){ if (id) socket.emit('get:models', id); }

// ── Chat rendering (from branching tree) ──────────────────────────────────────
function activePath(session){
  if (!session || !session.nodes) return [];
  const chain = []; let id = session.activeLeafId;
  while (id && session.nodes[id]){ chain.push(session.nodes[id]); id = session.nodes[id].parentId; }
  return chain.reverse().filter(n => n.role !== 'root');
}
function renderChat(){
  dockComposer(false); renderTopbar();
  const s = state.session; const msgs = $('#msgs'); msgs.innerHTML = '';
  const path = activePath(s);
  for (const node of path){
    if (node.role === 'user') msgs.appendChild(userMsgEl(s, node));
    else if (node.role === 'assistant') msgs.appendChild(assistantMsgEl(node));
  }
  scrollBottom();
}
function userMsgEl(session, node){
  const parent = session.nodes[node.parentId];
  const sibs = parent ? parent.children.filter(id => session.nodes[id].role === 'user') : [node.id];
  const idx = sibs.indexOf(node.id);
  const div = document.createElement('div'); div.className = 'msg user';
  const nav = sibs.length > 1 ? `<span class="branch-nav">
      <button data-act="branch" data-target="${sibs[idx-1]||''}" ${idx<=0?'disabled':''}>${SVG('<path d="M15 18l-6-6 6-6"/>','icon-xs')}</button>
      ${idx+1}/${sibs.length}
      <button data-act="branch" data-target="${sibs[idx+1]||''}" ${idx>=sibs.length-1?'disabled':''}>${SVG('<path d="M9 18l6-6-6-6"/>','icon-xs')}</button></span>` : '';
  div.innerHTML = `<div class="ububble">
      ${node.refThumb?`<img class="uref" src="${esc(node.refThumb)}">`:''}
      <div>${esc(node.content)}</div>
      <div class="umeta">${nav}<button class="msg-edit" data-act="edit-msg" data-node="${node.id}">${SVG(I.edit,'icon-xs')}Edit</button></div>
    </div>`;
  return div;
}
function assistantMsgEl(node){
  const r = node.result || {}; const imgs = r.images || []; const n = imgs.length;
  const dur = r.duration ? (r.duration/1000).toFixed(1) : '?';
  const enh = r.enhancedPrompt && r.enhancedPrompt !== r.prompt;
  const userNode = state.session.nodes[node.parentId];
  const el = document.createElement('div'); el.className = 'msg assistant';
  const grid = imgs.map((img, i) => {
    const src = '/output/' + encodeURIComponent(img.filename || '');
    const info = `${r.prompt||''} · ${r.provider||''} · ${img.width||'?'}×${img.height||'?'}`;
    return `<div class="img-card" style="animation-delay:${i*0.06}s" data-act="lightbox" data-src="${src}" data-info="${esc(info)}">
      <img src="${src}" loading="lazy" alt="">
      <div class="img-overlay">
        <button class="ov-btn" data-act="download" data-src="${src}" data-name="${esc(img.filename||'image.png')}" title="Download"><svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button>
        <button class="ov-btn" data-act="lightbox" data-src="${src}" data-info="${esc(info)}" title="Full size"><svg viewBox="0 0 24 24"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="3" y1="21" x2="10" y2="14"/><line x1="3" y1="21" x2="10" y2="14"/></svg></button>
      </div></div>`;
  }).join('');

  const modelId = r.model || '';
  let modelName = modelId;
  const foundDynamic = state.models.find(m => m.id === modelId);
  if (foundDynamic) {
    modelName = foundDynamic.name;
  } else {
    for (const p of state.providers) {
      const foundStatic = (p.models || []).find(m => m.id === modelId);
      if (foundStatic) {
        modelName = foundStatic.name;
        break;
      }
    }
  }
  modelName = modelName.replace(/^[★\s]+/, '');

  el.innerHTML = `
    <div class="msg-head"><div class="msg-avatar"><svg viewBox="0 0 24 24"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg></div>
      <div class="msg-author">Nenopix Studio</div><div class="msg-dur">${dur}s</div></div>
    ${enh?`<div class="enhanced-bar">${esc(r.enhancedPrompt)}</div>`:''}
    ${n?`<div class="img-grid n${Math.min(n,4)}">${grid}</div>`:`<div class="no-image-card">${SVG('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>','icon')}<div class="nic-title">No image was created</div><div class="nic-sub">${esc(r.error||"This generation didn't return an image. Try adjusting the prompt or switching providers.")}</div></div>`}
    <div class="gen-chips">
      <span class="chip prov">${esc(r.provider||'')}</span>
      <span class="chip">${esc(modelName)}</span>
      ${n?`<span class="chip">${n} image${n>1?'s':''}</span>`:''}
      ${r.cost?`<span class="chip">$${r.cost.toFixed(4)}</span>`:''}
      ${userNode?`<button class="regen-btn" data-act="regen" data-node="${userNode.id}">${SVG(I.redo,'icon-xs')}Regenerate</button>`:''}
    </div>`;
  return el;
}

// Optimistic placeholders while generating, with a rotating "model thinking" status
const THINKING_STEPS = [
  'Reading your prompt…', 'Understanding the scene…', 'Composing the layout…',
  'Choosing colors and lighting…', 'Rendering details…', 'Upscaling and finishing…',
];
let thinkingTimer = null;
function startThinking(enhance){
  const steps = enhance ? ['Enhancing your prompt…', ...THINKING_STEPS] : THINKING_STEPS;
  let i = 0;
  const set = () => { const el = $('#optiThinking'); if (!el) return; el.textContent = steps[i % steps.length]; el.classList.remove('swap'); void el.offsetWidth; el.classList.add('swap'); };
  set();
  clearInterval(thinkingTimer);
  thinkingTimer = setInterval(() => { i++; set(); }, 1700);
}
function stopThinking(){ clearInterval(thinkingTimer); thinkingTimer = null; }
function appendOptimistic(text, thumb){
  const msgs = $('#msgs');
  const u = document.createElement('div'); u.className = 'msg user'; u.id = 'optiUser';
  u.innerHTML = `<div class="ububble">${thumb?`<img class="uref" src="${esc(thumb)}">`:''}<div>${esc(text)}</div></div>`;
  const a = document.createElement('div'); a.className = 'msg assistant'; a.id = 'optiAsst';
  const n = state.opts.count;
  a.innerHTML = `<div class="msg-head"><div class="msg-avatar"><svg viewBox="0 0 24 24"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg></div><div class="msg-author">Nenopix Studio</div></div>
    <div class="status-line"><div class="spin"></div><span id="optiThinking" class="thinking-text"></span></div>
    <div class="skeleton img-grid n${Math.min(n,4)}">${Array.from({length:n}).map(()=>'<div class="sk-card"></div>').join('')}</div>`;
  msgs.appendChild(u); msgs.appendChild(a); scrollBottom();
  startThinking(state.opts.enhance);
}
function removeOptimistic(){ stopThinking(); $('#optiUser')?.remove(); $('#optiAsst')?.remove(); }

// ── Generation ───────────────────────────────────────────────────────────────
function setBusy(v){
  state.busy = v; const b = $('#genBtn'); b.disabled = v;
  b.innerHTML = v ? '<div class="spin" style="border-top-color:#fff;border-color:rgba(255,255,255,.35)"></div>'
    : '<svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';
}
function submitPrompt(text, opts = {}){
  if (state.busy) return;
  text = (text || '').trim(); if (!text){ toast('Enter a prompt first'); return; }
  const o = state.opts;
  const parentNodeId = opts.parentNodeId || (state.session ? state.session.activeLeafId : undefined);
  const payload = {
    prompt: text, provider: o.provider || undefined, model: o.model || undefined,
    size: o.size, quality: o.quality, style: o.style || undefined, count: o.count,
    enhance: o.enhance, negative: o.negative || undefined,
    seed: o.seed || undefined, steps: o.steps || undefined, cfgScale: o.cfgScale || undefined, format: o.format,
    referenceImage: state.refs[0] ? state.refs[0].full : undefined,
    refThumb: state.refs[0] ? state.refs[0].thumb : undefined,
    sessionId: state.route.kind === 'chat' ? state.route.id : (state.session ? state.session.id : null),
    parentNodeId,
    projectId: state.pendingProjectId || (state.session ? state.session.projectId : null) || null,
  };
  setBusy(true);
  if (state.route.kind === 'new' || !state.session) state.pendingNew = true;
  dockComposer(true);
  appendOptimistic(text, state.refs[0] ? state.refs[0].thumb : null);
  $('#prompt').value = ''; autosize($('#prompt')); clearRefs();
  socket.emit('generate', payload);
}

// ── Magic-pen inline enhance ──────────────────────────────────────────────────
let magicTimer = null;
function magicEnhance(){
  const ta = $('#prompt'); const text = ta.value.trim();
  if (!text){ toast('Type a prompt to enhance'); return; }
  const btn = $('#magicBtn'); btn.classList.add('working');
  btn.innerHTML = '<div class="spin" style="border-top-color:var(--purple);border-color:rgba(139,92,246,.3)"></div>';
  socket.emit('enhance:now', { prompt: text, provider: activeProviderId(), style: state.opts.style, quality: state.opts.quality });
}
function magicDone(){
  const btn = $('#magicBtn'); btn.classList.remove('working');
  btn.innerHTML = '<span class="icon"><svg viewBox="0 0 24 24"><path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M15 9l-1.2-1.2M17.8 6.2L19 5M3 21l9-9M12.2 6.2L11 5"/></svg></span>';
}
function onEnhanced(enhanced){
  magicDone();
  const ta = $('#prompt'); if (!enhanced){ toast('No enhancement'); return; }
  clearTimeout(magicTimer); ta.value = '';
  if (reduceMotion()){ ta.value = enhanced; autosize(ta); return; }
  let i = 0; (function type(){ ta.value = enhanced.slice(0, i); autosize(ta);
    if (i++ < enhanced.length) magicTimer = setTimeout(type, 8); })();
  toast('Prompt enhanced ✨');
}

// ── Branching actions ─────────────────────────────────────────────────────────
function switchBranch(targetId){ if (targetId && state.session) socket.emit('branch:setActive', { sessionId: state.session.id, nodeId: targetId }); }
function startEdit(nodeId){
  const node = state.session.nodes[nodeId]; if (!node) return;
  const wrap = $(`[data-node="${nodeId}"]`)?.closest('.msg.user'); if (!wrap) return;
  wrap.className = 'msg'; wrap.innerHTML = `<div class="edit-box">
    <textarea>${esc(node.content)}</textarea>
    <div class="edit-actions"><button class="btn-sm btn-ghost" data-act="cancel-edit">Cancel</button>
    <button class="btn-sm btn-fill" data-act="save-edit" data-parent="${node.parentId}">Branch ✦</button></div></div>`;
  const ta = wrap.querySelector('textarea'); ta.focus(); autosize(ta);
  ta.addEventListener('input', () => autosize(ta));
}

// ── Projects ─────────────────────────────────────────────────────────────────
function openProjectDialog(){ $('#projNameInput').value = ''; openScrim('proj'); setTimeout(()=>$('#projNameInput').focus(),120); }
function renderProject(id){
  const p = state.projects.find(x => x.id === id);
  setView('project'); renderSidebar(); renderTopbar();
  if (!p){ $('#projview').innerHTML = `<div class="view-empty">Project not found.</div>`; return; }
  const chats = state.sessions.filter(s => s.projectId === id);
  $('#projview').innerHTML = `<div class="proj-hero">
    <div class="proj-banner">
      <div class="proj-avatar" style="background:${esc(p.color)}">${SVG(I.folder)}</div>
      <div style="flex:1"><input class="proj-title-in" id="projTitleIn" value="${esc(p.name)}">
        <div class="proj-meta">${chats.length} chat${chats.length!==1?'s':''} · created ${ago(p.createdAt)}</div></div>
      <button class="btn-sm btn-ghost" data-act="del-project" data-id="${p.id}" style="color:var(--red)">${SVG(I.trash,'icon-sm')}</button>
    </div>
    <div class="mem-card">
      <div class="mem-head">${SVG('<path d="M12 2a7 7 0 00-7 7c0 2.4 1.2 4 2.5 5.2.8.8 1.5 1.5 1.5 2.8h6c0-1.3.7-2 1.5-2.8C18.8 13 20 11.4 20 9a7 7 0 00-8-7z"/><path d="M9 21h6"/>','icon-sm')}
        <span class="mem-title">Project memory</span></div>
      <div class="mem-desc">Instructions here are applied to every generation in this project — style guidelines, recurring subjects, brand rules, or quality directives.</div>
      <textarea class="mem-area" id="memArea" placeholder="e.g. Always use a warm cinematic palette, shallow depth of field, and a 35mm film look. Brand color #ea580c.">${esc(p.instructions||'')}</textarea>
      <div class="mem-foot"><span class="mem-saved" id="memSaved">${SVG(I.check,'icon-sm')}Saved</span>
        <button class="btn-sm btn-fill" data-act="new-chat-project" data-id="${p.id}">New chat in project</button></div>
    </div>
    <div class="proj-chats-head"><h3>Chats</h3></div>
    <div class="chat-tiles">${chats.length?chats.map((s,i)=>`
      <div class="chat-tile" data-act="open-chat" data-id="${s.id}" style="animation-delay:${i*0.04}s">
        <div class="ses-thumb ${thumbWrapClass(s.thumbnail)}">${thumbHTML(s.thumbnail)}</div>
        <div style="min-width:0"><div class="chat-tile-title">${esc(s.title)}</div><div class="chat-tile-time">${ago(s.updatedAt)}</div></div>
      </div>`).join(''):'<div class="empty-note">No chats yet — start one above.</div>'}</div>
  </div>`;
  // wire memory + title editors (debounced)
  const mem = $('#memArea'); let mt;
  mem.addEventListener('input', () => { clearTimeout(mt); mt = setTimeout(() => {
    socket.emit('project:update', { id, instructions: mem.value });
    const sv = $('#memSaved'); sv.classList.add('show'); setTimeout(()=>sv.classList.remove('show'),1600);
  }, 700); });
  const ti = $('#projTitleIn');
  ti.addEventListener('change', () => socket.emit('project:update', { id, name: ti.value.trim() || 'Untitled' }));
}

// ── Gallery (every image across all of this user's chats) ────────────────────
function galleryLoadingHTML(){
  return Array.from({length:8}).map(()=>'<div class="gal-card sk-card" style="animation:shimmer 1.4s linear infinite"></div>').join('');
}
function renderGalleryImages(imgs){
  if (state.view !== 'gallery') return; // a slower response landed after the user navigated away
  $('#galGrid').innerHTML = imgs.length ? imgs.map((im, i) => {
    const info = `${im.prompt||''} · ${im.provider||''} · ${im.width||'?'}×${im.height||'?'}`;
    return `<div class="gal-card" style="animation-delay:${Math.min(i,12)*0.03}s" data-act="lightbox" data-src="${im.src}" data-info="${esc(info)}" data-name="${esc(im.filename||'image.png')}">
      <img src="${im.src}" loading="lazy" alt="">
      <div class="img-overlay">
        <button class="ov-btn" data-act="download" data-src="${im.src}" data-name="${esc(im.filename||'image.png')}" title="Download"><svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button>
        <button class="ov-btn" data-act="open-chat" data-id="${esc(im.sessionId)}" title="Open chat"><svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg></button>
      </div></div>`;
  }).join('') : `<div class="no-image-card" style="margin:60px auto">${SVG('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>','icon')}<div class="nic-title">No images yet</div><div class="nic-sub">Generate something from the chat view and it'll show up here.</div></div>`;
}

// ── Lightbox ─────────────────────────────────────────────────────────────────
function openLightbox(src, info){ $('#lbImg').src = src; $('#lbInfo').textContent = info||''; $('#lb').classList.add('open'); }
function closeLightbox(){ $('#lb').classList.remove('open'); setTimeout(()=>{ if(!$('#lb').classList.contains('open')) $('#lbImg').src=''; },300); }

// ── Reference image attach ────────────────────────────────────────────────────
function handleFiles(files){
  if (!providerSupports('image-to-image')){ toast("This provider can't use reference images"); return; }
  for (const f of files){
    if (!/^image\/(png|jpe?g|webp)$/.test(f.type)){ toast('Only PNG, JPG, WEBP'); continue; }
    if (f.size > 10*1024*1024){ toast('Max 10MB per image'); continue; }
    const reader = new FileReader();
    reader.onload = () => downscale(reader.result, 1024, (full) => downscale(full, 256, (thumb) => {
      state.refs = [{ full, thumb }];   // single reference image for now
      renderRefs();
    }));
    reader.readAsDataURL(f);
  }
}
function downscale(dataUrl, max, cb){
  const img = new Image();
  img.onload = () => {
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const w = Math.round(img.width*scale), h = Math.round(img.height*scale);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    cb(c.toDataURL('image/png'));
  };
  img.onerror = () => cb(dataUrl);
  img.src = dataUrl;
}
function renderRefs(){
  const strip = $('#refStrip');
  if (!state.refs.length){ strip.style.display='none'; strip.innerHTML=''; return; }
  strip.style.display='flex';
  strip.innerHTML = state.refs.map((r,i)=>`<div class="ref-chip"><img src="${r.thumb}"><button class="rm" data-act="rm-ref" data-i="${i}">${SVG('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>','icon-xs')}</button></div>`).join('');
}
function clearRefs(){ state.refs = []; renderRefs(); }

// ── Modals ───────────────────────────────────────────────────────────────────
function openScrim(name){ $('#'+name+'Scrim').classList.add('open'); }
function closeScrim(name){ $('#'+name+'Scrim').classList.remove('open'); }
function openNegative(){
  $('#negArea').value = state.opts.negative || '';
  const sup = providerSupports('negative-prompts');
  $('#negWarn').style.display = sup ? 'none' : 'flex';
  if (!sup) $('#negWarnText').textContent = `${(activeProvider()||{}).name||'The selected provider'} doesn't use negative prompts — pick Stability, Replicate, or HuggingFace to apply this.`;
  $('#negChips').innerHTML = NEG_PRESETS.map(p=>`<button class="neg-chip" data-neg="${esc(p)}">${esc(p)}</button>`).join('');
  openScrim('neg'); setTimeout(()=>$('#negArea').focus(),120);
}
function fillSettingsProviders(){
  $('#cfgProvider').innerHTML = state.providers.map(p =>
    `<option value="${esc(p.id)}">${p.status==='available'?'✓ ':''}${esc(p.name)}</option>`).join('');
  if (state.config.defaultProvider) $('#cfgProvider').value = state.config.defaultProvider;
}

// ── Output directory: native browse + end-to-end check ───────────────────────
function setOutdirStatus(cls, text){
  const el = $('#outdirStatus'); el.className = 'outdir-status' + (cls?' '+cls:'');
  el.innerHTML = text ? (cls==='busy'?'<div class="spin" style="width:11px;height:11px;border-width:1.5px"></div>':'') + esc(text) : '';
}
function checkAndSetOutputDir(dir){
  if (!dir || !dir.trim()){ setOutdirStatus('bad', "Path can't be empty"); return; }
  setOutdirStatus('busy', 'Checking folder…');
  socket.emit('config:setOutputDir', { dir });
}
function onOutputDirResult(r){
  if (r.success) setOutdirStatus('ok', r.message || 'Folder ready');
  else setOutdirStatus('bad', r.message || "Folder isn't writable");
}

// ── Provider API keys: save + live end-to-end connection test ────────────────
// Test results/in-flight state survive the `providers:data` re-render that
// follows a save (the row markup is rebuilt from scratch each time).
const pkStatus = {}; // providerId -> { cls, text }
function pkPlaceholder(p, configured){
  if (configured) return '•••••••••• (saved)';
  return p.requiresApiKey ? `${p.name} API key…` : 'Optional — leave blank to use defaults';
}
function renderProviderKeys(){
  const list = $('#provKeysList'); if (!list) return;
  list.innerHTML = state.providers.map(p => {
    const configured = p.status === 'available';
    const st = pkStatus[p.id];
    return `<div class="pk-row" data-pk="${esc(p.id)}">
      <div class="pk-row-head">
        <span class="prov-dot ${configured?'on':'off'}"></span>
        <span class="pk-row-name">${esc(p.name)}</span>
        <span class="pk-row-msg ${st?st.cls:''}" id="pkMsg-${esc(p.id)}">${st?esc(st.text):''}</span>
      </div>
      <div class="pk-row-fields">
        <input type="password" id="pkKey-${esc(p.id)}" placeholder="${esc(pkPlaceholder(p, configured))}" autocomplete="off">
      </div>
      <div class="pk-row-actions">
        <button class="btn-sm btn-fill" data-act="pk-save" data-id="${esc(p.id)}">Save &amp; test</button>
        ${configured?`<button class="btn-sm btn-ghost" data-act="pk-remove" data-id="${esc(p.id)}" style="color:var(--red)">Remove</button>`:''}
      </div>
    </div>`;
  }).join('');
}
function pkSetMsg(id, cls, text){ pkStatus[id] = { cls, text: text||'' }; const el = $('#pkMsg-'+id); if (el){ el.className = 'pk-row-msg'+(cls?' '+cls:''); el.textContent = text||''; } }
function savePkKey(id){
  const input = $('#pkKey-'+id); const apiKey = input.value.trim();
  if (!apiKey){ toast('Enter an API key first'); return; }
  pkSetMsg(id, '', 'Testing…');
  socket.emit('provider:setKey', { id, apiKey });
}
function onProviderKeyResult({ id, success, message }){
  pkSetMsg(id, success?'ok':'bad', message);
  const input = $('#pkKey-'+id); if (input && success) input.value = '';
  toast(success ? `${id}: connection verified ✓` : `${id}: ${message||'connection failed'}`);
}

// ── Sidebar collapse (desktop rail / mobile drawer) ───────────────────────────
function setSidebarCollapsed(collapsed){
  $('#sidebar').classList.toggle('collapsed', collapsed);
  localStorage.setItem('if-sb-collapsed', collapsed ? '1' : '0');
  $('#sbBackdrop').classList.toggle('show', !collapsed && window.innerWidth <= 820);
}

// ── Wire-up (delegated + static) ──────────────────────────────────────────────
function init(){
  applyTheme(state.theme);

  // Initialize Galaxy Background
  const canvas = $('#galaxyCanvas');
  if (canvas) {
    try {
      state.galaxyBg = new GalaxyBackground(canvas, document.body, {
        starSpeed: 0.3,
        density: 1.0,
        glowIntensity: 0.3,
        rotationSpeed: 0.05,
        twinkleIntensity: 0.3,
        mouseRepulsion: true,
        repulsionStrength: 1.5,
        transparent: false
      });
    } catch (e) {
      console.error('Failed to initialize Galaxy Background:', e);
    }
  }

  setSidebarCollapsed(window.innerWidth <= 820 ? true : localStorage.getItem('if-sb-collapsed') === '1');
  $('#greetText').textContent = (h => h<12?'Good morning':h<17?'Good afternoon':'Good evening')(new Date().getHours());
  renderOptBar(); renderQuickCards();
  router();

  // static buttons
  $('#newChatBtn').onclick = () => { state.pendingProjectId=null; navigate('#/new'); };
  $('#addProjectBtn').onclick = openProjectDialog;
  $('#toggleSidebar').onclick = () => setSidebarCollapsed(!$('#sidebar').classList.contains('collapsed'));
  $('#sbBackdrop').onclick = () => setSidebarCollapsed(true);
  $('#folderBtn').onclick = () => socket.emit('open:folder');
  $('#settingsLink').onclick = () => { openScrim('set'); renderProviderKeys(); };
  $('#searchInput').oninput = (e)=>{ state.search=e.target.value; renderSidebar(); };
  $$('#themeSwitch button').forEach(b=> b.onclick = ()=>applyTheme(b.dataset.themeVal));
  $$('#viewTabs .vtab').forEach(t=> t.onclick = ()=>{ if(state.route.kind==='project') navigate('#/new'); setView(t.dataset.view); });

  // composer
  const ta = $('#prompt');
  ta.addEventListener('input', ()=>autosize(ta));
  ta.addEventListener('keydown', (e)=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); submitPrompt(ta.value); } });
  $('#genBtn').onclick = ()=>submitPrompt(ta.value);
  $('#magicBtn').onclick = magicEnhance;
  $('#attachBtn').onclick = ()=>{ if(!$('#attachBtn').disabled) $('#fileInput').click(); };
  $('#fileInput').onchange = (e)=>{ handleFiles(e.target.files); e.target.value=''; };
  $('#optBar').addEventListener('click', (e)=>{ const p=e.target.closest('[data-pill]'); if(p) onPillClick(p.dataset.pill, p); });

  // drag-drop reference images onto composer
  const comp = $('#composer');
  ['dragenter','dragover'].forEach(ev=>comp.addEventListener(ev,(e)=>{ e.preventDefault(); if(!$('#attachBtn').disabled) comp.classList.add('drag'); }));
  ['dragleave','drop'].forEach(ev=>comp.addEventListener(ev,(e)=>{ e.preventDefault(); comp.classList.remove('drag'); }));
  comp.addEventListener('drop',(e)=>{ if(e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); });

  // negative modal
  $('#negSave').onclick = ()=>{ state.opts.negative=$('#negArea').value.trim(); renderOptBar(); closeScrim('neg'); };
  $('#negClear').onclick = ()=>{ $('#negArea').value=''; };
  $('#negChips').addEventListener('click',(e)=>{ const c=e.target.closest('[data-neg]'); if(!c)return; const a=$('#negArea'); a.value=(a.value?a.value.replace(/,\s*$/,'')+', ':'')+c.dataset.neg; });
  // project dialog
  $('#projCreate').onclick = ()=>{ const n=$('#projNameInput').value.trim(); if(!n){toast('Name your project');return;} socket.emit('project:create',n); closeScrim('proj'); toast('Project created'); };
  $('#projNameInput').addEventListener('keydown',(e)=>{ if(e.key==='Enter') $('#projCreate').click(); });
  // settings — output directory (native browse + end-to-end write check)
  $('#outdirBrowse').onclick = () => socket.emit('dialog:pickFolder');
  $('#cfgOutput').addEventListener('change', (e)=>checkAndSetOutputDir(e.target.value));
  $('#saveSettings').onclick = ()=>{
    const keys={ defaultProvider:$('#cfgProvider').value, defaultSize:$('#cfgSize').value, defaultQuality:$('#cfgQuality').value, enhanceProvider:$('#cfgEnhance').value };
    Object.entries(keys).forEach(([k,v])=>socket.emit('config:set',{key:k,value:v}));
    checkAndSetOutputDir($('#cfgOutput').value);
    toast('Settings saved');
  };
  // close buttons on scrims
  $$('[data-close]').forEach(b=> b.onclick = ()=>closeScrim(b.dataset.close));
  $$('.scrim').forEach(sc=> sc.addEventListener('mousedown',(e)=>{ if(e.target===sc) closeScrim(sc.id.replace('Scrim','')); }));
  // lightbox
  $('#lbClose').onclick = closeLightbox;
  $('#lb').addEventListener('click',(e)=>{ if(e.target.id==='lb') closeLightbox(); });
  document.addEventListener('keydown',(e)=>{ if(e.key==='Escape'){ closeLightbox(); closeMenu(); closeGenPopup(); $$('.scrim.open').forEach(s=>s.classList.remove('open')); } });

  // global delegated clicks
  document.addEventListener('click', onDelegatedClick);

  // account row
  $('#logoutBtn').onclick = () => { if (confirm('Log out?')) authFailed(); };
  $('#manageUsersBtn').onclick = openUsersDialog;
  $('#umCreate').onclick = createUser;
}

function onDelegatedClick(e){
  const t = e.target.closest('[data-act]'); if (!t) return;
  const act = t.dataset.act;
  if (act === 'quick'){ const ta=$('#prompt'); ta.value=t.dataset.prompt; autosize(ta); ta.focus(); }
  else if (act === 'open-chat'){ navigate('#/c/'+t.dataset.id); }
  else if (act === 'open-project'){ navigate('#/p/'+t.dataset.id); }
  else if (act === 'toggle-project'){ e.stopPropagation(); const id=t.dataset.id; state.expandedProjects.has(id)?state.expandedProjects.delete(id):state.expandedProjects.add(id); renderSidebar(); }
  else if (act === 'chat-menu'){ e.stopPropagation(); openChatMenu(t, t.dataset.id); }
  else if (act === 'lightbox'){ openLightbox(t.dataset.src, t.dataset.info); }
  else if (act === 'download'){ const a=document.createElement('a'); a.href=t.dataset.src; a.download=t.dataset.name; a.click(); }
  else if (act === 'branch'){ switchBranch(t.dataset.target); }
  else if (act === 'edit-msg'){ startEdit(t.dataset.node); }
  else if (act === 'cancel-edit'){ renderChat(); }
  else if (act === 'save-edit'){ const txt=t.closest('.edit-box').querySelector('textarea').value; submitPrompt(txt,{parentNodeId:t.dataset.parent}); }
  else if (act === 'regen'){ const node=state.session.nodes[t.dataset.node]; if(node) submitPrompt(node.content,{parentNodeId:node.parentId}); }
  else if (act === 'rm-ref'){ state.refs.splice(+t.dataset.i,1); renderRefs(); }
  else if (act === 'del-project'){ if(confirm('Delete this project? Chats inside it are kept and moved out.')){ socket.emit('project:delete',t.dataset.id); navigate('#/new'); } }
  else if (act === 'new-chat-project'){ state.pendingProjectId=t.dataset.id; navigate('#/new'); }
  else if (act === 'open-gen-settings'){ e.stopPropagation(); openGenPopup(t); }
  else if (act === 'pk-save'){ savePkKey(t.dataset.id); }
  else if (act === 'pk-remove'){ if(confirm('Remove the stored API key for this provider?')) socket.emit('provider:removeKey', { id: t.dataset.id }); }
}

// Lightweight per-chat context menu (rename / move / delete)
function openChatMenu(anchor, id){
  const ses = state.sessions.find(s=>s.id===id);
  const items = [
    { value:'rename', label:'Rename', icon:SVG(I.edit,'icon-sm') },
    ...state.projects.filter(p=>p.id!==(ses&&ses.projectId)).map(p=>({ value:'move:'+p.id, label:'Move to '+p.name, dotColor:p.color })),
    ...(ses&&ses.projectId?[{ value:'move:', label:'Remove from project', icon:SVG(I.folder,'icon-sm') }]:[]),
    { value:'delete', label:'Delete', icon:SVG(I.trash,'icon-sm') },
  ];
  openMenu(anchor, { items, value:null, onPick:(v)=>{
    if (v==='rename'){ const t=prompt('Rename chat', ses?ses.title:''); if(t!=null) socket.emit('rename:session',{id,title:t}); }
    else if (v==='delete'){ if(confirm('Delete this chat?')){ socket.emit('delete:session',id); if(state.route.id===id) navigate('#/new'); } }
    else if (v.startsWith('move:')){ socket.emit('session:assign',{id,projectId:v.slice(5)||null}); }
  }});
}

// ── Auth gate (first-run setup / login) ───────────────────────────────────────
const TOKEN_KEY = 'if-token';

async function api(path, opts = {}){
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(path, { ...opts, headers });
  let body = null;
  try { body = await res.json(); } catch {}
  if (!res.ok) throw new Error((body && body.error) || 'Something went wrong');
  return body;
}

function authCardHTML(html){ $('#authCard').innerHTML = html; }
const AUTH_LOGO = `<div class="auth-logo"><div class="logo-mark"><svg viewBox="0 0 24 24"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg></div><div class="auth-logo-text">Neno<span>pix</span></div></div>`;

async function bootstrapAuth(){
  $('#authGate').classList.remove('hide');
  let status;
  try { status = await api('/api/auth/status'); }
  catch {
    authCardHTML(`${AUTH_LOGO}<div class="auth-title">Can't reach the server</div><div class="auth-sub">Make sure Nenopix Studio is running, then try again.</div>
      <button class="btn-sm btn-fill" id="authRetry" style="width:100%;padding:11px">Retry</button>`);
    $('#authRetry').onclick = bootstrapAuth;
    return;
  }
  state.authMode = status.authMode;
  if (status.needsSetup){ renderSetupChoice(); return; }
  if (status.authMode === 'solo'){ startApp(null); return; }
  const token = localStorage.getItem(TOKEN_KEY);
  if (token){
    try { await api('/api/auth/me'); startApp(token); return; }
    catch { localStorage.removeItem(TOKEN_KEY); }
  }
  renderLogin();
}

function renderSetupChoice(){
  authCardHTML(`${AUTH_LOGO}
    <div class="auth-title">Welcome — let's set things up</div>
    <div class="auth-sub">Choose how you'll use Nenopix Studio on this machine.</div>
    <div class="auth-mode-choice">
      <button class="auth-mode-opt" data-mode="solo">
        ${SVG('<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>')}
        <span><span class="auth-mode-opt-title">Just for me</span><br><span class="auth-mode-opt-sub">No login screen — open straight into the app. Best for a personal machine.</span></span>
      </button>
      <button class="auth-mode-opt" data-mode="team">
        ${SVG('<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>')}
        <span><span class="auth-mode-opt-title">Set up team accounts</span><br><span class="auth-mode-opt-sub">Create a super admin login, then invite friends or teammates with their own logins, provider limits, and usage caps.</span></span>
      </button>
    </div>`);
  $$('.auth-mode-opt').forEach(b => b.onclick = () => b.dataset.mode === 'solo' ? doSetupSolo() : renderTeamSetupForm());
}

async function doSetupSolo(){
  authCardHTML('<div class="auth-loading"><div class="spin"></div></div>');
  try { await api('/api/auth/setup', { method: 'POST', body: JSON.stringify({ mode: 'solo' }) }); startApp(null); }
  catch (e) { renderSetupChoice(); toast(e.message); }
}

function renderTeamSetupForm(){
  authCardHTML(`<div class="auth-back" id="authBack">${SVG('<path d="M19 12H5M12 19l-7-7 7-7"/>','icon-xs')}Back</div>
    <div class="auth-title">Create your super admin account</div>
    <div class="auth-sub">This account can create sub-accounts, restrict which providers they see, and cap their usage or spend.</div>
    <div class="auth-field"><label>Username</label><input type="text" id="setupUser" autocomplete="off"></div>
    <div class="auth-field"><label>Password (6+ characters)</label><input type="password" id="setupPass" autocomplete="new-password"></div>
    <div class="auth-err" id="authErr"></div>
    <button class="btn-sm btn-fill" id="setupSubmit" style="width:100%;padding:11px">Create account &amp; continue</button>`);
  $('#authBack').onclick = renderSetupChoice;
  $('#setupSubmit').onclick = doSetupTeam;
  $('#setupPass').addEventListener('keydown', e => { if (e.key === 'Enter') doSetupTeam(); });
  $('#setupUser').focus();
}

async function doSetupTeam(){
  const username = $('#setupUser').value.trim(), password = $('#setupPass').value;
  if (!username || password.length < 6){ $('#authErr').textContent = 'Pick a username and a password of 6+ characters.'; return; }
  $('#authErr').textContent = '';
  try {
    const r = await api('/api/auth/setup', { method: 'POST', body: JSON.stringify({ mode: 'team', username, password }) });
    localStorage.setItem(TOKEN_KEY, r.token); startApp(r.token);
  } catch (e) { $('#authErr').textContent = e.message; }
}

function renderLogin(){
  authCardHTML(`${AUTH_LOGO}
    <div class="auth-title">Sign in</div>
    <div class="auth-sub">Enter the credentials your team admin gave you.</div>
    <div class="auth-field"><label>Username</label><input type="text" id="loginUser" autocomplete="username"></div>
    <div class="auth-field"><label>Password</label><input type="password" id="loginPass" autocomplete="current-password"></div>
    <div class="auth-err" id="authErr"></div>
    <button class="btn-sm btn-fill" id="loginSubmit" style="width:100%;padding:11px">Sign in</button>`);
  $('#loginSubmit').onclick = doLogin;
  $('#loginPass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  $('#loginUser').focus();
}

async function doLogin(){
  const username = $('#loginUser').value.trim(), password = $('#loginPass').value;
  if (!username || !password){ $('#authErr').textContent = 'Enter your username and password.'; return; }
  $('#authErr').textContent = '';
  try {
    const r = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    localStorage.setItem(TOKEN_KEY, r.token); startApp(r.token);
  } catch (e) { $('#authErr').textContent = e.message; }
}

function authFailed(){
  localStorage.removeItem(TOKEN_KEY);
  state.currentUser = null;
  if (socket){ socket.removeAllListeners(); socket.disconnect(); socket = undefined; }
  bootstrapAuth();
}

function startApp(token){
  $('#authGate').classList.add('hide');
  socket = io({ auth: token ? { token } : {} });
  wireSocket();
  init();
}

// ── Account UI (sidebar row + user management dialog) ─────────────────────────
function renderAuthUI(){
  const u = state.currentUser; if (!u) return;
  if (state.authMode !== 'team'){ $('#sbAcct').classList.add('hide'); return; } // solo mode: no auth chrome
  $('#sbAcct').classList.remove('hide');
  $('#sbAcctAvatar').textContent = (u.username || '?')[0];
  $('#sbAcctName').textContent = u.username;
  $('#sbAcctRole').textContent = u.role === 'SUPER_ADMIN' ? 'Super admin' : 'Member';
  $('#manageUsersBtn').style.display = u.role === 'SUPER_ADMIN' ? '' : 'none';
  $('#logoutBtn').style.display = '';
}

function umProvidersChipsHTML(selected){
  return state.providers.map(p => `<span class="um-prov-chip ${selected.includes(p.id)?'active':''}" data-pid="${esc(p.id)}">${esc(p.name)}</span>`).join('');
}
async function openUsersDialog(){
  openScrim('users');
  $('#umProviders').innerHTML = umProvidersChipsHTML([]);
  $$('#umProviders .um-prov-chip').forEach(c => c.onclick = () => c.classList.toggle('active'));
  await refreshUsersList();
}
async function refreshUsersList(){
  const list = $('#umList'); list.innerHTML = '<div class="auth-loading"><div class="spin"></div></div>';
  try {
    const { users } = await api('/api/users');
    list.innerHTML = users.map(u => {
      const usage = u.role === 'SUPER_ADMIN' ? 'Unlimited'
        : [u.genLimit != null ? `${u.genUsed}/${u.genLimit} gens` : null, u.costLimit != null ? `$${u.costUsed.toFixed(2)}/$${u.costLimit.toFixed(2)}` : null]
            .filter(Boolean).join(' · ') || 'No limits set';
      return `<div class="um-row ${u.isActive?'':'inactive'}">
        <div class="um-row-avatar">${esc((u.username||'?')[0])}</div>
        <div class="um-row-meta">
          <div class="um-row-name">${esc(u.username)}${u.role==='SUPER_ADMIN'?'<span class="um-role-badge">Admin</span>':''}${!u.isActive?'<span class="um-role-badge" style="background:rgba(239,68,68,.12);color:#ef4444">Disabled</span>':''}</div>
          <div class="um-row-usage">${esc(usage)}</div>
        </div>
        <div class="um-row-actions">
          ${u.role!=='SUPER_ADMIN'?`<button class="um-icon-btn" data-toggle="${u.id}" data-active="${u.isActive}" title="${u.isActive?'Disable':'Enable'}">${SVG(u.isActive?'<circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>':'<polyline points="20 6 9 17 4 12"/>','icon-xs')}</button>
          <button class="um-icon-btn danger" data-del="${u.id}" title="Delete">${SVG(I.trash,'icon-xs')}</button>`:''}
        </div>
      </div>`;
    }).join('') || '<div class="empty-note">No members yet — add one below.</div>';
    $$('#umList [data-toggle]').forEach(b => b.onclick = () => toggleUserActive(b.dataset.toggle, b.dataset.active !== 'true'));
    $$('#umList [data-del]').forEach(b => b.onclick = () => deleteUserRow(b.dataset.del));
  } catch (e) {
    list.innerHTML = `<div class="empty-note">${esc(e.message)}</div>`;
  }
}
async function toggleUserActive(id, isActive){
  try { await api('/api/users/'+id, { method: 'PATCH', body: JSON.stringify({ isActive }) }); refreshUsersList(); }
  catch (e) { toast(e.message); }
}
async function deleteUserRow(id){
  if (!confirm('Delete this member? This cannot be undone.')) return;
  try { await api('/api/users/'+id, { method: 'DELETE' }); refreshUsersList(); }
  catch (e) { toast(e.message); }
}
async function createUser(){
  const username = $('#umUsername').value.trim();
  const password = $('#umPassword').value;
  const allowedProviders = $$('#umProviders .um-prov-chip.active').map(c => c.dataset.pid);
  const genLimit = $('#umGenLimit').value, costLimit = $('#umCostLimit').value;
  $('#umErr').textContent = '';
  if (!username || password.length < 6){ $('#umErr').textContent = 'Pick a username and a password of 6+ characters.'; return; }
  try {
    await api('/api/users', { method: 'POST', body: JSON.stringify({ username, password, allowedProviders, genLimit, costLimit }) });
    $('#umUsername').value = ''; $('#umPassword').value = ''; $('#umGenLimit').value = ''; $('#umCostLimit').value = '';
    $$('#umProviders .um-prov-chip').forEach(c => c.classList.remove('active'));
    toast('Member created'); refreshUsersList();
  } catch (e) { $('#umErr').textContent = e.message; }
}

// ── Galaxy Background (WebGL Particle System) ───────────────────────────────
const vertexShaderSource = `
attribute vec2 uv;
attribute vec2 position;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const fragmentShaderSource = `
precision highp float;

uniform float uTime;
uniform vec3 uResolution;
uniform vec2 uFocal;
uniform vec2 uRotation;
uniform float uStarSpeed;
uniform float uDensity;
uniform float uHueShift;
uniform float uSpeed;
uniform vec2 uMouse;
uniform float uGlowIntensity;
uniform float uSaturation;
uniform bool uMouseRepulsion;
uniform float uTwinkleIntensity;
uniform float uRotationSpeed;
uniform float uRepulsionStrength;
uniform float uMouseActiveFactor;
uniform float uAutoCenterRepulsion;
uniform bool uTransparent;
uniform float uThemeMode;

varying vec2 vUv;

#define NUM_LAYER 4.0
#define STAR_COLOR_CUTOFF 0.2
#define MAT45 mat2(0.7071, -0.7071, 0.7071, 0.7071)
#define PERIOD 3.0

float Hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float tri(float x) {
  return abs(fract(x) * 2.0 - 1.0);
}

float tris(float x) {
  float t = fract(x);
  return 1.0 - smoothstep(0.0, 1.0, abs(2.0 * t - 1.0));
}

float trisn(float x) {
  float t = fract(x);
  return 2.0 * (1.0 - smoothstep(0.0, 1.0, abs(2.0 * t - 1.0))) - 1.0;
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

float Star(vec2 uv, float flare) {
  float d = length(uv);
  float m = (0.05 * uGlowIntensity) / d;
  float rays = smoothstep(0.0, 1.0, 1.0 - abs(uv.x * uv.y * 1000.0));
  m += rays * flare * uGlowIntensity;
  uv *= MAT45;
  rays = smoothstep(0.0, 1.0, 1.0 - abs(uv.x * uv.y * 1000.0));
  m += rays * 0.3 * flare * uGlowIntensity;
  m *= smoothstep(1.0, 0.2, d);
  return m;
}

vec3 StarLayer(vec2 uv) {
  vec3 col = vec3(0.0);
  vec2 gv = fract(uv) - 0.5; 
  vec2 id = floor(uv);

  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 offset = vec2(float(x), float(y));
      vec2 si = id + vec2(float(x), float(y));
      float seed = Hash21(si);
      float size = fract(seed * 345.32);
      float glossLocal = tri(uStarSpeed / (PERIOD * seed + 1.0));
      float flareSize = smoothstep(0.9, 1.0, size) * glossLocal;

      float red = smoothstep(STAR_COLOR_CUTOFF, 1.0, Hash21(si + 1.0)) + STAR_COLOR_CUTOFF;
      float blu = smoothstep(STAR_COLOR_CUTOFF, 1.0, Hash21(si + 3.0)) + STAR_COLOR_CUTOFF;
      float grn = min(red, blu) * seed;
      vec3 base = vec3(red, grn, blu);
      
      float hue = atan(base.g - base.r, base.b - base.r) / (2.0 * 3.14159) + 0.5;
      hue = fract(hue + uHueShift / 360.0);
      float sat = length(base - vec3(dot(base, vec3(0.299, 0.587, 0.114)))) * 0.5; // Add subtle saturation for stars
      float val = max(max(base.r, base.g), base.b);
      base = hsv2rgb(vec3(hue, sat, val));

      vec2 pad = vec2(tris(seed * 34.0 + uTime * uSpeed / 10.0), tris(seed * 38.0 + uTime * uSpeed / 30.0)) - 0.5;

      float star = Star(gv - offset - pad, flareSize);
      vec3 color = base;

      float twinkle = trisn(uTime * uSpeed + seed * 6.2831) * 0.5 + 1.0;
      twinkle = mix(1.0, twinkle, uTwinkleIntensity);
      star *= twinkle;
      
      col += star * size * color;
    }
  }
  return col;
}

// Procedural Nebula background colors morphing slowly over time
vec3 getNebula(vec2 uv, float time, float themeMode) {
  // Smooth sine wave morphing coordinates
  float n1 = sin(uv.x * 1.2 + time * 0.08) * cos(uv.y * 1.2 - time * 0.06);
  float n2 = cos(uv.x * 1.8 - time * 0.04) * sin(uv.y * 1.8 + time * 0.09);
  
  vec3 color1;
  vec3 color2;
  vec3 color3;

  if (themeMode > 0.5) {
    // Dark mode nebula: deep eye-catching colors (indigos, violets, amber hints)
    color1 = vec3(0.02, 0.01, 0.06); // Dark blue-violet
    color2 = vec3(0.07, 0.02, 0.10); // Dark magenta-purple
    color3 = vec3(0.06, 0.03, 0.01); // Dark warm amber
  } else {
    // Light mode nebula: soft, bright, eye-catching pastel washes (light teal, soft lavender, peach)
    color1 = vec3(0.85, 0.92, 0.98); // Soft sky blue/pastel blue
    color2 = vec3(0.92, 0.85, 0.95); // Soft pastel lavender
    color3 = vec3(0.98, 0.88, 0.85); // Soft pastel peach/coral
  }

  float mix1 = smoothstep(-1.0, 1.0, n1);
  float mix2 = smoothstep(-1.0, 1.0, n2);

  vec3 col = mix(color1, color2, mix1);
  col = mix(col, color3, mix2);
  return col;
}

void main() {
  vec2 focalPx = uFocal * uResolution.xy;
  vec2 uv = (vUv * uResolution.xy - focalPx) / uResolution.y;
  vec2 mouseNorm = uMouse - vec2(0.5);
  
  if (uAutoCenterRepulsion > 0.0) {
    vec2 centerUV = vec2(0.0, 0.0);
    float centerDist = length(uv - centerUV);
    vec2 repulsion = normalize(uv - centerUV) * (uAutoCenterRepulsion / (centerDist + 0.1));
    uv += repulsion * 0.05;
  } else if (uMouseRepulsion) {
    vec2 mousePosUV = (uMouse * uResolution.xy - focalPx) / uResolution.y;
    float mouseDist = length(uv - mousePosUV);
    vec2 repulsion = normalize(uv - mousePosUV) * (uRepulsionStrength / (mouseDist + 0.1));
    uv += repulsion * 0.05 * uMouseActiveFactor;
  } else {
    vec2 mouseOffset = mouseNorm * 0.1 * uMouseActiveFactor;
    uv += mouseOffset;
  }

  // Generate morphing nebula background color
  vec3 bgColor = getNebula(uv, uTime, uThemeMode);

  float autoRotAngle = uTime * uRotationSpeed;
  mat2 autoRot = mat2(cos(autoRotAngle), -sin(autoRotAngle), sin(autoRotAngle), cos(autoRotAngle));
  uv = autoRot * uv;

  uv = mat2(uRotation.x, -uRotation.y, uRotation.y, uRotation.x) * uv;

  vec3 col = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    float fi = float(i) / 4.0;
    float depth = fract(fi + uStarSpeed * uSpeed);
    float scale = mix(20.0 * uDensity, 0.5 * uDensity, depth);
    float fade = depth * smoothstep(1.0, 0.9, depth);
    col += StarLayer(uv * scale + fi * 453.32) * fade;
  }

  // Star colors: colorful particles on top of the nebula
  vec3 starColor = col;
  if (uThemeMode < 0.5) {
    // In light mode, make the star dots a clean white-based gray/white color
    float gray = dot(col, vec3(0.299, 0.587, 0.114));
    starColor = vec3(gray * 0.85); // Subtle white/gray stars
  }

  vec3 finalColor = bgColor + starColor;
  gl_FragColor = vec4(finalColor, 1.0); // Opaque color fill
}
`;

function isDarkTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'system';
  if (currentTheme === 'dark') return true;
  if (currentTheme === 'light') return false;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

class GalaxyBackground {
  constructor(canvas, container, options = {}) {
    this.canvas = canvas;
    this.container = container;
    this.options = Object.assign({
      focal: [0.5, 0.5],
      rotation: [1.0, 0.0],
      starSpeed: 0.5,
      density: 1.0,
      hueShift: 140,
      disableAnimation: false,
      speed: 1.0,
      mouseInteraction: true,
      glowIntensity: 0.3,
      saturation: 0.0,
      mouseRepulsion: true,
      repulsionStrength: 2.0,
      twinkleIntensity: 0.3,
      rotationSpeed: 0.1,
      autoCenterRepulsion: 0.0,
      transparent: true
    }, options);

    this.targetMousePos = { x: 0.5, y: 0.5 };
    this.smoothMousePos = { x: 0.5, y: 0.5 };
    this.targetMouseActive = 0.0;
    this.smoothMouseActive = 0.0;

    this.initWebGL();
    this.bindEvents();
    this.startLoop();
  }

  initWebGL() {
    const gl = this.canvas.getContext('webgl', {
      alpha: this.options.transparent,
      premultipliedAlpha: false,
      antialias: false
    });
    if (!gl) {
      console.error('WebGL not supported');
      return;
    }
    this.gl = gl;

    if (this.options.transparent) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0, 0, 0, 0);
    } else {
      gl.clearColor(0, 0, 0, 1);
    }

    const vs = this.compileShader(gl.VERTEX_SHADER, vertexShaderSource);
    const fs = this.compileShader(gl.FRAGMENT_SHADER, fragmentShaderSource);
    if (!vs || !fs) return;

    this.program = gl.createProgram();
    gl.attachShader(this.program, vs);
    gl.attachShader(this.program, fs);
    gl.linkProgram(this.program);

    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      console.error('Link failed:', gl.getProgramInfoLog(this.program));
      return;
    }

    gl.useProgram(this.program);

    const vertices = new Float32Array([
      -1, -1,  0, 0,
       3, -1,  2, 0,
      -1,  3,  0, 2
    ]);

    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    const positionLoc = gl.getAttribLocation(this.program, 'position');
    const uvLoc = gl.getAttribLocation(this.program, 'uv');

    gl.enableVertexAttribArray(positionLoc);
    gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 16, 0);

    gl.enableVertexAttribArray(uvLoc);
    gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 16, 8);

    this.uniforms = {
      uTime: gl.getUniformLocation(this.program, 'uTime'),
      uResolution: gl.getUniformLocation(this.program, 'uResolution'),
      uFocal: gl.getUniformLocation(this.program, 'uFocal'),
      uRotation: gl.getUniformLocation(this.program, 'uRotation'),
      uStarSpeed: gl.getUniformLocation(this.program, 'uStarSpeed'),
      uDensity: gl.getUniformLocation(this.program, 'uDensity'),
      uHueShift: gl.getUniformLocation(this.program, 'uHueShift'),
      uSpeed: gl.getUniformLocation(this.program, 'uSpeed'),
      uMouse: gl.getUniformLocation(this.program, 'uMouse'),
      uGlowIntensity: gl.getUniformLocation(this.program, 'uGlowIntensity'),
      uSaturation: gl.getUniformLocation(this.program, 'uSaturation'),
      uMouseRepulsion: gl.getUniformLocation(this.program, 'uMouseRepulsion'),
      uTwinkleIntensity: gl.getUniformLocation(this.program, 'uTwinkleIntensity'),
      uRotationSpeed: gl.getUniformLocation(this.program, 'uRotationSpeed'),
      uRepulsionStrength: gl.getUniformLocation(this.program, 'uRepulsionStrength'),
      uMouseActiveFactor: gl.getUniformLocation(this.program, 'uMouseActiveFactor'),
      uAutoCenterRepulsion: gl.getUniformLocation(this.program, 'uAutoCenterRepulsion'),
      uTransparent: gl.getUniformLocation(this.program, 'uTransparent'),
      uThemeMode: gl.getUniformLocation(this.program, 'uThemeMode')
    };

    this.resize();
  }

  compileShader(type, src) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  resize() {
    const gl = this.gl;
    if (!gl) return;
    const width = this.container.offsetWidth;
    const height = this.container.offsetHeight;
    this.canvas.width = width;
    this.canvas.height = height;
    gl.viewport(0, 0, width, height);

    gl.useProgram(this.program);
    gl.uniform3f(this.uniforms.uResolution, width, height, width / height);
  }

  bindEvents() {
    this.resizeListener = () => this.resize();
    window.addEventListener('resize', this.resizeListener, false);

    if (this.options.mouseInteraction) {
      this.mouseMoveListener = (e) => {
        const rect = this.container.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = 1.0 - (e.clientY - rect.top) / rect.height;
        this.targetMousePos = { x, y };
        this.targetMouseActive = 1.0;
      };

      this.mouseLeaveListener = () => {
        this.targetMouseActive = 0.0;
      };

      this.container.addEventListener('mousemove', this.mouseMoveListener, { passive: true });
      this.container.addEventListener('mouseleave', this.mouseLeaveListener, { passive: true });
    }
  }

  startLoop() {
    const gl = this.gl;
    if (!gl) return;

    gl.useProgram(this.program);
    gl.uniform2fv(this.uniforms.uFocal, new Float32Array(this.options.focal));
    gl.uniform2fv(this.uniforms.uRotation, new Float32Array(this.options.rotation));
    gl.uniform1f(this.uniforms.uStarSpeed, this.options.starSpeed);
    gl.uniform1f(this.uniforms.uDensity, this.options.density);
    gl.uniform1f(this.uniforms.uHueShift, this.options.hueShift);
    gl.uniform1f(this.uniforms.uSpeed, this.options.speed);
    gl.uniform1f(this.uniforms.uGlowIntensity, this.options.glowIntensity);
    gl.uniform1f(this.uniforms.uSaturation, this.options.saturation);
    gl.uniform1i(this.uniforms.uMouseRepulsion, this.options.mouseRepulsion ? 1 : 0);
    gl.uniform1f(this.uniforms.uTwinkleIntensity, this.options.twinkleIntensity);
    gl.uniform1f(this.uniforms.uRotationSpeed, this.options.rotationSpeed);
    gl.uniform1f(this.uniforms.uRepulsionStrength, this.options.repulsionStrength);
    gl.uniform1f(this.uniforms.uAutoCenterRepulsion, this.options.autoCenterRepulsion);
    gl.uniform1i(this.uniforms.uTransparent, this.options.transparent ? 1 : 0);

    const update = (t) => {
      this.animateId = requestAnimationFrame(update);

      gl.useProgram(this.program);

      if (!this.options.disableAnimation) {
        gl.uniform1f(this.uniforms.uTime, t * 0.001);
        gl.uniform1f(this.uniforms.uStarSpeed, (t * 0.001 * this.options.starSpeed) / 10.0);
      }

      const dark = isDarkTheme();
      gl.uniform1f(this.uniforms.uThemeMode, dark ? 1.0 : 0.0);

      const lerpFactor = 0.05;
      this.smoothMousePos.x += (this.targetMousePos.x - this.smoothMousePos.x) * lerpFactor;
      this.smoothMousePos.y += (this.targetMousePos.y - this.smoothMousePos.y) * lerpFactor;
      this.smoothMouseActive += (this.targetMouseActive - this.smoothMouseActive) * lerpFactor;

      gl.uniform2f(this.uniforms.uMouse, this.smoothMousePos.x, this.smoothMousePos.y);
      gl.uniform1f(this.uniforms.uMouseActiveFactor, this.smoothMouseActive);

      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    this.animateId = requestAnimationFrame(update);
  }

  destroy() {
    cancelAnimationFrame(this.animateId);
    window.removeEventListener('resize', this.resizeListener);
    if (this.options.mouseInteraction) {
      this.container.removeEventListener('mousemove', this.mouseMoveListener);
      this.container.removeEventListener('mouseleave', this.mouseLeaveListener);
    }
    const gl = this.gl;
    if (gl) {
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.deleteBuffer(this.buffer);
      gl.deleteProgram(this.program);
      const ext = gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
    }
  }
}

bootstrapAuth();
