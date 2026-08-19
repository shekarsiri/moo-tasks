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
  
  let icon = 'ℹ️';
  if (type === 'success') icon = '✅';
  if (type === 'error') icon = '⚠️';

  toast.innerHTML = `<span>${icon}</span><span class="font-medium">${message}</span>`;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
    toast.style.transition = 'all 0.2s ease-out';
    setTimeout(() => toast.remove(), 200);
  }, 3500);
}

// SSE Sync
function initSSE() {
  const eventSource = new EventSource('/api/events');

  eventSource.addEventListener('tasks_updated', () => refreshAll());
  eventSource.addEventListener('goals_updated', () => refreshAll());
  eventSource.addEventListener('decisions_updated', () => fetchDecisions());
  eventSource.addEventListener('activity_updated', () => fetchActivity());

  eventSource.onerror = () => {
    console.warn('[SSE] Reconnecting...');
  };
}

// API Fetching
async function fetchGoals() {
  try {
    const res = await fetch('/api/goals');
    const data = await res.json();
    state.goals = data.goals || [];
    renderGoalFilters();
    renderGoalsView();
    if (navCounterGoals) navCounterGoals.textContent = state.goals.length;
  } catch (err) {
    console.error('Failed to fetch goals:', err);
  }
}

async function fetchTasks() {
  try {
    const res = await fetch('/api/tasks');
    const data = await res.json();
    state.tasks = data.tasks || [];
    renderTasks();
    renderHumanInbox();
    renderReviewFeed();
    renderResumeView();
    updateAssigneeFilter();
    updateSidebarCounters();
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
  } catch (err) {
    console.error('Failed to fetch activity:', err);
  }
}

async function refreshAll() {
  await Promise.all([fetchGoals(), fetchTasks(), fetchDecisions(), fetchActivity()]);
  if (state.selectedTaskId) {
    openInspector(state.selectedTaskId, false);
  }
}

// Sidebar Navigation
navItems.forEach((btn) => {
  btn.addEventListener('click', () => {
    const view = btn.getAttribute('data-view');
    switchView(view);
  });
});

function switchView(viewName) {
  state.currentView = viewName;
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
  filterGoal.innerHTML = '<option value="">All Goals</option><option value="__orphans__">⚠️ Scope Drift (Orphans)</option>';
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

// Priority Icon Helper
function getPriorityIcon(priority) {
  switch (priority) {
    case 'critical':
      return `<span class="priority-icon priority-critical" title="Critical">▲▲▲</span>`;
    case 'high':
      return `<span class="priority-icon priority-high" title="High">▲▲</span>`;
    case 'medium':
      return `<span class="priority-icon priority-medium" title="Medium">▲</span>`;
    case 'low':
      return `<span class="priority-icon priority-low" title="Low">▽</span>`;
    default:
      return `<span class="priority-icon text-slate-600">-</span>`;
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
            ${isStalled ? `<span title="High Thrash/Attempts" class="text-[10px]">⚠️</span>` : ''}
          </div>
          <div class="list-col-priority">${getPriorityIcon(task.priority)}</div>
          <div class="list-col-title">
            <span>${task.title}</span>
            <span class="text-[10.5px] text-slate-500 font-mono ml-2 font-normal">(${formatRelativeTime(task.lastStateChangeAt)})</span>
          </div>
          ${goal ? `<div class="list-col-goal">${goal.title}</div>` : `<div class="list-col-goal border-amber-900/40 text-amber-400 bg-amber-950/20">Scope Drift</div>`}
          <div class="list-col-agent">
            ${task.claimedByAgent ? `<span>🤖 ${task.claimedByAgent}</span>` : `<span class="text-slate-600 font-sans">Unassigned</span>`}
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

    // HTML5 Drag and drop over column
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
            ${isStalled ? `<span title="Stalled/High Attempts">⚠️</span>` : ''}
          </div>
          ${getPriorityIcon(task.priority)}
        </div>
        <div class="board-card-title">${task.title}</div>
        <div class="board-card-footer">
          ${task.claimedByAgent ? `<span class="text-indigo-400 font-mono text-[10.5px]">🤖 ${task.claimedByAgent}</span>` : `<span class="text-slate-600 text-[10px]">Unassigned</span>`}
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
async function openInspector(taskId, showDrawer = true) {
  state.selectedTaskId = taskId;
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
        <div class="text-[11px] text-slate-500 font-mono">Last changed: ${formatRelativeTime(task.lastStateChangeAt)} (${task.lastStateChangeAt})</div>
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
        <div class="property-value font-mono text-indigo-300">
          ${task.claimedByAgent ? `🤖 ${task.claimedByAgent} ${task.attemptCount > 1 ? `(Attempt #${task.attemptCount})` : ''}` : '<span class="text-slate-500 font-sans">Unclaimed</span>'}
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

      <!-- Editable Acceptance Criteria -->
      <div class="bg-surface border border-subtle rounded-lg p-3">
        <div class="flex items-center justify-between mb-1.5">
          <div class="text-[10px] font-bold tracking-wider uppercase text-slate-400 font-mono">ACCEPTANCE CRITERIA</div>
          <span class="text-[10px] text-slate-500 font-mono">Auto-saves on change</span>
        </div>
        <textarea id="drawerInputAC" rows="3" class="input-field text-xs text-slate-200" onchange="handleSaveInlineField('${task.id}', 'acceptanceCriteria', this.value)">${task.acceptanceCriteria || ''}</textarea>
      </div>

      <!-- Subtasks Section -->
      ${!task.parentId ? `
        <div class="bg-surface border border-subtle rounded-lg p-3">
          <div class="flex items-center justify-between mb-2">
            <div class="text-[10px] font-bold tracking-wider uppercase text-slate-400 font-mono">SUBTASKS (${subtasks.length})</div>
            <button class="btn-secondary text-[11px] py-0.5 px-2" onclick="promptAddSubtask('${task.id}')">+ Add Subtask</button>
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
        <div class="bg-surface border border-subtle rounded-lg p-2.5 text-xs text-slate-400">
          <span>↳ Subtask of parent issue: </span>
          <span class="font-mono text-indigo-300 font-medium cursor-pointer hover:underline" onclick="openInspector('${task.parentId}')">${task.parentId}</span>
        </div>
      `}

      <!-- Dependencies & Blockers -->
      <div class="bg-surface border border-subtle rounded-lg p-3 space-y-2.5">
        <div class="flex items-center justify-between">
          <div class="text-[10px] font-bold tracking-wider uppercase text-amber-400 font-mono">BLOCKERS (Depends on)</div>
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
            <div class="text-[10px] font-bold tracking-wider uppercase text-blue-400 mb-1 font-mono">BLOCKS DOWNSTREAM</div>
            <div class="flex flex-wrap gap-1.5">
              ${dependents.map((d) => `<span class="font-mono text-xs px-2 py-0.5 bg-blue-950/40 border border-blue-800/40 text-blue-300 rounded cursor-pointer hover:underline" onclick="openInspector('${d}')">⚡ ${d}</span>`).join('')}
            </div>
          </div>
        ` : ''}
      </div>

      ${task.evidence ? `
        <!-- Completion Proof -->
        <div class="bg-surface border border-indigo-500/30 rounded-lg p-3">
          <div class="text-[10px] font-bold tracking-wider uppercase text-indigo-400 mb-1.5 font-mono">VERIFIED EVIDENCE PROOF</div>
          <pre class="text-[11px] font-mono text-slate-300 bg-slate-950 p-2 rounded border border-slate-800 overflow-x-auto">${JSON.stringify(task.evidence, null, 2)}</pre>
        </div>
      ` : ''}

      ${task.humanQuestion ? `
        <!-- Human Question -->
        <div class="bg-purple-950/20 border border-purple-800/40 rounded-lg p-3">
          <div class="text-[10px] font-bold tracking-wider uppercase text-purple-400 mb-1 font-mono">HUMAN QUESTION (${task.humanQuestionType || 'clarification'})</div>
          <div class="text-xs text-purple-200 mb-2 font-medium">${task.humanQuestion}</div>
          ${task.humanAnswer ? `
            <div class="text-xs text-emerald-300 bg-emerald-950/30 p-2 rounded border border-emerald-800/40">
              <span class="font-bold">Answer:</span> ${task.humanAnswer}
            </div>
          ` : `
            <form onsubmit="handleDrawerAnswer(event, '${task.id}')" class="flex gap-2 mt-2">
              <input type="text" id="drawerAnswerInput" required placeholder="Type answer to resume agent..." class="input-field text-xs flex-1">
              <button type="submit" class="btn-primary text-xs">Resume Agent</button>
            </form>
          `}
        </div>
      ` : ''}

      <!-- Actions Bar -->
      <div class="flex items-center justify-between border-t border-subtle pt-3 mt-1">
        <div class="flex gap-2">
          <button class="btn-secondary text-xs" onclick="promptMergeTask('${task.id}')">Merge into...</button>
          <button class="btn-danger text-xs" onclick="promptDropTask('${task.id}')">Drop Issue</button>
          <button class="btn-secondary text-xs" onclick="undoTask('${task.id}')">Undo Status</button>
          ${task.status === 'done' || task.status === 'dropped' ? `<button class="btn-primary text-xs" onclick="reopenTask('${task.id}')">Reopen Issue</button>` : ''}
        </div>
        ${task.status === 'done' && task.verificationState === 'agent_completed' ? `
          <div class="flex gap-2">
            <button class="btn-danger text-xs" onclick="promptRejectTask('${task.id}')">Reject Proof</button>
            <button class="btn-success text-xs" onclick="verifyTask('${task.id}')">✓ Verify Done</button>
          </div>
        ` : ''}
      </div>

      <!-- Activity & Notes -->
      <div class="border-t border-subtle pt-4 mt-2">
        <div class="text-[11px] font-bold uppercase tracking-wider text-slate-400 font-mono mb-3">ACTIVITY & AUDIT NOTES (${notes.length})</div>
        
        <form onsubmit="handleAddNote(event, '${task.id}')" class="mb-3 flex gap-2">
          <input type="text" id="drawerNoteInput" required placeholder="Add a note or attempt log..." class="input-field text-xs flex-1">
          <button type="submit" class="btn-secondary text-xs">Post</button>
        </form>

        <div class="space-y-2 max-h-60 overflow-y-auto font-mono text-xs">
          ${notes.length === 0 ? `<div class="text-slate-600 text-xs font-sans">No activity notes yet.</div>` : ''}
          ${notes.map((n) => `
            <div class="p-2.5 bg-surface rounded border border-subtle">
              <div class="flex items-center justify-between mb-1">
                <span class="text-indigo-400 font-bold text-[11px]">${n.authorId} (${n.authorType})</span>
                <span class="text-slate-500 text-[10px]">${new Date(n.createdAt).toLocaleTimeString()}</span>
              </div>
              <div class="text-slate-300 text-xs font-sans whitespace-pre-wrap">${n.content}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    if (showDrawer && drawerInspector) {
      drawerInspector.classList.remove('hidden');
    }
  } catch (err) {
    console.error('Failed to load issue details:', err);
  }
}

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
document.querySelectorAll('.drawer-close').forEach((btn) => {
  btn.onclick = () => {
    if (drawerInspector) drawerInspector.classList.add('hidden');
    state.selectedTaskId = null;
  };
});

if (drawerInspector) {
  drawerInspector.onclick = (e) => {
    if (e.target === drawerInspector) {
      drawerInspector.classList.add('hidden');
      state.selectedTaskId = null;
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
        <div class="bg-card p-3 rounded border border-subtle text-xs text-slate-300 mb-3 italic">
          "${g.verbatimPrompt}"
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
            <div class="text-[10px] font-bold tracking-wider uppercase text-amber-400 mb-1 font-mono">LOOSE ENDS (${item.looseEnds.length})</div>
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
        <button class="btn-secondary text-xs" onclick="filterByGoalDirect('${g.id}')">View Issues</button>
        <div>
          ${g.status === 'active' 
            ? `<button class="btn-danger text-xs" onclick="promptKillGoal('${g.id}')">Kill Goal</button>`
            : `<button class="btn-success text-xs" onclick="reopenGoal('${g.id}')">Reopen Goal</button>`
          }
        </div>
      </div>
    `;

    container.appendChild(card);
  });
}

window.filterByGoalDirect = (goalId) => {
  state.filterGoal = goalId;
  if (filterGoal) filterGoal.value = goalId;
  switchView('tasks');
  renderTasks();
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
        <span class="text-xs font-mono text-purple-400 font-semibold uppercase">Question from Agent: ${task.claimedByAgent || 'Unknown'}</span>
        <span class="text-xs font-mono text-slate-500">${task.id}</span>
      </div>
      <h3 class="text-sm font-bold text-slate-100 mb-2">${task.title}</h3>
      <div class="bg-purple-950/25 border border-purple-900/40 p-3 rounded text-xs text-purple-200 mb-3">
        <div class="font-semibold mb-1">❓ ${task.humanQuestionType || 'Question'}:</div>
        <div>${task.humanQuestion}</div>
      </div>
      <form onsubmit="handleAnswerQuestion(event, '${task.id}')" class="flex gap-2">
        <input type="text" id="inbox-answer-${task.id}" required placeholder="Type answer or decision to resume agent..." class="input-field text-xs flex-1">
        <button type="submit" class="btn-primary text-xs">Resume Agent</button>
      </form>
    `;

    container.appendChild(card);
  });
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
        <span class="text-xs font-mono font-semibold ${isCompleted ? 'text-indigo-400' : 'text-rose-400'} uppercase">
          ${isCompleted ? 'Agent Claimed Done (Awaiting Verification)' : 'Dropped Task'}
        </span>
        <span class="text-xs font-mono text-slate-500">${task.id}</span>
      </div>
      <h3 class="text-sm font-bold text-slate-100 mb-1.5">${task.title}</h3>
      
      ${task.evidence ? `
        <div class="bg-card p-3 rounded border border-subtle text-xs font-mono text-slate-300 mb-3">
          <div class="text-slate-500 text-[10px] mb-1 font-bold uppercase">SUBMITTED EVIDENCE</div>
          <div>Commands: ${task.evidence.commandsRun?.join(', ') || 'N/A'}</div>
          <div>Proof: ${task.evidence.testProof || task.evidence.outputSnippet || 'Provided'}</div>
        </div>
      ` : ''}

      ${task.droppedReason ? `<div class="text-xs text-rose-300 italic mb-3">Reason: "${task.droppedReason}"</div>` : ''}

      <div class="flex items-center justify-end gap-2 border-t border-subtle pt-3">
        ${isCompleted ? `
          <button class="btn-danger text-xs" onclick="promptRejectTask('${task.id}')">Reject with Reason</button>
          <button class="btn-success text-xs" onclick="verifyTask('${task.id}')">✓ Verify Done</button>
        ` : `
          <button class="btn-secondary text-xs" onclick="reopenTask('${task.id}')">Reopen Issue</button>
        `}
      </div>
    `;

    container.appendChild(card);
  });
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
      <div class="space-y-1.5 text-xs mb-3">
        <div><span class="text-slate-500 font-semibold">Context:</span> <span class="text-slate-300">${dec.context}</span></div>
        <div><span class="text-slate-500 font-semibold">Choice:</span> <span class="text-slate-200 font-medium">${dec.choice}</span></div>
        <div><span class="text-slate-500 font-semibold">Rationale:</span> <span class="text-slate-300 italic">${dec.rationale}</span></div>
      </div>
      <div class="flex items-center justify-between border-t border-subtle pt-2">
        <div class="flex items-center gap-1.5">${tagsHtml}</div>
        ${dec.status === 'accepted' ? `<button class="btn-secondary text-[11px] py-0.5 px-2" onclick="promptSupersedeDecision('${dec.id}', '${dec.title.replace(/'/g, "\\'")}')">🔄 Supersede</button>` : ''}
      </div>
    `;

    container.appendChild(card);
  });
}

// Supersede Decision Modal
window.promptSupersedeDecision = (oldId, oldTitle) => {
  const hiddenOldId = document.getElementById('inputSupersedeOldId');
  const labelOldTitle = document.getElementById('labelSupersedeOldTitle');
  if (hiddenOldId) hiddenOldId.value = oldId;
  if (labelOldTitle) labelOldTitle.textContent = oldTitle;
  if (modalSupersedeDecision) modalSupersedeDecision.classList.remove('hidden');
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
          <span class="text-indigo-400 font-bold">${note.authorId} (${note.authorType})</span>
          <span class="text-slate-500 font-mono text-[10px]">task:${note.taskId}</span>
        </div>
        <div class="text-slate-300 whitespace-pre-wrap text-xs font-sans">${note.content}</div>
      </div>
    `;
    container.appendChild(row);
  });
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
            <button class="btn-primary text-xs" onclick="openInspector('${sum.unblockedReadyTasks[0].id}')">Inspect Issue</button>
          </div>
        ` : `<div class="text-xs text-slate-500">No ready unblocked tasks found. Check goals or add tasks.</div>`}
      </div>
    `;
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
    { title: 'Create New Issue', icon: '+', action: () => { closeCommandPalette(); if (modalCreateTask) modalCreateTask.classList.remove('hidden'); } },
    { title: 'Create New Goal', icon: '🎯', action: () => { closeCommandPalette(); if (modalCreateGoal) modalCreateGoal.classList.remove('hidden'); } },
    { title: 'Record Architectural Decision', icon: '🏛️', action: () => { closeCommandPalette(); if (modalCreateDecision) modalCreateDecision.classList.remove('hidden'); } },
    { title: 'Switch to All Issues', icon: '⚡', action: () => { closeCommandPalette(); switchView('tasks'); } },
    { title: 'Switch to Human Inbox', icon: '🙋', action: () => { closeCommandPalette(); switchView('human'); } },
    { title: 'Export Markdown Project Summary', icon: '↓', action: () => { closeCommandPalette(); exportProject(); } },
  ];

  const matchedActions = actions.filter((a) => a.title.toLowerCase().includes(q));
  matchedActions.forEach((a) => {
    const item = document.createElement('div');
    item.className = 'palette-item';
    item.innerHTML = `<div class="flex items-center gap-2"><span>${a.icon}</span><span>${a.title}</span></div><kbd class="kbd-key text-[9px]">Action</kbd>`;
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
if (btnHeaderNewTask) btnHeaderNewTask.onclick = () => modalCreateTask?.classList.remove('hidden');

const btnCreateGoal = document.getElementById('btnCreateGoal');
if (btnCreateGoal) btnCreateGoal.onclick = () => modalCreateGoal?.classList.remove('hidden');

const btnCreateDecision = document.getElementById('btnCreateDecision');
if (btnCreateDecision) btnCreateDecision.onclick = () => modalCreateDecision?.classList.remove('hidden');

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

  const res = await fetch(`/api/tasks/${taskId}/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: newStatus, authorId: 'human' }),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
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

// Start Engine
initSSE();
refreshAll();
