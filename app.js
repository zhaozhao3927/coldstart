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
    : appState.projects.map(p => `
        <div class="project-item">
          <div class="project-item-info">
            <strong>${escapeHtml(p.name)}</strong>
            <div class="muted">${escapeHtml(p.githubUrl)}</div>
          </div>
          <div class="project-item-actions">
            <button class="btn btn-ghost btn-sm" onclick="confirmDeleteProject('${escapeHtml(p.id)}')">Delete</button>
          </div>
        </div>
      `).join('');

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
          <label for="new-url">GitHub URL</label>
          <input id="new-url" type="url">
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
  if (!name || !githubUrl) { alert('Name and GitHub URL are required.'); return; }
  if (!parseGitHubUrl(githubUrl)) { alert('Please use a valid GitHub URL.'); return; }
  appState = addProject(appState, { name, description, githubUrl });
  saveState(appState);
  renderSettingsOverlay();
}

// ── Session choice ─────────────────────────────────────────────────────────
function renderChoiceScreen() {
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
    instruction: 'Breathe from the belly upward into the chest.\nA smooth wave of breath.\nBelly — Ribs — Chest.\nAnd slowly release.'
  }
];

function renderBreathingScreen() {
  document.getElementById('screen-breathing').innerHTML = `
    <div class="col">
      <div class="breath-wrap">
        <div class="breath-instruction" id="breath-instruction"></div>
        <div class="breath-circle exhaling" id="breath-circle"></div>
        <div class="breath-label" id="breath-label"></div>
        <div class="breath-counter" id="breath-counter"></div>
      </div>
      <div id="breathing-next-row" class="btn-row" style="display:none">
        <button class="btn" id="breathing-next">Next round →</button>
      </div>
      <div id="breathing-done-row" class="btn-row" style="display:none">
        <button class="btn" id="breathing-done">Continue →</button>
      </div>
    </div>
  `;

  runBreathingRound(0);
}

function runBreathingRound(roundIndex) {
  const round = BREATHING_ROUNDS[roundIndex];
  const TOTAL = 5;

  document.getElementById('breath-instruction').innerText = round.instruction;
  document.getElementById('breathing-next-row').style.display = 'none';
  document.getElementById('breathing-done-row').style.display = 'none';

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
        document.getElementById('breathing-done').addEventListener('click', () => {
          renderGroundingScreen();
          showScreen('screen-grounding');
        });
      }
      return;
    }

    count++;
    const circle  = document.getElementById('breath-circle');
    const label   = document.getElementById('breath-label');
    const counter = document.getElementById('breath-counter');

    counter.textContent = `${round.name} · breath ${count} of ${TOTAL}`;
    label.textContent   = 'Inhale';
    circle.classList.remove('exhaling');
    circle.classList.add('inhaling');

    setTimeout(() => {
      label.textContent = 'Exhale';
      circle.classList.remove('inhaling');
      circle.classList.add('exhaling');
      setTimeout(nextBreath, 4000);
    }, 4000);
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

    setTimeout(() => { promptEl.textContent = GROUNDING_PROMPTS[i]; promptEl.style.opacity = '1'; }, 300);

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
    }, 5000);
  }

  showPrompt(0);
}
