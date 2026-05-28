// ── State ──────────────────────────────────────────────────────────────────
const STORAGE_KEY = 'coldstart';

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : defaultState();
  } catch {
    return defaultState();
  }
}

function defaultState() {
  return { githubPAT: '', projects: [], sessions: [] };
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function addProject(state, { name, description, githubUrl, localPath }) {
  const project = { id: crypto.randomUUID(), name, description, githubUrl, localPath: localPath || '', tasks: [] };
  return { ...state, projects: [...state.projects, project] };
}

function addTask(state, projectId, text) {
  const task = { id: crypto.randomUUID(), text, status: 'todo', createdAt: new Date().toISOString(), completedAt: null };
  return {
    ...state,
    projects: state.projects.map(p =>
      p.id === projectId ? { ...p, tasks: [...(p.tasks || []), task] } : p
    )
  };
}

function completeTask(state, projectId, taskId) {
  return {
    ...state,
    projects: state.projects.map(p =>
      p.id === projectId
        ? { ...p, tasks: (p.tasks || []).map(t =>
            t.id === taskId ? { ...t, status: 'done', completedAt: new Date().toISOString() } : t
          )}
        : p
    )
  };
}

function deleteTask(state, projectId, taskId) {
  return {
    ...state,
    projects: state.projects.map(p =>
      p.id === projectId ? { ...p, tasks: (p.tasks || []).filter(t => t.id !== taskId) } : p
    )
  };
}

function updateProject(state, id, fields) {
  return {
    ...state,
    projects: state.projects.map(p => p.id === id ? { ...p, ...fields } : p)
  };
}

function deleteProject(state, id) {
  return { ...state, projects: state.projects.filter(p => p.id !== id) };
}

function saveSession(state, session) {
  const today = new Date().toISOString().slice(0, 10);
  const idx = state.sessions.findIndex(s => s.date === today);
  const entry = { date: today, ...session };
  const sessions = idx >= 0
    ? state.sessions.map((s, i) => i === idx ? { ...s, ...entry } : s)
    : [...state.sessions, entry];
  return { ...state, sessions };
}

// ── GitHub ─────────────────────────────────────────────────────────────────
function parseGitHubUrl(url) {
  try {
    const m = url.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
    return m ? { owner: m[1], repo: m[2] } : null;
  } catch {
    return null;
  }
}

function formatRelativeDate(isoString) {
  const diff = Date.now() - new Date(isoString).getTime();
  if (isNaN(diff)) return 'unknown';
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins  < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days  === 1) return 'yesterday';
  return `${days}d ago`;
}

async function fetchCommits(githubUrl, pat) {
  const parsed = parseGitHubUrl(githubUrl);
  if (!parsed) return [];
  const headers = pat ? { Authorization: `token ${pat}` } : {};
  try {
    const res = await fetch(
      `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/commits?per_page=3`,
      { headers }
    );
    if (!res.ok) return [];
    const commits = await res.json();
    return commits.map(c => ({
      message: c.commit.message.split('\n')[0],
      author:  c.commit.author?.name ?? '',
      date:    formatRelativeDate(c.commit.author?.date ?? '')
    }));
  } catch {
    return [];
  }
}

// ── Router ─────────────────────────────────────────────────────────────────
let appState = loadState();
const commitCache    = {};
const navHistory     = [];
let   currentRound   = 0;   // tracks active breathing round for skip
let   breathTimeout  = null; // active breathing timeout, cancelled on skip

const currentSession = {
  direction: { mainFocus: '', tasks: '', smallStep: '' },
  emotionCheck: null,
  chosenProjectId: null
};

function showScreen(id, skipHistory = false) {
  document.querySelectorAll('.screen').forEach(el => {
    el.classList.remove('active', 'visible');
  });
  const screen = document.getElementById(id);
  screen.classList.add('active');
  requestAnimationFrame(() => screen.classList.add('visible'));
  if (!skipHistory) navHistory.push(id);
  updateBackBtn();
}

function updateBackBtn() {
  const btn = document.getElementById('back-btn');
  if (!btn) return;
  const noBackScreens = ['screen-setup', 'screen-choice'];
  const current = navHistory[navHistory.length - 1];
  btn.style.display = (navHistory.length > 1 && !noBackScreens.includes(current)) ? 'block' : 'none';
}

const SCREEN_RENDERERS = {
  'screen-choice':    () => renderChoiceScreen(),
  'screen-arrive':    () => renderArriveScreen(),
  'screen-breathing': () => renderBreathingScreen(),
  'screen-grounding': () => renderGroundingScreen(),
  'screen-direction': () => renderDirectionScreen(),
  'screen-emotion':   () => renderEmotionCheckScreen(),
  'screen-projects':  () => renderProjectsScreen(),
  'screen-begin':     () => {
    const pid = currentSession.chosenProjectId;
    if (pid) renderFirstStepScreen(pid, commitCache[pid] || []);
  }
};

function goBack() {
  if (navHistory.length < 2) return;
  navHistory.pop();
  const prev = navHistory[navHistory.length - 1];
  const renderer = SCREEN_RENDERERS[prev];
  if (renderer) renderer();
  showScreen(prev, true); // true = don't add to history again
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function init() {
  document.getElementById('settings-btn').addEventListener('click', openSettings);
  if (appState.projects.length === 0) {
    renderSetupScreen();
    showScreen('screen-setup');
  } else {
    renderChoiceScreen();
    showScreen('screen-choice');
  }
}

document.addEventListener('DOMContentLoaded', init);

// ── Setup screen ───────────────────────────────────────────────────────────
function renderSetupScreen() {
  document.getElementById('screen-setup').innerHTML = `
    <div class="col">
      <h1>Welcome</h1>
      <p class="muted" style="margin-bottom:2.5rem;">
        Add your first project to get started. You can add more later via ⚙.
      </p>

      <div class="field">
        <label for="setup-name">Project name</label>
        <input id="setup-name" type="text" autocomplete="off">
      </div>
      <div class="field">
        <label for="setup-desc">Description</label>
        <textarea id="setup-desc" rows="2"></textarea>
      </div>
      <div class="field">
        <label for="setup-url">
          GitHub repository URL
          <span class="muted" style="text-transform:none; letter-spacing:0"> — recommended. The app will open it automatically when you begin.</span>
        </label>
        <input id="setup-url" type="url" placeholder="https://github.com/you/repo">
      </div>
      <div class="field">
        <label for="setup-localpath">
          Local folder path
          <span class="muted" style="text-transform:none; letter-spacing:0"> — optional. Opens a terminal here when you begin.</span>
        </label>
        <input id="setup-localpath" type="text" placeholder="C:\Users\you\projects\my-repo" autocomplete="off">
      </div>
      <div class="field">
        <label for="setup-pat">
          GitHub Personal Access Token
          <span class="muted" style="text-transform:none; letter-spacing:0"> — optional, for private repos</span>
        </label>
        <input id="setup-pat" type="password" placeholder="ghp_...">
        <p class="muted" style="margin-top:6px;">Stored only in this browser. Only sent to GitHub's API.</p>
      </div>

      <div class="btn-row">
        <button class="btn" id="setup-submit">Begin →</button>
      </div>
    </div>
  `;

  document.getElementById('setup-submit').addEventListener('click', () => {
    const name        = document.getElementById('setup-name').value.trim();
    const description = document.getElementById('setup-desc').value.trim();
    const githubUrl   = document.getElementById('setup-url').value.trim();
    const localPath   = document.getElementById('setup-localpath').value.trim();
    const pat         = document.getElementById('setup-pat').value.trim();

    if (!name) {
      alert('Please enter a project name.');
      return;
    }
    if (githubUrl && !parseGitHubUrl(githubUrl)) {
      alert('Please use a valid GitHub URL: https://github.com/owner/repo');
      return;
    }

    appState = addProject(appState, { name, description, githubUrl, localPath });
    if (pat) appState = { ...appState, githubPAT: pat };
    saveState(appState);

    renderChoiceScreen();
    showScreen('screen-choice');
  });
}

// ── Settings ───────────────────────────────────────────────────────────────
function openSettings() {
  renderSettingsOverlay();
  document.getElementById('settings-overlay').classList.remove('hidden');
}

function closeSettings() {
  document.getElementById('settings-overlay').classList.add('hidden');
}

function renderSettingsOverlay() {
  const projectsHtml = appState.projects.length === 0
    ? '<p class="muted">No projects yet.</p>'
    : appState.projects.map(p => {
        const tasks   = p.tasks || [];
        const todos   = tasks.filter(t => t.status === 'todo');
        const done    = tasks.filter(t => t.status === 'done').sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));

        const todoHtml = todos.length === 0
          ? '<p class="muted task-empty">Nothing to do yet.</p>'
          : todos.map(t => `
              <div class="task-item">
                <span class="task-text">${escapeHtml(t.text)}</span>
                <button class="btn btn-ghost btn-sm" onclick="doCompleteTask('${p.id}','${t.id}')">Done</button>
              </div>`).join('');

        const historyHtml = done.length === 0 ? '' : `
          <button class="task-history-toggle" onclick="toggleTaskHistory('${p.id}')">
            ▸ History (${done.length} completed)
          </button>
          <div id="task-history-${p.id}" style="display:none">
            ${done.map(t => `
              <div class="task-item task-item-done">
                <span class="task-text">✓ ${escapeHtml(t.text)}</span>
                <span class="muted" style="font-size:0.75rem; flex-shrink:0">${formatRelativeDate(t.completedAt)}</span>
              </div>`).join('')}
          </div>`;

        return `
        <div class="project-item" id="project-item-${p.id}">
          <div class="project-item-info">
            <strong>${escapeHtml(p.name)}</strong>
            ${p.description ? `<div class="muted" style="margin-top:3px">${escapeHtml(p.description)}</div>` : ''}
            <div class="muted" style="margin-top:3px; font-size:0.78rem">${p.githubUrl ? escapeHtml(p.githubUrl) : 'No repository URL'}</div>
          </div>
          <div class="project-item-actions">
            <button class="btn btn-ghost btn-sm" onclick="toggleProjectTasks('${p.id}')">Tasks</button>
            <button class="btn btn-ghost btn-sm" onclick="toggleEditProject('${p.id}')">Edit</button>
            <button class="btn btn-ghost btn-sm" onclick="confirmDeleteProject('${p.id}')">Delete</button>
          </div>
        </div>

        <div id="project-tasks-${p.id}" style="display:none; padding:1rem 0 1.5rem; border-bottom:1px solid var(--border)">
          <p class="eyebrow" style="margin-bottom:1rem">To do</p>
          <div id="todo-list-${p.id}">${todoHtml}</div>
          <div class="task-add-row">
            <input type="text" id="new-task-${p.id}" placeholder="Add a task…" class="task-input" autocomplete="off">
            <button class="btn btn-sm" onclick="doAddTask('${p.id}')">Add</button>
          </div>
          ${historyHtml}
        </div>

        <div id="project-edit-${p.id}" style="display:none; padding:1rem 0 1.5rem; border-bottom:1px solid var(--border)">
          <div class="field">
            <label>Name</label>
            <input type="text" id="edit-name-${p.id}" value="${escapeHtml(p.name)}" autocomplete="off">
          </div>
          <div class="field">
            <label>Description</label>
            <textarea id="edit-desc-${p.id}" rows="2">${escapeHtml(p.description || '')}</textarea>
          </div>
          <div class="field">
            <label>GitHub URL <span class="muted" style="text-transform:none; letter-spacing:0">— recommended</span></label>
            <input type="url" id="edit-url-${p.id}" value="${escapeHtml(p.githubUrl || '')}" placeholder="https://github.com/you/repo">
          </div>
          <div class="field">
            <label>Local folder path <span class="muted" style="text-transform:none; letter-spacing:0">— opens terminal here when you begin</span></label>
            <input type="text" id="edit-localpath-${p.id}" value="${escapeHtml(p.localPath || '')}" placeholder="C:\\Users\\you\\projects\\my-repo" autocomplete="off">
          </div>
          <div class="btn-row" style="margin-top:1rem">
            <button class="btn" onclick="saveEditProject('${p.id}')">Save</button>
            <button class="btn btn-ghost" onclick="toggleEditProject('${p.id}')">Cancel</button>
          </div>
        </div>`;
      }).join('');

  document.getElementById('settings-overlay').innerHTML = `
    <div class="col">
      <button class="close-btn" onclick="closeSettings()">✕</button>
      <h1>Settings</h1>

      <h2>Projects</h2>
      ${projectsHtml}
      <div style="margin-top:1.5rem">
        <button class="btn" onclick="toggleAddProjectForm()">+ Add project</button>
      </div>

      <div id="add-project-form" style="display:none; margin-top:2rem">
        <hr class="divider">
        <h2>New project</h2>
        <div class="field">
          <label for="new-name">Name</label>
          <input id="new-name" type="text" autocomplete="off">
        </div>
        <div class="field">
          <label for="new-desc">Description</label>
          <textarea id="new-desc" rows="2"></textarea>
        </div>
        <div class="field">
          <label for="new-url">
            GitHub URL
            <span class="muted" style="text-transform:none; letter-spacing:0"> — recommended</span>
          </label>
          <input id="new-url" type="url" placeholder="https://github.com/you/repo">
        </div>
        <div class="field">
          <label for="new-localpath">Local folder path <span class="muted" style="text-transform:none; letter-spacing:0">— opens terminal here when you begin</span></label>
          <input id="new-localpath" type="text" placeholder="C:\\Users\\you\\projects\\my-repo" autocomplete="off">
        </div>
        <div class="btn-row">
          <button class="btn" onclick="submitNewProject()">Add</button>
          <button class="btn btn-ghost" onclick="toggleAddProjectForm()">Cancel</button>
        </div>
      </div>

      <hr class="divider">

      <h2>GitHub Access Token</h2>
      <div class="field">
        <label for="settings-pat">Personal Access Token</label>
        <input id="settings-pat" type="password" value="${escapeHtml(appState.githubPAT)}" placeholder="ghp_...">
        <p class="muted" style="margin-top:6px;">Stored only in this browser. Only sent to GitHub's API.</p>
      </div>
      <button class="btn" onclick="savePAT()">Save token</button>
    </div>
  `;

  // Enter key on task inputs
  appState.projects.forEach(p => {
    const input = document.getElementById(`new-task-${p.id}`);
    if (input) input.addEventListener('keydown', e => {
      if (e.key === 'Enter') doAddTask(p.id);
    });
  });
}

function toggleEditProject(id) {
  const editDiv = document.getElementById(`project-edit-${id}`);
  const itemDiv = document.getElementById(`project-item-${id}`);
  if (!editDiv) return;
  const isOpen = editDiv.style.display !== 'none';
  editDiv.style.display = isOpen ? 'none' : 'block';
  if (itemDiv) itemDiv.style.opacity = isOpen ? '1' : '0.4';
  if (!isOpen) document.getElementById(`edit-name-${id}`).focus();
}

function saveEditProject(id) {
  const name        = document.getElementById(`edit-name-${id}`).value.trim();
  const description = document.getElementById(`edit-desc-${id}`).value.trim();
  const githubUrl   = document.getElementById(`edit-url-${id}`).value.trim();
  const localPath   = document.getElementById(`edit-localpath-${id}`).value.trim();
  if (!name) { alert('Name is required.'); return; }
  if (githubUrl && !parseGitHubUrl(githubUrl)) { alert('Please use a valid GitHub URL.'); return; }
  appState = updateProject(appState, id, { name, description, githubUrl, localPath });
  saveState(appState);
  renderSettingsOverlay();
}

function toggleProjectTasks(id) {
  const div = document.getElementById(`project-tasks-${id}`);
  const item = document.getElementById(`project-item-${id}`);
  if (!div) return;
  const isOpen = div.style.display !== 'none';
  div.style.display = isOpen ? 'none' : 'block';
  if (item) item.style.opacity = isOpen ? '1' : '0.5';
  if (!isOpen) document.getElementById(`new-task-${id}`).focus();
}

function doAddTask(projectId) {
  const input = document.getElementById(`new-task-${projectId}`);
  const text  = input ? input.value.trim() : '';
  if (!text) return;
  appState = addTask(appState, projectId, text);
  saveState(appState);
  renderSettingsOverlay();
  // Reopen the tasks panel after re-render
  toggleProjectTasks(projectId);
}

function doCompleteTask(projectId, taskId) {
  appState = completeTask(appState, projectId, taskId);
  saveState(appState);
  renderSettingsOverlay();
  toggleProjectTasks(projectId);
  // Show history so user sees where the item went
  const hist = document.getElementById(`task-history-${projectId}`);
  if (hist) hist.style.display = 'block';
}

function toggleTaskHistory(projectId) {
  const hist = document.getElementById(`task-history-${projectId}`);
  const btn  = hist && hist.previousElementSibling;
  if (!hist) return;
  const isOpen = hist.style.display !== 'none';
  hist.style.display = isOpen ? 'none' : 'block';
  if (btn) btn.textContent = isOpen
    ? btn.textContent.replace('▾', '▸')
    : btn.textContent.replace('▸', '▾');
}

function confirmDeleteProject(id) {
  if (!confirm('Delete this project?')) return;
  appState = deleteProject(appState, id);
  saveState(appState);
  renderSettingsOverlay();
}

function savePAT() {
  const pat = document.getElementById('settings-pat').value.trim();
  appState = { ...appState, githubPAT: pat };
  saveState(appState);
  alert('Token saved.');
}

function toggleAddProjectForm() {
  const form = document.getElementById('add-project-form');
  form.style.display = form.style.display === 'none' ? 'block' : 'none';
}

function submitNewProject() {
  const name        = document.getElementById('new-name').value.trim();
  const description = document.getElementById('new-desc').value.trim();
  const githubUrl   = document.getElementById('new-url').value.trim();
  const localPath   = document.getElementById('new-localpath').value.trim();
  if (!name) { alert('Name is required.'); return; }
  if (githubUrl && !parseGitHubUrl(githubUrl)) { alert('Please use a valid GitHub URL.'); return; }
  appState = addProject(appState, { name, description, githubUrl, localPath });
  saveState(appState);
  renderSettingsOverlay();
}

// ── Session choice ─────────────────────────────────────────────────────────
function renderChoiceScreen() {
  Object.assign(currentSession, {
    direction: { mainFocus: '', tasks: '', smallStep: '' },
    emotionCheck: null,
    chosenProjectId: null
  });
  document.getElementById('screen-choice').innerHTML = `
    <div class="col" style="text-align:center">
      <p class="ritual-text" style="opacity:1; font-size:1.35rem; margin-bottom:3rem;">
        Welcome back.
      </p>
      <p class="eyebrow" style="margin-bottom:2rem;">Would you like to begin with the ritual?</p>
      <div class="btn-row" style="justify-content:center">
        <button class="btn" id="choice-ritual">Yes, guide me</button>
        <button class="btn btn-ghost" id="choice-skip">Skip to today's focus</button>
      </div>
    </div>
  `;

  document.getElementById('choice-ritual').addEventListener('click', () => {
    renderArriveScreen();
    showScreen('screen-arrive');
  });

  document.getElementById('choice-skip').addEventListener('click', () => {
    renderDirectionScreen();
    showScreen('screen-direction');
  });
}

// ── Step 1: Arrive ─────────────────────────────────────────────────────────
const ARRIVE_LINES = [
  'Sit down.',
  'Place both feet on the ground.',
  'Let your shoulders soften.',
  'You do not need to feel motivated right now.',
  'You do not need to feel ready.',
  'You only need to arrive.',
  'Today is not about doing everything.',
  'It is only about beginning.',
  'Take one slow breath in.',
  'And one slow breath out.'
];

function renderArriveScreen() {
  const screen = document.getElementById('screen-arrive');
  screen.innerHTML = `
    <div class="col">
      <div id="arrive-text" class="ritual-text"></div>
      <div id="arrive-btn" style="opacity:0; transition:opacity 600ms ease; margin-top:2.5rem">
        <button class="btn" id="arrive-continue">Continue →</button>
      </div>
    </div>
  `;

  const container = document.getElementById('arrive-text');
  ARRIVE_LINES.forEach(line => {
    const p = document.createElement('p');
    p.textContent = line;
    container.appendChild(p);
  });

  let i = 0;
  (function revealNext() {
    const ps = container.querySelectorAll('p');
    if (i < ps.length) {
      ps[i].classList.add('revealed');
      i++;
      setTimeout(revealNext, 900);
    } else {
      document.getElementById('arrive-btn').style.opacity = '1';
    }
  })();

  document.getElementById('arrive-continue').addEventListener('click', () => {
    renderBreathingScreen();
    showScreen('screen-breathing');
  });
}

// ── Step 2: Breathing ──────────────────────────────────────────────────────
const BREATHING_ROUNDS = [
  {
    name: 'Belly Breathing',
    instruction: 'Place one hand on your abdomen.\nBreathe deeply into your belly.\nFeel your abdomen expand as you inhale\nand soften as you exhale.'
  },
  {
    name: 'Chest Breathing',
    instruction: 'Bring your attention to your chest.\nFeel the ribs expand gently.\nLet the chest rise with each inhale\nand fall with each exhale.'
  },
  {
    name: 'Full Yogic Breathing',
    instruction: 'Inhale — a slow wave upward:\nAbdomen · Chest · Collarbone\n\nExhale — release downward:\nCollarbone · Chest · Abdomen'
  }
];

function renderBreathingScreen() {
  document.getElementById('screen-breathing').innerHTML = `
    <div class="col">
      <div class="breath-wrap">
        <div class="breath-instruction" id="breath-instruction">
          Adjust the pace until it feels right.
        </div>
        <div class="breath-circle exhaling" id="breath-circle"></div>
        <div class="breath-label" id="breath-label"></div>
        <div class="breath-counter" id="breath-counter"></div>
      </div>

      <div id="breath-prep">
        <div class="breath-speed-wrap">
          <label class="breath-speed-label" for="breath-speed">
            Breath pace — <span id="breath-speed-val">4</span>s per phase
          </label>
          <input id="breath-speed" type="range" min="2" max="8" value="4" step="1" class="breath-speed-slider">
        </div>
        <div class="btn-row">
          <button class="btn" id="breath-ready">Begin breathing →</button>
        </div>
      </div>

      <div id="breath-practice" style="display:none">
        <div id="breathing-next-row" class="btn-row" style="display:none">
          <button class="btn" id="breathing-next">Next round →</button>
        </div>
        <div id="breathing-done-row" class="btn-row" style="display:none">
          <button class="btn" id="breathing-done">Continue →</button>
        </div>
        <div class="btn-row" style="margin-top:0.5rem">
          <button class="btn btn-ghost" id="breath-skip-round">Skip this round →</button>
        </div>
      </div>
    </div>
  `;

  // Live label update
  document.getElementById('breath-speed').addEventListener('input', e => {
    document.getElementById('breath-speed-val').textContent = e.target.value;
  });

  // Continuously loop inhale/exhale so user can preview speed
  let previewTimer = null;
  let previewPhase = 'exhaling';

  function runPreview() {
    const circle = document.getElementById('breath-circle');
    const label  = document.getElementById('breath-label');
    if (!circle || !label) return;
    const d = getBreathDuration();
    if (previewPhase === 'exhaling') {
      previewPhase = 'inhaling';
      circle.style.transition = `transform ${d / 1000}s ease-in-out`;
      label.textContent = 'Inhale';
      circle.classList.remove('exhaling');
      circle.classList.add('inhaling');
    } else {
      previewPhase = 'exhaling';
      circle.style.transition = `transform ${d / 1000}s ease-in-out`;
      label.textContent = 'Exhale';
      circle.classList.remove('inhaling');
      circle.classList.add('exhaling');
    }
    previewTimer = setTimeout(runPreview, d);
  }

  // Wait for screen fade-in before starting preview
  previewTimer = setTimeout(runPreview, 700);

  document.getElementById('breath-ready').addEventListener('click', () => {
    clearTimeout(previewTimer);

    // Snap circle back to resting state without transition
    const circle = document.getElementById('breath-circle');
    circle.style.transition = 'none';
    circle.classList.remove('inhaling');
    circle.classList.add('exhaling');

    document.getElementById('breath-prep').style.display = 'none';
    document.getElementById('breath-practice').style.display = 'block';
    document.getElementById('breath-instruction').textContent = '';
    document.getElementById('breath-label').textContent = '';

    // One frame so the circle settles before the first breath starts
    requestAnimationFrame(() => runBreathingRound(0));
  });

  document.getElementById('breath-skip-round').addEventListener('click', () => {
    clearTimeout(breathTimeout);
    const next = currentRound + 1;
    const circle = document.getElementById('breath-circle');
    if (circle) {
      circle.style.transition = 'none';
      circle.classList.remove('inhaling');
      circle.classList.add('exhaling');
    }
    if (next >= BREATHING_ROUNDS.length) {
      renderGroundingScreen();
      showScreen('screen-grounding');
    } else {
      requestAnimationFrame(() => runBreathingRound(next));
    }
  });
}

function getBreathDuration() {
  const slider = document.getElementById('breath-speed');
  return slider ? parseInt(slider.value, 10) * 1000 : 4000;
}

function runBreathingRound(roundIndex) {
  currentRound = roundIndex;
  const round  = BREATHING_ROUNDS[roundIndex];
  const TOTAL  = 5;

  document.getElementById('breath-instruction').innerText = round.instruction;
  document.getElementById('breathing-next-row').style.display = 'none';
  document.getElementById('breathing-done-row').style.display = 'none';

  // Update skip button label to show what you'll skip to
  const skipBtn = document.getElementById('breath-skip-round');
  if (skipBtn) {
    if (roundIndex < BREATHING_ROUNDS.length - 1) {
      skipBtn.textContent = `Skip to ${BREATHING_ROUNDS[roundIndex + 1].name} →`;
    } else {
      skipBtn.textContent = 'Skip to next step →';
    }
  }

  let count = 0;

  (function nextBreath() {
    if (count >= TOTAL) {
      document.getElementById('breath-counter').textContent = `${round.name} — complete`;
      document.getElementById('breath-label').textContent = '';

      if (roundIndex < BREATHING_ROUNDS.length - 1) {
        const row = document.getElementById('breathing-next-row');
        row.style.display = 'flex';
        document.getElementById('breathing-next').onclick = () => {
          row.style.display = 'none';
          runBreathingRound(roundIndex + 1);
        };
      } else {
        document.getElementById('breathing-done-row').style.display = 'flex';
        document.getElementById('breathing-done').onclick = () => {
          renderGroundingScreen();
          showScreen('screen-grounding');
        };
      }
      return;
    }

    const duration = getBreathDuration();
    count++;
    const circle  = document.getElementById('breath-circle');
    const label   = document.getElementById('breath-label');
    const counter = document.getElementById('breath-counter');

    if (!circle || !label || !counter) return;

    circle.style.transition = `transform ${duration / 1000}s ease-in-out`;
    counter.textContent = `${round.name} · breath ${count} of ${TOTAL}`;
    label.textContent   = 'Inhale';
    circle.classList.remove('exhaling');
    circle.classList.add('inhaling');

    breathTimeout = setTimeout(() => {
      const c = document.getElementById('breath-circle');
      const l = document.getElementById('breath-label');
      if (!c || !l) return;
      const d = getBreathDuration();
      c.style.transition = `transform ${d / 1000}s ease-in-out`;
      l.textContent = 'Exhale';
      c.classList.remove('inhaling');
      c.classList.add('exhaling');
      breathTimeout = setTimeout(nextBreath, d);
    }, duration);
  })();
}

// ── Step 3: Grounding ──────────────────────────────────────────────────────
const GROUNDING_PROMPTS = [
  'What can you hear right now?',
  'What can you smell?',
  'What can you see?'
];

function renderGroundingScreen() {
  document.getElementById('screen-grounding').innerHTML = `
    <div class="col" style="text-align:center">
      <p class="eyebrow">Bring your attention to this moment</p>
      <p class="ritual-text" id="grounding-prompt"
         style="opacity:0; transition:opacity 700ms ease; font-size:1.25rem; text-align:center;"></p>
      <div id="grounding-btn-row" class="btn-row"
           style="justify-content:center; margin-top:3rem; opacity:0; transition:opacity 300ms ease;">
        <button class="btn btn-ghost" id="grounding-next">Next</button>
      </div>
    </div>
  `;

  let idx = 0;

  function showPrompt(i) {
    const promptEl = document.getElementById('grounding-prompt');
    const btnRow   = document.getElementById('grounding-btn-row');
    const nextBtn  = document.getElementById('grounding-next');

    promptEl.style.opacity = '0';
    btnRow.style.opacity   = '0';
    promptEl.textContent = GROUNDING_PROMPTS[i];

    // double-rAF ensures the browser commits opacity:0 before transitioning to 1
    requestAnimationFrame(() => requestAnimationFrame(() => {
      promptEl.style.opacity = '1';
    }));

    setTimeout(() => {
      btnRow.style.opacity = '1';
      const isLast = i === GROUNDING_PROMPTS.length - 1;
      nextBtn.textContent = isLast ? 'Continue →' : 'Next';

      nextBtn.onclick = () => {
        if (isLast) {
          renderDirectionScreen();
          showScreen('screen-direction');
        } else {
          showPrompt(++idx);
        }
      };
    }, 1500);
  }

  showPrompt(0);
}

// ── Step 4: Today's Direction ──────────────────────────────────────────────
function renderDirectionScreen() {
  document.getElementById('screen-direction').innerHTML = `
    <div class="col">
      <p class="eyebrow">Today's direction</p>

      <div id="dir-s1">
        <div class="field">
          <label for="dir-focus">What is your main focus today?</label>
          <input id="dir-focus" type="text" autocomplete="off">
        </div>
        <div class="btn-row">
          <button class="btn" id="dir-s1-next">Next →</button>
        </div>
      </div>

      <div id="dir-s2" style="display:none">
        <div class="field">
          <label for="dir-tasks">What are one or two important tasks?</label>
          <textarea id="dir-tasks" rows="3"></textarea>
        </div>
        <div class="btn-row">
          <button class="btn btn-ghost" id="dir-s2-back">← Back</button>
          <button class="btn" id="dir-s2-next">Continue →</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('dir-s1-next').addEventListener('click', () => {
    const focus = document.getElementById('dir-focus').value.trim();
    if (!focus) { alert('Please enter your main focus for today.'); return; }
    currentSession.direction.mainFocus = focus;
    document.getElementById('dir-s1').style.display = 'none';
    document.getElementById('dir-s2').style.display = 'block';
    document.getElementById('dir-tasks').focus();
  });

  document.getElementById('dir-s2-back').addEventListener('click', () => {
    document.getElementById('dir-s2').style.display = 'none';
    document.getElementById('dir-s1').style.display = 'block';
    document.getElementById('dir-focus').focus();
  });

  document.getElementById('dir-s2-next').addEventListener('click', () => {
    currentSession.direction.tasks = document.getElementById('dir-tasks').value.trim();
    renderEmotionCheckScreen();
    showScreen('screen-emotion');
  });

  document.getElementById('dir-focus').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('dir-s1-next').click();
  });
}

// ── Step 4b: Emotion Check ─────────────────────────────────────────────────

// Forward: surface → middle → core
const EMOTION_PROMPTS = [
  "What's making you want to put this off right now?",
  "And if that's true... what are you afraid might happen?",
  "And if that happened... what would it mean about you?"
];
const EMOTION_KEYS = ['reason', 'fear', 'meaning'];

// Backwards: core → middle → surface (cognitive restructuring)
const REFRAME_STEPS = [
  {
    key:      'meaning_reflection',
    getLabel: v => `You wrote, about what this would mean about you`,
    getQuote: v => v.meaning,
    question: 'Is this actually true about you — or is it a story your mind is telling you right now?',
    sub:      'What evidence do you have for this belief — and what speaks against it?'
  },
  {
    key:      'fear_reflection',
    getLabel: v => `You wrote, about what you fear might happen`,
    getQuote: v => v.fear,
    question: 'How certain is it that this would actually happen?',
    sub:      'And if it did — have you faced difficult moments before and found your way through?'
  },
  {
    key:      'reason_reflection',
    getLabel: v => `You wrote, about why you want to postpone`,
    getQuote: v => v.reason,
    question: 'Seeing what lies beneath this — does this still feel like a barrier?',
    sub:      'Or might it be a signal that this work genuinely matters to you?'
  }
];

function renderEmotionCheckScreen() {
  document.getElementById('screen-emotion').innerHTML = `
    <div id="emotion-gate" class="col" style="text-align:center">
      <p class="ritual-text" style="opacity:1; margin-bottom:2.5rem;">
        Is there anything making you want to put this off?
      </p>
      <div class="btn-row" style="justify-content:center">
        <button class="btn btn-ghost" id="emotion-yes">Yes, let's look at it</button>
        <button class="btn" id="emotion-no">No, I'm ready</button>
      </div>
    </div>

    <div id="emotion-prompts"  class="col" style="display:none"></div>
    <div id="emotion-review"   class="col" style="display:none"></div>
    <div id="emotion-reframe"  class="col" style="display:none"></div>

    <div id="emotion-closing" class="col"
         style="display:none; text-align:center; flex-direction:column; align-items:center; padding-top:2rem">
      <p class="closing-question">You don't need to resolve all of this right now.</p>
      <p style="font-family:var(--font-serif); font-size:1rem; color:var(--text-muted); margin-top:0.75rem; font-style:italic">
        You only need to begin.
      </p>
      <div id="emotion-continue-row" class="btn-row"
           style="justify-content:center; margin-top:3rem; opacity:0; transition:opacity 300ms ease;">
        <button class="btn" id="emotion-continue">Continue →</button>
      </div>
    </div>
  `;

  const emotionValues   = {};
  const reframeValues   = {};

  // ── Stage 1: Forward prompts ──────────────────────────────────────────────
  function showEmotionPrompt(index) {
    document.getElementById('emotion-prompts').innerHTML = `
      <div class="field" style="margin-top:1rem">
        <label style="font-family:var(--font-serif); font-size:1rem; text-transform:none; letter-spacing:0; color:var(--text); line-height:1.7">
          ${escapeHtml(EMOTION_PROMPTS[index])}
        </label>
        <textarea id="emotion-input" rows="3" autocomplete="off" style="margin-top:1rem">${escapeHtml(emotionValues[EMOTION_KEYS[index]] || '')}</textarea>
      </div>
      <div class="btn-row">
        ${index > 0 ? `<button class="btn btn-ghost" id="emotion-prompt-back">← Back</button>` : ''}
        <button class="btn" id="emotion-prompt-next">
          ${index < EMOTION_PROMPTS.length - 1 ? 'Next →' : 'Continue →'}
        </button>
      </div>
    `;
    setTimeout(() => document.getElementById('emotion-input').focus(), 50);

    if (index > 0) {
      document.getElementById('emotion-prompt-back').addEventListener('click', () => {
        emotionValues[EMOTION_KEYS[index]] = document.getElementById('emotion-input').value.trim();
        showEmotionPrompt(index - 1);
      });
    }

    document.getElementById('emotion-prompt-next').addEventListener('click', () => {
      emotionValues[EMOTION_KEYS[index]] = document.getElementById('emotion-input').value.trim();
      if (index < EMOTION_PROMPTS.length - 1) {
        showEmotionPrompt(index + 1);
      } else {
        document.getElementById('emotion-prompts').style.display = 'none';
        showReview();
      }
    });
  }

  // ── Stage 2: Review — show all three answers together ────────────────────
  function showReview() {
    const review = document.getElementById('emotion-review');
    review.style.display = 'block';
    review.innerHTML = `
      <p class="eyebrow" style="margin-bottom:2rem">What you've written</p>

      <div class="reflection-block">
        <p class="reflection-label">What's making you postpone</p>
        <p class="reflection-answer">${escapeHtml(emotionValues.reason || '—')}</p>
      </div>
      <div class="reflection-block">
        <p class="reflection-label">What you fear might happen</p>
        <p class="reflection-answer">${escapeHtml(emotionValues.fear || '—')}</p>
      </div>
      <div class="reflection-block">
        <p class="reflection-label">What you believe this means about you</p>
        <p class="reflection-answer">${escapeHtml(emotionValues.meaning || '—')}</p>
      </div>

      <p class="muted" style="margin-top:2rem; font-style:italic">
        Let's look at each of these, starting from the deepest.
      </p>
      <div class="btn-row" style="margin-top:1.5rem">
        <button class="btn btn-ghost" id="review-back">← Back</button>
        <button class="btn" id="review-next">Look closer →</button>
        <button class="btn btn-ghost" id="review-skip">I'm ready to begin</button>
      </div>
    `;
    document.getElementById('review-back').addEventListener('click', () => {
      review.style.display = 'none';
      document.getElementById('emotion-prompts').style.display = 'block';
      showEmotionPrompt(EMOTION_PROMPTS.length - 1);
    });
    document.getElementById('review-skip').addEventListener('click', () => {
      currentSession.emotionCheck = emotionValues;
      appState = saveSession(appState, currentSession);
      saveState(appState);
      review.style.display = 'none';
      showClosing();
    });
    document.getElementById('review-next').addEventListener('click', () => {
      review.style.display = 'none';
      showReframe(0);
    });
  }

  // ── Stage 3: Backwards cognitive restructuring ───────────────────────────
  function showReframe(index) {
    const reframe = document.getElementById('emotion-reframe');
    const step    = REFRAME_STEPS[index];
    reframe.style.display = 'block';
    reframe.innerHTML = `
      <p class="eyebrow" style="margin-bottom:1.25rem">${escapeHtml(step.getLabel(emotionValues))}</p>
      <blockquote class="reflection-quote">${escapeHtml(step.getQuote(emotionValues) || '—')}</blockquote>
      <p class="ritual-text" style="opacity:1; margin:2rem 0 0.5rem; font-size:1.05rem">
        ${escapeHtml(step.question)}
      </p>
      <p class="muted" style="margin-bottom:1.5rem">${escapeHtml(step.sub)}</p>
      <div class="field">
        <textarea id="reframe-input" rows="3" autocomplete="off"
                  placeholder="Write whatever comes to mind…"></textarea>
      </div>
      <div class="btn-row">
        <button class="btn btn-ghost" id="reframe-back">← Back</button>
        <button class="btn" id="reframe-next">
          ${index < REFRAME_STEPS.length - 1 ? 'Next →' : 'Continue →'}
        </button>
      </div>
    `;
    setTimeout(() => {
      const inp = document.getElementById('reframe-input');
      if (inp) {
        inp.value = reframeValues[step.key] || '';
        inp.focus();
      }
    }, 50);

    document.getElementById('reframe-back').addEventListener('click', () => {
      reframeValues[step.key] = document.getElementById('reframe-input').value.trim();
      reframe.style.display = 'none';
      if (index === 0) {
        document.getElementById('emotion-review').style.display = 'block';
      } else {
        showReframe(index - 1);
      }
    });

    document.getElementById('reframe-next').addEventListener('click', () => {
      reframeValues[step.key] = document.getElementById('reframe-input').value.trim();
      reframe.style.display = 'none';
      if (index < REFRAME_STEPS.length - 1) {
        showReframe(index + 1);
      } else {
        currentSession.emotionCheck = { ...emotionValues, reframe: reframeValues };
        appState = saveSession(appState, currentSession);
        saveState(appState);
        showClosing();
      }
    });
  }

  // ── Stage 4: Closing ──────────────────────────────────────────────────────
  function showClosing() {
    const closing = document.getElementById('emotion-closing');
    closing.style.display = 'flex';
    setTimeout(() => {
      document.getElementById('emotion-continue-row').style.opacity = '1';
    }, 2000);
    document.getElementById('emotion-continue').onclick = goToProjects;
  }

  document.getElementById('emotion-yes').addEventListener('click', () => {
    document.getElementById('emotion-gate').style.display = 'none';
    document.getElementById('emotion-prompts').style.display = 'block';
    showEmotionPrompt(0);
  });

  document.getElementById('emotion-no').addEventListener('click', goToProjects);
}

function goToProjects() {
  renderProjectsScreen();
  showScreen('screen-projects');
}

// ── Step 5: Choose Project ─────────────────────────────────────────────────
async function renderProjectsScreen() {
  document.getElementById('screen-projects').innerHTML = `
    <div class="col">
      <p class="eyebrow">Choose one project</p>
      <div id="project-cards" class="project-cards"></div>
    </div>
  `;

  const container = document.getElementById('project-cards');

  if (appState.projects.length === 0) {
    container.innerHTML = '<p class="muted" style="text-align:center">No projects yet. Add one in ⚙ Settings.</p>';
    return;
  }

  for (const project of appState.projects) {
    const card = document.createElement('div');
    card.className = 'project-card';
    card.innerHTML = `
      <h3>${escapeHtml(project.name)}</h3>
      ${project.description ? `<p class="desc">${escapeHtml(project.description)}</p>` : ''}
      ${project.githubUrl ? `<ul class="commits-list" id="commits-${project.id}">
        <li><span class="commits-loading">Loading recent commits…</span></li>
      </ul>` : ''}
    `;
    card.addEventListener('click', () => selectProject(project.id));
    container.appendChild(card);

    if (!project.githubUrl) continue;

    fetchCommits(project.githubUrl, appState.githubPAT).then(commits => {
      commitCache[project.id] = commits;
      const list = document.getElementById(`commits-${project.id}`);
      if (!list) return;
      list.innerHTML = commits.length === 0
        ? '<li><span class="commits-loading">No recent commits found.</span></li>'
        : commits.map(c => `
            <li>
              <span class="commit-date">${escapeHtml(c.date)}</span>
              <span>${escapeHtml(c.message)}</span>
            </li>
          `).join('');
    });
  }

  // "Other" card — unregistered project
  const otherCard = document.createElement('div');
  otherCard.className = 'project-card';
  otherCard.innerHTML = `
    <h3 style="color:var(--text-muted)">Other</h3>
    <p class="desc">Something not listed here</p>
  `;
  otherCard.addEventListener('click', () => selectOtherProject());
  container.appendChild(otherCard);
}

function selectOtherProject() {
  currentSession.chosenProjectId = null;
  renderOtherFirstStepScreen();
  showScreen('screen-begin');
}

function renderOtherFirstStepScreen() {
  document.getElementById('screen-begin').innerHTML = `
    <div class="col">
      <div class="field" style="margin-bottom:1.5rem">
        <label for="other-project-name" style="font-family:var(--font-serif); font-size:1rem; text-transform:none; letter-spacing:0; color:var(--text); line-height:1.7">
          What are you working on?
        </label>
        <input id="other-project-name" type="text" autocomplete="off" style="margin-top:0.75rem" placeholder="Project or task name">
      </div>
      <div class="field">
        <label for="other-first-step" style="font-family:var(--font-serif); font-size:1rem; text-transform:none; letter-spacing:0; color:var(--text); line-height:1.7">
          What is one small, concrete first step?
        </label>
        <input id="other-first-step" type="text" autocomplete="off" style="margin-top:0.75rem">
      </div>
      <div class="btn-row">
        <button class="btn" id="other-begin">Begin →</button>
      </div>
    </div>
  `;

  setTimeout(() => document.getElementById('other-project-name').focus(), 50);

  document.getElementById('other-begin').addEventListener('click', () => {
    const name = document.getElementById('other-project-name').value.trim() || 'Other';
    const step = document.getElementById('other-first-step').value.trim() || 'Begin.';
    currentSession.direction.smallStep = step;
    appState = saveSession(appState, currentSession);
    saveState(appState);

    document.getElementById('screen-begin').innerHTML = `
      <div class="col">
        <p class="begin-project">${escapeHtml(name)}</p>
        <p class="begin-step">${escapeHtml(step)}</p>
      </div>
    `;
  });
}

function selectProject(projectId) {
  currentSession.chosenProjectId = projectId;
  renderFirstStepScreen(projectId, commitCache[projectId] || []);
  showScreen('screen-begin');
}

// ── Step 5b: First step input ──────────────────────────────────────────────
function renderFirstStepScreen(projectId, commits) {
  const project = appState.projects.find(p => p.id === projectId);
  if (!project) return;

  const commitsHtml = commits.length > 0 ? `
    <div class="begin-commits" style="margin-bottom:2rem">
      <p class="begin-commits-label">Recent commits</p>
      ${commits.map(c => `
        <div class="begin-commit-row">
          <span class="commit-date">${escapeHtml(c.date)}</span>
          <span class="begin-commit-msg">${escapeHtml(c.message)}</span>
        </div>`).join('')}
    </div>` : '';

  document.getElementById('screen-begin').innerHTML = `
    <div class="col">
      <p class="begin-project">${escapeHtml(project.name)}</p>
      ${commitsHtml}
      <div class="field">
        <label for="first-step-input" style="font-family:var(--font-serif); font-size:1.05rem; text-transform:none; letter-spacing:0; color:var(--text); line-height:1.7">
          What is one small, concrete first step you will take?
        </label>
        <input id="first-step-input" type="text" autocomplete="off" style="margin-top:0.75rem">
      </div>
      <div class="btn-row">
        <button class="btn" id="first-step-next">Begin →</button>
      </div>
    </div>
  `;

  setTimeout(() => document.getElementById('first-step-input').focus(), 50);

  const proceed = () => {
    currentSession.direction.smallStep = document.getElementById('first-step-input').value.trim() || 'Begin.';
    appState = saveSession(appState, currentSession);
    saveState(appState);
    renderBeginScreen(projectId, commits);
  };
  document.getElementById('first-step-next').addEventListener('click', proceed);
  document.getElementById('first-step-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') proceed();
  });
}

// ── Step 6: Begin ──────────────────────────────────────────────────────────
function renderBeginScreen(projectId, commits) {
  const project   = appState.projects.find(p => p.id === projectId);
  if (!project) return;
  const smallStep = currentSession.direction.smallStep || 'Begin.';
  const safeUrl   = /^https?:\/\//i.test(project.githubUrl) ? project.githubUrl : '';
  const localPath = project.localPath || '';

  const commitsHtml = (commits && commits.length > 0) ? `
    <div class="begin-commits">
      <p class="begin-commits-label">Recent commits</p>
      ${commits.map(c => `
        <div class="begin-commit-row">
          <span class="commit-date">${escapeHtml(c.date)}</span>
          <span class="begin-commit-msg">${escapeHtml(c.message)}</span>
        </div>`).join('')}
    </div>` : '';

  const terminalHtml = localPath ? `
    <div class="terminal-block">
      <p class="terminal-label">Open a terminal here</p>
      <div class="terminal-cmd-row">
        <code class="terminal-cmd" id="terminal-cmd-text">cd "${escapeHtml(localPath)}"</code>
        <button class="terminal-copy-btn" onclick="copyTerminalCmd('${escapeHtml(localPath)}')" title="Copy command">⎘</button>
      </div>
      ${localPath ? `<a class="terminal-vscode-link" href="vscode://file/${encodeURIComponent(localPath)}" title="Open in VS Code">Open in VS Code →</a>` : ''}
    </div>` : '';

  document.getElementById('screen-begin').innerHTML = `
    <div class="col">
      <p class="begin-project">${escapeHtml(project.name)}</p>
      <p class="begin-step">${escapeHtml(smallStep)}</p>
      ${commitsHtml}
      ${terminalHtml}
      ${safeUrl ? `<div class="btn-row" style="margin-top:1.5rem">
        <a class="btn" href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">Open repository →</a>
      </div>` : ''}
    </div>
  `;
}

function copyTerminalCmd(localPath) {
  navigator.clipboard.writeText(`cd "${localPath}"`).then(() => {
    const btn = document.querySelector('.terminal-copy-btn');
    if (btn) { btn.textContent = '✓'; setTimeout(() => { btn.textContent = '⎘'; }, 1500); }
  });
}
