// Moo Tasks Ultra-Modern Frontend Engine

const state = {
  goals: [],
  tasks: [],
  decisions: [],
  activity: [],
  currentView: 'tasks',
  viewMode: 'list', // 'list' | 'board'
  filterGoal: '',
  filterPriority: '',
  filterAgent: '',
  filterSearch: '',
  selectedTaskId: null,
  paletteSelectedIndex: 0,
};

// Lucide Refresh Helper
function refreshLucideIcons() {
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }
}

// Audio & Notification Alert Engine
let soundEnabled = localStorage.getItem('moo_sound_enabled') !== 'false';
const alertedHumanTaskIds = new Set();
let originalTitle = document.title || 'Moo Tasks';
let titleFlashInterval = null;

function startTitleFlashing(flashText) {
  if (titleFlashInterval) return;
  let toggle = false;
  titleFlashInterval = setInterval(() => {
    document.title = toggle ? flashText : (originalTitle || 'Moo Tasks');
    toggle = !toggle;
  }, 1000);
}

function stopTitleFlashing() {
  if (titleFlashInterval) {
    clearInterval(titleFlashInterval);
    titleFlashInterval = null;
    document.title = originalTitle || 'Moo Tasks';
  }
}

window.addEventListener('focus', stopTitleFlashing);
window.addEventListener('click', stopTitleFlashing);

function playNotificationChime() {
  if (!soundEnabled) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now); // D5
    osc1.frequency.exponentialRampToValueAtTime(880, now + 0.12); // A5

    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(880, now + 0.12);
    osc2.frequency.exponentialRampToValueAtTime(1174.66, now + 0.3); // D6

    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start(now);
    osc2.start(now + 0.12);
    osc1.stop(now + 0.25);
    osc2.stop(now + 0.45);
  } catch {
    // ignore
  }
}

function triggerHumanAlert(task) {
  playNotificationChime();
  if (document.hidden) {
    startTitleFlashing('🚨 (1) 🙋 Human Action Needed');
  }
  if ('Notification' in window && Notification.permission === 'granted') {
    const notif = new Notification('🙋 Moo Tasks: Action Needed', {
      body: `${task.claimedByAgent || 'Agent'}: ${task.humanQuestion || task.title}`,
      icon: '/logo.png',
    });
    notif.onclick = () => {
      window.focus();
      window.location.hash = '#/human';
    };
  }
}

// Markdown Parser Helper
function renderMarkdown(text) {
  if (!text) return '';
  if (window.marked && typeof window.marked.parse === 'function') {
    try {
      return window.marked.parse(text, { breaks: true, gfm: true });
    } catch {
      // fallback
    }
  }
  const div = document.createElement('div');
  div.textContent = text;
  return `<p>${div.innerHTML.replace(/\n/g, '<br>')}</p>`;
}

// HTML to Markdown Converter Engine
let turndownInstance = null;
function getTurndownEngine() {
  if (!turndownInstance && window.TurndownService) {
    turndownInstance = new window.TurndownService({
      headingStyle: 'atx',
      hr: '---',
      codeBlockStyle: 'fenced',
      emDelimiter: '*',
      bulletListMarker: '-',
    });
    if (window.turndownPluginGfm && window.turndownPluginGfm.gfm) {
      turndownInstance.use(window.turndownPluginGfm.gfm);
    }
  }
  return turndownInstance;
}

function htmlToMarkdown(html) {
  if (!html || !html.trim()) return '';
  const engine = getTurndownEngine();
  if (engine) {
    try {
      return engine.turndown(html);
    } catch {
      // fallback
    }
  }
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.innerText || '';
}

// Direct In-Place Visual Editing Handlers
window.handleDirectDocBlur = async (element, targetId, field, isGoal = false) => {
  const markdown = htmlToMarkdown(element.innerHTML);
  if (isGoal) {
    await fetch(`/api/goals/${targetId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: markdown }),
    });
    showToast('Saved specification', 'success');
    fetchGoals();
  } else {
    await handleSaveInlineField(targetId, field, markdown);
  }
};

window.handleDirectDocKeydown = (event, element, targetId, field, isGoal = false) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault();
    element.blur();
  }
};

// DOM References
const navItems = document.querySelectorAll('.nav-item');
const viewPanes = document.querySelectorAll('.view-pane');
const activeViewTitle = document.getElementById('activeViewTitle');
const tasksViewSwitcher = document.getElementById('tasksViewSwitcher');
const btnViewList = document.getElementById('btnViewList');
const btnViewBoard = document.getElementById('btnViewBoard');
const tasksListView = document.getElementById('tasksListView');
const tasksBoardView = document.getElementById('tasksBoardView');
const filterToolbar = document.getElementById('filterToolbar');

const filterGoal = document.getElementById('filterGoal');
const filterPriority = document.getElementById('filterPriority');
const filterAgent = document.getElementById('filterAgent');
const filterSearch = document.getElementById('filterSearch');
const displayCountLabel = document.getElementById('displayCountLabel');

// Counters
const navCounterTotal = document.getElementById('navCounterTotal');
const navCounterGoals = document.getElementById('navCounterGoals');
const navCounterHuman = document.getElementById('navCounterHuman');
const navCounterReview = document.getElementById('navCounterReview');
const navCounterDecisions = document.getElementById('navCounterDecisions');

// Drawers & Modals
const commandPalette = document.getElementById('commandPalette');
const paletteInput = document.getElementById('paletteInput');
const paletteResults = document.getElementById('paletteResults');
const drawerInspector = document.getElementById('drawerInspector');
const drawerBody = document.getElementById('drawerBody');
const modalCreateTask = document.getElementById('modalCreateTask');
const modalCreateSubtask = document.getElementById('modalCreateSubtask');
const modalMergeTask = document.getElementById('modalMergeTask');
const modalCreateGoal = document.getElementById('modalCreateGoal');
const modalCreateDecision = document.getElementById('modalCreateDecision');
const modalSupersedeDecision = document.getElementById('modalSupersedeDecision');
const modalReasonPrompt = document.getElementById('modalReasonPrompt');
const toastContainer = document.getElementById('toastContainer');

// Time Helpers
function formatRelativeTime(dateStr) {
  if (!dateStr) return '';
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now - date;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHrs = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHrs / 24);

  if (diffSec < 60) return `${Math.max(1, diffSec)}s ago`;
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHrs < 24) return `${diffHrs}h ago`;
  return `${diffDays}d ago`;
}

// Toast Notification System
function showToast(message, type = 'info') {
  if (!toastContainer) return;
  const toast = document.createElement('div');
  toast.className = `toast-msg ${type}`;
  
  let iconName = 'info';
  if (type === 'success') iconName = 'check-circle';
  if (type === 'error') iconName = 'alert-circle';

  toast.innerHTML = `<i data-lucide="${iconName}" class="w-4 h-4"></i><span class="font-medium">${message}</span>`;
  toastContainer.appendChild(toast);
  refreshLucideIcons();

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
    toast.style.transition = 'all 0.2s ease-out';
    setTimeout(() => toast.remove(), 200);
  }, 3500);
}

// SSE Sync & Resilient Connection Engine
let sseReconnectTimer = null;
let sseReconnectAttempts = 0;
let sseInstance = null;
let lastPingReceivedAt = Date.now();

function setLiveSyncState(status) {
  const indicator = document.getElementById('liveSyncIndicator');
  const dot = document.getElementById('liveSyncDot');
  const label = document.getElementById('liveSyncLabel');
  if (!indicator || !dot || !label) return;

  if (status === 'connected') {
    indicator.className = 'flex items-center gap-1.5 text-[11px] text-emerald-400 font-mono transition-colors';
    dot.className = 'w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse';
    label.textContent = 'Live Sync';
  } else if (status === 'reconnecting') {
    indicator.className = 'flex items-center gap-1.5 text-[11px] text-amber-400 font-mono transition-colors';
    dot.className = 'w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping';
    label.textContent = 'Reconnecting...';
  } else {
    indicator.className = 'flex items-center gap-1.5 text-[11px] text-rose-400 font-mono transition-colors';
    dot.className = 'w-1.5 h-1.5 rounded-full bg-rose-400';
    label.textContent = 'Offline';
  }
}

function initSSE() {
  if (sseInstance) {
    try {
      sseInstance.close();
    } catch {}
    sseInstance = null;
  }

  const eventSource = new EventSource('/api/events');
  sseInstance = eventSource;

  eventSource.onopen = () => {
    sseReconnectAttempts = 0;
    lastPingReceivedAt = Date.now();
    setLiveSyncState('connected');
    refreshAll();
  };

  eventSource.addEventListener('connected', () => {
    lastPingReceivedAt = Date.now();
    setLiveSyncState('connected');
  });

  eventSource.addEventListener('ping', () => {
    lastPingReceivedAt = Date.now();
    setLiveSyncState('connected');
  });

  eventSource.addEventListener('tasks_updated', () => refreshAll());
  eventSource.addEventListener('goals_updated', () => refreshAll());
  eventSource.addEventListener('decisions_updated', () => fetchDecisions());
  eventSource.addEventListener('activity_updated', () => fetchActivity());

  eventSource.onerror = () => {
    try {
      eventSource.close();
    } catch {}
    sseInstance = null;
    sseReconnectAttempts++;
    setLiveSyncState('reconnecting');

    const delay = Math.min(1000 * Math.pow(1.5, sseReconnectAttempts), 8000);
    if (sseReconnectTimer) clearTimeout(sseReconnectTimer);
    sseReconnectTimer = setTimeout(() => {
      initSSE();
    }, delay);
  };
}

// Multi-Device & Mobile Screen Wake Listeners
window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    refreshAll();
    if (!sseInstance || Date.now() - lastPingReceivedAt > 20000) {
      initSSE();
    }
  }
});

window.addEventListener('online', () => {
  refreshAll();
  initSSE();
});

// Active Multi-Device Background Sync (every 2.5s when visible)
setInterval(() => {
  if (document.visibilityState === 'visible') {
    fetchTasks();
    if (!sseInstance || sseReconnectAttempts > 0) {
      refreshAll();
    } else if (Date.now() - lastPingReceivedAt > 20000) {
      initSSE();
    }
  }
}, 2500);

// API Fetching
async function fetchProjectInfo() {
  try {
    const res = await fetch('/api/project');
    const data = await res.json();
    if (data.projectName) {
      const bc = document.getElementById('breadcrumbWorkspaceName');
      if (bc) bc.textContent = data.projectName;
      const lbl = document.getElementById('sidebarProjectLabel');
      if (lbl) lbl.textContent = `${data.projectName} • Local Engine`;
      document.title = `${data.projectName} — Moo Tasks`;
    }
  } catch (err) {
    // ignore
  }
}

async function fetchGoals() {
  try {
    const res = await fetch('/api/goals');
    const data = await res.json();
    state.goals = data.goals || [];
    renderGoalFilters();
    renderGoalsView();
    if (navCounterGoals) navCounterGoals.textContent = state.goals.length;
    refreshLucideIcons();
  } catch (err) {
    console.error('Failed to fetch goals:', err);
  }
}

async function fetchTasks() {
  try {
    const res = await fetch('/api/tasks');
    const data = await res.json();
    state.tasks = data.tasks || [];

    // Check for new waiting-on-human tasks to chime
    const waitingTasks = state.tasks.filter((t) => t.status === 'waiting-on-human' && !t.isArchived);
    waitingTasks.forEach((t) => {
      if (!alertedHumanTaskIds.has(t.id)) {
        alertedHumanTaskIds.add(t.id);
        triggerHumanAlert(t);
      }
    });

    renderTasks();
    renderHumanInbox();
    renderReviewFeed();
    renderResumeView();
    updateAssigneeFilter();
    updateSidebarCounters();
    refreshLucideIcons();
  } catch (err) {
    console.error('Failed to fetch tasks:', err);
  }
}

async function fetchDecisions() {
  try {
    const res = await fetch('/api/decisions');
    const data = await res.json();
    state.decisions = data.decisions || [];
    renderDecisionsView();
    if (navCounterDecisions) navCounterDecisions.textContent = state.decisions.length;
    refreshLucideIcons();
  } catch (err) {
    console.error('Failed to fetch decisions:', err);
  }
}

async function fetchActivity() {
  try {
    const res = await fetch('/api/activity');
    const data = await res.json();
    state.activity = data.notes || [];
    renderActivityFeed();
    refreshLucideIcons();
  } catch (err) {
    console.error('Failed to fetch activity:', err);
  }
}

async function refreshAll() {
  await Promise.all([fetchProjectInfo(), fetchGoals(), fetchTasks(), fetchDecisions(), fetchActivity()]);
  if (state.selectedTaskId) {
    const isTyping =
      document.activeElement &&
      (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') &&
      document.getElementById('drawerInspector')?.contains(document.activeElement);

    if (!isTyping) {
      openInspector(state.selectedTaskId, false, false);
    }
  }
  refreshLucideIcons();
}

// Sidebar Navigation
navItems.forEach((btn) => {
  btn.addEventListener('click', () => {
    const view = btn.getAttribute('data-view');
    switchView(view);
  });
});

function switchView(viewName, updateHash = true) {
  state.currentView = viewName;
  if (updateHash) {
    if (state.selectedTaskId && viewName === 'tasks') {
      window.location.hash = `#/tasks/${state.selectedTaskId}`;
    } else {
      window.location.hash = `#/${viewName}`;
    }
  }

  navItems.forEach((b) => b.classList.toggle('active', b.getAttribute('data-view') === viewName));
  viewPanes.forEach((pane) => {
    pane.classList.toggle('hidden', pane.id !== `pane-${viewName}`);
    pane.classList.toggle('active', pane.id === `pane-${viewName}`);
  });

  const titles = {
    tasks: 'All Issues',
    goals: 'Goals & Roadmap',
    human: 'Human Attention Inbox',
    review: 'Review & Proofs',
    decisions: 'Architectural Decisions',
    activity: 'Live Activity Feed',
    resume: 'Session Resume',
  };

  if (activeViewTitle) activeViewTitle.textContent = titles[viewName] || 'Workspace';
  if (tasksViewSwitcher) tasksViewSwitcher.classList.toggle('hidden', viewName !== 'tasks');
  if (filterToolbar) filterToolbar.classList.toggle('hidden', viewName !== 'tasks');

  if (viewName === 'resume') renderResumeView();
  if (viewName === 'activity') fetchActivity();
  refreshLucideIcons();
}

// View Mode (List vs Board)
if (btnViewList) btnViewList.onclick = () => setViewMode('list');
if (btnViewBoard) btnViewBoard.onclick = () => setViewMode('board');

function setViewMode(mode) {
  state.viewMode = mode;
  if (btnViewList) btnViewList.classList.toggle('active', mode === 'list');
  if (btnViewBoard) btnViewBoard.classList.toggle('active', mode === 'board');
  if (tasksListView) tasksListView.classList.toggle('hidden', mode !== 'list');
  if (tasksBoardView) tasksBoardView.classList.toggle('hidden', mode !== 'board');
  renderTasks();
}

// Filters
function getFilteredTasks() {
  let list = state.tasks.filter((t) => !t.isArchived);

  if (state.filterGoal === '__orphans__') {
    list = list.filter((t) => !t.goalId);
  } else if (state.filterGoal) {
    list = list.filter((t) => t.goalId === state.filterGoal);
  }

  if (state.filterPriority) {
    list = list.filter((t) => t.priority === state.filterPriority);
  }
  if (state.filterAgent) {
    list = list.filter((t) => t.claimedByAgent === state.filterAgent);
  }
  if (state.filterSearch) {
    const q = state.filterSearch.toLowerCase();
    list = list.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.id.toLowerCase().includes(q) ||
        (t.description && t.description.toLowerCase().includes(q))
    );
  }

  return list;
}

if (filterGoal) {
  filterGoal.onchange = (e) => {
    state.filterGoal = e.target.value;
    renderTasks();
  };
}
if (filterPriority) {
  filterPriority.onchange = (e) => {
    state.filterPriority = e.target.value;
    renderTasks();
  };
}
if (filterAgent) {
  filterAgent.onchange = (e) => {
    state.filterAgent = e.target.value;
    renderTasks();
  };
}
if (filterSearch) {
  filterSearch.oninput = (e) => {
    state.filterSearch = e.target.value;
    renderTasks();
  };
}

function renderGoalFilters() {
  if (!filterGoal) return;
  const cur = filterGoal.value;
  filterGoal.innerHTML = '<option value="">All Goals</option><option value="__orphans__">Scope Drift (Orphans)</option>';
  const inputTaskGoal = document.getElementById('inputTaskGoal');
  if (inputTaskGoal) inputTaskGoal.innerHTML = '<option value="">(None / Standalone)</option>';

  state.goals.forEach((item) => {
    const g = item.goal;
    const opt = document.createElement('option');
    opt.value = g.id;
    opt.textContent = `${g.title}`;
    filterGoal.appendChild(opt);

    if (inputTaskGoal) {
      const opt2 = document.createElement('option');
      opt2.value = g.id;
      opt2.textContent = g.title;
      inputTaskGoal.appendChild(opt2);
    }
  });
  filterGoal.value = cur;
}

function updateAssigneeFilter() {
  if (!filterAgent) return;
  const assignees = Array.from(new Set(state.tasks.map((t) => t.claimedByAgent).filter(Boolean)));
  const cur = filterAgent.value;
  filterAgent.innerHTML = '<option value="">All Assignees</option>';
  assignees.forEach((a) => {
    const opt = document.createElement('option');
    opt.value = a;
    opt.textContent = a;
    filterAgent.appendChild(opt);
  });
  filterAgent.value = cur;
}

function updateSidebarCounters() {
  const activeTasks = state.tasks.filter((t) => !t.isArchived);
  if (navCounterTotal) navCounterTotal.textContent = activeTasks.length;

  const humanWaiting = state.tasks.filter((t) => t.status === 'waiting-on-human' && !t.isArchived);
  if (navCounterHuman) {
    navCounterHuman.textContent = humanWaiting.length;
    navCounterHuman.classList.toggle('hidden', humanWaiting.length === 0);
  }

  const reviewTasks = state.tasks.filter(
    (t) => (t.status === 'done' && t.verificationState === 'agent_completed') || t.status === 'dropped'
  );
  if (navCounterReview) {
    navCounterReview.textContent = reviewTasks.length;
    navCounterReview.classList.toggle('hidden', reviewTasks.length === 0);
  }
}

// Priority Icon Helper (Lucide SVGs)
function getPriorityIcon(priority) {
  switch (priority) {
    case 'critical':
      return `<i data-lucide="chevrons-up" class="w-3.5 h-3.5 text-rose-500" title="Critical"></i>`;
    case 'high':
      return `<i data-lucide="chevron-up" class="w-3.5 h-3.5 text-amber-500" title="High"></i>`;
    case 'medium':
      return `<i data-lucide="equal" class="w-3.5 h-3.5 text-blue-400" title="Medium"></i>`;
    case 'low':
      return `<i data-lucide="chevron-down" class="w-3.5 h-3.5 text-slate-500" title="Low"></i>`;
    default:
      return `<i data-lucide="minus" class="w-3.5 h-3.5 text-slate-600"></i>`;
  }
}

// Status Name & Dot Helper
const statusConfig = {
  todo: { label: 'Todo', class: 'todo' },
  doing: { label: 'In Progress', class: 'doing' },
  'blocked-on-dependency': { label: 'Blocked', class: 'blocked-on-dependency' },
  'waiting-on-human': { label: 'Waiting on Human', class: 'waiting-on-human' },
  done: { label: 'Done', class: 'done' },
  dropped: { label: 'Dropped', class: 'dropped' },
};

// Render Tasks (List & Board)
function renderTasks() {
  const filtered = getFilteredTasks();
  if (displayCountLabel) displayCountLabel.textContent = `${filtered.length} issues`;

  if (state.viewMode === 'list') {
    renderListView(filtered);
  } else {
    renderBoardView(filtered);
  }
  refreshLucideIcons();
}

// Mode 1: List View
function renderListView(tasks) {
  if (!tasksListView) return;
  tasksListView.innerHTML = '';

  const groups = [
    { status: 'doing', label: 'In Progress' },
    { status: 'waiting-on-human', label: 'Waiting on Human' },
    { status: 'blocked-on-dependency', label: 'Blocked on Dependency' },
    { status: 'todo', label: 'Todo' },
    { status: 'done', label: 'Done' },
    { status: 'dropped', label: 'Dropped' },
  ];

  groups.forEach((grp) => {
    const groupTasks = tasks.filter((t) => t.status === grp.status);
    if (groupTasks.length === 0 && (grp.status === 'dropped' || grp.status === 'blocked-on-dependency')) {
      return;
    }

    const groupEl = document.createElement('div');
    groupEl.className = 'list-group';

    const cfg = statusConfig[grp.status];

    groupEl.innerHTML = `
      <div class="list-group-header">
        <div class="list-group-title">
          <span class="status-dot ${cfg.class}"></span>
          <span>${grp.label}</span>
          <span class="text-slate-500 font-mono text-[10px]">(${groupTasks.length})</span>
        </div>
      </div>
      <div class="list-rows-container"></div>
    `;

    const rowsContainer = groupEl.querySelector('.list-rows-container');

    if (groupTasks.length === 0) {
      const emptyRow = document.createElement('div');
      emptyRow.className = 'p-3 text-center text-xs text-slate-600';
      emptyRow.textContent = `No issues in ${grp.label.toLowerCase()}`;
      rowsContainer.appendChild(emptyRow);
    } else {
      groupTasks.forEach((task) => {
        const row = document.createElement('div');
        row.className = 'list-row';
        row.setAttribute('data-id', task.id);

        const goal = state.goals.find((g) => g.goal.id === task.goalId)?.goal;
        const isStalled = task.attemptCount >= task.maxAttemptsAllowed || task.reopenCount >= 2;

        row.innerHTML = `
          <div class="list-col-id flex items-center gap-1">
            <span>${task.id}</span>
            ${isStalled ? `<i data-lucide="alert-triangle" class="w-3 h-3 text-amber-400" title="High Thrash/Attempts"></i>` : ''}
          </div>
          <div class="list-col-priority">${getPriorityIcon(task.priority)}</div>
          <div class="list-col-title">
            <span>${task.title}</span>
            <span class="text-[10.5px] text-slate-500 font-mono ml-2 font-normal">(${formatRelativeTime(task.lastStateChangeAt)})</span>
          </div>
          ${goal ? `<div class="list-col-goal">${goal.title}</div>` : `<div class="list-col-goal border-amber-900/40 text-amber-400 bg-amber-950/20">Scope Drift</div>`}
          <div class="list-col-agent">
            ${task.claimedByAgent ? `<span class="flex items-center gap-1"><i data-lucide="bot" class="w-3.5 h-3.5"></i> ${task.claimedByAgent}</span>` : `<span class="text-slate-600 font-sans">Unassigned</span>`}
          </div>
          <div class="list-col-status">
            <span class="status-pill">
              <span class="status-dot ${cfg.class}"></span>
              <span class="text-slate-300">${cfg.label}</span>
            </span>
          </div>
        `;

        row.onclick = () => openInspector(task.id);
        rowsContainer.appendChild(row);
      });
    }

    tasksListView.appendChild(groupEl);
  });
}

// Mode 2: Board View with Drag & Drop
function renderBoardView(tasks) {
  if (!tasksBoardView) return;
  tasksBoardView.innerHTML = '';

  const columns = [
    { status: 'todo', label: 'Todo' },
    { status: 'doing', label: 'In Progress' },
    { status: 'blocked-on-dependency', label: 'Blocked' },
    { status: 'waiting-on-human', label: 'Needs Human' },
    { status: 'done', label: 'Done' },
    { status: 'dropped', label: 'Dropped' },
  ];

  columns.forEach((col) => {
    const colTasks = tasks.filter((t) => t.status === col.status);
    const cfg = statusConfig[col.status];

    const colEl = document.createElement('div');
    colEl.className = 'board-column';
    colEl.setAttribute('data-col-status', col.status);

    colEl.ondragover = (e) => {
      e.preventDefault();
      colEl.style.borderColor = '#5e6ad2';
      colEl.style.backgroundColor = 'rgba(94, 106, 210, 0.05)';
    };

    colEl.ondragleave = () => {
      colEl.style.borderColor = '';
      colEl.style.backgroundColor = '';
    };

    colEl.ondrop = async (e) => {
      e.preventDefault();
      colEl.style.borderColor = '';
      colEl.style.backgroundColor = '';
      const taskId = e.dataTransfer.getData('text/plain');
      if (taskId) {
        handleStatusChangePrompt(taskId, col.status);
      }
    };

    colEl.innerHTML = `
      <div class="board-column-header">
        <div class="flex items-center gap-2">
          <span class="status-dot ${cfg.class}"></span>
          <span>${col.label}</span>
        </div>
        <span class="font-mono text-slate-500 text-[10px]">${colTasks.length}</span>
      </div>
      <div class="board-cards"></div>
    `;

    const cardsContainer = colEl.querySelector('.board-cards');

    colTasks.forEach((task) => {
      const card = document.createElement('div');
      card.className = 'board-card';
      card.setAttribute('data-id', task.id);
      card.draggable = true;

      card.ondragstart = (e) => {
        e.dataTransfer.setData('text/plain', task.id);
        card.style.opacity = '0.4';
      };

      card.ondragend = () => {
        card.style.opacity = '1';
      };

      const goal = state.goals.find((g) => g.goal.id === task.goalId)?.goal;
      const isStalled = task.attemptCount >= task.maxAttemptsAllowed || task.reopenCount >= 2;

      card.innerHTML = `
        <div class="board-card-header">
          <div class="flex items-center gap-1 font-mono text-[11px] text-slate-500">
            <span>${task.id}</span>
            ${isStalled ? `<i data-lucide="alert-triangle" class="w-3 h-3 text-amber-400" title="Stalled"></i>` : ''}
          </div>
          ${getPriorityIcon(task.priority)}
        </div>
        <div class="board-card-title">${task.title}</div>
        <div class="board-card-footer">
          ${task.claimedByAgent ? `<span class="text-indigo-400 font-mono text-[10.5px] flex items-center gap-1"><i data-lucide="bot" class="w-3 h-3"></i> ${task.claimedByAgent}</span>` : `<span class="text-slate-600 text-[10px]">Unassigned</span>`}
          <span class="text-slate-500 text-[10px] font-mono">${formatRelativeTime(task.lastStateChangeAt)}</span>
        </div>
      `;

      card.onclick = () => openInspector(task.id);
      cardsContainer.appendChild(card);
    });

    tasksBoardView.appendChild(colEl);
  });
}

// Slide-Over Inspector Drawer
async function openInspector(taskId, showDrawer = true, updateHash = true) {
  state.selectedTaskId = taskId;
  if (updateHash) {
    window.location.hash = `#/tasks/${taskId}`;
  }
  try {
    const res = await fetch(`/api/tasks/${taskId}`);
    const data = await res.json();
    const task = data.task;
    const subtasks = data.subtasks || [];
    const dependencies = data.dependencies || [];
    const dependents = data.dependents || [];
    const notes = data.notes || [];

    const cfg = statusConfig[task.status] || { label: task.status, class: 'todo' };
    const drawerTaskId = document.getElementById('drawerTaskId');
    const drawerStatusDot = document.getElementById('drawerStatusDot');
    const drawerPriorityBadge = document.getElementById('drawerPriorityBadge');

    if (drawerTaskId) drawerTaskId.textContent = task.id;
    if (drawerStatusDot) drawerStatusDot.className = `status-dot ${cfg.class}`;
    if (drawerPriorityBadge) drawerPriorityBadge.textContent = task.priority;

    const candidateBlockers = state.tasks.filter((t) => t.id !== task.id && !dependencies.includes(t.id) && t.parentId !== task.id);

    if (!drawerBody) return;
    drawerBody.innerHTML = `
      <!-- Inline Editable Title -->
      <div class="space-y-1">
        <input type="text" id="drawerInputTitle" value="${task.title.replace(/"/g, '&quot;')}" class="input-field text-base font-bold text-slate-100 w-full" onchange="handleSaveInlineField('${task.id}', 'title', this.value)">
        <div class="text-[11px] text-slate-500 font-mono flex items-center gap-1"><i data-lucide="clock" class="w-3 h-3"></i> Last changed: ${formatRelativeTime(task.lastStateChangeAt)} (${task.lastStateChangeAt})</div>
      </div>

      <!-- Properties Grid -->
      <div class="property-grid">
        <span class="property-label">Status</span>
        <div class="property-value flex items-center gap-2">
          <span class="status-dot ${cfg.class}"></span>
          <span class="font-medium">${cfg.label}</span>
          <select id="drawerStatusSelect" class="filter-select text-xs ml-auto" onchange="handleStatusChangePrompt('${task.id}', this.value)">
            <option value="todo" ${task.status === 'todo' ? 'selected' : ''}>Todo</option>
            <option value="doing" ${task.status === 'doing' ? 'selected' : ''}>In Progress</option>
            <option value="blocked-on-dependency" ${task.status === 'blocked-on-dependency' ? 'selected' : ''}>Blocked (Dependency)</option>
            <option value="waiting-on-human" ${task.status === 'waiting-on-human' ? 'selected' : ''}>Waiting on Human</option>
            <option value="done" ${task.status === 'done' ? 'selected' : ''}>Done</option>
            <option value="dropped" ${task.status === 'dropped' ? 'selected' : ''}>Dropped</option>
          </select>
        </div>

        <span class="property-label">Priority</span>
        <div class="property-value flex items-center gap-2">
          <select class="filter-select text-xs capitalize" onchange="handleSaveInlineField('${task.id}', 'priority', this.value)">
            <option value="low" ${task.priority === 'low' ? 'selected' : ''}>Low</option>
            <option value="medium" ${task.priority === 'medium' ? 'selected' : ''}>Medium</option>
            <option value="high" ${task.priority === 'high' ? 'selected' : ''}>High</option>
            <option value="critical" ${task.priority === 'critical' ? 'selected' : ''}>Critical</option>
          </select>
        </div>

        <span class="property-label">Linked Goal</span>
        <div class="property-value">
          <select class="filter-select text-xs w-full" onchange="handleSaveInlineField('${task.id}', 'goalId', this.value || null)">
            <option value="">(None / Scope Drift)</option>
            ${state.goals.map((g) => `<option value="${g.goal.id}" ${task.goalId === g.goal.id ? 'selected' : ''}>${g.goal.title}</option>`).join('')}
          </select>
        </div>

        <span class="property-label">Claimed Agent</span>
        <div class="property-value font-mono text-indigo-300 flex items-center gap-1.5">
          ${task.claimedByAgent ? `<i data-lucide="bot" class="w-3.5 h-3.5"></i> ${task.claimedByAgent} ${task.attemptCount > 1 ? `(Attempt #${task.attemptCount})` : ''}` : '<span class="text-slate-500 font-sans">Unclaimed</span>'}
        </div>

        ${task.leaseExpiresAt ? `
          <span class="property-label">Lease Timeout</span>
          <div class="property-value font-mono text-xs text-slate-400">
            ${new Date(task.leaseExpiresAt).toLocaleTimeString()}
          </div>
        ` : ''}

        ${task.declaredFiles && task.declaredFiles.length > 0 ? `
          <span class="property-label">Declared Files</span>
          <div class="property-value font-mono text-xs text-slate-300">
            ${task.declaredFiles.join(', ')}
          </div>
        ` : ''}
      </div>

      <!-- Issue Description (Direct In-Place Visual Markdown Editing) -->
      <div class="bg-surface border border-subtle rounded-lg p-3.5 space-y-2">
        <div class="flex items-center justify-between pb-1 border-b border-subtle">
          <div class="text-[10px] font-bold tracking-wider uppercase text-slate-400 font-mono flex items-center gap-1.5">
            <i data-lucide="align-left" class="w-3.5 h-3.5 text-indigo-400"></i> Description & Context
          </div>
          <span class="text-[10px] text-slate-500 font-mono">Type directly to edit • ⌘Enter to save</span>
        </div>
        
        <div
          contenteditable="true"
          spellcheck="false"
          data-placeholder="+ Click here to type description directly..."
          class="markdown-body rich-editable-doc text-xs text-slate-200 leading-relaxed"
          onblur="handleDirectDocBlur(this, '${task.id}', 'description', false)"
          onkeydown="handleDirectDocKeydown(event, this, '${task.id}', 'description', false)"
        >${renderMarkdown(task.description || '')}</div>
      </div>

      <!-- Acceptance Criteria & Definition of Done (Direct In-Place Visual Markdown Editing) -->
      <div class="bg-surface border border-subtle rounded-lg p-3.5 space-y-2">
        <div class="flex items-center justify-between pb-1 border-b border-subtle">
          <div class="text-[10px] font-bold tracking-wider uppercase text-slate-400 font-mono flex items-center gap-1.5">
            <i data-lucide="check-circle" class="w-3.5 h-3.5 text-indigo-400"></i> Acceptance Criteria & Requirements
          </div>
          <span class="text-[10px] text-slate-500 font-mono">Type directly to edit • ⌘Enter to save</span>
        </div>

        <div
          contenteditable="true"
          spellcheck="false"
          data-placeholder="+ Click here to type acceptance criteria directly..."
          class="markdown-body rich-editable-doc text-xs text-slate-200 leading-relaxed"
          onblur="handleDirectDocBlur(this, '${task.id}', 'acceptanceCriteria', false)"
          onkeydown="handleDirectDocKeydown(event, this, '${task.id}', 'acceptanceCriteria', false)"
        >${renderMarkdown(task.acceptanceCriteria || '')}</div>
      </div>

      <!-- Subtasks Section -->
      ${!task.parentId ? `
        <div class="bg-surface border border-subtle rounded-lg p-3">
          <div class="flex items-center justify-between mb-2">
            <div class="text-[10px] font-bold tracking-wider uppercase text-slate-400 font-mono">SUBTASKS (${subtasks.length})</div>
            <button class="btn-secondary text-[11px] py-0.5 px-2 flex items-center gap-1" onclick="promptAddSubtask('${task.id}')">
              <i data-lucide="plus" class="w-3 h-3"></i> Add Subtask
            </button>
          </div>
          <div class="space-y-1.5">
            ${subtasks.length === 0 ? `<div class="text-xs text-slate-500 italic">No subtasks.</div>` : ''}
            ${subtasks.map((s) => `
              <div class="p-2 bg-card rounded border border-subtle flex items-center justify-between text-xs cursor-pointer hover:border-borderActive" onclick="openInspector('${s.id}')">
                <div class="flex items-center gap-2">
                  <span class="status-dot ${statusConfig[s.status]?.class || 'todo'}"></span>
                  <span class="font-mono text-slate-500 text-[10px]">${s.id}</span>
                  <span class="text-slate-200">${s.title}</span>
                </div>
                <span class="font-mono text-[10px] text-slate-400 uppercase">${s.status}</span>
              </div>
            `).join('')}
          </div>
        </div>
      ` : `
        <div class="bg-surface border border-subtle rounded-lg p-2.5 text-xs text-slate-400 flex items-center gap-1.5">
          <i data-lucide="corner-down-right" class="w-3.5 h-3.5 text-indigo-400"></i>
          <span>Subtask of parent issue: </span>
          <span class="font-mono text-indigo-300 font-medium cursor-pointer hover:underline" onclick="openInspector('${task.parentId}')">${task.parentId}</span>
        </div>
      `}

      <!-- Dependencies & Blockers -->
      <div class="bg-surface border border-subtle rounded-lg p-3 space-y-2.5">
        <div class="flex items-center justify-between">
          <div class="text-[10px] font-bold tracking-wider uppercase text-amber-400 font-mono flex items-center gap-1">
            <i data-lucide="alert-circle" class="w-3.5 h-3.5 text-amber-400"></i> BLOCKERS (Depends on)
          </div>
          <div class="flex items-center gap-1">
            <select id="selectAddBlocker" class="filter-select text-[11px]">
              <option value="">+ Add Blocker...</option>
              ${candidateBlockers.map((c) => `<option value="${c.id}">${c.id} - ${c.title.slice(0, 30)}</option>`).join('')}
            </select>
            <button class="btn-secondary text-[11px] py-0.5 px-2" onclick="handleAddBlocker('${task.id}')">Link</button>
          </div>
        </div>
        
        <div class="flex flex-wrap gap-1.5">
          ${dependencies.length === 0 ? `<div class="text-xs text-slate-500 italic">No direct blockers.</div>` : ''}
          ${dependencies.map((d) => `
            <span class="font-mono text-xs px-2 py-0.5 bg-amber-950/40 border border-amber-800/40 text-amber-300 rounded flex items-center gap-1.5">
              <span class="cursor-pointer hover:underline" onclick="openInspector('${d}')">⚠️ ${d}</span>
              <button class="text-amber-500 hover:text-rose-400 text-xs ml-1" onclick="handleRemoveBlocker('${task.id}', '${d}')">&times;</button>
            </span>
          `).join('')}
        </div>

        ${dependents.length > 0 ? `
          <div class="pt-2 border-t border-subtle">
            <div class="text-[10px] font-bold tracking-wider uppercase text-blue-400 mb-1 font-mono flex items-center gap-1">
              <i data-lucide="zap" class="w-3.5 h-3.5 text-blue-400"></i> BLOCKS DOWNSTREAM
            </div>
            <div class="flex flex-wrap gap-1.5">
              ${dependents.map((d) => `<span class="font-mono text-xs px-2 py-0.5 bg-blue-950/40 border border-blue-800/40 text-blue-300 rounded cursor-pointer hover:underline" onclick="openInspector('${d}')">⚡ ${d}</span>`).join('')}
            </div>
          </div>
        ` : ''}
      </div>

      ${task.evidence ? `
        <!-- Completion Proof -->
        <div class="bg-surface border border-indigo-500/30 rounded-lg p-3">
          <div class="text-[10px] font-bold tracking-wider uppercase text-indigo-400 mb-1.5 font-mono flex items-center gap-1">
            <i data-lucide="shield-check" class="w-3.5 h-3.5"></i> VERIFIED EVIDENCE PROOF
          </div>
          <pre class="text-[11px] font-mono text-slate-300 bg-slate-950 p-2 rounded border border-slate-800 overflow-x-auto">${JSON.stringify(task.evidence, null, 2)}</pre>
        </div>
      ` : ''}

      ${task.humanQuestion ? `
        <!-- Human Question -->
        <div class="bg-purple-950/20 border border-purple-800/40 rounded-lg p-3">
          <div class="text-[10px] font-bold tracking-wider uppercase text-purple-400 mb-1 font-mono flex items-center gap-1">
            <i data-lucide="help-circle" class="w-3.5 h-3.5"></i> HUMAN QUESTION (${task.humanQuestionType || 'clarification'})
          </div>
          <div class="markdown-body text-xs text-purple-200 mb-2">${renderMarkdown(task.humanQuestion)}</div>
          ${task.humanAnswer ? `
            <div class="text-xs text-emerald-300 bg-emerald-950/30 p-2 rounded border border-emerald-800/40 markdown-body">
              <span class="font-bold">Answer:</span> ${renderMarkdown(task.humanAnswer)}
            </div>
          ` : `
            <form onsubmit="handleDrawerAnswer(event, '${task.id}')" class="flex gap-2 mt-2">
              <input type="text" id="drawerAnswerInput" required placeholder="Type answer to resume agent..." class="input-field text-xs flex-1">
              <button type="submit" class="btn-primary text-xs flex items-center gap-1">
                <i data-lucide="send" class="w-3 h-3"></i> Resume Agent
              </button>
            </form>
          `}
        </div>
      ` : ''}

      <!-- Actions Bar -->
      <div class="flex items-center justify-between border-t border-subtle pt-3 mt-1">
        <div class="flex gap-2">
          <button class="btn-secondary text-xs flex items-center gap-1" onclick="promptMergeTask('${task.id}')">
            <i data-lucide="git-merge" class="w-3 h-3"></i> Merge into...
          </button>
          <button class="btn-danger text-xs flex items-center gap-1" onclick="promptDropTask('${task.id}')">
            <i data-lucide="x-circle" class="w-3 h-3"></i> Drop Issue
          </button>
          <button class="btn-secondary text-xs flex items-center gap-1" onclick="undoTask('${task.id}')">
            <i data-lucide="rotate-ccw" class="w-3 h-3"></i> Undo Status
          </button>
          ${task.status === 'done' || task.status === 'dropped' ? `
            <button class="btn-primary text-xs flex items-center gap-1" onclick="reopenTask('${task.id}')">
              <i data-lucide="rotate-ccw" class="w-3 h-3"></i> Reopen Issue
            </button>
          ` : ''}
        </div>
        ${task.status === 'done' && task.verificationState === 'agent_completed' ? `
          <div class="flex gap-2">
            <button class="btn-danger text-xs flex items-center gap-1" onclick="promptRejectTask('${task.id}')">
              <i data-lucide="ban" class="w-3 h-3"></i> Reject Proof
            </button>
            <button class="btn-success text-xs flex items-center gap-1" onclick="verifyTask('${task.id}')">
              <i data-lucide="check-check" class="w-3.5 h-3.5"></i> Verify Done
            </button>
          </div>
        ` : ''}
      </div>

      <!-- Activity & Notes -->
      <div class="border-t border-subtle pt-4 mt-2">
        <div class="text-[11px] font-bold uppercase tracking-wider text-slate-400 font-mono mb-3 flex items-center gap-1.5">
          <i data-lucide="activity" class="w-3.5 h-3.5 text-slate-400"></i> ACTIVITY & AUDIT NOTES (${notes.length})
        </div>
        
        <form onsubmit="handleAddNote(event, '${task.id}')" class="mb-3 flex gap-2">
          <input type="text" id="drawerNoteInput" required placeholder="Add a note or attempt log..." class="input-field text-xs flex-1">
          <button type="submit" class="btn-secondary text-xs">Post</button>
        </form>

        <div class="space-y-2 max-h-60 overflow-y-auto font-mono text-xs">
          ${notes.length === 0 ? `<div class="text-slate-600 text-xs font-sans">No activity notes yet.</div>` : ''}
          ${notes.map((n) => `
            <div class="p-2.5 bg-surface rounded border border-subtle">
              <div class="flex items-center justify-between mb-1">
                <span class="text-indigo-400 font-bold text-[11px] flex items-center gap-1"><i data-lucide="${n.authorType === 'agent' ? 'bot' : 'user'}" class="w-3 h-3"></i> ${n.authorId}</span>
                <span class="text-slate-500 text-[10px]">${new Date(n.createdAt).toLocaleTimeString()}</span>
              </div>
              <div class="text-slate-300 text-xs font-sans markdown-body">${renderMarkdown(n.content)}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    if (showDrawer && drawerInspector) {
      drawerInspector.classList.remove('hidden');
    }
    refreshLucideIcons();
  } catch (err) {
    console.error('Failed to load issue details:', err);
  }
}

// Auto-Growing Textarea Helper
window.autoGrowTextarea = (el) => {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.max(el.scrollHeight + 4, 90) + 'px';
};

window.startTaskDocEdit = (taskId, type) => {
  const isDesc = type === 'description';
  const preview = document.getElementById(isDesc ? `taskDescPreview-${taskId}` : `taskCriteriaPreview-${taskId}`);
  const editBox = document.getElementById(isDesc ? `taskDescEdit-${taskId}` : `taskCriteriaEdit-${taskId}`);
  const input = document.getElementById(isDesc ? `taskDescInput-${taskId}` : `taskCriteriaInput-${taskId}`);

  if (preview && editBox && input) {
    preview.classList.add('hidden');
    editBox.classList.remove('hidden');
    autoGrowTextarea(input);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
};

window.cancelTaskDocEdit = (taskId, type) => {
  const isDesc = type === 'description';
  const preview = document.getElementById(isDesc ? `taskDescPreview-${taskId}` : `taskCriteriaPreview-${taskId}`);
  const editBox = document.getElementById(isDesc ? `taskDescEdit-${taskId}` : `taskCriteriaEdit-${taskId}`);

  if (preview && editBox) {
    editBox.classList.add('hidden');
    preview.classList.remove('hidden');
  }
  refreshLucideIcons();
};

window.saveTaskDocEdit = async (taskId, type) => {
  const isDesc = type === 'description';
  const input = document.getElementById(isDesc ? `taskDescInput-${taskId}` : `taskCriteriaInput-${taskId}`);
  if (!input) return;
  const fieldName = isDesc ? 'description' : 'acceptanceCriteria';
  await handleSaveInlineField(taskId, fieldName, input.value);
};

window.handleDocKeydown = (event, taskId, type) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault();
    saveTaskDocEdit(taskId, type);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    cancelTaskDocEdit(taskId, type);
  }
};

window.startGoalSpecInlineEdit = (goalId) => {
  const preview = document.getElementById('goalSpecPreviewBox');
  const editBox = document.getElementById('goalSpecEditBox');
  const textarea = document.getElementById('goalSpecTextarea');

  if (preview && editBox && textarea) {
    preview.classList.add('hidden');
    editBox.classList.remove('hidden');
    autoGrowTextarea(textarea);
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }
};

window.cancelGoalSpecInlineEdit = (goalId) => {
  const preview = document.getElementById('goalSpecPreviewBox');
  const editBox = document.getElementById('goalSpecEditBox');

  if (preview && editBox) {
    editBox.classList.add('hidden');
    preview.classList.remove('hidden');
  }
  refreshLucideIcons();
};

window.handleGoalSpecKeydown = (event, goalId) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault();
    handleSaveGoalSpec(goalId);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    cancelGoalSpecInlineEdit(goalId);
  }
};

// Inline Field Save Handler
window.handleSaveInlineField = async (taskId, field, value) => {
  const payload = { [field]: value };
  const res = await fetch(`/api/tasks/${taskId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (res.ok) {
    showToast(`Updated ${field}`, 'success');
    refreshAll();
  } else {
    showToast(`Failed to update ${field}`, 'error');
  }
};

// Blocker Linking Handlers
window.handleAddBlocker = async (taskId) => {
  const select = document.getElementById('selectAddBlocker');
  if (!select || !select.value) return;
  const dependsOnTaskId = select.value;

  const res = await fetch(`/api/tasks/${taskId}/dependencies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dependsOnTaskId }),
  });

  if (res.ok) {
    showToast('Blocker dependency linked', 'success');
    openInspector(taskId, false);
    refreshAll();
  } else {
    showToast('Failed to link blocker', 'error');
  }
};

window.handleRemoveBlocker = async (taskId, dependsOnTaskId) => {
  const res = await fetch(`/api/tasks/${taskId}/dependencies/${dependsOnTaskId}`, {
    method: 'DELETE',
  });

  if (res.ok) {
    showToast('Blocker removed', 'info');
    openInspector(taskId, false);
    refreshAll();
  }
};

// Subtask Modal
window.promptAddSubtask = (parentId) => {
  const hiddenId = document.getElementById('inputSubtaskParentId');
  if (hiddenId) hiddenId.value = parentId;
  if (modalCreateSubtask) modalCreateSubtask.classList.remove('hidden');
  refreshLucideIcons();
};

const formCreateSubtask = document.getElementById('formCreateSubtask');
if (formCreateSubtask) {
  formCreateSubtask.onsubmit = async (e) => {
    e.preventDefault();
    const parentId = document.getElementById('inputSubtaskParentId').value;
    const title = document.getElementById('inputSubtaskTitle').value;
    const acceptanceCriteria = document.getElementById('inputSubtaskAC').value;

    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parentId, title, acceptanceCriteria }),
    });

    const data = await res.json();
    if (!res.ok || data.error) {
      showToast(data.error || 'Failed to create subtask', 'error');
      return;
    }

    showToast('Subtask created successfully', 'success');
    if (modalCreateSubtask) modalCreateSubtask.classList.add('hidden');
    formCreateSubtask.reset();
    refreshAll();
  };
}

// Merge Task Modal
window.promptMergeTask = (sourceId) => {
  const hiddenSource = document.getElementById('inputMergeSourceId');
  const labelSource = document.getElementById('labelMergeSourceId');
  const selectTarget = document.getElementById('selectMergeTargetId');

  if (hiddenSource) hiddenSource.value = sourceId;
  if (labelSource) labelSource.textContent = sourceId;

  if (selectTarget) {
    selectTarget.innerHTML = '';
    const otherTasks = state.tasks.filter((t) => t.id !== sourceId && t.status !== 'dropped');
    otherTasks.forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = `${t.id} - ${t.title.slice(0, 40)}`;
      selectTarget.appendChild(opt);
    });
  }

  if (modalMergeTask) modalMergeTask.classList.remove('hidden');
  refreshLucideIcons();
};

const formMergeTask = document.getElementById('formMergeTask');
if (formMergeTask) {
  formMergeTask.onsubmit = async (e) => {
    e.preventDefault();
    const sourceId = document.getElementById('inputMergeSourceId').value;
    const targetTaskId = document.getElementById('selectMergeTargetId').value;
    const reason = document.getElementById('inputMergeReason').value;

    const res = await fetch(`/api/tasks/${sourceId}/merge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetTaskId, reason }),
    });

    const data = await res.json();
    if (!res.ok || data.error) {
      showToast(data.error || 'Failed to merge issues', 'error');
      return;
    }

    showToast(`Merged issue ${sourceId} into ${targetTaskId}`, 'success');
    if (modalMergeTask) modalMergeTask.classList.add('hidden');
    if (drawerInspector) drawerInspector.classList.add('hidden');
    state.selectedTaskId = null;
    refreshAll();
  };
}

// Drawer Closers
function closeInspector(updateHash = true) {
  if (drawerInspector) drawerInspector.classList.add('hidden');
  state.selectedTaskId = null;
  if (updateHash) {
    window.location.hash = `#/${state.currentView}`;
  }
}

document.querySelectorAll('.drawer-close').forEach((btn) => {
  btn.onclick = () => closeInspector(true);
});

if (drawerInspector) {
  drawerInspector.onclick = (e) => {
    if (e.target === drawerInspector) {
      closeInspector(true);
    }
  };
}

// Goals View
function renderGoalsView() {
  const container = document.getElementById('goalsViewContainer');
  if (!container) return;
  container.innerHTML = '';

  if (state.goals.length === 0) {
    container.innerHTML = `<div class="col-span-2 text-center py-16 text-slate-600">No goals created yet. Click "+ Create Goal" to record human objectives.</div>`;
    return;
  }

  state.goals.forEach((item) => {
    const g = item.goal;
    const card = document.createElement('div');
    card.className = 'bg-surface border border-subtle rounded-lg p-4 flex flex-col justify-between';

    const pct = item.totalTasks > 0 ? Math.round((item.completedTasks / item.totalTasks) * 100) : 0;
    const isDropped = g.status === 'dropped';

    card.innerHTML = `
      <div>
        <div class="flex items-center justify-between mb-2">
          <span class="font-mono text-xs ${isDropped ? 'text-rose-400 bg-rose-950/30' : 'text-indigo-400 bg-indigo-950/30'} px-2 py-0.5 rounded border border-subtle uppercase font-semibold">${g.status}</span>
          <span class="font-mono text-slate-500 text-xs">${g.id}</span>
        </div>
        <h3 class="text-sm font-bold text-slate-100 mb-1.5">${g.title}</h3>
        <div class="bg-card p-3 rounded border border-subtle text-xs text-slate-300 mb-3 markdown-body">
          ${renderMarkdown(g.verbatimPrompt)}
        </div>

        <!-- Progress Bar -->
        <div class="mb-3">
          <div class="flex justify-between text-[11px] font-mono text-slate-400 mb-1">
            <span>Progress (${item.completedTasks}/${item.totalTasks} issues)</span>
            <span class="font-bold text-slate-200">${pct}%</span>
          </div>
          <div class="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden">
            <div class="h-full bg-indigo-500 rounded-full" style="width: ${pct}%"></div>
          </div>
        </div>

        <!-- Metric Boxes -->
        <div class="grid grid-cols-3 gap-2 text-center text-xs mb-3 font-mono">
          <div class="bg-card p-2 rounded border border-subtle">
            <div class="text-slate-500 text-[10px]">Open / Cap</div>
            <div class="font-bold ${item.hasReachedCap ? 'text-rose-400' : 'text-slate-200'}">${item.openTasks} / ${g.maxOpenTasksCap}</div>
          </div>
          <div class="bg-card p-2 rounded border border-subtle">
            <div class="text-slate-500 text-[10px]">Loose Ends</div>
            <div class="font-bold text-amber-400">${item.looseEnds.length}</div>
          </div>
          <div class="bg-card p-2 rounded border border-subtle">
            <div class="text-slate-500 text-[10px]">Completed</div>
            <div class="font-bold text-emerald-400">${item.completedTasks}</div>
          </div>
        </div>

        <!-- Loose Ends List -->
        ${item.looseEnds.length > 0 ? `
          <div class="mb-3">
            <div class="text-[10px] font-bold tracking-wider uppercase text-amber-400 mb-1 font-mono flex items-center gap-1">
              <i data-lucide="alert-circle" class="w-3.5 h-3.5"></i> LOOSE ENDS (${item.looseEnds.length})
            </div>
            <div class="space-y-1 max-h-24 overflow-y-auto">
              ${item.looseEnds.map((t) => `
                <div class="p-1.5 bg-card rounded border border-subtle text-[11px] flex items-center justify-between cursor-pointer hover:border-borderActive" onclick="openInspector('${t.id}')">
                  <span class="truncate max-w-[220px] text-slate-300">${t.title}</span>
                  <span class="font-mono text-[9px] text-amber-400 uppercase">[${t.status}]</span>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </div>

      <div class="flex items-center justify-between border-t border-subtle pt-3 mt-1">
        <div class="flex items-center gap-2">
          <button class="btn-primary text-xs flex items-center gap-1" onclick="viewGoalDetails('${g.id}')">
            <i data-lucide="file-text" class="w-3 h-3"></i> Details & Spec
          </button>
          <button class="btn-secondary text-xs flex items-center gap-1" onclick="filterByGoalDirect('${g.id}')">
            <i data-lucide="layers" class="w-3 h-3"></i> View Issues
          </button>
        </div>
        <div>
          ${g.status === 'active' 
            ? `<button class="btn-danger text-xs flex items-center gap-1" onclick="promptKillGoal('${g.id}')"><i data-lucide="x-circle" class="w-3 h-3"></i> Kill</button>`
            : `<button class="btn-success text-xs flex items-center gap-1" onclick="reopenGoal('${g.id}')"><i data-lucide="rotate-ccw" class="w-3 h-3"></i> Reopen</button>`
          }
        </div>
      </div>
    `;

    container.appendChild(card);
  });
  refreshLucideIcons();
}

window.viewGoalDetails = (goalId) => {
  window.location.hash = `#/goals/${goalId}`;
};

window.closeGoalDetails = () => {
  window.location.hash = '#/goals';
};

window.openCreateTaskForGoal = (goalId) => {
  if (modalCreateTask) {
    modalCreateTask.classList.remove('hidden');
    const select = document.getElementById('inputTaskGoal');
    if (select) select.value = goalId;
    const titleInput = document.getElementById('inputTaskTitle');
    if (titleInput) titleInput.focus();
    refreshLucideIcons();
  }
};

window.handleSaveGoalField = async (goalId, field, value) => {
  const payload = { [field]: value };
  const res = await fetch(`/api/goals/${goalId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (res.ok) {
    showToast(`Updated goal ${field}`, 'success');
    renderGoalDetails(goalId);
    fetchGoals();
  } else {
    showToast(`Failed to update goal ${field}`, 'error');
  }
};

window.handleSaveGoalSpec = async (goalId) => {
  const textarea = document.getElementById('goalSpecTextarea');
  if (!textarea) return;
  const description = textarea.value;

  const res = await fetch(`/api/goals/${goalId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description }),
  });

  if (res.ok) {
    showToast('Saved goal specification', 'success');
    renderGoalDetails(goalId);
    fetchGoals();
  } else {
    showToast('Failed to save specification', 'error');
  }
};

window.toggleGoalSpecTab = (mode) => {
  const previewBtn = document.getElementById('btnGoalSpecPreview');
  const editBtn = document.getElementById('btnGoalSpecEdit');
  const previewBox = document.getElementById('goalSpecPreviewBox');
  const editBox = document.getElementById('goalSpecEditBox');

  if (mode === 'preview') {
    previewBtn?.classList.add('active');
    editBtn?.classList.remove('active');
    previewBox?.classList.remove('hidden');
    editBox?.classList.add('hidden');
  } else {
    previewBtn?.classList.remove('active');
    editBtn?.classList.add('active');
    previewBox?.classList.add('hidden');
    editBox?.classList.remove('hidden');
  }
  refreshLucideIcons();
};

async function renderGoalDetails(goalId) {
  const container = document.getElementById('goalDetailsContent');
  if (!container) return;

  try {
    const res = await fetch(`/api/goals/${goalId}`);
    const data = await res.json();
    if (!res.ok || !data.goal) {
      container.innerHTML = `<div class="p-8 text-center text-slate-500">Goal not found. <button onclick="closeGoalDetails()" class="text-indigo-400 underline">Back to Goals</button></div>`;
      return;
    }

    const g = data.goal;
    const summary = data.summary;
    const tasks = data.tasks || [];
    const pct = summary.totalTasks > 0 ? Math.round((summary.completedTasks / summary.totalTasks) * 100) : 0;
    const isDropped = g.status === 'dropped';
    const isCompleted = g.status === 'completed';

    container.innerHTML = `
      <!-- Goal Details Header -->
      <div class="flex items-center justify-between border-b border-subtle pb-3 mb-4">
        <div class="flex items-center gap-3">
          <button onclick="closeGoalDetails()" class="btn-secondary text-xs flex items-center gap-1.5">
            <i data-lucide="arrow-left" class="w-3.5 h-3.5"></i> All Goals
          </button>
          <div class="flex items-center gap-2">
            <span class="font-mono text-xs text-slate-500">${g.id}</span>
            <span class="font-mono text-xs ${isDropped ? 'text-rose-400 bg-rose-950/30' : isCompleted ? 'text-emerald-400 bg-emerald-950/30' : 'text-indigo-400 bg-indigo-950/30'} px-2 py-0.5 rounded border border-subtle uppercase font-semibold">
              ${g.status}
            </span>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <button class="btn-secondary text-xs flex items-center gap-1.5" onclick="filterByGoalDirect('${g.id}')">
            <i data-lucide="kanban" class="w-3.5 h-3.5"></i> View in Board
          </button>
          <button class="btn-primary text-xs flex items-center gap-1.5" onclick="openCreateTaskForGoal('${g.id}')">
            <i data-lucide="plus" class="w-3.5 h-3.5"></i> Add Issue
          </button>
          ${g.status === 'active'
            ? `<button class="btn-danger text-xs flex items-center gap-1" onclick="promptKillGoal('${g.id}')"><i data-lucide="x-circle" class="w-3.5 h-3.5"></i> Kill Goal</button>`
            : `<button class="btn-success text-xs flex items-center gap-1" onclick="reopenGoal('${g.id}')"><i data-lucide="rotate-ccw" class="w-3.5 h-3.5"></i> Reopen Goal</button>`
          }
        </div>
      </div>

      <!-- Goal Title & Controls -->
      <div class="bg-surface border border-subtle rounded-lg p-4 space-y-3">
        <div class="space-y-1">
          <label class="text-[11px] font-mono uppercase font-bold text-slate-500">Goal Title</label>
          <input type="text" value="${g.title.replace(/"/g, '&quot;')}" class="input-field text-base font-bold text-slate-100 w-full" onchange="handleSaveGoalField('${g.id}', 'title', this.value)">
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
          <div>
            <label class="text-[11px] font-mono uppercase font-bold text-slate-500">Status</label>
            <select class="filter-select text-xs w-full mt-1" onchange="handleSaveGoalField('${g.id}', 'status', this.value)">
              <option value="active" ${g.status === 'active' ? 'selected' : ''}>Active</option>
              <option value="completed" ${g.status === 'completed' ? 'selected' : ''}>Completed</option>
              <option value="dropped" ${g.status === 'dropped' ? 'selected' : ''}>Dropped</option>
            </select>
          </div>

          <div>
            <label class="text-[11px] font-mono uppercase font-bold text-slate-500">Open Tasks Cap</label>
            <input type="number" min="1" max="50" value="${g.maxOpenTasksCap}" class="filter-select text-xs w-full mt-1" onchange="handleSaveGoalField('${g.id}', 'maxOpenTasksCap', Number(this.value))">
          </div>

          <div>
            <label class="text-[11px] font-mono uppercase font-bold text-slate-500">Created / Updated</label>
            <div class="text-xs font-mono text-slate-400 mt-2">
              ${formatRelativeTime(g.createdAt)} (${g.createdAt.slice(0, 10)})
            </div>
          </div>
        </div>

        <!-- Live Progress Banner -->
        <div class="pt-2">
          <div class="flex justify-between text-xs font-mono text-slate-400 mb-1.5">
            <span>Coverage (${summary.completedTasks} / ${summary.totalTasks} issues completed)</span>
            <span class="font-bold ${pct === 100 ? 'text-emerald-400' : 'text-indigo-400'}">${pct}% Covered</span>
          </div>
          <div class="w-full h-2 bg-slate-900 rounded-full overflow-hidden">
            <div class="h-full ${pct === 100 ? 'bg-emerald-500' : 'bg-indigo-500'} rounded-full transition-all duration-300" style="width: ${pct}%"></div>
          </div>
        </div>

        <div class="grid grid-cols-4 gap-2 text-center text-xs font-mono pt-1">
          <div class="bg-card p-2 rounded border border-subtle">
            <div class="text-slate-500 text-[10px]">Open Tasks</div>
            <div class="font-bold ${summary.hasReachedCap ? 'text-rose-400' : 'text-slate-200'}">${summary.openTasks} / ${g.maxOpenTasksCap}</div>
          </div>
          <div class="bg-card p-2 rounded border border-subtle">
            <div class="text-slate-500 text-[10px]">Loose Ends</div>
            <div class="font-bold text-amber-400">${summary.looseEnds.length}</div>
          </div>
          <div class="bg-card p-2 rounded border border-subtle">
            <div class="text-slate-500 text-[10px]">Completed</div>
            <div class="font-bold text-emerald-400">${summary.completedTasks}</div>
          </div>
          <div class="bg-card p-2 rounded border border-subtle">
            <div class="text-slate-500 text-[10px]">Total Issues</div>
            <div class="font-bold text-slate-200">${summary.totalTasks}</div>
          </div>
        </div>
      </div>

      <!-- Specification & PRD Section (Direct In-Place Visual Markdown Editing) -->
      <div class="bg-surface border border-subtle rounded-lg p-4 space-y-3">
        <div class="flex items-center justify-between border-b border-subtle pb-2">
          <div class="flex items-center gap-2">
            <i data-lucide="file-text" class="w-4 h-4 text-indigo-400"></i>
            <span class="text-xs font-bold uppercase tracking-wider text-slate-200">Specification & Definition of Done (PRD)</span>
          </div>
          <span class="text-[10px] text-slate-500 font-mono">Type directly into document • ⌘Enter to save</span>
        </div>

        <div
          contenteditable="true"
          spellcheck="false"
          data-placeholder="+ Click here to write full specification directly into the document..."
          class="markdown-body rich-editable-doc bg-card/70 p-5 rounded-lg border border-subtle/80 min-h-[140px] text-xs text-slate-200 leading-relaxed"
          onblur="handleDirectDocBlur(this, '${g.id}', 'description', true)"
          onkeydown="handleDirectDocKeydown(event, this, '${g.id}', 'description', true)"
        >${renderMarkdown(g.description || '')}</div>
      </div>

      <!-- Verbatim Human Request Card -->
      <div class="bg-surface border border-subtle rounded-lg p-4 space-y-2">
        <div class="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 font-mono">
          <i data-lucide="message-square" class="w-3.5 h-3.5 text-indigo-400"></i> Original Verbatim Human Request
        </div>
        <div class="bg-card p-3.5 rounded-lg border border-subtle text-xs text-slate-200 markdown-body">
          ${renderMarkdown(g.verbatimPrompt)}
        </div>
      </div>

      <!-- Child Tasks & Tracking Breakdown -->
      <div class="bg-surface border border-subtle rounded-lg p-4 space-y-3">
        <div class="flex items-center justify-between border-b border-subtle pb-2">
          <div class="flex items-center gap-2">
            <i data-lucide="check-square" class="w-4 h-4 text-indigo-400"></i>
            <span class="text-xs font-bold uppercase tracking-wider text-slate-200">Linked Issues & Execution Breakdown (${tasks.length})</span>
          </div>
          <button class="btn-primary text-xs flex items-center gap-1" onclick="openCreateTaskForGoal('${g.id}')">
            <i data-lucide="plus" class="w-3 h-3"></i> Add Issue
          </button>
        </div>

        ${tasks.length === 0 ? `
          <div class="text-center py-8 text-slate-500 text-xs">
            No issues created under this goal yet. Click "+ Add Issue" or have coding agents call <code>moo_create_task</code>.
          </div>
        ` : `
          <div class="space-y-1.5 max-h-96 overflow-y-auto">
            ${tasks.map((t) => {
              const cfg = statusConfig[t.status] || { label: t.status, class: 'todo' };
              return `
                <div class="p-2.5 bg-card hover:bg-cardHover rounded-md border border-subtle flex items-center justify-between cursor-pointer transition" onclick="openInspector('${t.id}')">
                  <div class="flex items-center gap-2.5 min-w-0">
                    <span class="status-dot ${cfg.class}"></span>
                    <span class="font-mono text-[11px] text-slate-500 shrink-0">${t.id}</span>
                    <span class="text-xs text-slate-200 font-medium truncate">${t.title}</span>
                  </div>
                  <div class="flex items-center gap-2 shrink-0">
                    ${t.claimedByAgent ? `<span class="text-indigo-400 font-mono text-[10px] flex items-center gap-1"><i data-lucide="bot" class="w-3 h-3"></i> ${t.claimedByAgent}</span>` : ''}
                    ${getPriorityIcon(t.priority)}
                    <span class="font-mono text-[10px] text-slate-400 bg-surface px-1.5 py-0.5 rounded border border-subtle">${cfg.label}</span>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `}
      </div>
    `;

    refreshLucideIcons();
  } catch (err) {
    container.innerHTML = `<div class="p-8 text-center text-rose-400 text-xs">Error loading goal details: ${err.message}</div>`;
  }
}

window.filterByGoalDirect = (goalId) => {
  state.filterGoal = goalId;
  if (filterGoal) filterGoal.value = goalId;
  switchView('tasks');
  renderTasks();
};

// Quick Answer Helper
window.setQuickAnswer = (taskId, text) => {
  const input = document.getElementById(`inbox-answer-${taskId}`);
  if (input) {
    input.value = text;
    const form = input.closest('form');
    if (form) form.requestSubmit();
  }
};

// Human Attention View
function renderHumanInbox() {
  const container = document.getElementById('humanInboxList');
  if (!container) return;
  const waitingTasks = state.tasks.filter((t) => t.status === 'waiting-on-human' && !t.isArchived);

  container.innerHTML = '';

  if (waitingTasks.length === 0) {
    container.innerHTML = `<div class="text-center py-16 text-slate-600 text-sm">🎉 No agents are currently blocked on human input.</div>`;
    return;
  }

  waitingTasks.forEach((task) => {
    const card = document.createElement('div');
    card.className = 'bg-surface border border-purple-800/40 rounded-lg p-4 shadow-lg';

    card.innerHTML = `
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs font-mono text-purple-400 font-semibold uppercase flex items-center gap-1">
          <i data-lucide="bot" class="w-3.5 h-3.5"></i> Question from Agent: ${task.claimedByAgent || 'Unknown'}
        </span>
        <span class="text-xs font-mono text-slate-500">${task.id}</span>
      </div>
      <h3 class="text-sm font-bold text-slate-100 mb-2">${task.title}</h3>
      <div class="bg-purple-950/25 border border-purple-900/40 p-3 rounded text-xs text-purple-200 mb-3 markdown-body">
        <div class="font-semibold mb-1 flex items-center gap-1"><i data-lucide="help-circle" class="w-3.5 h-3.5"></i> ${task.humanQuestionType || 'Question'}:</div>
        <div>${renderMarkdown(task.humanQuestion)}</div>
      </div>
      
      <!-- Quick Action Buttons -->
      <div class="flex flex-wrap items-center gap-1.5 mb-2.5">
        <span class="text-[10px] uppercase font-bold text-slate-500 mr-1">Quick Action:</span>
        <button type="button" onclick="setQuickAnswer('${task.id}', 'Approved. Please proceed with implementation.')" class="px-2 py-0.5 rounded bg-emerald-950/50 border border-emerald-800/70 text-emerald-300 text-[11px] hover:bg-emerald-900/70 transition flex items-center gap-1">
          <i data-lucide="check" class="w-3 h-3"></i> Approve
        </button>
        <button type="button" onclick="setQuickAnswer('${task.id}', 'Rejected. Please rethink or try an alternative approach.')" class="px-2 py-0.5 rounded bg-rose-950/50 border border-rose-800/70 text-rose-300 text-[11px] hover:bg-rose-900/70 transition flex items-center gap-1">
          <i data-lucide="x" class="w-3 h-3"></i> Reject
        </button>
        <button type="button" onclick="setQuickAnswer('${task.id}', 'Skip this requirement for now and proceed with next steps.')" class="px-2 py-0.5 rounded bg-slate-800/60 border border-slate-700 text-slate-300 text-[11px] hover:bg-slate-700 transition flex items-center gap-1">
          <i data-lucide="skip-forward" class="w-3 h-3"></i> Skip
        </button>
      </div>

      <form onsubmit="handleAnswerQuestion(event, '${task.id}')" class="flex gap-2">
        <input type="text" id="inbox-answer-${task.id}" required placeholder="Type answer or decision to resume agent..." class="input-field text-xs flex-1">
        <button type="submit" class="btn-primary text-xs flex items-center gap-1">
          <i data-lucide="send" class="w-3 h-3"></i> Resume Agent
        </button>
      </form>
    `;

    container.appendChild(card);
  });
  refreshLucideIcons();
}

// Review & Proofs View
function renderReviewFeed() {
  const container = document.getElementById('reviewFeedList');
  if (!container) return;
  const reviewTasks = state.tasks.filter(
    (t) => (t.status === 'done' && t.verificationState === 'agent_completed') || t.status === 'dropped'
  );

  container.innerHTML = '';

  if (reviewTasks.length === 0) {
    container.innerHTML = `<div class="text-center py-16 text-slate-600 text-sm">No tasks currently awaiting review or verification.</div>`;
    return;
  }

  reviewTasks.forEach((task) => {
    const isCompleted = task.status === 'done';
    const card = document.createElement('div');
    card.className = `bg-surface border ${isCompleted ? 'border-indigo-500/30' : 'border-rose-500/30'} rounded-lg p-4`;

    card.innerHTML = `
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs font-mono font-semibold ${isCompleted ? 'text-indigo-400' : 'text-rose-400'} uppercase flex items-center gap-1">
          <i data-lucide="${isCompleted ? 'shield-check' : 'x-circle'}" class="w-3.5 h-3.5"></i>
          ${isCompleted ? 'Agent Claimed Done (Awaiting Verification)' : 'Dropped Task'}
        </span>
        <span class="text-xs font-mono text-slate-500">${task.id}</span>
      </div>
      <h3 class="text-sm font-bold text-slate-100 mb-1.5">${task.title}</h3>
      
      ${task.evidence ? `
        <div class="bg-card p-3 rounded border border-subtle text-xs font-mono text-slate-300 mb-3">
          <div class="text-slate-500 text-[10px] mb-1 font-bold uppercase flex items-center gap-1"><i data-lucide="file-check" class="w-3 h-3"></i> SUBMITTED EVIDENCE</div>
          <div>Commands: ${task.evidence.commandsRun?.join(', ') || 'N/A'}</div>
          <div>Proof: ${task.evidence.testProof || task.evidence.outputSnippet || 'Provided'}</div>
        </div>
      ` : ''}

      ${task.droppedReason ? `<div class="text-xs text-rose-300 italic mb-3">Reason: "${task.droppedReason}"</div>` : ''}

      <div class="flex items-center justify-end gap-2 border-t border-subtle pt-3">
        ${isCompleted ? `
          <button class="btn-danger text-xs flex items-center gap-1" onclick="promptRejectTask('${task.id}')">
            <i data-lucide="ban" class="w-3 h-3"></i> Reject with Reason
          </button>
          <button class="btn-success text-xs flex items-center gap-1" onclick="verifyTask('${task.id}')">
            <i data-lucide="check-check" class="w-3.5 h-3.5"></i> Verify Done
          </button>
        ` : `
          <button class="btn-secondary text-xs flex items-center gap-1" onclick="reopenTask('${task.id}')">
            <i data-lucide="rotate-ccw" class="w-3 h-3"></i> Reopen Issue
          </button>
        `}
      </div>
    `;

    container.appendChild(card);
  });
  refreshLucideIcons();
}

// Decisions View
function renderDecisionsView() {
  const container = document.getElementById('decisionsList');
  if (!container) return;
  container.innerHTML = '';

  if (state.decisions.length === 0) {
    container.innerHTML = `<div class="col-span-2 text-center py-16 text-slate-600">No architectural decisions recorded yet.</div>`;
    return;
  }

  state.decisions.forEach((dec) => {
    const card = document.createElement('div');
    card.className = 'bg-surface border border-subtle rounded-lg p-4';

    const tagsHtml = dec.tags.map((t) => `<span class="text-[10px] px-2 py-0.5 rounded bg-card text-slate-400 font-mono border border-subtle">${t}</span>`).join(' ');

    card.innerHTML = `
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs px-2 py-0.5 rounded border border-indigo-500/20 text-indigo-400 bg-indigo-950/20 font-mono uppercase">${dec.status}</span>
        <span class="text-xs font-mono text-slate-500">${dec.id}</span>
      </div>
      <h3 class="text-sm font-bold text-slate-100 mb-2">${dec.title}</h3>
      <div class="space-y-2 text-xs mb-3">
        <div><span class="text-slate-500 font-semibold">Context:</span> <div class="text-slate-300 markdown-body">${renderMarkdown(dec.context)}</div></div>
        <div><span class="text-slate-500 font-semibold">Choice:</span> <div class="text-slate-200 font-medium">${dec.choice}</div></div>
        <div><span class="text-slate-500 font-semibold">Rationale:</span> <div class="text-slate-300 markdown-body">${renderMarkdown(dec.rationale)}</div></div>
      </div>
      <div class="flex items-center justify-between border-t border-subtle pt-2">
        <div class="flex items-center gap-1.5">${tagsHtml}</div>
        ${dec.status === 'accepted' ? `<button class="btn-secondary text-[11px] py-0.5 px-2 flex items-center gap-1" onclick="promptSupersedeDecision('${dec.id}', '${dec.title.replace(/'/g, "\\'")}')"><i data-lucide="refresh-cw" class="w-3 h-3"></i> Supersede</button>` : ''}
      </div>
    `;

    container.appendChild(card);
  });
  refreshLucideIcons();
}

// Supersede Decision Modal
window.promptSupersedeDecision = (oldId, oldTitle) => {
  const hiddenOldId = document.getElementById('inputSupersedeOldId');
  const labelOldTitle = document.getElementById('labelSupersedeOldTitle');
  if (hiddenOldId) hiddenOldId.value = oldId;
  if (labelOldTitle) labelOldTitle.textContent = oldTitle;
  if (modalSupersedeDecision) modalSupersedeDecision.classList.remove('hidden');
  refreshLucideIcons();
};

const formSupersedeDecision = document.getElementById('formSupersedeDecision');
if (formSupersedeDecision) {
  formSupersedeDecision.onsubmit = async (e) => {
    e.preventDefault();
    const oldId = document.getElementById('inputSupersedeOldId').value;
    const title = document.getElementById('inputSuperNewTitle').value;
    const context = document.getElementById('inputSuperNewContext').value;
    const choice = document.getElementById('inputSuperNewChoice').value;
    const rationale = document.getElementById('inputSuperNewRationale').value;
    const reason = document.getElementById('inputSuperReason').value;

    const res = await fetch(`/api/decisions/${oldId}/supersede`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, context, choice, rationale, reason }),
    });

    const data = await res.json();
    if (!res.ok || data.error) {
      showToast(data.error || 'Failed to supersede decision', 'error');
      return;
    }

    showToast('Decision superseded with new ADR', 'success');
    if (modalSupersedeDecision) modalSupersedeDecision.classList.add('hidden');
    formSupersedeDecision.reset();
    fetchDecisions();
  };
}

// Activity Feed
function renderActivityFeed() {
  const container = document.getElementById('activityStream');
  if (!container) return;
  container.innerHTML = '';

  if (state.activity.length === 0) {
    container.innerHTML = `<div class="text-center py-16 text-slate-600">No recent activity.</div>`;
    return;
  }

  state.activity.forEach((note) => {
    const row = document.createElement('div');
    row.className = 'p-3 rounded bg-surface border border-subtle flex items-start gap-3';
    row.innerHTML = `
      <span class="text-slate-500 text-[10px] whitespace-nowrap">${new Date(note.createdAt).toLocaleTimeString()}</span>
      <div class="flex-1">
        <div class="flex items-center gap-2 mb-1">
          <span class="text-indigo-400 font-bold flex items-center gap-1"><i data-lucide="${note.authorType === 'agent' ? 'bot' : 'user'}" class="w-3 h-3"></i> ${note.authorId} (${note.authorType})</span>
          <span class="text-slate-500 font-mono text-[10px]">task:${note.taskId}</span>
        </div>
        <div class="text-slate-300 text-xs markdown-body">${renderMarkdown(note.content)}</div>
      </div>
    `;
    container.appendChild(row);
  });
  refreshLucideIcons();
}

// Session Resume
async function renderResumeView() {
  const container = document.getElementById('sessionResumeDashboard');
  if (!container) return;
  try {
    const res = await fetch('/api/resume');
    const data = await res.json();
    const sum = data.summary;

    container.innerHTML = `
      <div class="grid grid-cols-3 gap-3 mb-4 font-mono text-xs">
        <div class="bg-surface border border-subtle p-3 rounded-lg">
          <div class="text-slate-500 text-[10px]">In-Flight Doing</div>
          <div class="text-xl font-bold text-blue-400">${sum.abandonedDoingTasks.length}</div>
        </div>
        <div class="bg-surface border border-subtle p-3 rounded-lg">
          <div class="text-slate-500 text-[10px]">Waiting on Human</div>
          <div class="text-xl font-bold text-purple-400">${sum.waitingOnHumanTasks.length}</div>
        </div>
        <div class="bg-surface border border-subtle p-3 rounded-lg">
          <div class="text-slate-500 text-[10px]">Ready Unblocked</div>
          <div class="text-xl font-bold text-emerald-400">${sum.unblockedReadyTasks.length}</div>
        </div>
      </div>

      <div class="bg-surface border border-subtle p-4 rounded-lg">
        <h3 class="text-sm font-bold text-slate-200 mb-2">Next Recommended Step</h3>
        ${sum.unblockedReadyTasks.length > 0 ? `
          <div class="p-3 bg-card rounded border border-emerald-500/30 flex items-center justify-between">
            <div>
              <span class="text-xs font-mono text-emerald-400 font-semibold">[READY] ${sum.unblockedReadyTasks[0].id}</span>
              <div class="text-sm font-bold text-slate-100">${sum.unblockedReadyTasks[0].title}</div>
            </div>
            <button class="btn-primary text-xs flex items-center gap-1" onclick="openInspector('${sum.unblockedReadyTasks[0].id}')">
              <i data-lucide="eye" class="w-3.5 h-3.5"></i> Inspect Issue
            </button>
          </div>
        ` : `<div class="text-xs text-slate-500">No ready unblocked tasks found. Check goals or add tasks.</div>`}
      </div>
    `;
    refreshLucideIcons();
  } catch (err) {
    console.error('Failed to load session resume:', err);
  }
}

// Command Palette (Cmd+K)
const btnOpenPalette = document.getElementById('btnOpenPalette');
if (btnOpenPalette) btnOpenPalette.onclick = () => openCommandPalette();

function openCommandPalette() {
  if (!commandPalette) return;
  commandPalette.classList.remove('hidden');
  if (paletteInput) {
    paletteInput.value = '';
    renderPaletteResults('');
    paletteInput.focus();
  }
  refreshLucideIcons();
}

function closeCommandPalette() {
  if (commandPalette) commandPalette.classList.add('hidden');
}

if (commandPalette) {
  commandPalette.onclick = (e) => {
    if (e.target === commandPalette) closeCommandPalette();
  };
}

if (paletteInput) {
  paletteInput.oninput = (e) => {
    renderPaletteResults(e.target.value);
  };
}

function renderPaletteResults(query) {
  if (!paletteResults) return;
  paletteResults.innerHTML = '';
  state.paletteSelectedIndex = 0;
  const q = query.trim().toLowerCase();

  const actions = [
    { title: 'Create New Issue', icon: 'plus-circle', action: () => { closeCommandPalette(); if (modalCreateTask) modalCreateTask.classList.remove('hidden'); } },
    { title: 'Create New Goal', icon: 'target', action: () => { closeCommandPalette(); if (modalCreateGoal) modalCreateGoal.classList.remove('hidden'); } },
    { title: 'Record Architectural Decision', icon: 'landmark', action: () => { closeCommandPalette(); if (modalCreateDecision) modalCreateDecision.classList.remove('hidden'); } },
    { title: 'Switch to All Issues', icon: 'check-square', action: () => { closeCommandPalette(); switchView('tasks'); } },
    { title: 'Switch to Human Inbox', icon: 'help-circle', action: () => { closeCommandPalette(); switchView('human'); } },
    { title: 'Export Markdown Project Summary', icon: 'download', action: () => { closeCommandPalette(); exportProject(); } },
  ];

  const matchedActions = actions.filter((a) => a.title.toLowerCase().includes(q));
  matchedActions.forEach((a) => {
    const item = document.createElement('div');
    item.className = 'palette-item';
    item.innerHTML = `<div class="flex items-center gap-2"><i data-lucide="${a.icon}" class="w-3.5 h-3.5 text-indigo-400"></i><span>${a.title}</span></div><kbd class="kbd-key text-[9px]">Action</kbd>`;
    item.onclick = a.action;
    paletteResults.appendChild(item);
  });

  // Search Tasks
  const matchedTasks = state.tasks.filter((t) => t.title.toLowerCase().includes(q) || t.id.toLowerCase().includes(q)).slice(0, 6);
  matchedTasks.forEach((t) => {
    const item = document.createElement('div');
    item.className = 'palette-item';
    item.innerHTML = `<div class="flex items-center gap-2"><span class="font-mono text-slate-500 text-[10px]">${t.id}</span><span>${t.title}</span></div><span class="status-pill text-[10px]">${t.status}</span>`;
    item.onclick = () => {
      closeCommandPalette();
      openInspector(t.id);
    };
    paletteResults.appendChild(item);
  });

  updatePaletteHighlight();
  refreshLucideIcons();
}

function updatePaletteHighlight() {
  const items = paletteResults.querySelectorAll('.palette-item');
  items.forEach((item, index) => {
    item.classList.toggle('active-item', index === state.paletteSelectedIndex);
  });
}

// Global Keyboard Shortcuts
window.addEventListener('keydown', (e) => {
  const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);

  if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault();
    openCommandPalette();
    return;
  }

  if (commandPalette && !commandPalette.classList.contains('hidden')) {
    const items = paletteResults.querySelectorAll('.palette-item');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      state.paletteSelectedIndex = (state.paletteSelectedIndex + 1) % Math.max(1, items.length);
      updatePaletteHighlight();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      state.paletteSelectedIndex = (state.paletteSelectedIndex - 1 + items.length) % Math.max(1, items.length);
      updatePaletteHighlight();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (items[state.paletteSelectedIndex]) {
        items[state.paletteSelectedIndex].click();
      }
      return;
    }
  }

  if (e.key === 'Escape') {
    closeCommandPalette();
    if (drawerInspector) drawerInspector.classList.add('hidden');
    document.querySelectorAll('.modal-backdrop').forEach((m) => m.classList.add('hidden'));
    return;
  }

  if (!isInput) {
    if (e.key === 'c' || e.key === 'C') {
      e.preventDefault();
      if (modalCreateTask) modalCreateTask.classList.remove('hidden');
      refreshLucideIcons();
    }
    if (e.key === '1') switchView('tasks');
    if (e.key === '2') switchView('goals');
    if (e.key === '3') switchView('human');
    if (e.key === '4') switchView('review');
    if (e.key === '5') switchView('decisions');
    if (e.key === '6') switchView('activity');
  }
});

// Modal Triggers
const btnHeaderNewTask = document.getElementById('btnHeaderNewTask');
if (btnHeaderNewTask) btnHeaderNewTask.onclick = () => { modalCreateTask?.classList.remove('hidden'); refreshLucideIcons(); };

const btnCreateGoal = document.getElementById('btnCreateGoal');
if (btnCreateGoal) btnCreateGoal.onclick = () => { modalCreateGoal?.classList.remove('hidden'); refreshLucideIcons(); };

const btnCreateDecision = document.getElementById('btnCreateDecision');
if (btnCreateDecision) btnCreateDecision.onclick = () => { modalCreateDecision?.classList.remove('hidden'); refreshLucideIcons(); };

document.querySelectorAll('.modal-close').forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll('.modal-backdrop').forEach((m) => m.classList.add('hidden'));
  };
});

// Form Submissions
const formCreateTask = document.getElementById('formCreateTask');
if (formCreateTask) {
  formCreateTask.onsubmit = async (e) => {
    e.preventDefault();
    const title = document.getElementById('inputTaskTitle').value;
    const goalId = document.getElementById('inputTaskGoal').value || undefined;
    const priority = document.getElementById('inputTaskPriority').value;
    const acceptanceCriteria = document.getElementById('inputTaskAC').value;
    const filesInput = document.getElementById('inputTaskFiles').value;
    const isDeferred = document.getElementById('inputTaskDeferred').checked;

    const declaredFiles = filesInput ? filesInput.split(',').map((f) => f.trim()).filter(Boolean) : [];

    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, goalId, priority, acceptanceCriteria, declaredFiles, isDeferred }),
    });

    const data = await res.json();
    if (!res.ok || data.error) {
      showToast(data.error || 'Failed to create issue', 'error');
      return;
    }

    showToast('Issue created successfully', 'success');
    modalCreateTask.classList.add('hidden');
    formCreateTask.reset();
    refreshAll();
  };
}

const formCreateGoal = document.getElementById('formCreateGoal');
if (formCreateGoal) {
  formCreateGoal.onsubmit = async (e) => {
    e.preventDefault();
    const title = document.getElementById('inputGoalTitle').value;
    const verbatimPrompt = document.getElementById('inputGoalVerbatim').value;
    const maxOpenTasksCap = parseInt(document.getElementById('inputGoalCap').value) || 10;

    await fetch('/api/goals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, verbatimPrompt, maxOpenTasksCap }),
    });

    showToast('Goal created successfully', 'success');
    modalCreateGoal.classList.add('hidden');
    formCreateGoal.reset();
    refreshAll();
  };
}

const formCreateDecision = document.getElementById('formCreateDecision');
if (formCreateDecision) {
  formCreateDecision.onsubmit = async (e) => {
    e.preventDefault();
    const title = document.getElementById('inputDecTitle').value;
    const context = document.getElementById('inputDecContext').value;
    const choice = document.getElementById('inputDecChoice').value;
    const rationale = document.getElementById('inputDecRationale').value;
    const tagsInput = document.getElementById('inputDecTags').value;
    const tags = tagsInput ? tagsInput.split(',').map((t) => t.trim()).filter(Boolean) : [];

    await fetch('/api/decisions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, context, choice, rationale, tags }),
    });

    showToast('Architectural decision recorded', 'success');
    modalCreateDecision.classList.add('hidden');
    formCreateDecision.reset();
    fetchDecisions();
  };
}

// Status Change Handler with Validation
window.handleStatusChangePrompt = async (taskId, newStatus) => {
  if (newStatus === 'dropped') {
    promptDropTask(taskId);
    return;
  }

  // Optimistic UI update for instantaneous visual feedback
  const targetTask = state.tasks.find((t) => t.id === taskId);
  const oldStatus = targetTask ? targetTask.status : null;
  if (targetTask) {
    targetTask.status = newStatus;
    renderTasks();
    updateSidebarCounters();
  }

  const res = await fetch(`/api/tasks/${taskId}/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: newStatus, authorId: 'human' }),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    if (targetTask && oldStatus) {
      targetTask.status = oldStatus;
      renderTasks();
      updateSidebarCounters();
    }
    showToast(data.error || 'Failed to change status', 'error');
    openInspector(taskId, false);
    return;
  }

  showToast(`Status updated to ${newStatus}`, 'success');
  refreshAll();
};

window.handleAnswerQuestion = async (e, taskId) => {
  e.preventDefault();
  const input = document.getElementById(`inbox-answer-${taskId}`);
  if (!input || !input.value) return;

  await fetch(`/api/tasks/${taskId}/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answer: input.value, humanId: 'human-operator' }),
  });
  showToast('Answer submitted, agent unblocked', 'success');
  refreshAll();
};

window.handleDrawerAnswer = async (e, taskId) => {
  e.preventDefault();
  const input = document.getElementById('drawerAnswerInput');
  if (!input || !input.value) return;

  await fetch(`/api/tasks/${taskId}/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answer: input.value, humanId: 'human-operator' }),
  });
  showToast('Answer submitted, agent unblocked', 'success');
  refreshAll();
};

window.handleAddNote = async (e, taskId) => {
  e.preventDefault();
  const input = document.getElementById('drawerNoteInput');
  if (!input || !input.value) return;

  await fetch(`/api/tasks/${taskId}/notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: input.value, noteType: 'general' }),
  });
  input.value = '';
  showToast('Note appended', 'info');
  openInspector(taskId, false);
};

window.verifyTask = async (taskId) => {
  await fetch(`/api/tasks/${taskId}/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes: 'Verified in UI' }),
  });
  showToast('Task verified done', 'success');
  refreshAll();
};

window.promptRejectTask = (taskId) => {
  showReasonModal('Reject Task Completion', async (reason) => {
    await fetch(`/api/tasks/${taskId}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    showToast('Task rejected with feedback', 'info');
    refreshAll();
  });
};

window.promptDropTask = (taskId) => {
  showReasonModal('Drop Issue (Mandatory Reason)', async (reason) => {
    await fetch(`/api/tasks/${taskId}/drop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    showToast('Issue dropped', 'info');
    refreshAll();
  });
};

window.reopenTask = async (taskId) => {
  await fetch(`/api/tasks/${taskId}/reopen`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'Reopened from UI' }),
  });
  showToast('Issue reopened', 'success');
  refreshAll();
};

window.undoTask = async (taskId) => {
  const res = await fetch(`/api/tasks/${taskId}/undo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    showToast(data.error || 'No state to undo', 'error');
    return;
  }
  showToast('Status undone to previous state', 'info');
  refreshAll();
};

window.promptKillGoal = (goalId) => {
  showReasonModal('Kill Goal and Cascade Drop Issues', async (reason) => {
    await fetch(`/api/goals/${goalId}/kill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    showToast('Goal killed and child tasks dropped', 'info');
    refreshAll();
  });
};

window.reopenGoal = async (goalId) => {
  await fetch(`/api/goals/${goalId}/reopen`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  showToast('Goal and tasks reopened', 'success');
  refreshAll();
};

function showReasonModal(title, callback) {
  const titleEl = document.getElementById('modalReasonTitle');
  if (titleEl) titleEl.textContent = title;
  const promptModal = document.getElementById('modalReasonPrompt');
  const form = document.getElementById('formReasonPrompt');
  const input = document.getElementById('inputReasonText');
  if (input) input.value = '';
  if (promptModal) promptModal.classList.remove('hidden');

  if (form) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const reason = input.value;
      promptModal.classList.add('hidden');
      await callback(reason);
    };
  }
}

// Export
async function exportProject() {
  const res = await fetch('/api/export?format=markdown');
  const data = await res.json();
  const blob = new Blob([data.content], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `moo-tasks-export-${new Date().toISOString().slice(0, 10)}.md`;
  a.click();
  showToast('Exported markdown project summary', 'success');
}

const btnHeaderExport = document.getElementById('btnHeaderExport');
if (btnHeaderExport) btnHeaderExport.onclick = exportProject;

// Sound Alert Toggle
const btnToggleSound = document.getElementById('btnToggleSound');
const iconSoundState = document.getElementById('iconSoundState');

function updateSoundButtonUI() {
  if (iconSoundState) {
    iconSoundState.setAttribute('data-lucide', soundEnabled ? 'bell' : 'bell-off');
    iconSoundState.className = `w-3.5 h-3.5 ${soundEnabled ? 'text-indigo-400' : 'text-slate-500'}`;
    refreshLucideIcons();
  }
}

if (btnToggleSound) {
  updateSoundButtonUI();
  btnToggleSound.onclick = () => {
    soundEnabled = !soundEnabled;
    localStorage.setItem('moo_sound_enabled', String(soundEnabled));
    updateSoundButtonUI();
    if (soundEnabled) {
      playNotificationChime();
      showToast('Sound alerts enabled', 'success');
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
      }
    } else {
      showToast('Sound alerts muted', 'info');
    }
  };
}

// Route & Hash Management
function handleRouteFromHash() {
  const hash = window.location.hash.replace(/^#\/?/, '').trim();
  if (!hash) {
    if (state.currentView !== 'tasks') {
      switchView('tasks', false);
    }
    return;
  }

  const parts = hash.split('/');
  const primaryView = parts[0] || 'tasks';
  const targetId = parts[1] || null;

  const validViews = ['tasks', 'goals', 'human', 'review', 'decisions', 'activity', 'resume'];
  const viewToOpen = validViews.includes(primaryView) ? primaryView : 'tasks';

  if (state.currentView !== viewToOpen) {
    switchView(viewToOpen, false);
  }

  if (primaryView === 'tasks') {
    const goalsOverview = document.getElementById('goalsOverviewView');
    const goalDetails = document.getElementById('goalDetailsView');
    if (goalsOverview) goalsOverview.classList.remove('hidden');
    if (goalDetails) goalDetails.classList.add('hidden');

    if (targetId) {
      openInspector(targetId, true, false);
    } else if (state.selectedTaskId) {
      if (drawerInspector) drawerInspector.classList.add('hidden');
      state.selectedTaskId = null;
    }
  } else if (primaryView === 'goals') {
    if (drawerInspector) drawerInspector.classList.add('hidden');
    state.selectedTaskId = null;

    const goalsOverview = document.getElementById('goalsOverviewView');
    const goalDetails = document.getElementById('goalDetailsView');

    if (targetId) {
      if (goalsOverview) goalsOverview.classList.add('hidden');
      if (goalDetails) goalDetails.classList.remove('hidden');
      renderGoalDetails(targetId);
    } else {
      if (goalsOverview) goalsOverview.classList.remove('hidden');
      if (goalDetails) goalDetails.classList.add('hidden');
      renderGoalsView();
    }
  } else {
    if (drawerInspector) drawerInspector.classList.add('hidden');
    state.selectedTaskId = null;
  }
}

// Start Engine
initSSE();
window.addEventListener('hashchange', handleRouteFromHash);
refreshAll().then(() => {
  handleRouteFromHash();
});
