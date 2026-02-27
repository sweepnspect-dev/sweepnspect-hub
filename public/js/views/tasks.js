// ══════════════════════════════════════════════════════════
// Tasks View — To-dos, Schedule, Reminders
// Upgraded from Commands with priorities & due dates
// ══════════════════════════════════════════════════════════
const TasksView = {
  data: { tasks: [], schedule: [] },
  taskFilter: 'active',  // 'active', 'done', 'all'

  render(container) {
    container.innerHTML = `
      <div class="tasks-view">
        <div class="panel-grid">
          <div>
            <div class="panel">
              <div class="panel-header">
                <h2>Tasks</h2>
                <div class="panel-header-actions">
                  <div class="task-filter-group">
                    <button class="btn btn-xs ${this.taskFilter === 'active' ? 'btn-primary' : 'btn-ghost'}" onclick="TasksView.setTaskFilter('active')">Active</button>
                    <button class="btn btn-xs ${this.taskFilter === 'done' ? 'btn-primary' : 'btn-ghost'}" onclick="TasksView.setTaskFilter('done')">Done</button>
                    <button class="btn btn-xs ${this.taskFilter === 'all' ? 'btn-primary' : 'btn-ghost'}" onclick="TasksView.setTaskFilter('all')">All</button>
                  </div>
                  <button class="btn btn-sm btn-primary" onclick="TasksView.showNewTaskModal()">+ Add</button>
                </div>
              </div>
              <div class="panel-body" id="taskListContainer">
                <div class="empty-state" style="padding:16px"><p>Loading...</p></div>
              </div>
            </div>

            <div class="panel" style="margin-top:20px">
              <div class="panel-header">
                <h2>Quick Add</h2>
              </div>
              <div class="panel-body">
                <div class="quick-add-row">
                  <input class="form-input" id="quickTaskInput" placeholder="Quick add task..." onkeydown="if(event.key==='Enter')TasksView.quickAddTask()">
                  <button class="btn btn-primary btn-sm" onclick="TasksView.quickAddTask()">Add</button>
                </div>
              </div>
            </div>
          </div>

          <div>
            <div class="panel">
              <div class="panel-header">
                <h2>Schedule</h2>
                <button class="btn btn-sm btn-primary" onclick="TasksView.showNewScheduleModal()">+ Add</button>
              </div>
              <div class="panel-body" id="scheduleContainer">
                <div class="empty-state" style="padding:16px"><p>Loading...</p></div>
              </div>
            </div>

            <div class="panel" style="margin-top:20px">
              <div class="panel-header">
                <h2>Upcoming</h2>
              </div>
              <div class="panel-body" id="upcomingContainer">
                <div class="empty-state" style="padding:16px"><p>Nothing scheduled</p></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    this.loadData();
  },

  async loadData() {
    this.data = await App.api('commands');
    this.renderTasks();
    this.renderSchedule();
    this.renderUpcoming();
  },

  setTaskFilter(f) {
    this.taskFilter = f;
    // Update filter buttons
    document.querySelectorAll('.task-filter-group .btn').forEach(b => {
      const label = b.textContent.trim().toLowerCase();
      b.className = `btn btn-xs ${label === f ? 'btn-primary' : 'btn-ghost'}`;
    });
    this.renderTasks();
  },

  renderTasks() {
    const el = document.getElementById('taskListContainer');
    if (!el) return;
    let tasks = this.data.tasks || [];

    // Apply filter
    if (this.taskFilter === 'active') {
      tasks = tasks.filter(t => !t.done);
    } else if (this.taskFilter === 'done') {
      tasks = tasks.filter(t => t.done);
    }

    if (tasks.length === 0) {
      const msg = this.taskFilter === 'done' ? 'No completed tasks' : 'No tasks yet. Add one!';
      el.innerHTML = `<div class="empty-state" style="padding:16px"><p>${msg}</p></div>`;
      return;
    }

    // Sort: high priority first, then by creation date
    const sorted = [...tasks].sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      const pa = { high: 0, normal: 1, low: 2 };
      if ((pa[a.priority] || 1) !== (pa[b.priority] || 1)) return (pa[a.priority] || 1) - (pa[b.priority] || 1);
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

    el.innerHTML = `<ul class="task-list">${sorted.map(t => {
      const priorityCls = t.priority === 'high' ? 'task-priority-high' : t.priority === 'low' ? 'task-priority-low' : '';
      const dueStr = t.dueDate ? this.formatDue(t.dueDate) : '';
      const overdue = t.dueDate && !t.done && new Date(t.dueDate) < new Date() ? ' task-overdue' : '';
      return `
        <li class="task-item ${t.done ? 'done' : ''} ${priorityCls}${overdue}">
          <input type="checkbox" ${t.done ? 'checked' : ''} onchange="TasksView.toggleTask('${t.id}', this.checked)">
          <div class="task-content">
            <span class="task-text">${App.esc(t.text)}</span>
            ${dueStr ? `<span class="task-due${overdue}">${dueStr}</span>` : ''}
          </div>
          ${t.priority !== 'normal' ? `<span class="task-priority-tag ${priorityCls}">${t.priority}</span>` : ''}
          <button class="task-delete" onclick="TasksView.deleteTask('${t.id}')">&times;</button>
        </li>
      `;
    }).join('')}</ul>`;
  },

  renderSchedule() {
    const el = document.getElementById('scheduleContainer');
    if (!el) return;
    const items = this.data.schedule || [];
    if (items.length === 0) {
      el.innerHTML = '<div class="empty-state" style="padding:16px"><p>No schedule entries</p></div>';
      return;
    }
    const sorted = [...items].sort((a, b) => {
      const da = `${a.date} ${a.time}`;
      const db = `${b.date} ${b.time}`;
      return da.localeCompare(db);
    });
    el.innerHTML = `<ul class="schedule-list">${sorted.map(s => `
      <li class="schedule-item">
        <div class="schedule-dot ${s.type}"></div>
        <div class="schedule-content">
          <div class="schedule-title">${App.esc(s.title)}</div>
          <div class="schedule-time">${s.date} ${s.time ? 'at ' + s.time : ''} &middot; ${s.type}</div>
        </div>
        <button class="task-delete" onclick="TasksView.deleteSchedule('${s.id}')">&times;</button>
      </li>
    `).join('')}</ul>`;
  },

  renderUpcoming() {
    const el = document.getElementById('upcomingContainer');
    if (!el) return;

    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const weekFromNow = new Date(now.getTime() + 7 * 86400000).toISOString().split('T')[0];

    // Combine tasks with due dates + schedule items
    const upcoming = [];

    (this.data.tasks || []).forEach(t => {
      if (t.dueDate && !t.done && t.dueDate <= weekFromNow) {
        upcoming.push({ title: t.text, date: t.dueDate, type: 'task', priority: t.priority });
      }
    });

    (this.data.schedule || []).forEach(s => {
      if (s.date >= today && s.date <= weekFromNow) {
        upcoming.push({ title: s.title, date: s.date, time: s.time, type: s.type });
      }
    });

    upcoming.sort((a, b) => `${a.date} ${a.time || ''}`.localeCompare(`${b.date} ${b.time || ''}`));

    if (upcoming.length === 0) {
      el.innerHTML = '<div class="empty-state" style="padding:16px"><p>Nothing upcoming this week</p></div>';
      return;
    }

    el.innerHTML = `<ul class="upcoming-list">${upcoming.map(u => {
      const isToday = u.date === today;
      const isOverdue = u.date < today;
      return `
        <li class="upcoming-item${isOverdue ? ' overdue' : ''}${isToday ? ' today' : ''}">
          <div class="upcoming-date">${isToday ? 'Today' : this.shortDate(u.date)}</div>
          <div class="upcoming-title">${App.esc(u.title)}</div>
          <span class="upcoming-type ${u.type}">${u.type}</span>
        </li>
      `;
    }).join('')}</ul>`;
  },

  async quickAddTask() {
    const input = document.getElementById('quickTaskInput');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    await App.api('commands/tasks', { method: 'POST', body: { text, priority: 'normal' } });
    input.value = '';
    HubNotify.toast('Task added', 'success');
    this.loadData();
  },

  async toggleTask(id, done) {
    await App.api(`commands/tasks/${id}`, { method: 'PUT', body: { done } });
    this.loadData();
  },

  async deleteTask(id) {
    await App.api(`commands/tasks/${id}`, { method: 'DELETE' });
    this.loadData();
  },

  async deleteSchedule(id) {
    await App.api(`commands/schedule/${id}`, { method: 'DELETE' });
    this.loadData();
  },

  showNewTaskModal() {
    const today = new Date().toISOString().split('T')[0];
    App.showModal('Add Task', `
      <div class="form-group">
        <label>Task</label>
        <input class="form-input" id="taskText" placeholder="What needs doing?">
      </div>
      <div class="form-group">
        <label>Priority</label>
        <select class="form-select" id="taskPriority">
          <option value="normal">Normal</option>
          <option value="high">High</option>
          <option value="low">Low</option>
        </select>
      </div>
      <div class="form-group">
        <label>Due Date (optional)</label>
        <input class="form-input" id="taskDue" type="date" min="${today}">
      </div>
    `, async (overlay) => {
      const text = overlay.querySelector('#taskText').value;
      const priority = overlay.querySelector('#taskPriority').value;
      const dueDate = overlay.querySelector('#taskDue').value || null;
      if (!text) return HubNotify.toast('Task text required', 'error');
      await App.api('commands/tasks', { method: 'POST', body: { text, priority, dueDate } });
      HubNotify.toast('Task added', 'success');
      this.loadData();
    });
  },

  showNewScheduleModal() {
    const today = new Date().toISOString().split('T')[0];
    App.showModal('Add Schedule Entry', `
      <div class="form-group">
        <label>Title</label>
        <input class="form-input" id="schedTitle" placeholder="Meeting, call, block...">
      </div>
      <div class="form-group">
        <label>Date</label>
        <input class="form-input" id="schedDate" type="date" value="${today}">
      </div>
      <div class="form-group">
        <label>Time</label>
        <input class="form-input" id="schedTime" type="time">
      </div>
      <div class="form-group">
        <label>Type</label>
        <select class="form-select" id="schedType">
          <option value="block">Time Block</option>
          <option value="meeting">Meeting</option>
          <option value="reminder">Reminder</option>
          <option value="deadline">Deadline</option>
        </select>
      </div>
    `, async (overlay) => {
      const data = {
        title: overlay.querySelector('#schedTitle').value,
        date: overlay.querySelector('#schedDate').value,
        time: overlay.querySelector('#schedTime').value,
        type: overlay.querySelector('#schedType').value
      };
      if (!data.title) return HubNotify.toast('Title required', 'error');
      await App.api('commands/schedule', { method: 'POST', body: data });
      HubNotify.toast('Added to schedule', 'success');
      this.loadData();
    });
  },

  formatDue(dateStr) {
    const d = new Date(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff = Math.ceil((d - today) / 86400000);
    if (diff < 0) return `${Math.abs(diff)}d overdue`;
    if (diff === 0) return 'Due today';
    if (diff === 1) return 'Due tomorrow';
    if (diff <= 7) return `Due in ${diff}d`;
    return 'Due ' + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  },

  shortDate(dateStr) {
    return new Date(dateStr).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  },

  onWsMessage(type) {
    if (type && (type.startsWith('command:') || type.startsWith('schedule:'))) {
      this.loadData();
    }
  }
};
