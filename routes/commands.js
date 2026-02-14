const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const TASKS_FILE = path.join(__dirname, '..', 'data', 'commands.json');

function readTasks() {
  try { return JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8')); }
  catch { return { tasks: [], schedule: [] }; }
}

function writeTasks(data) {
  fs.writeFileSync(TASKS_FILE, JSON.stringify(data, null, 2));
}

// Ensure file exists
if (!fs.existsSync(TASKS_FILE)) writeTasks({ tasks: [], schedule: [] });

// Get all tasks and schedule
router.get('/', (req, res) => {
  res.json(readTasks());
});

// Add task
router.post('/tasks', (req, res) => {
  const data = readTasks();
  const task = {
    id: `task-${Date.now().toString(36)}`,
    text: req.body.text || '',
    done: false,
    priority: req.body.priority || 'normal',
    createdAt: new Date().toISOString()
  };
  data.tasks.push(task);
  writeTasks(data);
  req.app.locals.broadcast({ type: 'command:task', data: task });
  res.status(201).json(task);
});

// Toggle task done
router.put('/tasks/:id', (req, res) => {
  const data = readTasks();
  const task = data.tasks.find(t => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (req.body.done !== undefined) task.done = req.body.done;
  if (req.body.text !== undefined) task.text = req.body.text;
  if (req.body.priority !== undefined) task.priority = req.body.priority;
  writeTasks(data);
  req.app.locals.broadcast({ type: 'command:updated', data: task });
  res.json(task);
});

// Delete task
router.delete('/tasks/:id', (req, res) => {
  const data = readTasks();
  data.tasks = data.tasks.filter(t => t.id !== req.params.id);
  writeTasks(data);
  req.app.locals.broadcast({ type: 'command:deleted', data: { id: req.params.id } });
  res.json({ ok: true });
});

// Add schedule entry
router.post('/schedule', (req, res) => {
  const data = readTasks();
  const entry = {
    id: `sched-${Date.now().toString(36)}`,
    title: req.body.title || '',
    time: req.body.time || '',
    date: req.body.date || new Date().toISOString().split('T')[0],
    type: req.body.type || 'block',
    createdAt: new Date().toISOString()
  };
  data.schedule.push(entry);
  writeTasks(data);
  req.app.locals.broadcast({ type: 'schedule:new', data: entry });
  res.status(201).json(entry);
});

// Delete schedule entry
router.delete('/schedule/:id', (req, res) => {
  const data = readTasks();
  data.schedule = data.schedule.filter(s => s.id !== req.params.id);
  writeTasks(data);
  req.app.locals.broadcast({ type: 'schedule:deleted', data: { id: req.params.id } });
  res.json({ ok: true });
});

module.exports = router;
