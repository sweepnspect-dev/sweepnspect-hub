// ── Automation Rules Engine ─────────────────────────────────────
// Evaluates Hub events against a JSON rules file.
// Dispatches actions: relay_notify, claude_dispatch, create_task, adb_command.

const fs = require('fs');
const path = require('path');

const RULES_FILE = path.join(__dirname, '..', 'data', 'automation-rules.json');
const LOG_FILE = path.join(__dirname, '..', 'data', 'automation-log.json');
const MAX_LOG = 200;

class AutomationRules {
  constructor(relayBridge, broadcast) {
    this.relay = relayBridge;
    this.broadcast = broadcast;
    this.log = this._loadLog();
  }

  // ── Rules CRUD ────────────────────────────────────────────

  getRules() {
    try {
      return JSON.parse(fs.readFileSync(RULES_FILE, 'utf8'));
    } catch {
      return [];
    }
  }

  saveRules(rules) {
    fs.writeFileSync(RULES_FILE, JSON.stringify(rules, null, 2));
  }

  getRule(id) {
    return this.getRules().find(r => r.id === id);
  }

  addRule(rule) {
    const rules = this.getRules();
    rule.id = rule.id || `rule-${Date.now().toString(36)}`;
    rule.enabled = rule.enabled !== false;
    rules.push(rule);
    this.saveRules(rules);
    return rule;
  }

  updateRule(id, updates) {
    const rules = this.getRules();
    const idx = rules.findIndex(r => r.id === id);
    if (idx === -1) return null;
    rules[idx] = { ...rules[idx], ...updates, id };
    this.saveRules(rules);
    return rules[idx];
  }

  deleteRule(id) {
    const rules = this.getRules();
    const filtered = rules.filter(r => r.id !== id);
    if (filtered.length === rules.length) return false;
    this.saveRules(filtered);
    return true;
  }

  // ── Evaluation ────────────────────────────────────────────

  async evaluate(eventType, data) {
    const rules = this.getRules().filter(r => r.enabled && r.event === eventType);
    if (rules.length === 0) return [];

    const results = [];

    for (const rule of rules) {
      if (!this._checkConditions(rule.conditions, data)) continue;

      const entry = {
        ruleId: rule.id,
        ruleName: rule.name,
        event: eventType,
        timestamp: new Date().toISOString(),
        actions: []
      };

      for (const action of rule.actions) {
        try {
          const result = await this._executeAction(action, data);
          entry.actions.push({ type: action.type, status: 'ok', result });
        } catch (err) {
          entry.actions.push({ type: action.type, status: 'error', error: err.message });
        }
      }

      results.push(entry);
      this._appendLog(entry);

      // Broadcast automation activity
      this.broadcast({
        type: 'automation:fired',
        data: { rule: rule.name, event: eventType, actions: entry.actions.length }
      });
    }

    return results;
  }

  // ── Condition Operators ───────────────────────────────────

  _checkConditions(conditions, data) {
    if (!conditions || conditions.length === 0) return true;

    return conditions.every(cond => {
      const value = this._resolve(cond.field, data);

      switch (cond.op) {
        case 'eq':
          return value === cond.value;
        case 'neq':
          return value !== cond.value;
        case 'in':
          return Array.isArray(cond.value) && cond.value.includes(value);
        case 'contains':
          return typeof value === 'string' && value.toLowerCase().includes(String(cond.value).toLowerCase());
        case 'exists':
          return value !== undefined && value !== null;
        case 'gt':
          return Number(value) > Number(cond.value);
        case 'lt':
          return Number(value) < Number(cond.value);
        default:
          return false;
      }
    });
  }

  // ── Template Resolution ───────────────────────────────────

  _resolve(field, data) {
    return field.split('.').reduce((obj, key) => obj && obj[key], data);
  }

  _template(str, data) {
    return str.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_, field) => {
      const val = this._resolve(field, data);
      return val !== undefined && val !== null ? String(val) : '';
    });
  }

  // ── Action Execution ──────────────────────────────────────

  async _executeAction(action, data) {
    switch (action.type) {
      case 'relay_notify': {
        const body = this._template(action.template, data);
        const to = action.to || 'z';
        await this.relay.sendMessage('hub-automation', to, body);
        return { sent: true, to, body };
      }

      case 'claude_dispatch': {
        const prompt = this._template(action.template, data);
        // Post to relay's automation queue for event watcher to pick up
        await this.relay.sendMessage('hub-automation', 'automation', `DISPATCH: ${prompt}`);
        return { dispatched: true, prompt: prompt.substring(0, 100) + '...' };
      }

      case 'create_task': {
        const title = this._template(action.title, data);
        const assignee = action.assignee || 'z';
        const priority = action.priority || 'normal';
        await this.relay.createTask(title, assignee, { priority });
        return { created: true, title, assignee };
      }

      case 'adb_command': {
        // Phase 4 — placeholder for ADB automation
        return { skipped: true, reason: 'ADB actions not yet implemented' };
      }

      default:
        return { skipped: true, reason: `Unknown action type: ${action.type}` };
    }
  }

  // ── Log ───────────────────────────────────────────────────

  _loadLog() {
    try {
      return JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
    } catch {
      return [];
    }
  }

  _appendLog(entry) {
    this.log.push(entry);
    if (this.log.length > MAX_LOG) {
      this.log = this.log.slice(-MAX_LOG);
    }
    try {
      fs.writeFileSync(LOG_FILE, JSON.stringify(this.log, null, 2));
    } catch (err) {
      console.error('[AUTOMATION] Failed to write log:', err.message);
    }
  }

  getLog(limit = 50) {
    return this.log.slice(-limit);
  }
}

module.exports = AutomationRules;
