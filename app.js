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
    instruction: 'Breathe from the belly upward into the chest.\nA smooth wave of breath.\nBelly — Ribs — Chest.\nAnd slowly release.'
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
  setTimeout(runPreview, 700);

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
}

function getBreathDuration() {
  const slider = document.getElementById('breath-speed');
  return slider ? parseInt(slider.value, 10) * 1000 : 4000;
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

    setTimeout(() => {
      const c = document.getElementById('breath-circle');
      const l = document.getElementById('breath-label');
      if (!c || !l) return;
      const d = getBreathDuration();
      c.style.transition = `transform ${d / 1000}s ease-in-out`;
      l.textContent = 'Exhale';
      c.classList.remove('inhaling');
      c.classList.add('exhaling');
      setTimeout(nextBreath, d);
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
          <button class="btn" id="dir-s2-next">Next →</button>
        </div>
      </div>

      <div id="dir-s3" style="display:none">
        <div class="field">
          <label for="dir-step">What is one small, achievable first step?</label>
          <input id="dir-step" type="text" autocomplete="off">
        </div>
        <div class="btn-row">
          <button class="btn" id="dir-s3-next">Continue →</button>
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

  document.getElementById('dir-s2-next').addEventListener('click', () => {
    currentSession.direction.tasks = document.getElementById('dir-tasks').value.trim();
    document.getElementById('dir-s2').style.display = 'none';
    document.getElementById('dir-s3').style.display = 'block';
    document.getElementById('dir-step').focus();
  });

  document.getElementById('dir-s3-next').addEventListener('click', () => {
    currentSession.direction.smallStep = document.getElementById('dir-step').value.trim();
    renderEmotionCheckScreen();
    showScreen('screen-emotion');
  });

  document.getElementById('dir-focus').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('dir-s1-next').click();
  });

  document.getElementById('dir-step').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('dir-s3-next').click();
  });
}

// ── Step 4b: Emotion Check ─────────────────────────────────────────────────
const EMOTION_PROMPTS = [
  "What's the reason you want to postpone?",
  "And if that's true... what are you afraid might happen?",
  "And if that happened... what would it really mean about you?"
];
const EMOTION_KEYS = ['reason', 'fear', 'meaning'];

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

    <div id="emotion-prompts" class="col" style="display:none"></div>

    <div id="emotion-closing" class="col"
         style="display:none; text-align:center; padding-top:3rem; flex-direction:column; align-items:center">
      <p class="closing-question">
        Is any of this actually true right now, in this moment?
      </p>
      <div id="emotion-continue-row" class="btn-row"
           style="justify-content:center; margin-top:3rem; opacity:0; transition:opacity 300ms ease;">
        <button class="btn" id="emotion-continue">Continue →</button>
      </div>
    </div>
  `;

  const emotionValues = {};

  function showEmotionPrompt(index) {
    document.getElementById('emotion-prompts').innerHTML = `
      <div class="field" style="margin-top:1rem">
        <label>${escapeHtml(EMOTION_PROMPTS[index])}</label>
        <textarea id="emotion-input" rows="3" autocomplete="off" style="margin-top:0.5rem"></textarea>
      </div>
      <div class="btn-row">
        <button class="btn" id="emotion-prompt-next">
          ${index < EMOTION_PROMPTS.length - 1 ? 'Next →' : 'Done'}
        </button>
      </div>
    `;
    setTimeout(() => document.getElementById('emotion-input').focus(), 50);

    document.getElementById('emotion-prompt-next').addEventListener('click', () => {
      emotionValues[EMOTION_KEYS[index]] = document.getElementById('emotion-input').value.trim();
      if (index < EMOTION_PROMPTS.length - 1) {
        showEmotionPrompt(index + 1);
      } else {
        currentSession.emotionCheck = emotionValues;
        appState = saveSession(appState, currentSession);
        saveState(appState);
        showClosingQuestion();
      }
    });
  }

  function showClosingQuestion() {
    document.getElementById('emotion-prompts').style.display = 'none';
    const closing = document.getElementById('emotion-closing');
    closing.style.display = 'flex';
    setTimeout(() => {
      document.getElementById('emotion-continue-row').style.opacity = '1';
    }, 4000);
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
      <ul class="commits-list" id="commits-${project.id}">
        <li><span class="commits-loading">Loading recent commits…</span></li>
      </ul>
    `;
    card.addEventListener('click', () => selectProject(project.id));
    container.appendChild(card);

    fetchCommits(project.githubUrl, appState.githubPAT).then(commits => {
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
}

function selectProject(projectId) {
  currentSession.chosenProjectId = projectId;
  appState = saveSession(appState, currentSession);
  saveState(appState);
  renderBeginScreen(projectId);
  showScreen('screen-begin');
}

// ── Step 6: Begin ──────────────────────────────────────────────────────────
function renderBeginScreen(projectId) {
  const project   = appState.projects.find(p => p.id === projectId);
  if (!project) return;
  const smallStep = currentSession.direction.smallStep || 'Begin.';
  const safeUrl   = /^https?:\/\//i.test(project.githubUrl) ? project.githubUrl : '#';

  document.getElementById('screen-begin').innerHTML = `
    <div class="col">
      <p class="begin-project">${escapeHtml(project.name)}</p>
      <p class="begin-step">${escapeHtml(smallStep)}</p>
      <div class="btn-row">
        <a class="btn"
           href="${escapeHtml(safeUrl)}"
           target="_blank"
           rel="noopener noreferrer">Open repository →</a>
      </div>
    </div>
  `;
}
