// State Management
const state = {
  goals: [],
  tasks: [],
  decisions: [],
  activity: [],
  humanInbox: [],
  currentTab: 'board',
  selectedGoalId: '',
  searchQuery: '',
};

// Elements
const tabs = document.querySelectorAll('.nav-btn');
const tabPanes = document.querySelectorAll('.tab-pane');
const boardGoalFilter = document.getElementById('boardGoalFilter');
const boardSearchInput = document.getElementById('boardSearchInput');
const totalTasksCount = document.getElementById('totalTasksCount');
const humanInboxBadge = document.getElementById('humanInboxBadge');
const reviewBadge = document.getElementById('reviewBadge');

// Modals
const modalTaskDetail = document.getElementById('modalTaskDetail');
const modalCreateGoal = document.getElementById('modalCreateGoal');
const modalCreateTask = document.getElementById('modalCreateTask');
const modalCreateDecision = document.getElementById('modalCreateDecision');
const modalReasonPrompt = document.getElementById('modalReasonPrompt');

// SSE Connection
function setupSSE() {
  const eventSource = new EventSource('/api/events');

  eventSource.addEventListener('connected', () => {
    console.log('[SSE] Connected to Moo Tasks event stream');
  });

  eventSource.addEventListener('tasks_updated', () => {
    refreshAll();
  });

  eventSource.addEventListener('goals_updated', () => {
    refreshAll();
  });

  eventSource.addEventListener('decisions_updated', () => {
    fetchDecisions();
  });

  eventSource.addEventListener('activity_updated', (e) => {
    fetchActivity();
  });

  eventSource.onerror = () => {
    console.warn('[SSE] Connection lost, retrying...');
  };
}

// API Calls
async function fetchGoals() {
  try {
    const res = await fetch('/api/goals');
    const data = await res.json();
    state.goals = data.goals || [];
    renderGoalSelects();
    renderGoalsView();
  } catch (err) {
    console.error('Failed to fetch goals:', err);
  }
}

async function fetchTasks() {
  try {
    const res = await fetch('/api/tasks');
    const data = await res.json();
    state.tasks = data.tasks || [];
    renderBoard();
    renderHumanInbox();
    renderReviewFeed();
    renderResumeView();
  } catch (err) {
    console.error('Failed to fetch tasks:', err);
  }
}

async function fetchDecisions() {
  try {
    const res = await fetch('/api/decisions');
    const data = await res.json();
    state.decisions = data.decisions || [];
    renderDecisions();
  } catch (err) {
    console.error('Failed to fetch decisions:', err);
  }
}

async function fetchActivity() {
  try {
    const res = await fetch('/api/activity');
    const data = await res.json();
    state.activity = data.notes || [];
    renderActivity();
  } catch (err) {
    console.error('Failed to fetch activity:', err);
  }
}

async function refreshAll() {
  await Promise.all([fetchGoals(), fetchTasks(), fetchDecisions(), fetchActivity()]);
}

// Navigation
tabs.forEach((btn) => {
  btn.addEventListener('click', () => {
    const tabName = btn.getAttribute('data-tab');
    switchTab(tabName);
  });
});

function switchTab(tabName) {
  state.currentTab = tabName;
  tabs.forEach((b) => b.classList.toggle('active', b.getAttribute('data-tab') === tabName));
  tabPanes.forEach((pane) => {
    pane.classList.toggle('hidden', pane.id !== `tab-${tabName}`);
    pane.classList.toggle('active', pane.id === `tab-${tabName}`);
  });

  if (tabName === 'resume') renderResumeView();
  if (tabName === 'activity') fetchActivity();
}

// Renderers
function renderGoalSelects() {
  const currentVal = boardGoalFilter.value;
  boardGoalFilter.innerHTML = '<option value="">All Goals</option>';
  const inputTaskGoal = document.getElementById('inputTaskGoal');
  inputTaskGoal.innerHTML = '<option value="">(None / Standalone)</option>';

  state.goals.forEach((item) => {
    const g = item.goal;
    const opt = document.createElement('option');
    opt.value = g.id;
    opt.textContent = `${g.title} (${item.openTasks}/${g.maxOpenTasksCap})`;
    boardGoalFilter.appendChild(opt);

    const opt2 = document.createElement('option');
    opt2.value = g.id;
    opt2.textContent = g.title;
    inputTaskGoal.appendChild(opt2);
  });

  boardGoalFilter.value = currentVal;
}

function renderBoard() {
  const columns = {
    todo: document.getElementById('cards-todo'),
    doing: document.getElementById('cards-doing'),
    'blocked-on-dependency': document.getElementById('cards-blocked-on-dependency'),
    'waiting-on-human': document.getElementById('cards-waiting-on-human'),
    done: document.getElementById('cards-done'),
    dropped: document.getElementById('cards-dropped'),
  };

  const counts = {
    todo: 0,
    doing: 0,
    'blocked-on-dependency': 0,
    'waiting-on-human': 0,
    done: 0,
    dropped: 0,
  };

  Object.values(columns).forEach((col) => (col.innerHTML = ''));

  let filtered = state.tasks;
  if (state.selectedGoalId) {
    filtered = filtered.filter((t) => t.goalId === state.selectedGoalId);
  }
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    filtered = filtered.filter(
      (t) => t.title.toLowerCase().includes(q) || (t.description && t.description.toLowerCase().includes(q))
    );
  }

  totalTasksCount.textContent = `${filtered.length} Tasks`;

  filtered.forEach((task) => {
    if (counts[task.status] !== undefined) {
      counts[task.status]++;
    }

    const card = document.createElement('div');
    card.className = `task-card priority-${task.priority}`;
    card.setAttribute('data-id', task.id);

    let claimedBadge = '';
    if (task.claimedByAgent) {
      claimedBadge = `<div class="mt-1.5 flex items-center space-x-1 text-[10px] text-blue-400 font-mono">
        <span>🤖 ${task.claimedByAgent}</span>
        ${task.attemptCount > 1 ? `<span class="text-amber-400">(Att #${task.attemptCount})</span>` : ''}
      </div>`;
    }

    let depBadge = '';
    if (task.blockedReason) {
      depBadge = `<div class="mt-1 text-[10px] text-amber-400 truncate">⚠️ ${task.blockedReason}</div>`;
    }

    let verificationBadge = '';
    if (task.status === 'done') {
      if (task.verificationState === 'agent_completed') {
        verificationBadge = `<span class="mt-1 inline-block text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 font-mono">Awaiting Review</span>`;
      } else if (task.verificationState === 'verified_done') {
        verificationBadge = `<span class="mt-1 inline-block text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-mono">✓ Verified</span>`;
      }
    }

    card.innerHTML = `
      <div class="flex items-center justify-between mb-1">
        <span class="font-mono text-[10px] text-slate-400">${task.id}</span>
        <span class="text-[10px] font-semibold text-slate-400 uppercase">${task.priority}</span>
      </div>
      <div class="text-xs font-semibold text-slate-200 line-clamp-2">${task.title}</div>
      ${claimedBadge}
      ${depBadge}
      ${verificationBadge}
    `;

    card.addEventListener('click', () => openTaskModal(task.id));

    if (columns[task.status]) {
      columns[task.status].appendChild(card);
    }
  });

  Object.entries(counts).forEach(([status, count]) => {
    const el = document.getElementById(`count-${status}`);
    if (el) el.textContent = count;
  });
}

function renderGoalsView() {
  const container = document.getElementById('goalsContainer');
  container.innerHTML = '';

  if (state.goals.length === 0) {
    container.innerHTML = `<div class="col-span-2 text-center py-12 text-slate-500 text-sm">No goals created yet. Click "+ Create Goal" to record human objectives.</div>`;
    return;
  }

  state.goals.forEach((item) => {
    const g = item.goal;
    const card = document.createElement('div');
    card.className = 'bg-slate-900 border border-slate-800 rounded-lg p-4 flex flex-col justify-between';

    const pct = item.totalTasks > 0 ? Math.round((item.completedTasks / item.totalTasks) * 100) : 0;

    let statusClass = 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
    if (g.status === 'dropped') statusClass = 'text-rose-400 bg-rose-500/10 border-rose-500/20';

    card.innerHTML = `
      <div>
        <div class="flex items-center justify-between mb-2">
          <span class="text-xs px-2 py-0.5 rounded-full border ${statusClass} font-mono uppercase font-semibold">${g.status}</span>
          <span class="text-xs font-mono text-slate-400">${g.id}</span>
        </div>
        <h3 class="text-sm font-bold text-slate-100 mb-1">${g.title}</h3>
        <div class="bg-slate-950 p-2.5 rounded border border-slate-800 text-xs text-slate-300 mb-3 italic">
          "${g.verbatimPrompt}"
        </div>
        
        <!-- Metrics -->
        <div class="grid grid-cols-4 gap-2 text-center text-xs mb-3 font-mono">
          <div class="bg-slate-950 p-1.5 rounded">
            <div class="text-slate-400 text-[10px]">Open / Cap</div>
            <div class="font-bold ${item.hasReachedCap ? 'text-rose-400' : 'text-slate-200'}">${item.openTasks} / ${g.maxOpenTasksCap}</div>
          </div>
          <div class="bg-slate-950 p-1.5 rounded">
            <div class="text-slate-400 text-[10px]">Done</div>
            <div class="font-bold text-emerald-400">${item.completedTasks}</div>
          </div>
          <div class="bg-slate-950 p-1.5 rounded">
            <div class="text-slate-400 text-[10px]">Loose Ends</div>
            <div class="font-bold text-amber-400">${item.looseEnds.length}</div>
          </div>
          <div class="bg-slate-950 p-1.5 rounded">
            <div class="text-slate-400 text-[10px]">Coverage</div>
            <div class="font-bold text-blue-400">${pct}%</div>
          </div>
        </div>
      </div>

      <div class="flex items-center justify-between border-t border-slate-800 pt-3">
        <button class="btn-secondary text-xs" onclick="filterByGoal('${g.id}')">View Tasks</button>
        <div class="space-x-2">
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

function renderHumanInbox() {
  const container = document.getElementById('humanInboxContainer');
  const waitingTasks = state.tasks.filter((t) => t.status === 'waiting-on-human' && !t.isArchived);

  humanInboxBadge.textContent = waitingTasks.length;
  humanInboxBadge.classList.toggle('hidden', waitingTasks.length === 0);

  container.innerHTML = '';

  if (waitingTasks.length === 0) {
    container.innerHTML = `<div class="text-center py-12 text-slate-500 text-sm">🎉 No agents are currently blocked on human input. Everything is flowing smoothly!</div>`;
    return;
  }

  waitingTasks.forEach((task) => {
    const card = document.createElement('div');
    card.className = 'bg-slate-900 border border-purple-500/30 rounded-lg p-4 shadow-lg';

    card.innerHTML = `
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs font-mono text-purple-400 font-semibold uppercase">Question from Agent: ${task.claimedByAgent || 'Unknown'}</span>
        <span class="text-xs font-mono text-slate-400">${task.id}</span>
      </div>
      <h3 class="text-sm font-bold text-slate-100 mb-2">${task.title}</h3>
      <div class="bg-purple-950/30 border border-purple-800/40 p-3 rounded text-xs text-purple-200 mb-3">
        <div class="font-semibold mb-1">❓ ${task.humanQuestionType || 'Question'}:</div>
        <div>${task.humanQuestion || 'No question text provided'}</div>
      </div>
      <form onsubmit="handleAnswerQuestion(event, '${task.id}')" class="flex space-x-2">
        <input type="text" id="answer-input-${task.id}" required placeholder="Type your answer or decision to resume agent..." class="input-field flex-1 text-xs">
        <button type="submit" class="btn-primary text-xs">Submit & Resume Agent</button>
      </form>
    `;

    container.appendChild(card);
  });
}

function renderReviewFeed() {
  const container = document.getElementById('reviewContainer');
  const reviewTasks = state.tasks.filter(
    (t) => (t.status === 'done' && t.verificationState === 'agent_completed') || t.status === 'dropped'
  );

  reviewBadge.textContent = reviewTasks.length;
  reviewBadge.classList.toggle('hidden', reviewTasks.length === 0);

  container.innerHTML = '';

  if (reviewTasks.length === 0) {
    container.innerHTML = `<div class="text-center py-12 text-slate-500 text-sm">No tasks currently pending human review or verification.</div>`;
    return;
  }

  reviewTasks.forEach((task) => {
    const isCompleted = task.status === 'done';
    const card = document.createElement('div');
    card.className = `bg-slate-900 border ${isCompleted ? 'border-blue-500/30' : 'border-rose-500/30'} rounded-lg p-4`;

    let evidenceContent = '';
    if (task.evidence) {
      evidenceContent = `
        <div class="bg-slate-950 p-2.5 rounded border border-slate-800 text-xs font-mono text-slate-300 mb-3">
          <div class="text-slate-400 text-[10px] mb-1">EVIDENCE SUBMITTED:</div>
          <div>Commands: ${task.evidence.commandsRun?.join(', ') || 'N/A'}</div>
          <div>Proof: ${task.evidence.testProof || task.evidence.outputSnippet || 'Provided'}</div>
        </div>
      `;
    }

    let droppedContent = '';
    if (task.droppedReason) {
      droppedContent = `<div class="text-xs text-rose-300 mb-3 italic">Reason: "${task.droppedReason}"</div>`;
    }

    card.innerHTML = `
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs font-mono font-semibold ${isCompleted ? 'text-blue-400' : 'text-rose-400'} uppercase">
          ${isCompleted ? 'Agent Claimed Done' : 'Dropped Task'}
        </span>
        <span class="text-xs font-mono text-slate-400">${task.id}</span>
      </div>
      <h3 class="text-sm font-bold text-slate-100 mb-1">${task.title}</h3>
      <p class="text-xs text-slate-400 mb-3">${task.acceptanceCriteria}</p>
      ${evidenceContent}
      ${droppedContent}
      <div class="flex items-center justify-end space-x-2 border-t border-slate-800 pt-3">
        ${isCompleted ? `
          <button class="btn-danger text-xs" onclick="promptRejectTask('${task.id}')">Reject with Reason</button>
          <button class="btn-success text-xs" onclick="verifyTask('${task.id}')">✓ Verify Done</button>
        ` : `
          <button class="btn-secondary text-xs" onclick="reopenTask('${task.id}')">Reopen Task</button>
        `}
      </div>
    `;

    container.appendChild(card);
  });
}

function renderDecisions() {
  const container = document.getElementById('decisionsContainer');
  container.innerHTML = '';

  if (state.decisions.length === 0) {
    container.innerHTML = `<div class="col-span-2 text-center py-12 text-slate-500 text-sm">No architectural decisions recorded yet.</div>`;
    return;
  }

  state.decisions.forEach((dec) => {
    const card = document.createElement('div');
    card.className = 'bg-slate-900 border border-slate-800 rounded-lg p-4';

    const tagsHtml = dec.tags.map((t) => `<span class="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">${t}</span>`).join(' ');

    card.innerHTML = `
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs px-2 py-0.5 rounded-full border border-blue-500/20 text-blue-400 bg-blue-500/10 font-mono uppercase">${dec.status}</span>
        <span class="text-xs font-mono text-slate-400">${dec.id}</span>
      </div>
      <h3 class="text-sm font-bold text-slate-100 mb-2">${dec.title}</h3>
      <div class="space-y-2 text-xs mb-3">
        <div><span class="text-slate-400 font-semibold">Context:</span> <span class="text-slate-300">${dec.context}</span></div>
        <div><span class="text-slate-400 font-semibold">Choice:</span> <span class="text-slate-200 font-medium">${dec.choice}</span></div>
        <div><span class="text-slate-400 font-semibold">Rationale:</span> <span class="text-slate-300 italic">${dec.rationale}</span></div>
      </div>
      <div class="flex items-center space-x-1.5 border-t border-slate-800 pt-2">${tagsHtml}</div>
    `;

    container.appendChild(card);
  });
}

function renderActivity() {
  const container = document.getElementById('activityContainer');
  container.innerHTML = '';

  if (state.activity.length === 0) {
    container.innerHTML = `<div class="text-center py-12 text-slate-500">No activity recorded yet.</div>`;
    return;
  }

  state.activity.forEach((note) => {
    const row = document.createElement('div');
    row.className = 'p-2.5 rounded bg-slate-900 border border-slate-800 flex items-start space-x-3';
    row.innerHTML = `
      <span class="text-slate-500 text-[10px] whitespace-nowrap">${new Date(note.createdAt).toLocaleTimeString()}</span>
      <div class="flex-1">
        <div class="flex items-center space-x-2 mb-0.5">
          <span class="text-blue-400 font-bold">${note.authorId} (${note.authorType})</span>
          <span class="text-slate-500 font-mono text-[10px]">task:${note.taskId}</span>
        </div>
        <div class="text-slate-300 whitespace-pre-wrap text-xs">${note.content}</div>
      </div>
    `;
    container.appendChild(row);
  });
}

async function renderResumeView() {
  const container = document.getElementById('resumeContainer');
  try {
    const res = await fetch('/api/resume');
    const data = await res.json();
    const sum = data.summary;

    container.innerHTML = `
      <div class="grid grid-cols-3 gap-3 mb-4 font-mono text-xs">
        <div class="bg-slate-900 border border-slate-800 p-3 rounded-lg">
          <div class="text-slate-400 text-[10px]">In-Flight Doing</div>
          <div class="text-xl font-bold text-blue-400">${sum.abandonedDoingTasks.length}</div>
        </div>
        <div class="bg-slate-900 border border-slate-800 p-3 rounded-lg">
          <div class="text-slate-400 text-[10px]">Waiting on Human</div>
          <div class="text-xl font-bold text-purple-400">${sum.waitingOnHumanTasks.length}</div>
        </div>
        <div class="bg-slate-900 border border-slate-800 p-3 rounded-lg">
          <div class="text-slate-400 text-[10px]">Ready Unblocked</div>
          <div class="text-xl font-bold text-emerald-400">${sum.unblockedReadyTasks.length}</div>
        </div>
      </div>

      <div class="bg-slate-900 border border-slate-800 p-4 rounded-lg">
        <h3 class="text-sm font-bold text-slate-200 mb-2">Next Recommended Step</h3>
        ${sum.unblockedReadyTasks.length > 0 ? `
          <div class="p-3 bg-slate-950 rounded border border-emerald-500/30 flex items-center justify-between">
            <div>
              <span class="text-xs font-mono text-emerald-400 font-semibold">[READY] ${sum.unblockedReadyTasks[0].id}</span>
              <div class="text-sm font-bold text-slate-100">${sum.unblockedReadyTasks[0].title}</div>
            </div>
            <button class="btn-primary text-xs" onclick="openTaskModal('${sum.unblockedReadyTasks[0].id}')">Inspect & Claim</button>
          </div>
        ` : `<div class="text-xs text-slate-400">No ready unblocked tasks found. Check goals or add tasks.</div>`}
      </div>
    `;
  } catch (err) {
    console.error('Failed to load resume summary:', err);
  }
}

// Modal Handlers
async function openTaskModal(taskId) {
  try {
    const res = await fetch(`/api/tasks/${taskId}`);
    const data = await res.json();
    const task = data.task;
    const subtasks = data.subtasks || [];
    const notes = data.notes || [];

    document.getElementById('modalTaskId').textContent = task.id;
    const badge = document.getElementById('modalTaskBadge');
    badge.textContent = task.status;
    badge.className = `status-badge ${task.status}`;

    const body = document.getElementById('modalTaskBody');
    body.innerHTML = `
      <div>
        <h2 class="text-base font-bold text-slate-100 mb-1">${task.title}</h2>
        <div class="text-xs text-slate-400">Priority: <span class="text-slate-200 uppercase font-semibold">${task.priority}</span> | Goal: <span class="text-slate-200 font-mono">${task.goalId || 'None'}</span></div>
      </div>

      <div class="bg-slate-950 p-3 rounded border border-slate-800">
        <div class="text-xs font-semibold text-slate-400 mb-1">ACCEPTANCE CRITERIA</div>
        <div class="text-xs text-slate-200 whitespace-pre-wrap">${task.acceptanceCriteria}</div>
      </div>

      ${task.declaredFiles && task.declaredFiles.length > 0 ? `
        <div class="bg-slate-950 p-3 rounded border border-slate-800">
          <div class="text-xs font-semibold text-slate-400 mb-1">DECLARED TOUCH FILES</div>
          <div class="text-xs font-mono text-blue-300">${task.declaredFiles.join(', ')}</div>
        </div>
      ` : ''}

      ${task.evidence ? `
        <div class="bg-slate-950 p-3 rounded border border-blue-500/30">
          <div class="text-xs font-semibold text-blue-400 mb-1">COMPLETION PROOF / EVIDENCE</div>
          <pre class="text-[11px] font-mono text-slate-300 whitespace-pre-wrap">${JSON.stringify(task.evidence, null, 2)}</pre>
        </div>
      ` : ''}

      ${subtasks.length > 0 ? `
        <div>
          <div class="text-xs font-semibold text-slate-400 mb-1">SUBTASKS (${subtasks.length})</div>
          <div class="space-y-1.5">
            ${subtasks.map((s) => `
              <div class="p-2 bg-slate-950 rounded border border-slate-800 flex items-center justify-between text-xs">
                <span>${s.title}</span>
                <span class="font-mono text-[10px] text-slate-400">[${s.status}]</span>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <div>
        <div class="text-xs font-semibold text-slate-400 mb-1">ACTIVITY & NOTES (${notes.length})</div>
        <div class="space-y-1.5 max-h-40 overflow-y-auto font-mono text-xs">
          ${notes.map((n) => `
            <div class="p-2 bg-slate-950 rounded border border-slate-800">
              <span class="text-slate-500 text-[10px]">${new Date(n.createdAt).toLocaleTimeString()}</span>
              <span class="text-blue-400 font-bold ml-1">${n.authorId}:</span>
              <span class="text-slate-300 ml-1">${n.content}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    const actions = document.getElementById('modalTaskActions');
    actions.innerHTML = `
      <button class="btn-secondary text-xs" onclick="promptDropTask('${task.id}')">Drop</button>
      ${task.status === 'done' || task.status === 'dropped' ? `
        <button class="btn-primary text-xs" onclick="reopenTask('${task.id}')">Reopen</button>
      ` : ''}
      <button class="btn-secondary text-xs" onclick="undoTask('${task.id}')">Undo Transition</button>
    `;

    modalTaskDetail.classList.remove('hidden');
  } catch (err) {
    console.error('Failed to open task modal:', err);
  }
}

// Global modal triggers
document.getElementById('btnNewGoal').onclick = () => modalCreateGoal.classList.remove('hidden');
document.getElementById('btnNewGoal2').onclick = () => modalCreateGoal.classList.remove('hidden');
document.getElementById('btnNewTask').onclick = () => modalCreateTask.classList.remove('hidden');
document.getElementById('btnNewDecision').onclick = () => modalCreateDecision.classList.remove('hidden');

document.querySelectorAll('.modal-close').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.modal-backdrop').forEach((m) => m.classList.add('hidden'));
  });
});

// Form Submissions
document.getElementById('formCreateGoal').onsubmit = async (e) => {
  e.preventDefault();
  const title = document.getElementById('inputGoalTitle').value;
  const verbatimPrompt = document.getElementById('inputGoalVerbatim').value;
  const maxOpenTasksCap = parseInt(document.getElementById('inputGoalCap').value) || 10;

  await fetch('/api/goals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, verbatimPrompt, maxOpenTasksCap }),
  });

  modalCreateGoal.classList.add('hidden');
  document.getElementById('formCreateGoal').reset();
  refreshAll();
};

document.getElementById('formCreateTask').onsubmit = async (e) => {
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
    alert(data.error || 'Failed to create task');
    return;
  }

  modalCreateTask.classList.add('hidden');
  document.getElementById('formCreateTask').reset();
  refreshAll();
};

document.getElementById('formCreateDecision').onsubmit = async (e) => {
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

  modalCreateDecision.classList.add('hidden');
  document.getElementById('formCreateDecision').reset();
  fetchDecisions();
};

// Interactive Actions
window.filterByGoal = (goalId) => {
  boardGoalFilter.value = goalId;
  state.selectedGoalId = goalId;
  switchTab('board');
  renderBoard();
};

boardGoalFilter.onchange = (e) => {
  state.selectedGoalId = e.target.value;
  renderBoard();
};

boardSearchInput.oninput = (e) => {
  state.searchQuery = e.target.value;
  renderBoard();
};

window.handleAnswerQuestion = async (e, taskId) => {
  e.preventDefault();
  const input = document.getElementById(`answer-input-${taskId}`);
  const answer = input.value;
  if (!answer) return;

  await fetch(`/api/tasks/${taskId}/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answer, humanId: 'human-operator' }),
  });

  refreshAll();
};

window.verifyTask = async (taskId) => {
  await fetch(`/api/tasks/${taskId}/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes: 'Verified via Web UI' }),
  });
  modalTaskDetail.classList.add('hidden');
  refreshAll();
};

window.promptRejectTask = (taskId) => {
  showReasonModal('Reject Task', async (reason) => {
    await fetch(`/api/tasks/${taskId}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    refreshAll();
  });
};

window.promptDropTask = (taskId) => {
  showReasonModal('Drop Task', async (reason) => {
    await fetch(`/api/tasks/${taskId}/drop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    modalTaskDetail.classList.add('hidden');
    refreshAll();
  });
};

window.reopenTask = async (taskId) => {
  await fetch(`/api/tasks/${taskId}/reopen`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'Reopened from Web UI' }),
  });
  modalTaskDetail.classList.add('hidden');
  refreshAll();
};

window.undoTask = async (taskId) => {
  await fetch(`/api/tasks/${taskId}/undo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  modalTaskDetail.classList.add('hidden');
  refreshAll();
};

window.promptKillGoal = (goalId) => {
  showReasonModal('Kill Goal and Cascade Drop Tasks', async (reason) => {
    await fetch(`/api/goals/${goalId}/kill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    refreshAll();
  });
};

window.reopenGoal = async (goalId) => {
  await fetch(`/api/goals/${goalId}/reopen`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  refreshAll();
};

function showReasonModal(title, callback) {
  document.getElementById('modalReasonTitle').textContent = title;
  const promptModal = document.getElementById('modalReasonPrompt');
  const form = document.getElementById('formReasonPrompt');
  const input = document.getElementById('inputReasonText');
  input.value = '';
  promptModal.classList.remove('hidden');

  form.onsubmit = async (e) => {
    e.preventDefault();
    const reason = input.value;
    promptModal.classList.add('hidden');
    await callback(reason);
  };
}

// Export Trigger
document.getElementById('btnExport').onclick = async () => {
  const res = await fetch('/api/export?format=markdown');
  const data = await res.json();
  const blob = new Blob([data.content], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `moo-tasks-export-${new Date().toISOString().slice(0, 10)}.md`;
  a.click();
};

// Startup
setupSSE();
refreshAll();
