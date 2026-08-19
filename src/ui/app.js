// Moo Tasks Ultra-Modern Frontend Engine

const defaultDisplayProperties = {
  id: true,
  status: true,
  assignee: true,
  priority: true,
  project: false,
  dueDate: false,
  milestone: false,
  labels: true,
  links: false,
  timeInStatus: false,
  created: false,
  updated: false,
};

let savedProps = defaultDisplayProperties;
try {
  const parsed = JSON.parse(localStorage.getItem('moo_display_properties'));
  if (parsed && typeof parsed === 'object') savedProps = { ...defaultDisplayProperties, ...parsed };
} catch {}

const state = {
  goals: [],
  tasks: [],
  decisions: [],
  activity: [],
  currentView: 'tasks',
  viewMode: localStorage.getItem('moo_view_mode') || 'list', // 'list' | 'board'
  filterGoal: '',
  filterPriority: '',
  filterType: '',
  filterTag: '',
  filterAgent: '',
  filterSort: localStorage.getItem('moo_view_ordering') || 'default',
  filterSearch: '',
  filterPreset: 'all', // 'active' | 'backlog' | 'all'
  viewGrouping: localStorage.getItem('moo_view_grouping') || 'status', // 'status' | 'priority' | 'agent' | 'type' | 'goal' | 'none'
  viewSubGrouping: localStorage.getItem('moo_view_subgrouping') || 'none',
  viewOrdering: localStorage.getItem('moo_view_ordering') || 'priority',
  viewOrderCompletedByRecency: localStorage.getItem('moo_view_recency') === 'true',
  viewCompletedIssues: localStorage.getItem('moo_view_completed') || 'all',
  viewShowSubIssues: localStorage.getItem('moo_view_show_subissues') !== 'false',
  viewNestedSubIssues: localStorage.getItem('moo_view_nested_subissues') === 'true',
  viewShowEmptyGroups: localStorage.getItem('moo_view_empty_groups') === 'true',
  displayProperties: savedProps,
  selectedTaskId: null,
  selectedTaskIds: new Set(),
  collapsedColumns: new Set(JSON.parse(localStorage.getItem('moo_collapsed_columns') || '[]')),
  collapsedGroups: new Set(),
  currentIssueTab: 'assigned',
  projectShortCode: 'MO',
  keyboardFocusedIndex: -1,
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
      let html = window.marked.parse(text, { breaks: true, gfm: true });
      // Enable interactive checkboxes (marked renders them as disabled by default)
      html = html.replace(/<input\s+type="checkbox"\s+disabled(?:\s+checked)?/g, (match) => {
        return match.replace(' disabled', '');
      });
      return html;
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

// Inline Save Status Helper
function setInlineSaveStatus(field, status) {
  const indicator = document.getElementById(`inlineSaveStatus-${field}`);
  if (!indicator) return;
  if (status === 'saving') {
    indicator.className = 'inline-save-indicator saving';
    indicator.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping inline-block"></span> Saving...`;
  } else if (status === 'saved') {
    indicator.className = 'inline-save-indicator saved';
    indicator.textContent = 'Saved ✓';
    setTimeout(() => {
      if (indicator.textContent === 'Saved ✓') {
        indicator.textContent = '';
        indicator.className = 'inline-save-indicator';
      }
    }, 2000);
  }
}

// Direct In-Place Visual Editing Handlers
window.handleDirectDocBlur = async (element, targetId, field, isGoal = false) => {
  const markdown = htmlToMarkdown(element.innerHTML);
  setInlineSaveStatus(field, 'saving');
  if (isGoal) {
    await fetch(`/api/goals/${targetId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: markdown }),
    });
    setInlineSaveStatus(field, 'saved');
    showToast('Saved specification', 'success');
    fetchGoals();
  } else {
    await handleSaveInlineField(targetId, field, markdown);
    setInlineSaveStatus(field, 'saved');
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
const btnViewGraph = document.getElementById('btnViewGraph');
const tasksListView = document.getElementById('tasksListView');
const tasksBoardView = document.getElementById('tasksBoardView');
const tasksGraphView = document.getElementById('tasksGraphView');
const filterToolbar = document.getElementById('filterToolbar');

// Linear Filter & Sort References
const btnFilterMenu = document.getElementById('btnFilterMenu');
const filterPopover = document.getElementById('filterPopover');
const filterPopoverRoot = document.getElementById('filterPopoverRoot');
const filterPopoverSub = document.getElementById('filterPopoverSub');
const btnFilterSubBack = document.getElementById('btnFilterSubBack');
const filterSubTitle = document.getElementById('filterSubTitle');
const filterSubSearch = document.getElementById('filterSubSearch');
const filterSubOptionsList = document.getElementById('filterSubOptionsList');
const activeFilterChips = document.getElementById('activeFilterChips');
const btnClearAllFilters = document.getElementById('btnClearAllFilters');
const filterActiveBadge = document.getElementById('filterActiveBadge');

const btnSortMenu = document.getElementById('btnSortMenu');
const sortPopover = document.getElementById('sortPopover');
const sortMenuLabel = document.getElementById('sortMenuLabel');

const filterSearch = document.getElementById('filterSearch');
const displayCountLabel = document.getElementById('displayCountLabel');

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Batch Actions & Shortcuts References
const batchActionBar = document.getElementById('batchActionBar');
const batchSelectedCount = document.getElementById('batchSelectedCount');
const modalKeyboardShortcuts = document.getElementById('modalKeyboardShortcuts');
const btnOpenShortcutsHelp = document.getElementById('btnOpenShortcutsHelp');

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

function formatLeaseRemaining(leaseExpiresAt) {
  if (!leaseExpiresAt) return '';
  const diffMs = new Date(leaseExpiresAt).getTime() - Date.now();
  if (diffMs <= 0) return 'Expired';
  const totalSec = Math.floor(diffMs / 1000);
  const hours = Math.floor(totalSec / 3600);
  const min = Math.floor((totalSec % 3600) / 60);
  const sec = totalSec % 60;
  if (hours > 0) {
    return `${hours}h ${min < 10 ? '0' : ''}${min}m ${sec < 10 ? '0' : ''}${sec}s`;
  }
  return `${min}m ${sec < 10 ? '0' : ''}${sec}s`;
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
  eventSource.addEventListener('workspaces_updated', () => refreshAll());
  eventSource.addEventListener('workspaces_switched', () => refreshAll());
  eventSource.addEventListener('project_updated', () => refreshAll());

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

// Active Multi-Device Background Sync (Smart adaptive polling fallback)
let lastFallbackPoll = Date.now();
setInterval(() => {
  if (document.visibilityState === 'visible') {
    const isSSEHealthy = sseInstance && sseReconnectAttempts === 0 && Date.now() - lastPingReceivedAt <= 25000;
    const pollThreshold = isSSEHealthy ? 15000 : 3000;
    if (Date.now() - lastFallbackPoll >= pollThreshold) {
      lastFallbackPoll = Date.now();
      if (!isSSEHealthy) {
        refreshAll();
        initSSE();
      } else {
        fetchTasks();
      }
    }
  }
}, 1000);

// Live Lease & Countdown Tick Timer (ticks every second for active timers)
setInterval(() => {
  if (document.visibilityState === 'visible') {
    const activeLeaseBadges = document.querySelectorAll('[data-lease-expires]');
    activeLeaseBadges.forEach((el) => {
      const expiresAt = el.getAttribute('data-lease-expires');
      if (expiresAt) {
        const text = formatLeaseRemaining(expiresAt);
        const textSpan = el.querySelector('.lease-text') || el;
        if (textSpan) textSpan.textContent = text;
      }
    });
  }
}, 1000);

// API Fetching
function getProjectShortCode(projectName) {
  if (!projectName) return 'MO';
  const clean = projectName.trim().replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '');
  const parts = clean.split(/[-_\s.]+/).filter(Boolean);
  if (parts.length >= 2) {
    const code = parts.map((p) => p[0]).join('').slice(0, 3).toUpperCase();
    if (code.length >= 2) return code;
  }
  const letters = clean.replace(/[^a-zA-Z]/g, '');
  if (letters.length >= 2) {
    return letters.slice(0, 2).toUpperCase();
  }
  return (clean.slice(0, 2) || 'MO').toUpperCase();
}

function updateWorkspaceNameInUI(name) {
  if (!name) return;
  const wsLbl = document.getElementById('workspaceNameLabel');
  if (wsLbl) wsLbl.textContent = name;
  const breadcrumbLbl = document.getElementById('headerWorkspaceBreadcrumb');
  if (breadcrumbLbl) breadcrumbLbl.textContent = name;
  const teamLbl = document.getElementById('teamProjectNameLabel');
  if (teamLbl) teamLbl.textContent = name;
  document.title = `${name} — My issues`;
}

async function fetchProjectInfo() {
  try {
    const res = await fetch('/api/project');
    const data = await res.json();
    if (data.projectName) {
      state.projectShortCode = getProjectShortCode(data.projectName);
      updateWorkspaceNameInUI(data.projectName);
    }
    if (data.workspace) {
      state.activeWorkspace = data.workspace;
      updateWorkspaceNameInUI(data.workspace.name);
    }
  } catch (err) {
    // ignore
  }
}

async function fetchWorkspaces() {
  try {
    const res = await fetch('/api/workspaces');
    const data = await res.json();
    state.workspaces = data.workspaces || [];
    state.activeWorkspace = data.activeWorkspace || state.activeWorkspace;
    renderWorkspacesDropdown();
  } catch (err) {
    console.error('Failed to fetch workspaces:', err);
  }
}

function renderWorkspacesDropdown() {
  const container = document.getElementById('workspaceListContainer');
  if (!container) return;

  if (state.workspaces.length === 0) {
    container.innerHTML = `<div class="text-xs text-slate-500 px-2 py-2">No workspaces found</div>`;
    return;
  }

  container.innerHTML = state.workspaces
    .map((ws) => {
      const isActive = ws.id === state.activeWorkspace?.id;
      return `
        <div class="workspace-item group flex items-center justify-between px-2 py-1.5 rounded cursor-pointer text-xs transition-colors ${
          isActive
            ? 'bg-surfaceHover text-cyan-400 font-semibold'
            : 'text-slate-300 hover:bg-surfaceHover hover:text-white'
        }" onclick="switchWorkspace('${ws.id}')" title="${escapeHtml(ws.rootPath)}">
          <div class="flex items-center gap-2 min-w-0 truncate">
            <span class="w-2 h-2 rounded-full shrink-0 ${isActive ? 'bg-cyan-400' : 'bg-slate-600'}"></span>
            <span class="truncate">${escapeHtml(ws.name)}</span>
          </div>
          <div class="flex items-center gap-1.5 shrink-0 ml-2">
            <span class="text-[10px] text-slate-500 font-mono">${ws.openTasks || 0} open</span>
            <div class="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity">
              <button class="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-700/50" onclick="editWorkspace(event, '${ws.id}')" title="Rename display name">
                <i data-lucide="pencil" class="w-3 h-3"></i>
              </button>
              <button class="p-1 text-slate-400 hover:text-red-400 rounded hover:bg-slate-700/50" onclick="deleteWorkspace(event, '${ws.id}')" title="Unregister workspace">
                <i data-lucide="trash-2" class="w-3 h-3"></i>
              </button>
            </div>
          </div>
        </div>
      `;
    })
    .join('');
  refreshLucideIcons();
}

window.editWorkspace = (e, workspaceId) => {
  if (e) {
    e.stopPropagation();
    e.preventDefault();
  }
  const ws = state.workspaces.find((w) => w.id === workspaceId) || state.activeWorkspace;
  if (!ws) return;

  const modal = document.getElementById('modalEditWorkspace');
  const inputId = document.getElementById('inputEditWorkspaceId');
  const inputName = document.getElementById('inputEditWorkspaceName');
  const inputPath = document.getElementById('inputEditWorkspacePath');
  const inputRemote = document.getElementById('inputEditWorkspaceRemote');

  if (inputId) inputId.value = ws.id;
  if (inputName) inputName.value = ws.name || '';
  if (inputPath) inputPath.value = ws.rootPath || '';
  if (inputRemote) inputRemote.value = ws.gitRemote || '';

  const wsDropdown = document.getElementById('workspaceDropdownMenu');
  if (wsDropdown) wsDropdown.classList.add('hidden');

  if (modal) {
    modal.classList.remove('hidden');
    refreshLucideIcons();
    setTimeout(() => inputName?.focus(), 50);
  }
};

window.openRegisterWorkspaceModal = (e) => {
  if (e) {
    e.stopPropagation();
    e.preventDefault();
  }
  const modal = document.getElementById('modalRegisterWorkspace');
  const inputPath = document.getElementById('inputRegisterWorkspacePath');
  const inputName = document.getElementById('inputRegisterWorkspaceName');
  if (inputPath) inputPath.value = '';
  if (inputName) inputName.value = '';

  const wsDropdown = document.getElementById('workspaceDropdownMenu');
  if (wsDropdown) wsDropdown.classList.add('hidden');

  if (modal) {
    modal.classList.remove('hidden');
    refreshLucideIcons();
    setTimeout(() => inputPath?.focus(), 50);
  }
};

window.deleteWorkspace = async (e, workspaceId) => {
  if (e) {
    e.stopPropagation();
    e.preventDefault();
  }
  const ws = state.workspaces.find((w) => w.id === workspaceId);
  const name = ws ? ws.name : workspaceId;
  const ok = confirm(`Are you sure you want to unregister workspace "${name}"?\n(Tasks and data will remain safe in global database).`);
  if (!ok) return;

  try {
    const res = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}`, {
      method: 'DELETE',
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Unregistered workspace "${name}"`, 'info');
      await fetchWorkspaces();
      if (state.activeWorkspace?.id === workspaceId && state.workspaces.length > 0) {
        await switchWorkspace(state.workspaces[0].id);
      } else {
        await refreshAll();
      }
    } else {
      showToast('Failed to delete workspace', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
};

window.switchWorkspace = async (workspaceId) => {
  try {
    const res = await fetch('/api/workspaces/switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId }),
    });
    const data = await res.json();
    if (data.success) {
      state.activeWorkspace = data.activeWorkspace;
      const wsDropdown = document.getElementById('workspaceDropdownMenu');
      if (wsDropdown) wsDropdown.classList.add('hidden');
      await refreshAll();
      showToast(`Switched to workspace: ${data.activeWorkspace.name}`, 'success');
    }
  } catch (err) {
    showToast(`Failed to switch workspace: ${err.message}`, 'error');
  }
};

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
    updateTagFilter();
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
  await Promise.all([fetchProjectInfo(), fetchWorkspaces(), fetchGoals(), fetchTasks(), fetchDecisions(), fetchActivity()]);
  if (state.selectedTaskId) {
    const activeEl = document.activeElement;
    const isTyping =
      activeEl &&
      (activeEl.tagName === 'INPUT' ||
        activeEl.tagName === 'TEXTAREA' ||
        activeEl.isContentEditable ||
        activeEl.classList?.contains('rich-editable-doc')) &&
      document.getElementById('drawerInspector')?.contains(activeEl);

    if (!isTyping) {
      openInspector(state.selectedTaskId, false, false);
    }
  }
  refreshLucideIcons();
}

// Mobile Sidebar Drawer Controller
window.toggleMobileSidebar = (open) => {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  if (!sidebar) return;

  const shouldOpen = open !== undefined ? open : sidebar.classList.contains('-translate-x-full');
  if (shouldOpen) {
    sidebar.classList.remove('-translate-x-full');
    if (backdrop) backdrop.classList.remove('hidden');
  } else {
    sidebar.classList.add('-translate-x-full');
    if (backdrop) backdrop.classList.add('hidden');
  }
};

// Workspace Dropdown Toggle & Register Handlers
const wsDropdownBtn = document.getElementById('workspaceDropdownBtn');
const wsDropdownMenu = document.getElementById('workspaceDropdownMenu');
if (wsDropdownBtn && wsDropdownMenu) {
  wsDropdownBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    wsDropdownMenu.classList.toggle('hidden');
    fetchWorkspaces();
  });
}

document.addEventListener('click', (e) => {
  if (
    wsDropdownMenu &&
    !wsDropdownMenu.contains(e.target) &&
    e.target !== wsDropdownBtn &&
    !wsDropdownBtn?.contains(e.target)
  ) {
    wsDropdownMenu.classList.add('hidden');
  }
});

const btnRegisterWorkspace = document.getElementById('btnRegisterWorkspace');
if (btnRegisterWorkspace) {
  btnRegisterWorkspace.addEventListener('click', (e) => {
    window.openRegisterWorkspaceModal(e);
  });
}

// Sidebar workspace name label quick edit on double click
const workspaceNameLabel = document.getElementById('workspaceNameLabel');
if (workspaceNameLabel) {
  workspaceNameLabel.addEventListener('dblclick', (e) => {
    if (state.activeWorkspace) {
      window.editWorkspace(e, state.activeWorkspace.id);
    }
  });
}

// Sidebar Navigation
navItems.forEach((btn) => {
  btn.addEventListener('click', () => {
    const view = btn.getAttribute('data-view');
    const mode = btn.getAttribute('data-mode');
    if (view) switchView(view);
    if (mode) setViewMode(mode);
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

  // Sync Mobile Bottom Navigation
  const mobileNavBtns = document.querySelectorAll('.mobile-nav-btn');
  mobileNavBtns.forEach((b) => {
    const isTarget = b.getAttribute('data-view') === viewName;
    b.classList.toggle('active', isTarget);
    b.classList.toggle('text-indigo-400', isTarget);
    b.classList.toggle('text-slate-400', !isTarget);
  });

  // Close mobile sidebar if open
  toggleMobileSidebar(false);

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

// View Mode (List vs Board vs Graph)
if (btnViewList) btnViewList.onclick = () => setViewMode('list');
if (btnViewBoard) btnViewBoard.onclick = () => setViewMode('board');
if (btnViewGraph) btnViewGraph.onclick = () => setViewMode('graph');

function setViewMode(mode) {
  state.viewMode = mode;
  if (btnViewList) btnViewList.classList.toggle('active', mode === 'list');
  if (btnViewBoard) btnViewBoard.classList.toggle('active', mode === 'board');
  if (btnViewGraph) btnViewGraph.classList.toggle('active', mode === 'graph');
  if (tasksListView) tasksListView.classList.toggle('hidden', mode !== 'list');
  if (tasksBoardView) tasksBoardView.classList.toggle('hidden', mode !== 'board');
  if (tasksGraphView) tasksGraphView.classList.toggle('hidden', mode !== 'graph');
  renderTasks();
}

// Filters & Sorting
function getFilteredTasks() {
  let list = state.tasks.filter((t) => !t.isArchived);

  // 1. Preset Filter (Active / Backlog / All)
  if (state.filterPreset === 'active') {
    list = list.filter((t) => t.status !== 'done' && !t.isDeferred);
  } else if (state.filterPreset === 'backlog') {
    list = list.filter((t) => t.isDeferred || t.status === 'backlog');
  }

  // 2. Completed issues filter
  if (state.viewCompletedIssues === 'hide') {
    list = list.filter((t) => t.status !== 'done');
  } else if (state.viewCompletedIssues === 'past_day') {
    list = list.filter((t) => {
      if (t.status !== 'done') return true;
      const tTime = new Date(t.lastStateChangeAt || t.createdAt || 0).getTime();
      return Date.now() - tTime <= 24 * 3600 * 1000;
    });
  } else if (state.viewCompletedIssues === 'past_week') {
    list = list.filter((t) => {
      if (t.status !== 'done') return true;
      const tTime = new Date(t.lastStateChangeAt || t.createdAt || 0).getTime();
      return Date.now() - tTime <= 7 * 24 * 3600 * 1000;
    });
  } else if (state.viewCompletedIssues === 'past_month') {
    list = list.filter((t) => {
      if (t.status !== 'done') return true;
      const tTime = new Date(t.lastStateChangeAt || t.createdAt || 0).getTime();
      return Date.now() - tTime <= 30 * 24 * 3600 * 1000;
    });
  }

  // 3. Goal / Dimension Filters
  if (state.filterGoal === '__orphans__') {
    list = list.filter((t) => !t.goalId);
  } else if (state.filterGoal) {
    list = list.filter((t) => t.goalId === state.filterGoal);
  }

  if (state.filterType) {
    list = list.filter((t) => (t.type || 'feature') === state.filterType);
  }
  if (state.filterPriority) {
    list = list.filter((t) => t.priority === state.filterPriority);
  }
  if (state.filterTag) {
    list = list.filter((t) => (t.tags || []).includes(state.filterTag));
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
        (t.type && t.type.toLowerCase().includes(q)) ||
        (t.tags && t.tags.some((tag) => tag.toLowerCase().includes(q))) ||
        (t.description && t.description.toLowerCase().includes(q))
    );
  }

  // 4. Ordering
  const priorityRank = { critical: 5, urgent: 5, high: 4, medium: 3, low: 2, none: 1 };
  const statusRank = { doing: 5, todo: 4, 'waiting-on-human': 3, 'blocked-on-dependency': 2, backlog: 1, done: 0, dropped: -1 };
  
  const ordering = state.viewOrdering || state.filterSort || 'priority';

  if (ordering === 'priority' || ordering === 'priority-desc') {
    list.sort((a, b) => (priorityRank[b.priority] || 1) - (priorityRank[a.priority] || 1));
  } else if (ordering === 'status') {
    list.sort((a, b) => (statusRank[b.status] || 0) - (statusRank[a.status] || 0));
  } else if (ordering === 'title') {
    list.sort((a, b) => a.title.localeCompare(b.title));
  } else if (ordering === 'updated' || ordering === 'updated-desc') {
    list.sort((a, b) => new Date(b.lastStateChangeAt || 0).getTime() - new Date(a.lastStateChangeAt || 0).getTime());
  } else if (ordering === 'created') {
    list.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  } else if (ordering === 'thrash' || ordering === 'thrash-desc') {
    list.sort((a, b) => ((b.attemptCount || 0) + (b.reopenCount || 0) * 2) - ((a.attemptCount || 0) + (a.reopenCount || 0) * 2));
  }

  // 5. Order completed by recency
  if (state.viewOrderCompletedByRecency) {
    list.sort((a, b) => {
      if (a.status === 'done' && b.status === 'done') {
        return new Date(b.lastStateChangeAt || b.createdAt || 0).getTime() - new Date(a.lastStateChangeAt || a.createdAt || 0).getTime();
      }
      return 0;
    });
  }

  return list;
}

// Linear Filter & Sort State Controllers
function getActiveFilterCount() {
  let count = 0;
  if (state.filterGoal) count++;
  if (state.filterType) count++;
  if (state.filterPriority) count++;
  if (state.filterTag) count++;
  if (state.filterAgent) count++;
  return count;
}

function renderActiveFilterChips() {
  if (!activeFilterChips) return;
  activeFilterChips.innerHTML = '';

  const count = getActiveFilterCount();
  if (filterActiveBadge) {
    if (count > 0) {
      filterActiveBadge.textContent = count;
      filterActiveBadge.classList.remove('hidden');
    } else {
      filterActiveBadge.classList.add('hidden');
    }
  }

  const container = document.getElementById('activeFilterChipsContainer');
  if (container) {
    container.classList.toggle('hidden', count === 0);
  }

  // 1. Goal Chip
  if (state.filterGoal) {
    let goalVal = state.filterGoal;
    if (state.filterGoal === '__orphans__') {
      goalVal = 'Scope Drift';
    } else {
      const found = state.goals.find((g) => g.goal.id === state.filterGoal);
      if (found) goalVal = found.goal.title;
    }
    createFilterChip(
      'Goal',
      `<i data-lucide="target" class="w-3 h-3 text-indigo-400"></i>`,
      goalVal,
      `<i data-lucide="compass" class="w-3 h-3 text-slate-400"></i>`,
      () => {
        state.filterGoal = '';
        renderActiveFilterChips();
        renderTasks();
      }
    );
  }

  // 2. Type Chip
  if (state.filterType) {
    const typeNames = {
      feature: 'Feature',
      bug: 'Bug',
      refactor: 'Refactor',
      test: 'Test',
      docs: 'Docs',
      chore: 'Chore',
      spike: 'Spike',
      security: 'Security',
    };
    createFilterChip(
      'Type',
      `<i data-lucide="sparkles" class="w-3 h-3 text-amber-400"></i>`,
      typeNames[state.filterType] || state.filterType,
      `<span class="w-2 h-2 rounded-full bg-amber-400 inline-block"></span>`,
      () => {
        state.filterType = '';
        renderActiveFilterChips();
        renderTasks();
      }
    );
  }

  // 3. Priority Chip
  if (state.filterPriority) {
    const pCapital = state.filterPriority.charAt(0).toUpperCase() + state.filterPriority.slice(1);
    createFilterChip(
      'Priority',
      `<i data-lucide="flag" class="w-3 h-3 text-rose-400"></i>`,
      pCapital,
      `<span class="priority-signal ${state.filterPriority}"><span class="priority-signal-bar bar-1 filled"></span><span class="priority-signal-bar bar-2 filled"></span></span>`,
      () => {
        state.filterPriority = '';
        renderActiveFilterChips();
        renderTasks();
      }
    );
  }

  // 4. Tag Chip
  if (state.filterTag) {
    createFilterChip(
      'Tag',
      `<i data-lucide="tag" class="w-3 h-3 text-emerald-400"></i>`,
      `#${state.filterTag}`,
      `<span class="w-2 h-2 rounded-full bg-emerald-400 inline-block"></span>`,
      () => {
        state.filterTag = '';
        renderActiveFilterChips();
        renderTasks();
      }
    );
  }

  // 5. Assignee Chip
  if (state.filterAgent) {
    createFilterChip(
      'Assignee',
      `<i data-lucide="bot" class="w-3 h-3 text-blue-400"></i>`,
      state.filterAgent,
      `<i data-lucide="user" class="w-3 h-3 text-slate-300"></i>`,
      () => {
        state.filterAgent = '';
        renderActiveFilterChips();
        renderTasks();
      }
    );
  }

  refreshLucideIcons();
}

function createFilterChip(dimLabel, dimIconHtml, valLabel, valIconHtml, onRemove) {
  const chip = document.createElement('div');
  chip.className = 'filter-chip';
  chip.innerHTML = `
    <span class="filter-chip-dimension">${dimIconHtml || ''} <span>${escapeHtml(dimLabel)}</span></span>
    <span class="filter-chip-operator">is</span>
    <span class="filter-chip-value">${valIconHtml || ''} <span>${escapeHtml(valLabel)}</span></span>
    <button type="button" class="filter-chip-remove" title="Remove filter" aria-label="Remove filter">
      <i data-lucide="x" class="w-3 h-3"></i>
    </button>
  `;
  chip.querySelector('.filter-chip-remove').onclick = (e) => {
    e.stopPropagation();
    onRemove();
  };
  activeFilterChips.appendChild(chip);
}

if (btnClearAllFilters) {
  btnClearAllFilters.onclick = () => {
    state.filterGoal = '';
    state.filterType = '';
    state.filterPriority = '';
    state.filterTag = '';
    state.filterAgent = '';
    renderActiveFilterChips();
    renderTasks();
  };
}

let currentFilterDimension = null;

function openFilterPopover() {
  if (!filterPopover) return;
  filterPopover.classList.remove('hidden');
  btnFilterMenu?.setAttribute('aria-expanded', 'true');
  btnFilterMenu?.classList.add('active');
  showFilterPopoverRoot();
  if (sortPopover) closeSortPopover();
}

function closeFilterPopover() {
  if (!filterPopover) return;
  filterPopover.classList.add('hidden');
  btnFilterMenu?.setAttribute('aria-expanded', 'false');
  btnFilterMenu?.classList.remove('active');
  currentFilterDimension = null;
}

function toggleFilterPopover() {
  if (filterPopover?.classList.contains('hidden')) {
    openFilterPopover();
  } else {
    closeFilterPopover();
  }
}

if (btnFilterMenu) {
  btnFilterMenu.onclick = (e) => {
    e.stopPropagation();
    toggleFilterPopover();
  };
}

function showFilterPopoverRoot() {
  if (!filterPopoverRoot || !filterPopoverSub) return;
  filterPopoverRoot.classList.remove('hidden');
  filterPopoverSub.classList.add('hidden');
  currentFilterDimension = null;
}

function showFilterDimensionSubmenu(dimension) {
  if (!filterPopoverRoot || !filterPopoverSub || !filterSubOptionsList) return;
  currentFilterDimension = dimension;
  filterPopoverRoot.classList.add('hidden');
  filterPopoverSub.classList.remove('hidden');

  const titles = {
    goal: 'Goal',
    type: 'Type',
    priority: 'Priority',
    tag: 'Tag',
    agent: 'Assignee',
  };
  if (filterSubTitle) filterSubTitle.textContent = titles[dimension] || 'Back';
  if (filterSubSearch) {
    filterSubSearch.value = '';
    setTimeout(() => filterSubSearch.focus(), 50);
  }

  renderSubmenuOptions(dimension, '');
}

function renderSubmenuOptions(dimension, searchQuery) {
  if (!filterSubOptionsList) return;
  filterSubOptionsList.innerHTML = '';
  const query = (searchQuery || '').toLowerCase();

  let options = [];

  if (dimension === 'goal') {
    options.push({ value: '__orphans__', label: 'Scope Drift (Orphans)', icon: 'target', color: 'text-amber-400' });
    state.goals.forEach((item) => {
      options.push({ value: item.goal.id, label: item.goal.title, icon: 'target', color: 'text-indigo-400' });
    });
  } else if (dimension === 'type') {
    options = [
      { value: 'feature', label: '✨ Feature' },
      { value: 'bug', label: '🐛 Bug' },
      { value: 'refactor', label: '♻️ Refactor' },
      { value: 'test', label: '🧪 Test' },
      { value: 'docs', label: '📚 Docs' },
      { value: 'chore', label: '🧹 Chore' },
      { value: 'spike', label: '🔬 Spike' },
      { value: 'security', label: '🔒 Security' },
    ];
  } else if (dimension === 'priority') {
    options = [
      { value: 'critical', label: 'Critical', icon: 'chevrons-up', color: 'text-rose-500' },
      { value: 'high', label: 'High', icon: 'chevron-up', color: 'text-amber-500' },
      { value: 'medium', label: 'Medium', icon: 'equal', color: 'text-blue-400' },
      { value: 'low', label: 'Low', icon: 'chevron-down', color: 'text-slate-500' },
    ];
  } else if (dimension === 'tag') {
    const allTags = new Set();
    state.tasks.forEach((t) => (t.tags || []).forEach((tag) => allTags.add(tag)));
    Array.from(allTags).sort().forEach((tag) => {
      options.push({ value: tag, label: `#${tag}` });
    });
  } else if (dimension === 'agent') {
    const assignees = Array.from(new Set(state.tasks.map((t) => t.claimedByAgent).filter(Boolean)));
    assignees.forEach((a) => {
      options.push({ value: a, label: a, icon: 'bot', color: 'text-blue-400' });
    });
  }

  const filteredOptions = query ? options.filter((o) => o.label.toLowerCase().includes(query)) : options;

  if (filteredOptions.length === 0) {
    filterSubOptionsList.innerHTML = `<div class="p-2 text-center text-slate-500 text-xs">No matching options</div>`;
    return;
  }

  filteredOptions.forEach((opt) => {
    const isSelected =
      (dimension === 'goal' && state.filterGoal === opt.value) ||
      (dimension === 'type' && state.filterType === opt.value) ||
      (dimension === 'priority' && state.filterPriority === opt.value) ||
      (dimension === 'tag' && state.filterTag === opt.value) ||
      (dimension === 'agent' && state.filterAgent === opt.value);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `filter-menu-item w-full flex items-center justify-between px-2 py-1.5 rounded text-left text-slate-300 hover:bg-surfaceHover hover:text-white transition ${
      isSelected ? 'bg-indigo-950/40 text-indigo-200 border border-indigo-500/30' : ''
    }`;

    let iconHtml = '';
    if (opt.icon) {
      iconHtml = `<i data-lucide="${opt.icon}" class="w-3.5 h-3.5 ${opt.color || 'text-slate-400'}"></i>`;
    }

    btn.innerHTML = `
      <span class="flex items-center gap-2 truncate">${iconHtml}<span>${escapeHtml(opt.label)}</span></span>
      ${isSelected ? '<i data-lucide="check" class="w-3.5 h-3.5 text-indigo-400 shrink-0"></i>' : ''}
    `;

    btn.onclick = (e) => {
      e.stopPropagation();
      if (isSelected) {
        if (dimension === 'goal') state.filterGoal = '';
        if (dimension === 'type') state.filterType = '';
        if (dimension === 'priority') state.filterPriority = '';
        if (dimension === 'tag') state.filterTag = '';
        if (dimension === 'agent') state.filterAgent = '';
      } else {
        if (dimension === 'goal') state.filterGoal = opt.value;
        if (dimension === 'type') state.filterType = opt.value;
        if (dimension === 'priority') state.filterPriority = opt.value;
        if (dimension === 'tag') state.filterTag = opt.value;
        if (dimension === 'agent') state.filterAgent = opt.value;
      }
      closeFilterPopover();
      renderActiveFilterChips();
      renderTasks();
    };

    filterSubOptionsList.appendChild(btn);
  });

  refreshLucideIcons();
}

document.querySelectorAll('#filterPopoverRoot [data-dimension]').forEach((btn) => {
  btn.onclick = (e) => {
    e.stopPropagation();
    const dimension = btn.getAttribute('data-dimension');
    showFilterDimensionSubmenu(dimension);
  };
});

if (btnFilterSubBack) {
  btnFilterSubBack.onclick = (e) => {
    e.stopPropagation();
    showFilterPopoverRoot();
  };
}

if (filterSubSearch) {
  filterSubSearch.oninput = (e) => {
    if (currentFilterDimension) {
      renderSubmenuOptions(currentFilterDimension, e.target.value);
    }
  };
}

// Sort Popover Menu Handlers
function openSortPopover() {
  if (!sortPopover) return;
  sortPopover.classList.remove('hidden');
  btnSortMenu?.setAttribute('aria-expanded', 'true');
  btnSortMenu?.classList.add('active');
  if (filterPopover) closeFilterPopover();
}

function closeSortPopover() {
  if (!sortPopover) return;
  sortPopover.classList.add('hidden');
  btnSortMenu?.setAttribute('aria-expanded', 'false');
  btnSortMenu?.classList.remove('active');
}

function toggleSortPopover() {
  if (sortPopover?.classList.contains('hidden')) {
    openSortPopover();
  } else {
    closeSortPopover();
  }
}

if (btnSortMenu) {
  btnSortMenu.onclick = (e) => {
    e.stopPropagation();
    toggleSortPopover();
  };
}

function updateSortMenuUI() {
  const selGrouping = document.getElementById('selViewGrouping');
  const selSubGrouping = document.getElementById('selViewSubGrouping');
  const selOrdering = document.getElementById('selViewOrdering');
  const chkRecency = document.getElementById('chkViewRecency');
  const selCompleted = document.getElementById('selViewCompleted');
  const chkShowSub = document.getElementById('chkViewShowSubIssues');
  const chkNestedSub = document.getElementById('chkViewNestedSub');
  const chkEmptyGroups = document.getElementById('chkViewEmptyGroups');

  if (selGrouping) selGrouping.value = state.viewGrouping || 'status';
  if (selSubGrouping) selSubGrouping.value = state.viewSubGrouping || 'none';
  if (selOrdering) selOrdering.value = state.viewOrdering || 'priority';
  if (chkRecency) chkRecency.checked = state.viewOrderCompletedByRecency === true;
  if (selCompleted) selCompleted.value = state.viewCompletedIssues || 'all';
  if (chkShowSub) chkShowSub.checked = state.viewShowSubIssues !== false;
  if (chkNestedSub) chkNestedSub.checked = state.viewNestedSubIssues === true;
  if (chkEmptyGroups) chkEmptyGroups.checked = state.viewShowEmptyGroups === true;

  document.querySelectorAll('#displayPropertiesContainer .display-prop-pill').forEach((btn) => {
    const prop = btn.getAttribute('data-prop');
    const isAct = state.displayProperties && state.displayProperties[prop] !== false;
    btn.classList.toggle('active', isAct);
  });

  document.querySelectorAll('.tab-preset-btn').forEach((btn) => {
    const preset = btn.getAttribute('data-preset');
    btn.classList.toggle('active', preset === state.filterPreset);
  });
}

function initViewOptionsControls() {
  const selGrouping = document.getElementById('selViewGrouping');
  const selSubGrouping = document.getElementById('selViewSubGrouping');
  const selOrdering = document.getElementById('selViewOrdering');
  const chkRecency = document.getElementById('chkViewRecency');
  const selCompleted = document.getElementById('selViewCompleted');
  const chkShowSub = document.getElementById('chkViewShowSubIssues');
  const chkNestedSub = document.getElementById('chkViewNestedSub');
  const chkEmptyGroups = document.getElementById('chkViewEmptyGroups');

  if (selGrouping) {
    selGrouping.onchange = (e) => {
      state.viewGrouping = e.target.value;
      localStorage.setItem('moo_view_grouping', state.viewGrouping);
      renderTasks();
    };
  }

  if (selSubGrouping) {
    selSubGrouping.onchange = (e) => {
      state.viewSubGrouping = e.target.value;
      localStorage.setItem('moo_view_subgrouping', state.viewSubGrouping);
      renderTasks();
    };
  }

  if (selOrdering) {
    selOrdering.onchange = (e) => {
      state.viewOrdering = e.target.value;
      state.filterSort = state.viewOrdering;
      localStorage.setItem('moo_view_ordering', state.viewOrdering);
      renderTasks();
    };
  }

  if (chkRecency) {
    chkRecency.onchange = (e) => {
      state.viewOrderCompletedByRecency = e.target.checked;
      localStorage.setItem('moo_view_recency', state.viewOrderCompletedByRecency ? 'true' : 'false');
      renderTasks();
    };
  }

  if (selCompleted) {
    selCompleted.onchange = (e) => {
      state.viewCompletedIssues = e.target.value;
      localStorage.setItem('moo_view_completed', state.viewCompletedIssues);
      renderTasks();
    };
  }

  if (chkShowSub) {
    chkShowSub.onchange = (e) => {
      state.viewShowSubIssues = e.target.checked;
      localStorage.setItem('moo_view_show_subissues', state.viewShowSubIssues ? 'true' : 'false');
      renderTasks();
    };
  }

  if (chkNestedSub) {
    chkNestedSub.onchange = (e) => {
      state.viewNestedSubIssues = e.target.checked;
      localStorage.setItem('moo_view_nested_subissues', state.viewNestedSubIssues ? 'true' : 'false');
      renderTasks();
    };
  }

  if (chkEmptyGroups) {
    chkEmptyGroups.onchange = (e) => {
      state.viewShowEmptyGroups = e.target.checked;
      localStorage.setItem('moo_view_empty_groups', state.viewShowEmptyGroups ? 'true' : 'false');
      renderTasks();
    };
  }

  // Display Properties Pills
  document.querySelectorAll('#displayPropertiesContainer .display-prop-pill').forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const prop = btn.getAttribute('data-prop');
      state.displayProperties[prop] = !state.displayProperties[prop];
      btn.classList.toggle('active', state.displayProperties[prop]);
      localStorage.setItem('moo_display_properties', JSON.stringify(state.displayProperties));
      renderTasks();
    };
  });

  // View Mode Switcher inside View Options Popover
  document.querySelectorAll('#viewOptModeSwitcher .view-opt-tab').forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const mode = btn.getAttribute('data-mode');
      setViewMode(mode);
      document.querySelectorAll('#viewOptModeSwitcher .view-opt-tab').forEach((b) => b.classList.toggle('active', b.getAttribute('data-mode') === mode));
    };
  });

  // Subheader Presets
  document.querySelectorAll('.tab-preset-btn').forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll('.tab-preset-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.filterPreset = btn.getAttribute('data-preset') || 'all';
      renderTasks();
    };
  });

  // Add filter chip button (+)
  const btnAddChip = document.getElementById('btnAddFilterChip');
  if (btnAddChip) {
    btnAddChip.onclick = (e) => {
      e.stopPropagation();
      openFilterPopover();
    };
  }
}

initViewOptionsControls();

// Close popovers when clicking outside
document.addEventListener('click', (e) => {
  if (filterPopover && !filterPopover.classList.contains('hidden')) {
    if (!document.getElementById('filterMenuContainer')?.contains(e.target)) {
      closeFilterPopover();
    }
  }
  if (sortPopover && !sortPopover.classList.contains('hidden')) {
    if (!document.getElementById('sortMenuContainer')?.contains(e.target)) {
      closeSortPopover();
    }
  }
});

if (filterSearch) {
  filterSearch.oninput = (e) => {
    state.filterSearch = e.target.value;
    renderTasks();
  };
}

// Batch Actions Logic
window.toggleTaskSelection = (taskId, isSelected) => {
  if (isSelected) {
    state.selectedTaskIds.add(taskId);
  } else {
    state.selectedTaskIds.delete(taskId);
  }
  updateBatchActionBar();
};

window.clearTaskSelection = () => {
  state.selectedTaskIds.clear();
  updateBatchActionBar();
  renderTasks();
};

function updateBatchActionBar() {
  if (!batchActionBar || !batchSelectedCount) return;
  const count = state.selectedTaskIds.size;
  batchSelectedCount.textContent = count;
  if (count > 0) {
    batchActionBar.classList.remove('hidden');
  } else {
    batchActionBar.classList.add('hidden');
  }
}

window.handleBatchStatusChange = async (newStatus) => {
  if (!newStatus || state.selectedTaskIds.size === 0) return;
  const taskIds = Array.from(state.selectedTaskIds);
  showToast(`Updating ${taskIds.length} issues to ${newStatus}...`, 'info');
  try {
    const res = await fetch('/api/tasks/bulk/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskIds,
        updates: { status: newStatus, authorId: 'human-batch' },
      }),
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Updated ${taskIds.length} issues to ${newStatus}`, 'success');
    } else {
      showToast(`Failed to batch update: ${data.error || 'Unknown error'}`, 'error');
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
  clearTaskSelection();
  refreshAll();
};

window.handleBatchPriorityChange = async (newPriority) => {
  if (!newPriority || state.selectedTaskIds.size === 0) return;
  const taskIds = Array.from(state.selectedTaskIds);
  showToast(`Setting priority for ${taskIds.length} issues...`, 'info');
  try {
    const res = await fetch('/api/tasks/bulk/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskIds,
        updates: { priority: newPriority },
      }),
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Updated priority for ${taskIds.length} issues`, 'success');
    } else {
      showToast(`Failed to batch update priority: ${data.error || 'Unknown error'}`, 'error');
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
  clearTaskSelection();
  refreshAll();
};

window.toggleBoardColumn = (colStatus) => {
  if (state.collapsedColumns.has(colStatus)) {
    state.collapsedColumns.delete(colStatus);
  } else {
    state.collapsedColumns.add(colStatus);
  }
  localStorage.setItem('moo_collapsed_columns', JSON.stringify(Array.from(state.collapsedColumns)));
  renderTasks();
};

function renderGoalFilters() {
  const inputTaskGoal = document.getElementById('inputTaskGoal');
  if (inputTaskGoal) {
    const curVal = inputTaskGoal.value;
    inputTaskGoal.innerHTML = '<option value="">(None / Standalone)</option>';
    state.goals.forEach((item) => {
      const g = item.goal;
      const opt = document.createElement('option');
      opt.value = g.id;
      opt.textContent = g.title;
      inputTaskGoal.appendChild(opt);
    });
    inputTaskGoal.value = curVal;
  }
  renderActiveFilterChips();
}

function updateAssigneeFilter() {
  renderActiveFilterChips();
}

function updateTagFilter() {
  renderActiveFilterChips();
}

window.filterByTag = (tag) => {
  state.filterTag = tag;
  renderActiveFilterChips();
  renderTasks();
};

function getTypeBadge(type) {
  const t = type || 'feature';
  switch (t) {
    case 'feature':
      return `<span class="type-badge type-feature" title="Feature"><i data-lucide="sparkles" class="w-3 h-3"></i><span>feat</span></span>`;
    case 'bug':
      return `<span class="type-badge type-bug" title="Bug"><i data-lucide="bug" class="w-3 h-3"></i><span>bug</span></span>`;
    case 'refactor':
      return `<span class="type-badge type-refactor" title="Refactor"><i data-lucide="refresh-cw" class="w-3 h-3"></i><span>refactor</span></span>`;
    case 'test':
      return `<span class="type-badge type-test" title="Test"><i data-lucide="flask-conical" class="w-3 h-3"></i><span>test</span></span>`;
    case 'docs':
      return `<span class="type-badge type-docs" title="Docs"><i data-lucide="book-open" class="w-3 h-3"></i><span>docs</span></span>`;
    case 'chore':
      return `<span class="type-badge type-chore" title="Chore"><i data-lucide="wrench" class="w-3 h-3"></i><span>chore</span></span>`;
    case 'spike':
      return `<span class="type-badge type-spike" title="Spike"><i data-lucide="zap" class="w-3 h-3"></i><span>spike</span></span>`;
    case 'security':
      return `<span class="type-badge type-security" title="Security"><i data-lucide="shield-alert" class="w-3 h-3"></i><span>sec</span></span>`;
    default:
      return `<span class="type-badge type-feature"><i data-lucide="tag" class="w-3 h-3"></i><span>${t}</span></span>`;
  }
}



function updateSidebarCounters() {
  const activeTasks = state.tasks.filter((t) => !t.isArchived);
  if (navCounterTotal) navCounterTotal.textContent = activeTasks.length;

  const humanWaiting = state.tasks.filter((t) => t.status === 'waiting-on-human' && !t.isArchived);
  if (navCounterHuman) {
    navCounterHuman.textContent = humanWaiting.length;
    navCounterHuman.classList.toggle('hidden', humanWaiting.length === 0);
  }

  const badgeHuman = document.getElementById('mobileNavBadgeHuman');
  if (badgeHuman) {
    badgeHuman.textContent = humanWaiting.length;
    badgeHuman.classList.toggle('hidden', humanWaiting.length === 0);
  }

  const reviewTasks = state.tasks.filter(
    (t) => (t.status === 'done' && t.verificationState === 'agent_completed') || t.status === 'dropped'
  );
  if (navCounterReview) {
    navCounterReview.textContent = reviewTasks.length;
    navCounterReview.classList.toggle('hidden', reviewTasks.length === 0);
  }
}

// Priority Signal Bar Helper (Signal strength 3-bar indicator & urgent exclamation icon)
function getPrioritySignal(priority) {
  const p = (priority || '').toLowerCase();
  if (p === 'critical' || p === 'urgent') {
    return `<div class="priority-signal urgent" title="${p === 'critical' ? 'Critical' : 'Urgent'}"><svg class="w-3.5 h-3.5 text-amber-500" viewBox="0 0 16 16" fill="none"><rect x="1.5" y="1.5" width="13" height="13" rx="3" stroke="currentColor" stroke-width="1.5"/><path d="M8 4.5V8.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="11.25" r="0.75" fill="currentColor"/></svg></div>`;
  }
  if (p === 'high') {
    return `<div class="priority-signal high" title="High"><span class="priority-signal-bar bar-1 filled"></span><span class="priority-signal-bar bar-2 filled"></span><span class="priority-signal-bar bar-3 filled"></span></div>`;
  }
  if (p === 'medium') {
    return `<div class="priority-signal medium" title="Medium"><span class="priority-signal-bar bar-1 filled"></span><span class="priority-signal-bar bar-2 filled"></span><span class="priority-signal-bar bar-3"></span></div>`;
  }
  if (p === 'low') {
    return `<div class="priority-signal low" title="Low"><span class="priority-signal-bar bar-1 filled"></span><span class="priority-signal-bar bar-2"></span><span class="priority-signal-bar bar-3"></span></div>`;
  }
  return `<span class="priority-none text-slate-600 font-mono text-xs tracking-tighter" title="No priority">---</span>`;
}
const getPriorityIcon = getPrioritySignal;

// Status Icon Helper (Backlog dotted circle, Todo circle, Doing pie, Done check)
function getStatusIcon(status, isBacklog) {
  if (isBacklog || status === 'dropped') {
    return `<svg class="w-3.5 h-3.5 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 3"><circle cx="12" cy="12" r="9"/></svg>`;
  }
  if (status === 'doing') {
    return `<svg class="w-3.5 h-3.5 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 9 9h-9z" fill="currentColor"/></svg>`;
  }
  if (status === 'done') {
    return `<svg class="w-3.5 h-3.5 text-emerald-500" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>`;
  }
  return `<svg class="w-3.5 h-3.5 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/></svg>`;
}

// Colored Dot Tag Badge Helper
function getTagDotColor(tag) {
  const t = (tag || '').toLowerCase();
  if (t === 'api' || t === 'bug' || t === 'security') return '#ef4444';
  if (t === 'backend') return '#06b6d4';
  if (t === 'feature') return '#a855f7';
  if (t === 'melonade') return '#ec4899';
  if (t === 'android') return '#6b7280';
  if (t === 'frontend' || t === 'ui') return '#3b82f6';
  return '#8b5cf6';
}

function renderTagBadges(tags) {
  if (!tags || tags.length === 0) return '';
  return tags
    .map((tag) => {
      const color = getTagDotColor(tag);
      return `
        <span class="tag-badge">
          <span class="tag-badge-dot" style="background-color: ${color}"></span>
          <span>${escapeHtml(tag)}</span>
        </span>
      `;
    })
    .join('');
}
const renderTagPills = renderTagBadges;

// Hexagon Project Badge Helper
function renderProjectBadge(goal) {
  if (!goal) return '';
  return `
    <span class="project-badge">
      <svg class="w-3 h-3 text-slate-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <polygon points="12 2 21 7 21 17 12 22 3 17 3 7 12 2"/>
      </svg>
      <span class="truncate max-w-[150px]">${escapeHtml(goal.title)}</span>
    </span>
  `;
}

// Title Formatter with Inline Code Highlight
function formatTitleWithCode(title) {
  if (!title) return '';
  let escaped = escapeHtml(title);
  escaped = escaped.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
  escaped = escaped.replace(/(tenant-id\/[a-zA-Z0-9_\-\.]+)/g, '<code class="inline-code">$1</code>');
  return escaped;
}

// Date Formatter (e.g. Jul 28 or Nov 2025)
function formatIssueDate(dateStr) {
  if (!dateStr) return 'Nov 2025';
  const d = new Date(dateStr);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[d.getMonth()] || 'Jul';
  const day = d.getDate();
  const year = d.getFullYear();
  if (year < 2026) {
    return `${month} ${year}`;
  }
  return `${month} ${day}`;
}

// Dynamic Agent Avatar Color Palette & Generator
function getAgentColor(agentName) {
  if (!agentName) return { bg: '#1c1e24', text: '#94a3b8', border: '#2e333d' };
  const palette = [
    { bg: '#3b82f6', text: '#ffffff', border: '#60a5fa' }, // Blue
    { bg: '#6366f1', text: '#ffffff', border: '#818cf8' }, // Indigo
    { bg: '#8b5cf6', text: '#ffffff', border: '#a78bfa' }, // Purple
    { bg: '#ec4899', text: '#ffffff', border: '#f472b6' }, // Pink
    { bg: '#10b981', text: '#ffffff', border: '#34d399' }, // Emerald
    { bg: '#06b6d4', text: '#ffffff', border: '#22d3ee' }, // Cyan
    { bg: '#f59e0b', text: '#ffffff', border: '#fbbf24' }, // Amber
    { bg: '#f43f5e', text: '#ffffff', border: '#fb7185' }, // Rose
    { bg: '#14b8a6', text: '#ffffff', border: '#2dd4bf' }, // Teal
  ];
  let hash = 0;
  for (let i = 0; i < agentName.length; i++) {
    hash = agentName.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % palette.length;
  return palette[index];
}

// Avatar Initials Helper
function getAvatarInitials(claimedBy) {
  if (!claimedBy) return '';
  const clean = claimedBy.replace(/[^a-zA-Z0-9\s-_]/g, '').trim();
  if (!clean) return 'AG';
  const parts = clean.split(/[\s\-_]+/);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase();
}

// Render Dynamic Assignee / Agent Avatar Component
function renderAgentAvatar(claimedBy, size = 'md') {
  const isSm = size === 'sm';
  const sizeClasses = isSm ? 'w-4 h-4 text-[8.5px]' : 'w-5 h-5 text-[9.5px]';
  if (!claimedBy) {
    return `
      <div class="avatar-circle avatar-unassigned ${sizeClasses}" title="Unassigned — Click to assign agent">
        <svg class="${isSm ? 'w-2.5 h-2.5' : 'w-3 h-3'} text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="8" r="4"/>
          <path d="M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/>
        </svg>
      </div>
    `;
  }
  const color = getAgentColor(claimedBy);
  const initials = getAvatarInitials(claimedBy);
  return `
    <div class="avatar-circle ${sizeClasses}" style="background-color: ${color.bg}; border-color: ${color.border}; color: ${color.text};" title="Assigned Agent: @${escapeHtml(claimedBy)}">
      ${initials}
    </div>
  `;
}

// Issue Key Short Code Formatter (e.g. MO-101, SH-123)
function formatIssueKey(id, task) {
  const prefix = state.projectShortCode || 'MO';
  const targetTask = task || (state.tasks && state.tasks.find((t) => t.id === id));
  if (targetTask && targetTask.orderIndex) {
    return `${prefix}-${targetTask.orderIndex}`;
  }
  if (!id) return `${prefix}-1`;
  if (id.startsWith(`${prefix}-`)) return id;
  const match = String(id).match(/^(?:[A-Za-z]{2,}-)?(\d+)$/);
  if (match) {
    return `${prefix}-${match[1]}`;
  }
  if (id.startsWith('task-')) {
    if (state.tasks && state.tasks.length > 0) {
      const idx = state.tasks.findIndex((t) => t.id === id);
      if (idx !== -1) {
        return `${prefix}-${idx + 1}`;
      }
    }
    const hex = id.replace('task-', '');
    const num = parseInt(hex.slice(0, 4), 16);
    if (!isNaN(num)) {
      return `${prefix}-${(num % 900) + 100}`;
    }
  }
  return id;
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

// Render Tasks (List, Board, Graph)
function renderTasks() {
  renderActiveFilterChips();
  updateSortMenuUI();
  const filtered = getFilteredTasks();
  if (displayCountLabel) displayCountLabel.textContent = `${filtered.length} issues`;

  // Dynamically compute the maximum key width across all tasks for perfect column alignment
  let maxKeyLen = 4;
  (state.tasks || []).forEach((t) => {
    const key = formatIssueKey(t.id, t);
    if (key && key.length > maxKeyLen) {
      maxKeyLen = key.length;
    }
  });
  document.documentElement.style.setProperty('--task-key-width', `${maxKeyLen + 0.5}ch`);

  if (state.viewMode === 'list') {
    renderListView(filtered);
  } else if (state.viewMode === 'board') {
    renderBoardView(filtered);
  } else if (state.viewMode === 'graph') {
    renderGraphView(filtered);
  }
  refreshLucideIcons();
}

// Group Collapse Toggle Handler
window.toggleGroupCollapse = (groupId) => {
  if (state.collapsedGroups.has(groupId)) {
    state.collapsedGroups.delete(groupId);
  } else {
    state.collapsedGroups.add(groupId);
  }
  renderTasks();
};

window.grpAddHandler = (groupId) => {
  if (modalCreateTask) {
    modalCreateTask.classList.remove('hidden');
    const chk = document.getElementById('inputTaskDeferred');
    if (chk) chk.checked = groupId === 'backlog';
    refreshLucideIcons();
  }
};

// Sub-Issue Progress Pill Helper (e.g. ⭕ 0/8)
function getSubissueProgressPill(task) {
  if (state.viewShowSubIssues === false) return '';
  const totalSubtasks = (task.dependsOnTaskIds && task.dependsOnTaskIds.length > 0) ? task.dependsOnTaskIds.length : 0;
  if (totalSubtasks === 0) return '';
  const doneSubtasks = task.dependsOnTaskIds.filter((id) => {
    const dep = state.tasks.find((t) => t.id === id);
    return dep && dep.status === 'done';
  }).length;
  return `
    <span class="subissue-progress-pill ml-1.5" title="${doneSubtasks}/${totalSubtasks} subtasks completed">
      <svg class="w-3 h-3 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="8"/></svg>
      <span>${doneSubtasks}/${totalSubtasks}</span>
    </span>
  `;
}

// Dynamic Grouping Generator
function getTaskGroups(tasks) {
  const grouping = state.viewGrouping || 'status';
  const showEmpty = state.viewShowEmptyGroups === true;
  const groups = [];

  if (grouping === 'status') {
    const backlogTasks = tasks.filter((t) => t.isDeferred || t.status === 'backlog');
    const nonBacklog = tasks.filter((t) => !t.isDeferred && t.status !== 'backlog');

    const doingTasks = nonBacklog.filter((t) => t.status === 'doing');
    const todoTasks = nonBacklog.filter((t) => t.status === 'todo');
    const blockedTasks = nonBacklog.filter((t) => t.status === 'blocked-on-dependency');
    const waitingTasks = nonBacklog.filter((t) => t.status === 'waiting-on-human');
    const doneTasks = nonBacklog.filter((t) => t.status === 'done');
    const droppedTasks = nonBacklog.filter((t) => t.status === 'dropped');

    // In Progress
    if (doingTasks.length > 0 || (showEmpty && state.filterPreset !== 'backlog')) {
      groups.push({
        id: 'doing',
        title: 'In Progress',
        count: doingTasks.length,
        icon: `<svg class="w-3.5 h-3.5 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 9 9h-9z" fill="currentColor"/></svg>`,
        tasks: doingTasks,
        showAdd: false,
      });
    }

    // Todo
    if (todoTasks.length > 0 || (showEmpty && state.filterPreset !== 'backlog') || (state.filterPreset === 'active' && doingTasks.length === 0 && blockedTasks.length === 0 && waitingTasks.length === 0)) {
      groups.push({
        id: 'todo',
        title: 'Todo',
        count: todoTasks.length,
        icon: `<svg class="w-3.5 h-3.5 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/></svg>`,
        tasks: todoTasks,
        showAdd: true,
      });
    }

    // Blocked
    if (blockedTasks.length > 0 || (showEmpty && state.filterPreset !== 'backlog')) {
      groups.push({
        id: 'blocked',
        title: 'Blocked',
        count: blockedTasks.length,
        icon: `<svg class="w-3.5 h-3.5 text-rose-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>`,
        tasks: blockedTasks,
        showAdd: false,
      });
    }

    // Needs Human
    if (waitingTasks.length > 0 || (showEmpty && state.filterPreset !== 'backlog')) {
      groups.push({
        id: 'waiting',
        title: 'Needs Human',
        count: waitingTasks.length,
        icon: `<i data-lucide="inbox" class="w-3.5 h-3.5 text-purple-400"></i>`,
        tasks: waitingTasks,
        showAdd: false,
      });
    }

    // Backlog
    if (backlogTasks.length > 0 || showEmpty || state.filterPreset === 'backlog') {
      groups.push({
        id: 'backlog',
        title: 'Backlog',
        count: backlogTasks.length,
        icon: `<svg class="w-3.5 h-3.5 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 3"><circle cx="12" cy="12" r="9"/></svg>`,
        tasks: backlogTasks,
        showAdd: true,
      });
    }

    // Done
    if ((doneTasks.length > 0 || (showEmpty && state.filterPreset === 'all')) && state.filterPreset !== 'active' && state.filterPreset !== 'backlog') {
      groups.push({
        id: 'done',
        title: 'Done',
        count: doneTasks.length,
        icon: `<svg class="w-3.5 h-3.5 text-emerald-500" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>`,
        tasks: doneTasks,
        showAdd: false,
      });
    }

    // Dropped
    if (droppedTasks.length > 0 && state.filterPreset === 'all') {
      groups.push({
        id: 'dropped',
        title: 'Dropped',
        count: droppedTasks.length,
        icon: `<svg class="w-3.5 h-3.5 text-slate-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
        tasks: droppedTasks,
        showAdd: false,
      });
    }
  } else if (grouping === 'priority') {
    const priorities = [
      { id: 'critical', title: 'Critical / Urgent', icon: `<span class="priority-signal critical"><span class="priority-signal-bar bar-1 filled"></span><span class="priority-signal-bar bar-2 filled"></span><span class="priority-signal-bar bar-3 filled"></span></span>` },
      { id: 'high', title: 'High Priority', icon: `<span class="priority-signal high"><span class="priority-signal-bar bar-1 filled"></span><span class="priority-signal-bar bar-2 filled"></span><span class="priority-signal-bar bar-3 filled"></span></span>` },
      { id: 'medium', title: 'Medium Priority', icon: `<span class="priority-signal medium"><span class="priority-signal-bar bar-1 filled"></span><span class="priority-signal-bar bar-2 filled"></span><span class="priority-signal-bar bar-3"></span></span>` },
      { id: 'low', title: 'Low Priority', icon: `<span class="priority-signal low"><span class="priority-signal-bar bar-1 filled"></span><span class="priority-signal-bar bar-2"></span><span class="priority-signal-bar bar-3"></span></span>` },
    ];
    priorities.forEach((p) => {
      const pTasks = tasks.filter((t) => t.priority === p.id);
      if (pTasks.length > 0 || showEmpty) {
        groups.push({
          id: `p-${p.id}`,
          title: p.title,
          count: pTasks.length,
          icon: p.icon,
          tasks: pTasks,
          showAdd: true,
        });
      }
    });
  } else if (grouping === 'agent') {
    const agentMap = new Map();
    tasks.forEach((t) => {
      const a = t.claimedByAgent || 'Unassigned';
      if (!agentMap.has(a)) agentMap.set(a, []);
      agentMap.get(a).push(t);
    });
    if (showEmpty && !agentMap.has('Unassigned')) agentMap.set('Unassigned', []);
    agentMap.forEach((aTasks, agent) => {
      groups.push({
        id: `agent-${agent}`,
        title: agent === 'Unassigned' ? 'Unassigned' : `@${agent}`,
        count: aTasks.length,
        icon: renderAgentAvatar(agent === 'Unassigned' ? null : agent, 'sm'),
        tasks: aTasks,
        showAdd: true,
      });
    });
  } else if (grouping === 'type') {
    const types = ['feature', 'bug', 'refactor', 'test', 'docs', 'chore', 'spike', 'security'];
    types.forEach((tp) => {
      const tTasks = tasks.filter((t) => (t.type || 'feature') === tp);
      if (tTasks.length > 0 || showEmpty) {
        groups.push({
          id: `type-${tp}`,
          title: tp.charAt(0).toUpperCase() + tp.slice(1),
          count: tTasks.length,
          icon: getTypeBadge(tp),
          tasks: tTasks,
          showAdd: true,
        });
      }
    });
  } else if (grouping === 'goal') {
    const goalMap = new Map();
    state.goals.forEach((g) => goalMap.set(g.goal.id, { title: g.goal.title, tasks: [] }));
    goalMap.set('__no_goal__', { title: 'No Goal / Scope Drift', tasks: [] });
    tasks.forEach((t) => {
      const gid = t.goalId || '__no_goal__';
      if (!goalMap.has(gid)) goalMap.set(gid, { title: gid, tasks: [] });
      goalMap.get(gid).tasks.push(t);
    });
    goalMap.forEach((val, gid) => {
      if (val.tasks.length > 0 || showEmpty) {
        groups.push({
          id: `goal-${gid}`,
          title: val.title,
          count: val.tasks.length,
          icon: `<i data-lucide="target" class="w-3.5 h-3.5 text-indigo-400"></i>`,
          tasks: val.tasks,
          showAdd: true,
        });
      }
    });
  } else {
    // None / Flat List
    groups.push({
      id: 'all',
      title: 'All Issues',
      count: tasks.length,
      icon: `<i data-lucide="layers" class="w-3.5 h-3.5 text-slate-400"></i>`,
      tasks: tasks,
      showAdd: true,
    });
  }

  return groups;
}

// Mode 1: List View (Exact OpenReplay Layout with View Options)
function renderListView(tasks) {
  if (!tasksListView) return;
  tasksListView.innerHTML = '';

  const groups = getTaskGroups(tasks);
  const dp = state.displayProperties || {};

  groups.forEach((grp) => {
    const isCollapsed = state.collapsedGroups && state.collapsedGroups.has(grp.id);
    const groupEl = document.createElement('div');
    groupEl.className = 'issue-group';

    groupEl.innerHTML = `
      <div class="issue-group-header" onclick="toggleGroupCollapse('${grp.id}')">
        <div class="issue-group-left">
          <span class="issue-group-toggle">
            <svg class="w-3 h-3 transition-transform ${isCollapsed ? '-rotate-90' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
          </span>
          ${grp.icon || ''}
          <span class="issue-group-title">${grp.title}</span>
          <span class="issue-group-count">${grp.tasks.length}</span>
          ${grp.dateRange ? `<span class="issue-group-date-range">${grp.dateRange}</span>` : ''}
        </div>
        ${grp.showAdd ? `
          <button class="issue-group-add-btn" onclick="event.stopPropagation(); grpAddHandler('${grp.id}')" title="Add issue to ${grp.title}">
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
        ` : ''}
      </div>
      <div class="issue-group-rows ${isCollapsed ? 'hidden' : ''}"></div>
    `;

    const rowsContainer = groupEl.querySelector('.issue-group-rows');

    if (grp.tasks.length === 0) {
      const emptyRow = document.createElement('div');
      emptyRow.className = 'px-8 py-6 text-xs text-slate-500 flex items-center justify-between border-b border-borderSubtle/50';
      emptyRow.innerHTML = `
        <span class="italic">No issues in ${grp.title.toLowerCase()}</span>
        ${grp.showAdd ? `
          <button class="flex items-center gap-1.5 px-2.5 py-1 rounded bg-surface hover:bg-surfaceHover border border-borderDefault text-slate-300 text-xs transition" onclick="event.stopPropagation(); grpAddHandler('${grp.id}')">
            <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            <span>Add issue</span>
          </button>
        ` : ''}
      `;
      rowsContainer.appendChild(emptyRow);
    } else {
      grp.tasks.forEach((task) => {
        const row = document.createElement('div');
        row.className = 'issue-row';
        row.setAttribute('data-id', task.id);

        const goal = state.goals.find((g) => g.goal.id === task.goalId)?.goal;
        const isBacklog = grp.id === 'backlog' || task.isDeferred;

        const showPriority = dp.priority !== false;
        const showId = dp.id !== false;
        const showStatus = dp.status !== false;
        const showProject = dp.project !== false;
        const showLabels = dp.labels !== false;
        const showAssignee = dp.assignee !== false;
        const showDate = dp.updated !== false || dp.created !== false;

        row.innerHTML = `
          <div class="issue-row-left">
            ${showPriority ? `<div class="issue-priority-icon">${getPrioritySignal(task.priority)}</div>` : ''}
            ${showId ? `<span class="issue-key">${formatIssueKey(task.id)}</span>` : ''}
            ${showStatus ? `<div class="issue-status-icon">${getStatusIcon(task.status, isBacklog)}</div>` : ''}
            <div class="issue-title-container">
              <span class="issue-title-text">${formatTitleWithCode(task.title)}</span>
              ${showProject && goal ? `<span class="issue-breadcrumb">› ${escapeHtml(goal.title)}</span>` : ''}
            </div>
            ${getSubissueProgressPill(task)}
          </div>
          <div class="issue-row-right">
            ${showLabels ? renderTagBadges(task.tags) : ''}
            ${showProject && goal ? renderProjectBadge(goal) : ''}
            ${showAssignee ? renderAgentAvatar(task.claimedByAgent) : ''}
            ${showDate ? `<span class="issue-date">${formatIssueDate(dp.created ? task.createdAt : (task.lastStateChangeAt || task.createdAt))}</span>` : ''}
          </div>
        `;

        row.onclick = () => openInspector(task.id);
        rowsContainer.appendChild(row);
      });
    }

    tasksListView.appendChild(groupEl);
  });
}

// Mode 2: Board View with Drag & Drop & Collapsible Columns
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
    const isCollapsed = state.collapsedColumns.has(col.status);

    const colEl = document.createElement('div');
    colEl.className = `board-column ${isCollapsed ? 'collapsed' : ''}`;
    colEl.setAttribute('data-col-status', col.status);

    if (isCollapsed) {
      colEl.onclick = () => toggleBoardColumn(col.status);
    }

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
      <div class="board-column-header" title="${isCollapsed ? 'Click to expand' : ''}">
        <div class="flex items-center gap-2">
          <span class="status-dot ${cfg.class}"></span>
          <span>${col.label}</span>
        </div>
        <div class="flex items-center gap-1.5">
          <span class="font-mono text-slate-500 text-[10px]">${colTasks.length}</span>
          <button class="board-column-collapse-btn" onclick="event.stopPropagation(); toggleBoardColumn('${col.status}')" title="${isCollapsed ? 'Expand column' : 'Collapse column'}">
            <i data-lucide="${isCollapsed ? 'chevron-right' : 'chevron-left'}" class="w-3.5 h-3.5"></i>
          </button>
        </div>
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
      const hasActiveLease = task.status === 'doing' && task.leaseExpiresAt && new Date(task.leaseExpiresAt) > new Date();

      card.innerHTML = `
        <div class="board-card-header">
          <div class="flex items-center gap-1 font-mono text-[11px] text-slate-500">
            <span>${formatIssueKey(task.id)}</span>
            ${isStalled ? `<i data-lucide="alert-triangle" class="w-3 h-3 text-amber-400" title="Stalled"></i>` : ''}
          </div>
          <div class="flex items-center gap-1.5">
            ${getTypeBadge(task.type)}
            ${getPrioritySignal(task.priority)}
          </div>
        </div>
        <div class="board-card-title">${task.title}</div>
        ${task.tags && task.tags.length > 0 ? `<div class="flex items-center gap-1 flex-wrap mb-2">${renderTagBadges(task.tags)}</div>` : ''}
        ${hasActiveLease ? `
          <div class="mb-2">
            <span class="lease-countdown-badge" data-lease-expires="${task.leaseExpiresAt}" title="Active agent lease">
              <span class="lease-pulse-dot"></span>
              <span class="lease-text">${formatLeaseRemaining(task.leaseExpiresAt)}</span>
            </span>
          </div>
        ` : ''}
        <div class="board-card-footer">
          <div class="flex items-center gap-1.5 min-w-0">
            ${renderAgentAvatar(task.claimedByAgent, 'sm')}
            ${task.claimedByAgent ? `<span class="text-indigo-300 font-mono text-[10.5px] truncate">@${escapeHtml(task.claimedByAgent)}</span>` : `<span class="text-slate-500 text-[10px]">Unassigned</span>`}
          </div>
          <span class="text-slate-500 text-[10px] font-mono shrink-0">${formatRelativeTime(task.lastStateChangeAt)}</span>
        </div>
      `;

      card.onclick = () => openInspector(task.id);
      cardsContainer.appendChild(card);
    });

    tasksBoardView.appendChild(colEl);
  });
}

// Mode 3: Interactive Dependency DAG Graph View
async function renderGraphView(tasks) {
  if (!tasksGraphView) return;
  tasksGraphView.innerHTML = '';

  if (tasks.length === 0) {
    tasksGraphView.innerHTML = `
      <div class="flex flex-col items-center justify-center py-20 text-slate-500">
        <i data-lucide="git-fork" class="w-12 h-12 text-slate-600 mb-3"></i>
        <div class="text-sm font-medium text-slate-400">No issues to display in Dependency Graph</div>
        <div class="text-xs text-slate-600 mt-1">Create issues and link dependencies to view workflow DAG</div>
      </div>
    `;
    refreshLucideIcons();
    return;
  }

  // Header Bar with Legend and Stats
  const header = document.createElement('div');
  header.className = 'flex items-center justify-between pb-3 border-b border-borderSubtle mb-4 select-none';
  header.innerHTML = `
    <div class="flex items-center gap-4 text-xs">
      <span class="font-semibold text-slate-200 flex items-center gap-1.5 font-mono">
        <i data-lucide="network" class="w-4 h-4 text-indigo-400"></i> WORKFLOW DAG
      </span>
      <span class="text-slate-500 font-mono text-[11px]">${tasks.length} Nodes</span>
    </div>
    <div class="flex items-center gap-3 text-[11px] text-slate-400 font-mono">
      <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-emerald-500"></span> Done</span>
      <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-indigo-500"></span> In Progress</span>
      <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-purple-500"></span> Needs Human</span>
      <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-amber-500"></span> Todo</span>
      <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-red-500"></span> Blocked</span>
    </div>
  `;
  tasksGraphView.appendChild(header);

  // Fetch dependencies for all visible tasks
  const taskMap = new Map();
  tasks.forEach((t) => taskMap.set(t.id, t));

  // Build edges
  const edges = [];
  const inDegree = new Map();
  tasks.forEach((t) => {
    inDegree.set(t.id, 0);
  });

  // Query dependency links from server or task fields
  try {
    const depsRes = await fetch('/api/tasks');
    const depsData = await depsRes.json();
    const allTasks = depsData.tasks || [];
    
    for (const t of allTasks) {
      if (t.dependsOnTaskIds && Array.isArray(t.dependsOnTaskIds)) {
        for (const depId of t.dependsOnTaskIds) {
          if (taskMap.has(depId) && taskMap.has(t.id)) {
            edges.push({ from: depId, to: t.id });
            inDegree.set(t.id, (inDegree.get(t.id) || 0) + 1);
          }
        }
      }
    }
  } catch {
    // fallback
  }

  // Calculate topological depth layers
  const depth = new Map();
  const queue = [];
  tasks.forEach((t) => {
    if ((inDegree.get(t.id) || 0) === 0) {
      depth.set(t.id, 0);
      queue.push(t.id);
    }
  });

  while (queue.length > 0) {
    const currentId = queue.shift();
    const currDepth = depth.get(currentId) || 0;
    const outgoing = edges.filter((e) => e.from === currentId);
    for (const edge of outgoing) {
      const nextDepth = Math.max(depth.get(edge.to) || 0, currDepth + 1);
      depth.set(edge.to, nextDepth);
      queue.push(edge.to);
    }
  }

  // Group into layers
  const layers = new Map();
  let maxDepth = 0;
  tasks.forEach((t) => {
    const d = depth.get(t.id) || 0;
    maxDepth = Math.max(maxDepth, d);
    if (!layers.has(d)) layers.set(d, []);
    layers.get(d).push(t);
  });

  // Graph Canvas Area
  const canvasWrapper = document.createElement('div');
  canvasWrapper.className = 'relative flex-1 overflow-auto w-full min-h-[480px] p-4 bg-app/60 rounded-lg border border-borderSubtle';

  const nodeWidth = 240;
  const nodeHeight = 84;
  const gapX = 100;
  const gapY = 32;

  const nodePositions = new Map(); // id -> { x, y, cx, cy }
  let maxColHeight = 0;

  for (let col = 0; col <= maxDepth; col++) {
    const colTasks = layers.get(col) || [];
    const colX = 30 + col * (nodeWidth + gapX);
    colTasks.forEach((t, row) => {
      const colY = 30 + row * (nodeHeight + gapY);
      nodePositions.set(t.id, {
        x: colX,
        y: colY,
        cx: colX + nodeWidth,
        cy: colY + nodeHeight / 2,
        inX: colX,
        inY: colY + nodeHeight / 2,
      });
      maxColHeight = Math.max(maxColHeight, colY + nodeHeight + 40);
    });
  }

  const canvasWidth = Math.max(900, 30 + (maxDepth + 1) * (nodeWidth + gapX) + 60);
  const canvasHeight = Math.max(500, maxColHeight + 60);

  // SVG Layer for Bezier Arrows
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', `${canvasWidth}`);
  svg.setAttribute('height', `${canvasHeight}`);
  svg.style.position = 'absolute';
  svg.style.top = '0';
  svg.style.left = '0';
  svg.style.pointerEvents = 'none';
  svg.style.zIndex = '1';

  svg.innerHTML = `
    <defs>
      <marker id="dag-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 1 L 10 5 L 0 9 z" fill="#5e6ad2" />
      </marker>
    </defs>
  `;

  edges.forEach((edge) => {
    const fromPos = nodePositions.get(edge.from);
    const toPos = nodePositions.get(edge.to);
    if (!fromPos || !toPos) return;

    const startX = fromPos.cx;
    const startY = fromPos.cy;
    const endX = toPos.inX;
    const endY = toPos.inY;
    const dx = Math.max(40, (endX - startX) / 2);

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute(
      'd',
      `M ${startX} ${startY} C ${startX + dx} ${startY}, ${endX - dx} ${endY}, ${endX} ${endY}`
    );
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', '#5e6ad2');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-dasharray', 'none');
    path.setAttribute('marker-end', 'url(#dag-arrow)');
    svg.appendChild(path);
  });

  canvasWrapper.appendChild(svg);

  // HTML Node Cards Layer
  tasks.forEach((task) => {
    const pos = nodePositions.get(task.id);
    if (!pos) return;

    const cfg = statusConfig[task.status] || { label: task.status, class: 'todo' };
    const priorityColor =
      task.priority === 'critical'
        ? 'text-red-400 bg-red-500/10 border-red-500/30'
        : task.priority === 'high'
        ? 'text-amber-400 bg-amber-500/10 border-amber-500/30'
        : 'text-slate-400 bg-slate-500/10 border-slate-500/30';

    const card = document.createElement('div');
    card.className =
      'absolute bg-surface border border-borderDefault hover:border-indigo-500/70 transition-all rounded-lg p-2.5 cursor-pointer shadow-lg hover:shadow-indigo-500/10 flex flex-col justify-between select-none group';
    card.style.left = `${pos.x}px`;
    card.style.top = `${pos.y}px`;
    card.style.width = `${nodeWidth}px`;
    card.style.height = `${nodeHeight}px`;
    card.style.zIndex = '2';

    card.innerHTML = `
      <div>
        <div class="flex items-center justify-between mb-1">
          <div class="flex items-center gap-1.5 font-mono text-[10px] text-slate-400">
            <span class="status-dot ${cfg.class}"></span>
            <span class="font-semibold text-slate-300">${task.id}</span>
          </div>
          <span class="text-[9.5px] uppercase font-mono px-1.5 py-0.5 rounded border ${priorityColor}">${task.priority}</span>
        </div>
        <div class="text-[12px] font-medium text-slate-200 line-clamp-1 group-hover:text-indigo-300 transition-colors">${task.title}</div>
      </div>
      <div class="flex items-center justify-between text-[10px] text-slate-500 font-mono pt-1 border-t border-borderSubtle">
        <span>${cfg.label}</span>
        ${task.claimedByAgent ? `<span class="text-indigo-400 flex items-center gap-1"><i data-lucide="bot" class="w-3 h-3"></i> ${task.claimedByAgent}</span>` : '<span>Unclaimed</span>'}
      </div>
    `;

    card.onclick = () => openInspector(task.id);
    canvasWrapper.appendChild(card);
  });

  tasksGraphView.appendChild(canvasWrapper);
  refreshLucideIcons();
}

// Slide-Over Inspector Drawer
async function openInspector(taskIdOrShortCode, showDrawer = true, updateHash = true) {
  if (!taskIdOrShortCode) return;

  // Resolve target task from state.tasks if passing a short code (e.g. MO-123, SH-123)
  let targetTask = state.tasks.find((t) => t.id === taskIdOrShortCode);
  if (!targetTask) {
    targetTask = state.tasks.find((t) => formatIssueKey(t.id, t) === taskIdOrShortCode);
  }
  if (!targetTask) {
    const match = String(taskIdOrShortCode).match(/^(?:[A-Za-z]{2,}-)?(\d+)$/);
    if (match) {
      const orderIdx = parseInt(match[1], 10);
      targetTask = state.tasks.find((t) => t.orderIndex === orderIdx);
    }
  }

  const lookupId = targetTask ? targetTask.id : taskIdOrShortCode;
  const shortKey = targetTask ? formatIssueKey(targetTask.id, targetTask) : taskIdOrShortCode;

  state.selectedTaskId = lookupId;
  if (updateHash) {
    window.location.hash = `#/tasks/${shortKey}`;
  }
  try {
    const res = await fetch(`/api/tasks/${lookupId}`);
    const data = await res.json();
    const task = data.task;
    if (!task) return;
    const subtasks = data.subtasks || [];
    const dependencies = data.dependencies || [];
    const dependents = data.dependents || [];
    const notes = data.notes || [];

    const displayKey = formatIssueKey(task.id, task);
    const cfg = statusConfig[task.status] || { label: task.status, class: 'todo' };
    const drawerTaskId = document.getElementById('drawerTaskId');
    const drawerStatusDot = document.getElementById('drawerStatusDot');
    const drawerPriorityBadge = document.getElementById('drawerPriorityBadge');

    if (drawerTaskId) drawerTaskId.textContent = displayKey;
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

        <span class="property-label">Backlog / Queue</span>
        <div class="property-value flex items-center gap-2">
          <label class="toggle-switch">
            <input type="checkbox" ${task.isDeferred ? 'checked' : ''} onchange="handleSaveInlineField('${task.id}', 'isDeferred', this.checked)">
            <span class="toggle-slider"></span>
          </label>
          <span class="text-xs text-slate-300">${task.isDeferred ? 'In Backlog (Deferred)' : 'In Active Queue'}</span>
        </div>

        <span class="property-label">Type</span>
        <div class="property-value flex items-center gap-2">
          <select class="filter-select text-xs" onchange="handleSaveInlineField('${task.id}', 'type', this.value)">
            <option value="feature" ${(task.type || 'feature') === 'feature' ? 'selected' : ''}>✨ Feature</option>
            <option value="bug" ${task.type === 'bug' ? 'selected' : ''}>🐛 Bug</option>
            <option value="refactor" ${task.type === 'refactor' ? 'selected' : ''}>♻️ Refactor</option>
            <option value="test" ${task.type === 'test' ? 'selected' : ''}>🧪 Test</option>
            <option value="docs" ${task.type === 'docs' ? 'selected' : ''}>📚 Docs</option>
            <option value="chore" ${task.type === 'chore' ? 'selected' : ''}>🧹 Chore</option>
            <option value="spike" ${task.type === 'spike' ? 'selected' : ''}>🔬 Spike</option>
            <option value="security" ${task.type === 'security' ? 'selected' : ''}>🔒 Security</option>
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

        <span class="property-label">Tags</span>
        <div class="property-value flex items-center gap-1.5 flex-wrap">
          <input type="text" value="${(task.tags || []).join(', ')}" placeholder="e.g. auth, frontend" class="input-field text-xs py-0.5 px-2 w-full font-mono" onchange="handleSaveInlineTags('${task.id}', this.value)">
        </div>

        <span class="property-label">Linked Goal</span>
        <div class="property-value">
          <select class="filter-select text-xs w-full" onchange="handleSaveInlineField('${task.id}', 'goalId', this.value || null)">
            <option value="">(None / Scope Drift)</option>
            ${state.goals.map((g) => `<option value="${g.goal.id}" ${task.goalId === g.goal.id ? 'selected' : ''}>${g.goal.title}</option>`).join('')}
          </select>
        </div>

        <span class="property-label">Assigned Agent</span>
        <div class="property-value flex items-center gap-2">
          ${renderAgentAvatar(task.claimedByAgent, 'sm')}
          <input type="text" value="${task.claimedByAgent ? escapeHtml(task.claimedByAgent) : ''}" placeholder="e.g. antigravity, vibe-agent" class="input-field text-xs py-0.5 px-2 flex-1 font-mono" onchange="handleSaveInlineField('${task.id}', 'claimedByAgent', this.value.trim() || null)">
          ${task.claimedByAgent ? `
            <button class="text-slate-400 hover:text-rose-400 text-xs px-1.5 py-0.5 rounded hover:bg-surface border border-borderSubtle transition flex items-center justify-center" onclick="handleSaveInlineField('${task.id}', 'claimedByAgent', null)" title="Unassign agent">
              <i data-lucide="x" class="w-3 h-3"></i>
            </button>
          ` : ''}
        </div>

        ${task.status === 'doing' && task.leaseExpiresAt ? `
          <span class="property-label">Lease Status</span>
          <div class="property-value font-mono text-xs flex items-center gap-2">
            ${new Date(task.leaseExpiresAt) > new Date() ? `
              <span class="lease-countdown-badge" data-lease-expires="${task.leaseExpiresAt}" title="Real-time agent lease remaining">
                <span class="lease-pulse-dot"></span>
                <span class="lease-text">${formatLeaseRemaining(task.leaseExpiresAt)}</span>
              </span>
            ` : `
              <span class="text-rose-400 font-mono text-xs px-2 py-0.5 rounded bg-rose-950/30 border border-rose-800/40">Lease Expired</span>
            `}
            <span class="text-slate-500 text-[10px]">(Expires: ${new Date(task.leaseExpiresAt).toLocaleTimeString()})</span>
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
            <span id="inlineSaveStatus-description" class="inline-save-indicator"></span>
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
            <span id="inlineSaveStatus-acceptanceCriteria" class="inline-save-indicator"></span>
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
                       ${subtasks.map((s) => `
              <div class="p-2 bg-card rounded border border-subtle flex items-center justify-between text-xs cursor-pointer hover:border-borderActive" onclick="openInspector('${s.id}')">
                <div class="flex items-center gap-2">
                  <span class="status-dot ${statusConfig[s.status]?.class || 'todo'}"></span>
                  <span class="font-mono text-slate-500 text-[10px]">${formatIssueKey(s.id, s)}</span>
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
          <span class="font-mono text-indigo-300 font-medium cursor-pointer hover:underline" onclick="openInspector('${task.parentId}')">${formatIssueKey(task.parentId)}</span>
        </div>
      `}

      <!-- Visual Dependency Flow (DAG) & Blockers -->
      <div class="bg-surface border border-subtle rounded-lg p-3 space-y-2.5">
        <div class="flex items-center justify-between">
          <div class="text-[10px] font-bold tracking-wider uppercase text-amber-400 font-mono flex items-center gap-1">
            <i data-lucide="git-branch" class="w-3.5 h-3.5 text-amber-400"></i> DEPENDENCY GRAPH & BLOCKERS
          </div>
          <div class="flex items-center gap-1">
            <select id="selectAddBlocker" class="filter-select text-[11px]">
              <option value="">+ Add Blocker...</option>
              ${candidateBlockers.map((c) => `<option value="${c.id}">${formatIssueKey(c.id, c)} - ${c.title.slice(0, 30)}</option>`).join('')}
            </select>
            <button class="btn-secondary text-[11px] py-0.5 px-2" onclick="handleAddBlocker('${task.id}')">Link</button>
          </div>
        </div>

        ${(dependencies.length > 0 || dependents.length > 0) ? `
          <div class="dag-flow-container mb-2">
            <div class="dag-column">
              <div class="text-[9px] font-mono text-amber-400 font-bold uppercase">Blockers (${dependencies.length})</div>
              ${dependencies.length === 0 ? '<div class="text-[10px] text-slate-500 italic">None</div>' : dependencies.map((d) => {
                const bTask = state.tasks.find((t) => t.id === d);
                return `
                  <div class="dag-node" onclick="openInspector('${d}')">
                    <span class="text-amber-300 font-bold">${formatIssueKey(d, bTask)}</span>
                    <span class="text-slate-300 truncate max-w-[130px]">${bTask ? bTask.title : ''}</span>
                  </div>
                `;
              }).join('')}
            </div>
            <div class="dag-connector"><i data-lucide="arrow-right" class="w-4 h-4 text-slate-500"></i></div>
            <div class="dag-column">
              <div class="text-[9px] font-mono text-indigo-400 font-bold uppercase">This Task</div>
              <div class="dag-node active-node">
                <span class="text-indigo-300 font-bold">${formatIssueKey(task.id, task)}</span>
                <span class="text-slate-100 font-medium truncate max-w-[140px]">${task.title}</span>
              </div>
            </div>
            <div class="dag-connector"><i data-lucide="arrow-right" class="w-4 h-4 text-slate-500"></i></div>
            <div class="dag-column">
              <div class="text-[9px] font-mono text-blue-400 font-bold uppercase">Dependents (${dependents.length})</div>
              ${dependents.length === 0 ? '<div class="text-[10px] text-slate-500 italic">None</div>' : dependents.map((d) => {
                const depTask = state.tasks.find((t) => t.id === d);
                return `
                  <div class="dag-node" onclick="openInspector('${d}')">
                    <span class="text-blue-300 font-bold">${formatIssueKey(d, depTask)}</span>
                    <span class="text-slate-300 truncate max-w-[130px]">${depTask ? depTask.title : ''}</span>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        ` : ''}
        
        <div class="flex flex-wrap gap-1.5">
          ${dependencies.length === 0 ? `<div class="text-xs text-slate-500 italic">No direct blockers.</div>` : ''}
          ${dependencies.map((d) => `
            <span class="font-mono text-xs px-2 py-0.5 bg-amber-950/40 border border-amber-800/40 text-amber-300 rounded flex items-center gap-1.5">
              <span class="cursor-pointer hover:underline" onclick="openInspector('${d}')">⚠️ ${formatIssueKey(d)}</span>
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
              ${dependents.map((d) => `<span class="font-mono text-xs px-2 py-0.5 bg-blue-950/40 border border-blue-800/40 text-blue-300 rounded cursor-pointer hover:underline" onclick="openInspector('${d}')">⚡ ${formatIssueKey(d)}</span>`).join('')}
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

window.handleSaveInlineTags = async (taskId, tagString) => {
  const tags = tagString.split(',').map((t) => t.trim()).filter(Boolean);
  await window.handleSaveInlineField(taskId, 'tags', tags);
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
    container.innerHTML = `
      <div class="col-span-1 md:col-span-2 empty-hero-card">
        <div class="empty-hero-icon"><i data-lucide="target" class="w-6 h-6"></i></div>
        <h3 class="text-sm font-semibold text-slate-100 mb-1">No Goals Defined Yet</h3>
        <p class="text-xs text-slate-400 max-w-sm mb-4">Goals anchor overarching user requirements, specifications, and prevent multi-agent scope drift.</p>
        <button class="btn-primary text-xs" onclick="modalCreateGoal?.classList.remove('hidden'); refreshLucideIcons();">
          <i data-lucide="plus" class="w-3.5 h-3.5"></i> Create First Goal
        </button>
      </div>
    `;
    refreshLucideIcons();
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
  renderActiveFilterChips();
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
    container.innerHTML = `
      <div class="empty-hero-card">
        <div class="empty-hero-icon" style="background: rgba(168, 85, 247, 0.12); border-color: rgba(168, 85, 247, 0.25); color: #c084fc;">
          <i data-lucide="check-circle-2" class="w-6 h-6"></i>
        </div>
        <h3 class="text-sm font-semibold text-slate-100 mb-1">Human Attention Queue is Clear</h3>
        <p class="text-xs text-slate-400 max-w-sm mb-2">No coding agents are currently blocked or waiting on questions/approvals. When an agent needs input, real-time alerts will trigger here.</p>
      </div>
    `;
    refreshLucideIcons();
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
      
      ${task.humanOptions && Array.isArray(task.humanOptions) && task.humanOptions.length > 0 ? `
        <!-- Custom Selectable Options (1-Click Resolution) -->
        <div class="mb-3 p-2.5 rounded bg-purple-900/20 border border-purple-800/40">
          <div class="text-[11px] font-semibold text-purple-300 mb-1.5 flex items-center gap-1">
            <i data-lucide="list" class="w-3 h-3 text-purple-400"></i> Selectable Choices (1-Click Resolution):
          </div>
          <div class="flex flex-wrap gap-1.5">
            ${task.humanOptions.map((opt) => `
              <button type="button" onclick="setQuickAnswer('${task.id}', '${opt.replace(/'/g, "\\'")}')" class="px-2.5 py-1 rounded bg-purple-800/40 border border-purple-600/60 text-purple-200 text-xs hover:bg-purple-700/60 hover:text-white transition flex items-center gap-1 font-medium shadow-sm">
                <i data-lucide="corner-down-right" class="w-3 h-3 text-purple-400"></i> ${opt}
              </button>
            `).join('')}
          </div>
        </div>
      ` : ''}

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
    container.innerHTML = `
      <div class="empty-hero-card">
        <div class="empty-hero-icon" style="background: rgba(16, 185, 129, 0.12); border-color: rgba(16, 185, 129, 0.25); color: #34d399;">
          <i data-lucide="shield-check" class="w-6 h-6"></i>
        </div>
        <h3 class="text-sm font-semibold text-slate-100 mb-1">All Work Verified</h3>
        <p class="text-xs text-slate-400 max-w-sm mb-2">No agent-completed issues are waiting for proof review or verification.</p>
      </div>
    `;
    refreshLucideIcons();
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
    container.innerHTML = `
      <div class="col-span-1 md:col-span-2 empty-hero-card">
        <div class="empty-hero-icon"><i data-lucide="landmark" class="w-6 h-6"></i></div>
        <h3 class="text-sm font-semibold text-slate-100 mb-1">No Architectural Decisions (ADR) Yet</h3>
        <p class="text-xs text-slate-400 max-w-sm mb-4">Record system architecture trade-offs and tech choices so autonomous agents never re-debate settled decisions.</p>
        <button class="btn-primary text-xs" onclick="modalCreateDecision?.classList.remove('hidden'); refreshLucideIcons();">
          <i data-lucide="plus" class="w-3.5 h-3.5"></i> Record First Decision
        </button>
      </div>
    `;
    refreshLucideIcons();
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
    container.innerHTML = `
      <div class="empty-hero-card">
        <div class="empty-hero-icon" style="background: rgba(59, 130, 246, 0.12); border-color: rgba(59, 130, 246, 0.25); color: #60a5fa;">
          <i data-lucide="activity" class="w-6 h-6"></i>
        </div>
        <h3 class="text-sm font-semibold text-slate-100 mb-1">No Activity Logged</h3>
        <p class="text-xs text-slate-400 max-w-sm mb-2">Audit notes, checkpoints, and attempt logs from running coding agents will appear in this real-time stream.</p>
      </div>
    `;
    refreshLucideIcons();
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
  const matchedTasks = state.tasks.filter((t) => t.title.toLowerCase().includes(q) || t.id.toLowerCase().includes(q) || formatIssueKey(t.id, t).toLowerCase().includes(q)).slice(0, 6);
  matchedTasks.forEach((t) => {
    const item = document.createElement('div');
    item.className = 'palette-item';
    item.innerHTML = `<div class="flex items-center gap-2"><span class="font-mono text-slate-500 text-[10px]">${formatIssueKey(t.id, t)}</span><span>${t.title}</span></div><span class="status-pill text-[10px]">${t.status}</span>`;
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
  const isInput =
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) ||
    document.activeElement?.isContentEditable ||
    document.activeElement?.classList?.contains('rich-editable-doc');

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
    closeFilterPopover();
    closeSortPopover();
    if (drawerInspector) drawerInspector.classList.add('hidden');
    document.querySelectorAll('.modal-backdrop').forEach((m) => m.classList.add('hidden'));
    return;
  }

  if (!isInput) {
    // Shortcuts Help
    if (e.key === '?' || (e.shiftKey && e.key === '/')) {
      e.preventDefault();
      modalKeyboardShortcuts?.classList.toggle('hidden');
      refreshLucideIcons();
      return;
    }

    // Filter Menu (F)
    if ((e.key === 'f' || e.key === 'F') && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      if (state.currentView !== 'tasks') {
        switchView('tasks');
      }
      toggleFilterPopover();
      return;
    }

    // List Navigation (J / K / ArrowDown / ArrowUp)
    if (state.currentView === 'tasks' && state.viewMode === 'list') {
      const rows = document.querySelectorAll('.list-row');
      if (rows.length > 0) {
        if (e.key === 'j' || e.key === 'J' || e.key === 'ArrowDown') {
          e.preventDefault();
          state.keyboardFocusedIndex = (state.keyboardFocusedIndex + 1) % rows.length;
          rows.forEach((r, idx) => r.classList.toggle('keyboard-focused', idx === state.keyboardFocusedIndex));
          rows[state.keyboardFocusedIndex]?.scrollIntoView({ block: 'nearest' });
          return;
        }
        if (e.key === 'k' || e.key === 'K' || e.key === 'ArrowUp') {
          e.preventDefault();
          state.keyboardFocusedIndex = (state.keyboardFocusedIndex - 1 + rows.length) % rows.length;
          rows.forEach((r, idx) => r.classList.toggle('keyboard-focused', idx === state.keyboardFocusedIndex));
          rows[state.keyboardFocusedIndex]?.scrollIntoView({ block: 'nearest' });
          return;
        }
        if ((e.key === 'Enter' || e.key === ' ') && state.keyboardFocusedIndex >= 0) {
          e.preventDefault();
          const targetRow = rows[state.keyboardFocusedIndex];
          const taskId = targetRow?.getAttribute('data-id');
          if (taskId) openInspector(taskId);
          return;
        }
        if ((e.key === 'x' || e.key === 'X') && state.keyboardFocusedIndex >= 0) {
          e.preventDefault();
          const targetRow = rows[state.keyboardFocusedIndex];
          const taskId = targetRow?.getAttribute('data-id');
          if (taskId) {
            const isSelected = state.selectedTaskIds.has(taskId);
            toggleTaskSelection(taskId, !isSelected);
            const checkbox = targetRow.querySelector('.list-row-checkbox');
            if (checkbox) checkbox.checked = !isSelected;
          }
          return;
        }
      }
    }

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

if (btnOpenShortcutsHelp) {
  btnOpenShortcutsHelp.onclick = () => {
    modalKeyboardShortcuts?.classList.remove('hidden');
    refreshLucideIcons();
  };
}

// Modal Triggers
const btnHeaderNewTask = document.getElementById('btnHeaderNewTask');
if (btnHeaderNewTask) btnHeaderNewTask.onclick = () => { modalCreateTask?.classList.remove('hidden'); refreshLucideIcons(); };

const btnSidebarSearch = document.getElementById('btnSidebarSearch');
if (btnSidebarSearch) btnSidebarSearch.onclick = () => openCommandPalette();

const btnSidebarCompose = document.getElementById('btnSidebarCompose');
if (btnSidebarCompose) btnSidebarCompose.onclick = () => { modalCreateTask?.classList.remove('hidden'); refreshLucideIcons(); };

// Issue Tab Switcher (Assigned, Created, Subscribed, Activity)
window.switchIssueTab = (tab) => {
  document.querySelectorAll('#issueTabsBar .tab-pill').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tab);
  });
  state.currentIssueTab = tab;
  if (tab === 'activity') {
    switchView('activity');
  } else {
    if (state.currentView !== 'tasks') {
      switchView('tasks');
    }
    renderTasks();
  }
};

// Favorites Filter Click Handler
window.applyFavoriteFilter = (filterKey) => {
  switchView('tasks');
  if (filterKey === 'saved_search') {
    state.filterSearch = 'saved search';
  } else if (filterKey === 'blockers') {
    state.filterPriority = 'critical';
  } else if (filterKey === 'api_key') {
    state.filterSearch = 'api key';
  } else if (filterKey === 'product_analytics') {
    state.filterSearch = 'analytics';
  } else {
    state.filterSearch = '';
    state.filterPriority = '';
  }
  renderTasks();
};

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
    const type = document.getElementById('inputTaskType')?.value || 'feature';
    const priority = document.getElementById('inputTaskPriority').value;
    const tagsInput = document.getElementById('inputTaskTags')?.value;
    const tags = tagsInput ? tagsInput.split(',').map((t) => t.trim()).filter(Boolean) : [];
    const description = document.getElementById('inputTaskDescription')?.value || undefined;
    const acceptanceCriteria = document.getElementById('inputTaskAC').value;
    const filesInput = document.getElementById('inputTaskFiles').value;
    const isDeferred = document.getElementById('inputTaskDeferred').checked;
    const claimedByAgent = document.getElementById('inputTaskAgent')?.value?.trim() || undefined;

    const declaredFiles = filesInput ? filesInput.split(',').map((f) => f.trim()).filter(Boolean) : [];

    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, goalId, type, priority, tags, description, acceptanceCriteria, declaredFiles, isDeferred, claimedByAgent }),
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
    const description = document.getElementById('inputGoalDescription')?.value || undefined;
    const maxOpenTasksCap = parseInt(document.getElementById('inputGoalCap').value) || 10;

    await fetch('/api/goals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, verbatimPrompt, description, maxOpenTasksCap }),
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

// Workspace Management Forms
const formEditWorkspace = document.getElementById('formEditWorkspace');
if (formEditWorkspace) {
  formEditWorkspace.onsubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById('inputEditWorkspaceId')?.value;
    const name = document.getElementById('inputEditWorkspaceName')?.value?.trim();
    const gitRemote = document.getElementById('inputEditWorkspaceRemote')?.value?.trim();
    if (!id || !name) return;

    try {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, gitRemote }),
      });
      const data = await res.json();
      if (data.success && data.workspace) {
        document.getElementById('modalEditWorkspace')?.classList.add('hidden');
        showToast(`Workspace updated: ${data.workspace.name}`, 'success');
        if (state.activeWorkspace?.id === id) {
          state.activeWorkspace = data.workspace;
          updateWorkspaceNameInUI(data.workspace.name);
        }
        await refreshAll();
      } else {
        showToast(data.error || 'Failed to update workspace', 'error');
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  };
}

const formRegisterWorkspace = document.getElementById('formRegisterWorkspace');
if (formRegisterWorkspace) {
  formRegisterWorkspace.onsubmit = async (e) => {
    e.preventDefault();
    const projectPath = document.getElementById('inputRegisterWorkspacePath')?.value?.trim();
    const name = document.getElementById('inputRegisterWorkspaceName')?.value?.trim();
    if (!projectPath) return;

    try {
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath, name: name || undefined }),
      });
      const data = await res.json();
      if (data.success && data.workspace) {
        document.getElementById('modalRegisterWorkspace')?.classList.add('hidden');
        showToast(`Registered workspace: ${data.workspace.name}`, 'success');
        await switchWorkspace(data.workspace.id);
      } else {
        showToast(data.error || 'Failed to register workspace', 'error');
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
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
