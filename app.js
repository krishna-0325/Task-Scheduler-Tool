/* ── Config ────────────────────────────────────────────────── */
const API = 'http://localhost:8000';

/* ── State ─────────────────────────────────────────────────── */
const state = {
  tasks: [],
  filters: { status: '', priority: '', search: '' },
  sort: 'created_at',
  editId: null,
  deleteId: null,
  calYear: new Date().getFullYear(),
  calMonth: new Date().getMonth(),
  currentView: 'dashboard',
};

/* ── API Helpers ───────────────────────────────────────────── */
async function api(path, opts = {}) {
  try {
    const res = await fetch(API + path, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    return await res.json();
  } catch (e) {
    if (e.message.includes('Failed to fetch')) {
      showToast('Cannot connect to server. Is the backend running?', 'error');
    } else {
      showToast(e.message, 'error');
    }
    throw e;
  }
}

async function fetchTasks() {
  const params = new URLSearchParams();
  if (state.filters.status)   params.set('status',   state.filters.status);
  if (state.filters.priority) params.set('priority', state.filters.priority);
  if (state.filters.search)   params.set('search',   state.filters.search);
  const tasks = await api(`/tasks?${params}`);
  state.tasks = tasks || [];
  return state.tasks;
}

async function fetchStats() {
  return await api('/stats');
}

async function fetchCategories() {
  const cats = await api('/categories');
  const dl = document.getElementById('categoryOptions');
  dl.innerHTML = cats.map(c => `<option value="${c}">`).join('');
}

/* ── View Switcher ─────────────────────────────────────────── */
function switchView(view, el) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.getElementById(`view-${view}`).classList.remove('hidden');

  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  if (el) el.classList.add('active');

  const titles = { dashboard: 'Dashboard', tasks: 'All Tasks', calendar: 'Calendar' };
  document.getElementById('pageTitle').textContent = titles[view] || view;
  state.currentView = view;

  if (view === 'dashboard')  loadDashboard();
  if (view === 'tasks')      loadTaskList();
  if (view === 'calendar')   renderCalendar();
}

/* ── Dashboard ─────────────────────────────────────────────── */
async function loadDashboard() {
  const [stats, tasks] = await Promise.all([fetchStats(), fetchTasks()]);
  renderStats(stats);
  renderPriorityBars(stats);
  renderCategoryList(stats);
  renderRecentTasks(tasks.slice(0, 8));
}

function renderStats(stats) {
  document.getElementById('statTotal').textContent   = stats.total ?? 0;
  document.getElementById('statPending').textContent  = stats.by_status?.pending ?? 0;
  document.getElementById('statProgress').textContent = stats.by_status?.in_progress ?? 0;
  document.getElementById('statDone').textContent     = stats.by_status?.completed ?? 0;
}

function renderPriorityBars(stats) {
  const total = stats.total || 1;
  const data = [
    { key: 'high',   label: 'High',   cls: 'pbar-high',   count: stats.by_priority?.high   || 0 },
    { key: 'medium', label: 'Medium', cls: 'pbar-medium', count: stats.by_priority?.medium || 0 },
    { key: 'low',    label: 'Low',    cls: 'pbar-low',    count: stats.by_priority?.low    || 0 },
  ];
  document.getElementById('priorityBars').innerHTML = data.map(d => {
    const pct = Math.round((d.count / total) * 100);
    return `
      <div class="pbar-row">
        <div class="pbar-label-row">
          <span>${d.label}</span>
          <span>${d.count} tasks (${pct}%)</span>
        </div>
        <div class="pbar-track">
          <div class="pbar-fill ${d.cls}" style="width:${pct}%"></div>
        </div>
      </div>`;
  }).join('');
}

function renderCategoryList(stats) {
  const cats = stats.by_category || {};
  const entries = Object.entries(cats);
  if (!entries.length) {
    document.getElementById('categoryList').innerHTML = emptyState('No categories yet');
    return;
  }
  document.getElementById('categoryList').innerHTML = entries.map(([cat, count]) => `
    <div class="cat-item">
      <span>${escHtml(cat)}</span>
      <span class="cat-badge">${count}</span>
    </div>`).join('');
}

function renderRecentTasks(tasks) {
  document.getElementById('recentTasks').innerHTML = tasks.length
    ? tasks.map(taskCard).join('')
    : emptyState('No tasks yet. Create your first one!');
}

/* ── Task List ─────────────────────────────────────────────── */
async function loadTaskList() {
  const el = document.getElementById('allTasksList');
  el.innerHTML = loading();
  await fetchTasks();
  renderTaskList();
}

function renderTaskList() {
  const sorted = sortedTasks();
  document.getElementById('taskCount').textContent =
    `${sorted.length} task${sorted.length !== 1 ? 's' : ''}`;
  document.getElementById('allTasksList').innerHTML = sorted.length
    ? sorted.map(taskCard).join('')
    : emptyState('No tasks match your filters.');
}

function sortedTasks() {
  const ts = [...state.tasks];
  const order = { high: 0, medium: 1, low: 2 };
  const statusOrder = { pending: 0, in_progress: 1, completed: 2 };
  ts.sort((a, b) => {
    if (state.sort === 'priority') return (order[a.priority] ?? 1) - (order[b.priority] ?? 1);
    if (state.sort === 'status')   return (statusOrder[a.status] ?? 0) - (statusOrder[b.status] ?? 0);
    if (state.sort === 'due_date') {
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      return a.due_date.localeCompare(b.due_date);
    }
    return (b.created_at || '').localeCompare(a.created_at || '');
  });
  return ts;
}

function sortTasks(val) {
  state.sort = val;
  renderTaskList();
}

/* ── Task Card HTML ────────────────────────────────────────── */
function taskCard(task) {
  const isCompleted = task.status === 'completed';
  const dueHtml = task.due_date ? (() => {
    const due = new Date(task.due_date);
    const today = new Date(); today.setHours(0,0,0,0);
    const overdue = !isCompleted && due < today;
    return `<span class="tag tag-due ${overdue ? 'overdue' : ''}">
      ${overdue ? '⚠ ' : ''}Due ${formatDate(task.due_date)}
    </span>`;
  })() : '';

  return `
  <div class="task-card ${isCompleted ? 'completed-card' : ''}" data-id="${task.id}">
    <span class="priority-dot dot-${task.priority}"></span>
    <div class="task-body">
      <div class="task-title">${escHtml(task.title)}</div>
      ${task.description ? `<div class="task-desc">${escHtml(task.description)}</div>` : ''}
      <div class="task-meta">
        <span class="tag tag-status-${task.status}">${statusLabel(task.status)}</span>
        <span class="tag tag-category">${escHtml(task.category || 'General')}</span>
        ${dueHtml}
      </div>
    </div>
    <div class="task-actions">
      ${!isCompleted ? `<button class="action-btn" onclick="markDone(${task.id})" title="Mark complete">✓</button>` : ''}
      <button class="action-btn" onclick="openEdit(${task.id})" title="Edit">✎</button>
      <button class="action-btn delete" onclick="openDelete(${task.id})" title="Delete">✕</button>
    </div>
  </div>`;
}

/* ── Calendar ──────────────────────────────────────────────── */
function renderCalendar() {
  const { calYear: y, calMonth: m } = state;
  const months = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
  document.getElementById('calendarMonth').textContent = `${months[m]} ${y}`;

  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const first = new Date(y, m, 1).getDay();
  const last  = new Date(y, m + 1, 0).getDate();
  const today = new Date();

  const tasksByDate = {};
  state.tasks.forEach(t => {
    if (t.due_date) {
      const k = t.due_date.slice(0, 10);
      if (!tasksByDate[k]) tasksByDate[k] = [];
      tasksByDate[k].push(t);
    }
  });

  let html = days.map(d => `<div class="cal-day-name">${d}</div>`).join('');

  // empty leading cells
  for (let i = 0; i < first; i++) {
    html += `<div class="cal-cell other-month"><div class="cal-date">${new Date(y, m, -first + i + 1).getDate()}</div></div>`;
  }

  for (let d = 1; d <= last; d++) {
    const dateStr = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isToday = d === today.getDate() && m === today.getMonth() && y === today.getFullYear();
    const tasks = tasksByDate[dateStr] || [];
    const dots = tasks.map(t =>
      `<span class="cal-task-dot" style="background:var(--${t.priority === 'high' ? 'high' : t.priority === 'medium' ? 'medium' : 'low'})"
       title="${escHtml(t.title)}"></span>`
    ).join('');
    html += `<div class="cal-cell ${isToday ? 'today' : ''}">
      <div class="cal-date">${d}</div>
      ${dots}
    </div>`;
  }

  document.getElementById('calendarGrid').innerHTML = html;
}

function changeMonth(dir) {
  state.calMonth += dir;
  if (state.calMonth > 11) { state.calMonth = 0; state.calYear++; }
  if (state.calMonth < 0)  { state.calMonth = 11; state.calYear--; }
  renderCalendar();
}

/* ── Filters ───────────────────────────────────────────────── */
function setFilter(type, value, el) {
  state.filters[type] = value;
  document.querySelectorAll(`[data-filter="${type}"]`).forEach(btn => btn.classList.remove('active'));
  el.classList.add('active');
  if (state.currentView === 'dashboard') loadDashboard();
  else if (state.currentView === 'tasks') loadTaskList();
  else if (state.currentView === 'calendar') { fetchTasks().then(() => renderCalendar()); }
}

let searchTimer;
function debounceSearch(val) {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.filters.search = val;
    if (state.currentView === 'tasks') loadTaskList();
    else if (state.currentView === 'dashboard') loadDashboard();
  }, 280);
}

/* ── Modal ─────────────────────────────────────────────────── */
function openModal(task = null) {
  state.editId = task ? task.id : null;
  document.getElementById('modalTitle').textContent = task ? 'Edit Task' : 'New Task';
  document.getElementById('submitBtn').textContent  = task ? 'Save Changes' : 'Create Task';
  document.getElementById('taskTitle').value       = task?.title || '';
  document.getElementById('taskDescription').value = task?.description || '';
  document.getElementById('taskPriority').value    = task?.priority || 'medium';
  document.getElementById('taskStatus').value      = task?.status || 'pending';
  document.getElementById('taskDue').value         = task?.due_date || '';
  document.getElementById('taskCategory').value    = task?.category || '';
  document.getElementById('modalOverlay').classList.remove('hidden');
  fetchCategories();
  document.getElementById('taskTitle').focus();
}

function closeModal() {
  document.getElementById('modalOverlay').classList.add('hidden');
  state.editId = null;
}

function handleOverlayClick(e) {
  if (e.target === document.getElementById('modalOverlay')) closeModal();
}

async function submitTask(e) {
  e.preventDefault();
  const payload = {
    title:       document.getElementById('taskTitle').value.trim(),
    description: document.getElementById('taskDescription').value.trim(),
    priority:    document.getElementById('taskPriority').value,
    status:      document.getElementById('taskStatus').value,
    due_date:    document.getElementById('taskDue').value || null,
    category:    document.getElementById('taskCategory').value.trim() || 'General',
  };
  if (!payload.title) return;

  const btn = document.getElementById('submitBtn');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    if (state.editId) {
      await api(`/tasks/${state.editId}`, { method: 'PUT', body: JSON.stringify(payload) });
      showToast('Task updated!', 'success');
    } else {
      await api('/tasks', { method: 'POST', body: JSON.stringify(payload) });
      showToast('Task created!', 'success');
    }
    closeModal();
    refreshCurrentView();
  } finally {
    btn.disabled = false;
    btn.textContent = state.editId ? 'Save Changes' : 'Create Task';
  }
}

async function openEdit(id) {
  const task = state.tasks.find(t => t.id === id) || await api(`/tasks/${id}`);
  openModal(task);
}

/* ── Quick Actions ─────────────────────────────────────────── */
async function markDone(id) {
  await api(`/tasks/${id}`, { method: 'PUT', body: JSON.stringify({ status: 'completed' }) });
  showToast('Task completed! 🎉', 'success');
  refreshCurrentView();
}

/* ── Delete ────────────────────────────────────────────────── */
function openDelete(id) {
  state.deleteId = id;
  document.getElementById('deleteOverlay').classList.remove('hidden');
}
function closeDelete() {
  document.getElementById('deleteOverlay').classList.add('hidden');
  state.deleteId = null;
}
async function confirmDelete() {
  if (!state.deleteId) return;
  await api(`/tasks/${state.deleteId}`, { method: 'DELETE' });
  showToast('Task deleted', 'success');
  closeDelete();
  refreshCurrentView();
}

/* ── Refresh ───────────────────────────────────────────────── */
function refreshCurrentView() {
  if (state.currentView === 'dashboard') loadDashboard();
  else if (state.currentView === 'tasks') loadTaskList();
  else if (state.currentView === 'calendar') { fetchTasks().then(() => renderCalendar()); }
}

/* ── Toast ─────────────────────────────────────────────────── */
function showToast(msg, type = 'success') {
  const container = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

/* ── Utils ─────────────────────────────────────────────────── */
function escHtml(str) {
  return String(str || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

function formatDate(str) {
  if (!str) return '';
  const d = new Date(str + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function statusLabel(s) {
  return { pending: 'Pending', in_progress: 'In Progress', completed: 'Completed' }[s] || s;
}

function loading() {
  return `<div class="loading"><div class="spinner"></div> Loading…</div>`;
}

function emptyState(msg) {
  return `<div class="empty"><div class="empty-icon">📭</div><p>${msg}</p></div>`;
}

/* ── Keyboard Shortcuts ────────────────────────────────────── */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeModal(); closeDelete(); }
  if (e.key === 'n' && !e.ctrlKey && !e.metaKey &&
      document.activeElement.tagName !== 'INPUT' &&
      document.activeElement.tagName !== 'TEXTAREA') {
    openModal();
  }
});

/* ── Init ──────────────────────────────────────────────────── */
loadDashboard();