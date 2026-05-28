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

function addProject(state, { name, description, githubUrl }) {
  const project = { id: crypto.randomUUID(), name, description, githubUrl };
  return { ...state, projects: [...state.projects, project] };
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

const currentSession = {
  direction: { mainFocus: '', tasks: '', smallStep: '' },
  emotionCheck: null,
  chosenProjectId: null
};

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(el => {
    el.classList.remove('active', 'visible');
  });
  const screen = document.getElementById(id);
  screen.classList.add('active');
  requestAnimationFrame(() => screen.classList.add('visible'));
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
        <label for="setup-url">GitHub repository URL</label>
        <input id="setup-url" type="url" placeholder="https://github.com/you/repo">
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
    const name       = document.getElementById('setup-name').value.trim();
    const description = document.getElementById('setup-desc').value.trim();
    const githubUrl  = document.getElementById('setup-url').value.trim();
    const pat        = document.getElementById('setup-pat').value.trim();

    if (!name || !githubUrl) {
      alert('Please enter a project name and GitHub URL.');
      return;
    }
    if (!parseGitHubUrl(githubUrl)) {
      alert('Please use a valid GitHub URL: https://github.com/owner/repo');
      return;
    }

    appState = addProject(appState, { name, description, githubUrl });
    if (pat) appState = { ...appState, githubPAT: pat };
    saveState(appState);

    renderChoiceScreen();
    showScreen('screen-choice');
  });
}
