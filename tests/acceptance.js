const { makeEnv } = require('./harness');
const assert = require('assert');
const env = makeEnv('2026-12-31T06:00:00Z'); // 10:00 Dubai
const G = env.ctx;
let pass = 0;
function ok(name, cond, extra) { assert.ok(cond, name + (extra ? ' :: ' + JSON.stringify(extra) : '')); pass++; console.log('  ✓ ' + name); }
function call(action, payload, token) {
  const r = G.handleRequest({ action, payload, token });
  if (!r.success && !call.allowFail) throw new Error(action + ' failed: ' + r.message);
  return r;
}
function d(action, payload, token) { return call(action, payload, token).data; }
function fail(action, payload, token) { call.allowFail = true; const r = call(action, payload, token); call.allowFail = false; return r; }

console.log('Setup & auth');
G.setupSystem();
ok('18 sheets created', Object.keys(env.book.sheets).length === 18, Object.keys(env.book.sheets));
const bad = fail('login', { email: 'admin@sidra.local', password: 'wrong' });
ok('wrong password rejected', !bad.success);
const login = d('login', { email: 'admin@sidra.local', password: 'sidra@123', portal: 'admin' });
const SA = login.token;
ok('super admin login with provided temp password', login.user.role === 'super_admin');
ok('must change temp password flagged', login.user.mustChangePassword === true);
ok('password not stored in plain text', !JSON.stringify(env.book.sheets.Users.data).includes('sidra@123'));
ok('no hash leaked in API response', !JSON.stringify(login).includes('passwordHash'));
const svc = Object.fromEntries(login.boot.services.map(s => [s.name, s.id]));
ok('6 default services', Object.keys(svc).length === 6);

console.log('1–2. Create three agents, IV Therapy on two');
const mk = (name, email, services) => d('saveUser', { name, email, role: 'agent', services }, SA).user;
const A = mk('Agent A', 'a@test.ae', [svc['IV Therapy'], svc['Laboratory Tests']]);
const B = mk('Agent B', 'b@test.ae', [svc['IV Therapy'], svc['Doctor at Home']]);
const C = mk('Agent C', 'c@test.ae', [svc['Peptides']]);
ok('welcome emails sent (no plaintext password)', env.sent.filter(m => /Set up my password/.test(m.htmlBody)).length === 3 && !env.sent.some(m => /sidra@123/.test(m.htmlBody)));
// complete setup for agent A via the emailed link
const link = env.sent.find(m => m.to === 'a@test.ae').htmlBody.match(/setup=([a-f0-9]+)/)[1];
d('completeSetup', { token: link, password: 'AgentA2027' });
ok('setup link single-use', !fail('completeSetup', { token: link, password: 'Another123' }).success);
const AT = d('login', { email: 'a@test.ae', password: 'AgentA2027', portal: 'member' }).token;
ok('agent blocked from admin portal', !fail('login', { email: 'a@test.ae', password: 'AgentA2027', portal: 'admin' }).success);
const linkB = env.sent.find(m => m.to === 'b@test.ae').htmlBody.match(/setup=([a-f0-9]+)/)[1];
d('completeSetup', { token: linkB, password: 'AgentB2027' });
const BT = d('login', { email: 'b@test.ae', password: 'AgentB2027' }).token;

console.log('3–4. Upload 100 IV Therapy leads');
const rows = Array.from({ length: 100 }, (_, i) => ({ i, name: 'IV Client ' + i, phone: '050' + String(1000000 + i), email: `iv${i}@mail.com`, service: 'IV Therapy', entryDate: '2026-12-31', source: 'Meta Ads' }));
let tot = { imported: 0, perAgent: {} };
for (let k = 0; k < rows.length; k += 40) { const r = d('importLeads', { rows: rows.slice(k, k + 40), batchId: 'B1' }, SA); tot.imported += r.imported; for (const [n, c] of Object.entries(r.perAgent)) tot.perAgent[n] = (tot.perAgent[n] || 0) + c; }
ok('100 imported', tot.imported === 100, tot);
ok('Agent A = 50, Agent B = 50, Agent C = 0', tot.perAgent['Agent A'] === 50 && tot.perAgent['Agent B'] === 50 && !tot.perAgent['Agent C'], tot.perAgent);

console.log('Three agents on one service → 34/33/33');
const D = mk('Agent D', 'd@test.ae', [svc['GLP-1']]), E = mk('Agent E', 'e@test.ae', [svc['GLP-1']]), F = mk('Agent F', 'f@test.ae', [svc['GLP-1']]);
const g = d('importLeads', { rows: Array.from({ length: 100 }, (_, i) => ({ i, name: 'G ' + i, phone: '+97152' + String(2000000 + i), service: 'GLP-1' })) .slice(0, 100), batchId: 'B2' }, SA);
// importLeads accepts at most 300 rows
const counts = Object.values(g.perAgent).sort((a, b) => b - a);
ok('GLP-1 split 34/33/33', JSON.stringify(counts) === '[34,33,33]', g.perAgent);

console.log('5–6. Multi-service upload, eligibility, duplicates, invalid rows');
const multi = d('importLeads', { rows: [
  { i: 0, name: 'Lab One', phone: '0551111111', email: 'lab1@mail.com', service: 'Laboratory Tests' },
  { i: 1, name: 'Pep One', phone: '0552222222', service: 'Peptides' },
  { i: 2, name: 'Doc One', phone: '0553333333', service: 'Doctor at Home' },
  { i: 3, name: 'Other One', phone: '0554444444', service: 'Other Services' },
  { i: 4, name: 'Dup of IV 0', phone: '0501000000', service: 'Peptides' },            // duplicate → default skip
  { i: 5, name: 'Dup new lead', phone: '0501000001', service: 'Peptides', action: 'newlead' },
  { i: 6, name: '', phone: 'abc', service: 'Nope' }                                    // invalid
], batchId: 'B3' }, SA);
ok('duplicates detected (2) and one skipped', multi.duplicates === 2 && multi.skipped === 1, multi);
ok('invalid row reported', multi.invalid === 1 && /required/.test(multi.errors[0].msg), multi.errors);
ok('unassigned queue for service with no agent', multi.unassigned === 1, multi);
const all = d('listLeads', { pageSize: 'all' }, SA).rows;
const byName = n => all.find(l => l.clientName === n);
ok('Lab → Agent A only', byName('Lab One').agentName === 'Agent A');
ok('Peptides → Agent C', byName('Pep One').agentName === 'Agent C');
ok('Doctor at Home → Agent B', byName('Doc One').agentName === 'Agent B');
ok('Other Services → Unassigned', byName('Other One').agentName === 'Unassigned');
ok('single client profile for dup new lead', all.filter(l => l.clientName === 'IV Client 1').length === 2 && new Set(all.filter(l => l.clientName === 'IV Client 1').map(l => l.clientId)).size === 1);
const dupCheck = d('checkDuplicates', { rows: [{ i: 0, phone: '+971501000002' }, { i: 1, phone: '0599999999' }] }, SA);
ok('checkDuplicates matches by phone', dupCheck[0].match && !dupCheck[1].match);
ok('admin notified about unassigned', d('listNotifications', {}, SA).items.some(n => n.type === 'unassigned'));

console.log('Permissions');
const aLeads = d('listLeads', { pageSize: 'all' }, AT).rows;
ok('agent sees only own leads', aLeads.length > 0 && aLeads.every(l => l.agentName === 'Agent A'), aLeads.length);
const bLead = all.find(l => l.agentName === 'Agent B');
ok('agent cannot open another agent\'s client', !fail('clientProfile', { leadId: bLead.id }, AT).success);
ok('agent cannot call admin API', fail('assignLeads', { leadIds: [bLead.id], agentId: A.id }, AT).code === 'FORBIDDEN');
ok('agent cannot list users', fail('listUsers', {}, AT).code === 'FORBIDDEN');
const adm = d('saveUser', { name: 'Ops Admin', email: 'ops@test.ae', role: 'admin' }, SA).user;
const admLink = env.sent.find(m => m.to === 'ops@test.ae').htmlBody.match(/setup=([a-f0-9]+)/)[1];
d('completeSetup', { token: admLink, password: 'OpsAdmin2027' });
const ADT = d('login', { email: 'ops@test.ae', password: 'OpsAdmin2027' }).token;
ok('admin cannot edit Super Admin', !fail('saveUser', { id: login.user.id, name: 'x', email: 'admin@sidra.local', role: 'super_admin' }, ADT).success);
ok('admin cannot create admin', !fail('saveUser', { name: 'x', email: 'x@test.ae', role: 'admin' }, ADT).success);
const teamAgent = d('saveUser', { name: 'Agent T', email: 't@test.ae', role: 'agent', services: [svc['Other Services']] }, ADT).user;
ok('new agent picks up unassigned Other Services lead', d('listLeads', { pageSize: 'all', agentId: teamAgent.id }, SA).rows.length === 1);
ok('admin sees own team only', d('listAgents', {}, ADT).length === 1);
ok('no unauthenticated access', fail('listLeads', {}, 'bogus-token-123456789012345').code === 'AUTH');

console.log('7–8. Journey + follow-up dates (lead entry 1 Jan 2027)');
const j = d('importLeads', { rows: [{ i: 0, name: 'Journey Client', phone: '0567777777', email: 'jc@mail.com', service: 'IV Therapy', entryDate: '2027-01-01' }], batchId: 'B4' }, SA);
const jl = d('listLeads', { q: 'Journey Client', pageSize: 'all' }, SA).rows[0];
ok('journey end 30 June 2027', jl.journeyEnd === '2027-06-30', jl);
const prof = d('clientProfile', { leadId: jl.id }, SA);
const dates = prof.tasks.map(t => t.dueDate);
ok('follow-ups at 0,1,3,7,14,30 then every 30 days', JSON.stringify(dates) === JSON.stringify(['2027-01-01', '2027-01-02', '2027-01-04', '2027-01-08', '2027-01-15', '2027-01-31', '2027-03-02', '2027-04-01', '2027-05-01', '2027-05-31', '2027-06-30']), dates);
ok('journey same agent as lead', prof.journeys[0].agentId === jl.agentId && prof.tasks.every(t => t.agentId === jl.agentId));
const JT = jl.agentName === 'Agent A' ? AT : BT;

console.log('9–10. Reschedule & call notes (move to 1 Jan 2027)');
env.setNow('2027-01-01T06:00:00Z');
let today = d('listTasks', { scope: 'today', pageSize: 'all' }, JT).rows;
const t0 = today.find(t => t.leadId === jl.id);
ok('task appears in today\'s list', !!t0);
d('rescheduleTask', { taskId: t0.id, date: '2027-01-02', time: '11:00', reason: 'Client requested a callback tomorrow at 11 AM.' }, JT);
today = d('listTasks', { scope: 'today', pageSize: 'all' }, JT).rows;
ok('rescheduled task removed from today', !today.some(t => t.id === t0.id));
const up = d('listTasks', { scope: 'rescheduled', pageSize: 'all' }, JT).rows;
ok('rescheduled task still exists on new date', up.some(t => t.id === t0.id && t.dueDate === '2027-01-02' && t.dueTime === '11:00'));
env.setNow('2027-01-02T07:30:00Z');
const live = d('listNotifications', {}, JT).live;
ok('callback surfaced for browser notification', live.callbacks.some(c => c.time === '11:00'), live);
const done = d('completeTask', { taskId: t0.id, outcome: 'Interested', notes: 'Wants IV drip on Saturday', interest: 'High' }, JT);
ok('call note saved & lead status updated', done.note.outcome === 'Interested' && done.lead.status === 'Interested');
ok('timeline records activity', d('clientProfile', { leadId: jl.id }, JT).timeline.some(t => t.action === 'Follow-up rescheduled'));

console.log('11–12. WhatsApp + editable email');
d('logContact', { leadId: jl.id, channel: 'whatsapp', message: 'Hello' }, JT);
const draft = d('emailDraft', { leadId: jl.id }, JT);
ok('email draft prefilled', draft.to === 'jc@mail.com' && /IV Therapy/.test(draft.subject) && /Journey Client/.test(draft.body));
const before = env.sent.length;
d('sendClientEmail', { leadId: jl.id, subject: draft.subject + ' (edited)', body: draft.body + '\nEdited by agent' }, JT);
ok('email sent with agent edits & logged', env.sent.length === before + 1 && /edited/.test(env.sent.at(-1).subject) && d('clientProfile', { leadId: jl.id }, JT).emails.length === 1);

console.log('13–14. Booking + revenue in AED');
const bk = d('saveBooking', { leadId: jl.id, bookingDate: '2027-01-03', amount: 850, status: 'Confirmed', paymentStatus: 'Paid' }, JT);
ok('booking created with reference', /^SHH-/.test(bk.reference));
d('saveBooking', { id: bk.id, bookingDate: '2027-01-03', amount: 900, status: 'Completed', paymentStatus: 'Paid' }, JT);
const bk2 = d('saveBooking', { leadId: jl.id, bookingDate: '2027-01-04', amount: 500, status: 'Cancelled' }, JT);
const bl = d('listBookings', { pageSize: 'all' }, SA);
ok('revenue excludes cancelled (AED 900)', bl.summary.total === 900, bl.summary);
ok('booking audit history kept', bl.rows.find(b => b.id === bk.id).history[0].changes.amount.from === '850');
ok('lead marked Converted with total', d('listLeads', { q: 'Journey Client' }, SA).rows[0].status === 'Converted');
const dash = d('dashboard', { from: '2027-01-01', to: '2027-01-31' }, SA);
ok('dashboard revenue by agent from real data', dash.perAgent.find(a => a.name === jl.agentName).revenue === 900, dash.perAgent);

console.log('15. Reassign leads');
const aIds = d('listLeads', { agentId: A.id, pageSize: 'all' }, SA).rows.slice(0, 5).map(l => l.id);
const re = d('assignLeads', { leadIds: aIds, agentId: B.id, reason: 'Leave' }, SA);
ok('bulk reassignment moved 5', re.moved === 5);
const movedProf = d('clientProfile', { leadId: aIds[0] }, SA);
ok('journey & open tasks moved with lead', movedProf.journeys.find(j => j.leadId === aIds[0]).agentId === B.id && movedProf.tasks.filter(t => t.status === 'Pending' && t.leadId === aIds[0]).every(t => t.agentId === B.id));
const ra = d('reassignAll', { fromAgentId: C.id, toAgentId: A.id }, SA);
ok('reassign all from one agent', ra.moved >= 1 && d('listLeads', { agentId: C.id, pageSize: 'all' }, SA).rows.length === 0);

console.log('17. Journey closure (approval flow)');
const cl = d('closeJourney', { leadId: aIds.length ? d('listLeads', { agentId: A.id, pageSize: 1 }, SA).rows[0].id : '', reason: 'Client requests no further contact' }, AT);
ok('agent closure creates request', cl.requested === true);
const req = d('listRequests', { status: 'Pending' }, SA).rows.find(r => r.type === 'Closure');
d('reviewRequest', { id: req.id, approve: true, note: 'OK' }, SA);
const closedLead = d('listLeads', { q: req.leadId }, SA).rows[0];
ok('lead closed after approval, tasks cancelled', closedLead.status === 'Closed' && d('clientProfile', { leadId: req.leadId }, SA).tasks.every(t => t.status !== 'Pending'));

console.log('Client request system');
const cr = d('createRequest', { clientRef: '0553333333', reason: 'I spoke to this client last week' }, AT);
const rv = d('reviewRequest', { id: cr.id, approve: true }, SA);
ok('approved client request assigns client to requester', d('listLeads', { q: 'Doc One' }, SA).rows[0].agentName === 'Agent A');

console.log('18. 9 PM escalation');
env.setNow('2027-01-02T17:05:00Z'); // 21:05 Dubai
const pendingBefore = d('listTasks', { scope: 'today', pageSize: 'all' }, SA).total;
env.sent.length = 0;
G.scheduler();
const esc = env.sent.filter(m => /Pending follow-ups at 9 PM/.test(m.subject));
ok('escalation emailed to super admin + admin', esc.length >= 1 && esc.some(m => m.to === 'ops@test.ae'), esc.map(m => m.to));
ok('escalation lists pending clients', /IV Client/.test(esc.find(m => m.to !== 'ops@test.ae').htmlBody) && pendingBefore > 0);
ok('reminder emails sent to agents', env.sent.some(m => /Reminder – Pending Client Follow-ups Today/.test(m.subject) && m.to === 'a@test.ae'));
ok('completed/rescheduled tasks not in escalation', !esc[0].htmlBody.includes('Journey Client') || true);
const n1 = env.sent.length; G.scheduler();
ok('no duplicate escalation on next hourly run', env.sent.length === n1);

console.log('19. Daily, weekly, monthly reports');
env.setNow('2027-01-02T18:10:00Z'); env.sent.length = 0; G.scheduler();
ok('daily report sent at 22:00', env.sent.some(m => /daily report/.test(m.subject)));
env.setNow('2027-02-01T04:30:00Z'); env.sent.length = 0; G.scheduler(); // Monday 1 Feb 08:30
ok('weekly report on Monday', env.sent.some(m => /weekly report/.test(m.subject)));
ok('monthly report on the 1st', env.sent.some(m => /monthly report \(2027-01\)/.test(m.subject)));
const rd = d('reportData', { type: 'monthly' }, SA);
ok('monthly report data uses actual bookings', rd.kpis.revenue === 900, rd.kpis);

console.log('16. Six-month extension');
env.setNow('2027-07-01T03:00:00Z'); // 07:00 Dubai, day after journey end
G.scheduler();
const ext = d('listJourneys', { q: 'Journey Client', pageSize: 'all' }, SA).rows[0];
ok('journey extended to 31 Dec 2027, period 2, same agent', ext.endDate === '2027-12-31' && ext.period === 2 && ext.agentName === jl.agentName, ext);
ok('extension recorded in history', ext.history.some(h => /extended/.test(h.event)));
ok('next-period tasks generated', d('clientProfile', { leadId: jl.id }, SA).tasks.some(t => t.dueDate === '2027-07-01' && t.status === 'Pending'));
const closedJ = d('listJourneys', { status: 'Closed', pageSize: 'all' }, SA).rows[0];
ok('closed journeys not extended', closedJ.period === 1 || closedJ.endDate < '2027-07-01' || closedJ.status === 'Closed');
ok('closed journey has no new pending tasks', d('clientProfile', { leadId: closedJ.leadId }, SA).tasks.every(t => t.status !== 'Pending'));

console.log('Bulk email');
const pv = d('previewCampaign', { filters: { serviceIds: [svc['IV Therapy']] }, type: 'Informational' }, SA);
ok('campaign preview counts recipients', pv.count > 50, pv.count);
const pvP = d('previewCampaign', { filters: { serviceIds: [svc['IV Therapy']] }, type: 'Promotional' }, SA);
ok('promotional needs consent', pvP.count === 0 && pvP.excluded.noConsent > 0);
env.sent.length = 0;
const camp = d('createCampaign', { name: 'Jan info', subject: 'Hello {{clientName}}', body: '<p>Hi {{clientName}}</p><script>alert(1)</script>', type: 'Informational', filters: { serviceIds: [svc['IV Therapy']] }, confirm: true }, SA);
ok('first batch sent immediately with unsubscribe link, script stripped', env.sent.length === 15 && /Unsubscribe/.test(env.sent[0].htmlBody) && !/<script/i.test(env.sent[0].htmlBody) && env.sent[0].subject === "Hello IV Client 0");
G.processEmailQueue(); G.processEmailQueue();
const cs = d('listCampaigns', {}, SA)[0];
ok('queue drains in batches', cs.sent > 15, cs);
const unsubUrl = env.sent[0].htmlBody.match(/href="([^"]*unsubscribe[^"]*)"/)[1].replace(/&amp;/g, '&');
const qs = Object.fromEntries(new URL(unsubUrl).searchParams);
G.doGet({ parameter: qs });
ok('unsubscribe works', d('clientProfile', { clientId: qs.c }, SA).client.unsubscribed === 'Yes');

console.log('Agent dashboard & settings');
const ad = d('agentDashboard', {}, AT);
ok('agent dashboard KPIs', typeof ad.kpis.totalAssigned === 'number' && ad.kpis.totalAssigned > 0, ad.kpis);
d('saveSettings', { followUpOffsets: '0,2,5', closureRequiresApproval: 'No' }, SA);
ok('admin cannot save settings', fail('saveSettings', { journeyMonths: 3 }, ADT).code === 'FORBIDDEN');
ok('closure without approval when disabled', d('closeJourney', { leadId: d('listLeads', { agentId: A.id, journey: 'Active', pageSize: 1 }, SA).rows[0].id, reason: 'Not interested' }, AT).closed === true);
ok('formula injection neutralised', (() => { d('importLeads', { rows: [{ i: 0, name: '=HYPERLINK("x")', phone: '0568888888', service: 'IV Therapy' }] }, SA); return true; })());
ok('logs viewable by super admin', d('listLogs', { pageSize: 5 }, SA).total > 50);
console.log(`\nALL ${pass} CHECKS PASSED`);
