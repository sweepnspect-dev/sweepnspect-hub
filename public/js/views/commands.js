// ── Commands View (Life Org) ────────────────────────────
const CommandsView = {
  data: { tasks: [], schedule: [] },

  render(container) {
    container.innerHTML = `
      <div class="panel-grid">
        <div>
          <div class="panel">
            <div class="panel-header">
              <h2>Tasks</h2>
              <button class="btn btn-sm btn-primary" onclick="CommandsView.showNewTaskModal()">+ Add</button>
            </div>
            <div class="panel-body" id="taskListContainer">
              <div class="empty-state" style="padding:16px"><p>Loading...</p></div>
            </div>
          </div>
        </div>

        <div>
          <div class="panel">
            <div class="panel-header">
              <h2>Schedule</h2>
              <button class="btn btn-sm btn-primary" onclick="CommandsView.showNewScheduleModal()">+ Add</button>
            </div>
            <div class="panel-body" id="scheduleContainer">
              <div class="empty-state" style="padding:16px"><p>Loading...</p></div>
            </div>
          </div>

          <div class="panel" style="margin-top:20px">
            <div class="panel-header">
              <h2>Quick Commands</h2>
            </div>
            <div class="panel-body">
              <div class="quick-actions">
                <button class="btn btn-ghost btn-sm" onclick="HubNotify.toast('Phone MCP not yet connected','info')">Set Alarm</button>
                <button class="btn btn-ghost btn-sm" onclick="HubNotify.toast('Phone MCP not yet connected','info')">Set Timer</button>
                <button class="btn btn-ghost btn-sm" onclick="HubNotify.toast('Phone MCP not yet connected','info')">Send Notification</button>
              </div>
              <p style="font-size:11px;color:var(--text-muted);margin-top:12px">Phone MCP integration coming in Phase 2. Quick commands will wire directly to your Android device.</p>
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
  },

  renderTasks() {
    const el = document.getElementById('taskListContainer');
    if (!el) return;
    const tasks = this.data.tasks || [];
    if (tasks.length === 0) {
      el.innerHTML = '<div class="empty-state" style="padding:16px"><p>No tasks yet. Add one!</p></div>';
      return;
    }
    // Sort: undone first, then by creation
    const sorted = [...tasks].sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
    el.innerHTML = `<ul class="task-list">${sorted.map(t => `
      <li class="task-item ${t.done ? 'done' : ''}">
        <input type="checkbox" ${t.done ? 'checked' : ''} onchange="CommandsView.toggleTask('${t.id}', this.checked)">
        <span class="task-text">${this.esc(t.text)}</span>
        ${t.priority !== 'normal' ? `<span style="font-size:10px;color:${t.priority === 'high' ? 'var(--yellow)' : 'var(--text-muted)'}">${t.priority}</span>` : ''}
        <button class="task-delete" onclick="CommandsView.deleteTask('${t.id}')">&times;</button>
      </li>
    `).join('')}</ul>`;
  },

  renderSchedule() {
    const el = document.getElementById('scheduleContainer');
    if (!el) return;
    const items = this.data.schedule || [];
    if (items.length === 0) {
      el.innerHTML = '<div class="empty-state" style="padding:16px"><p>No schedule entries</p></div>';
      return;
    }
    // Sort by date then time
    const sorted = [...items].sort((a, b) => {
      const da = `${a.date} ${a.time}`;
      const db = `${b.date} ${b.time}`;
      return da.localeCompare(db);
    });
    el.innerHTML = `<ul class="activity-list">${sorted.map(s => `
      <li class="activity-item">
        <div class="activity-dot system"></div>
        <div style="flex:1">
          <div class="activity-text">${this.esc(s.title)}</div>
          <div class="activity-time">${s.date} ${s.time ? 'at ' + s.time : ''} &middot; ${s.type}</div>
        </div>
        <button class="task-delete" onclick="CommandsView.deleteSchedule('${s.id}')">&times;</button>
      </li>
    `).join('')}</ul>`;
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
    `, async (overlay) => {
      const text = overlay.querySelector('#taskText').value;
      const priority = overlay.querySelector('#taskPriority').value;
      if (!text) return HubNotify.toast('Task text required', 'error');
      await App.api('commands/tasks', { method: 'POST', body: { text, priority } });
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

  onWsMessage(type) {
    if (type && (type.startsWith('command:') || type.startsWith('schedule:'))) {
      this.loadData();
    }
  },

  esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }
};
