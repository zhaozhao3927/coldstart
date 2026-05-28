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
