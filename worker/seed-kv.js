#!/usr/bin/env node
/**
 * Seed KV with existing JSON data from Hub server.
 * Usage: node seed-kv.js
 */

const API = 'https://sweepnspect-webhook.sweepnspect.workers.dev';
const TOKEN = 'U7wukNrYGfnS4Q46UFHNoRpmlh0EWiIAzzVKC1EALHQ';

const headers = {
  'Authorization': `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
};

async function post(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) console.error(`  FAIL ${path}: ${JSON.stringify(data)}`);
  return data;
}

async function put(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'PUT', headers, body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) console.error(`  FAIL ${path}: ${JSON.stringify(data)}`);
  return data;
}

async function seed() {
  console.log('=== Seeding KV from JSON data ===\n');

  // Subscribers
  const subs = [
    { name: "Mike's Sweeps LLC", email: "mike@mikessweeps.com", plan: "pro", mrr: 49, status: "active", startDate: "2026-02-13T07:59:06.650Z" },
    { name: "Heritage Chimney", email: "info@heritagechimney.com", plan: "team", mrr: 99, status: "active", startDate: "2026-02-13T07:59:06.710Z" },
    { name: "Tristate Sweep Co", email: "dispatch@tristatesweep.com", plan: "solo", mrr: 29, status: "active", startDate: "2026-02-13T07:59:06.767Z" },
    { name: "Pro Chimney Solutions", email: "admin@prochimney.com", plan: "pro", mrr: 49, status: "trial", startDate: "2026-02-13T07:59:06.825Z" },
    { name: "Test Application", email: "test@example.com", plan: "founding", mrr: 0, status: "lead", source: "founding-form", startDate: "2026-02-25T21:10:43.915Z", founding: { yearsSweeping: 5, currentTools: "Paper forms", heardAbout: "Other", referredBy: "" } },
    { name: "E2E Test Sweep", email: "e2etest@example.com", plan: "founding", mrr: 0, status: "lead", source: "founding-form", startDate: "2026-02-25T21:11:32.039Z", founding: { yearsSweeping: 12, currentTools: "Paper forms and photos", heardAbout: "Convention", referredBy: "Cody" } },
  ];

  console.log('Subscribers:');
  for (const s of subs) {
    const result = await post('/api/subscribers', s);
    console.log(`  ${result.id || 'ERR'}: ${s.name}`);
  }

  // Tickets
  const tickets = [
    { status: "review", priority: "critical", customer: { name: "Mike", email: "mike@mikessweeps.com", subscriberId: "s-001" }, subject: "App crashes on photo capture - Galaxy S21", description: "When I try to take a photo during an inspection, the app crashes back to the home screen.", aiAnalysis: { diagnosis: "Camera permission regression in v2.4.1", proposedFix: "Replace deprecated checkSelfPermission call with ActivityResultContracts.RequestPermission API", confidence: 0.92, relatedIssues: ["Camera permission issue on Pixel 7 (resolved Oct 2025)"], analyzedAt: "2026-02-12T22:00:00Z" } },
    { status: "new", priority: "high", customer: { name: "Heritage Chimney", email: "info@heritagechimney.com", subscriberId: "s-002" }, subject: "Invoice PDF not generating for amended reports", description: "When I amend a completed inspection report and try to generate a new invoice PDF, it just spins forever." },
    { status: "resolved", priority: "high", customer: { name: "Tristate Sweep", email: "dispatch@tristatesweep.com", subscriberId: "s-003" }, subject: "Login loop after Android 15 update", description: "Since updating to Android 15, the app asks me to log in, I enter credentials, it accepts them, then immediately asks me to log in again." },
    { status: "new", priority: "high", source: "email-bug", customer: { name: "Mike Johnson", email: "contact@sweepnspect.com" }, subject: "Camera freezes on Zone 3 edit", description: "" },
  ];

  console.log('\nTickets:');
  for (const t of tickets) {
    const result = await post('/api/tickets', t);
    console.log(`  ${result.id || 'ERR'}: ${t.subject}`);
    // If it has aiAnalysis or resolution, update after creation
    if (t.aiAnalysis && result.id) {
      await put(`/api/tickets/${result.id}`, { aiAnalysis: t.aiAnalysis, status: t.status });
    }
  }

  // Revenue
  const revenue = [
    { type: "subscription", amount: 49, subscriberId: "s-001", date: "2026-02-13T07:59:06.885Z", note: "Monthly - Mike's Sweeps" },
    { type: "subscription", amount: 99, subscriberId: "s-002", date: "2026-02-13T07:59:06.952Z", note: "Monthly - Heritage Chimney" },
    { type: "subscription", amount: 29, subscriberId: "s-003", date: "2026-02-13T07:59:07.010Z", note: "Monthly - Tristate" },
    { type: "one-time", amount: 150, subscriberId: "s-002", date: "2026-02-13T10:04:43.731Z", note: "Custom report setup" },
  ];

  console.log('\nRevenue:');
  for (const r of revenue) {
    const result = await post('/api/revenue', r);
    console.log(`  ${result.id || 'ERR'}: $${r.amount} ${r.note}`);
  }

  // Verify stats
  console.log('\n--- Verifying Stats ---');
  const statsRes = await fetch(`${API}/api/stats`, { headers });
  const stats = await statsRes.json();
  console.log(`  Tickets: ${stats.tickets.total} total, ${stats.tickets.open} open`);
  console.log(`  Subscribers: ${stats.subscribers.total} total, ${stats.subscribers.active} active`);
  console.log(`  Revenue: $${stats.revenue.mrr} MRR, $${stats.revenue.totalAllTime} all-time`);
  console.log(`  Alerts: ${stats.alerts.total} total`);
  console.log('\n=== Seed complete ===');
}

seed().catch(err => console.error('Seed failed:', err));
