// Staff Accounts: who can add / remove / reset passwords, and what happens to a removed person.
import test from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) };

const { Staff, StaffDirectory, LocalStaffDirectory, StaffError, AuthService, AuthError, SessionStore, LocalSessionStore } = await import('../Staff/js/staffDomain.js');

const dir = () => new StaffDirectory();
const who = (d, username) => d.find(username);
const newBaker = { name: 'Grace Achieng', username: 'grace', role: 'baker', password: 'bread2026' };

test('a manager can add any role; the new person appears with a fresh id', () => {
  const d = dir(), amina = who(d, 'amina');
  const g = d.add(amina, newBaker);
  assert.equal(g.id, 5);
  assert.equal(d.add(amina, { name: 'New Boss', username: 'boss2', role: 'manager', password: 'secret1' }).role, 'manager');
});

test('a supervisor can add bakers and supervisors but never a manager', () => {
  const d = dir(), sup = who(d, 'supervisor');
  assert.equal(d.add(sup, newBaker).role, 'baker');
  assert.equal(d.add(sup, { name: 'Sup Two', username: 'sup2', role: 'supervisor', password: 'secret1' }).role, 'supervisor');
  assert.throws(() => d.add(sup, { name: 'Sneaky', username: 'sneaky', role: 'manager', password: 'secret1' }), /Only a manager/);
});

test('a baker cannot add anyone', () => {
  const d = dir();
  assert.throws(() => d.add(who(d, 'peter'), newBaker), StaffError);
});

test('adding checks name, username, uniqueness and password length', () => {
  const d = dir(), amina = who(d, 'amina');
  assert.throws(() => d.add(amina, { ...newBaker, name: '  ' }), /name/);
  assert.throws(() => d.add(amina, { ...newBaker, username: 'a b' }), /Username must be/);
  assert.throws(() => d.add(amina, { ...newBaker, username: 'ab' }), /Username must be/);
  assert.throws(() => d.add(amina, { ...newBaker, username: 'PETER' }), /already taken/);   // not case sensitive
  assert.throws(() => d.add(amina, { ...newBaker, password: '12345' }), /at least 6/);
  assert.equal(d.list().length, 4);                                                           // nothing half-added
});

test('removing: manager removes anyone else, supervisor only bakers and supervisors', () => {
  const d = dir(), amina = who(d, 'amina'), sup = who(d, 'supervisor');
  assert.equal(d.removeBlocker(sup, who(d, 'manager2').id), 'Only a manager can remove a manager.');
  assert.equal(d.removeBlocker(sup, who(d, 'peter').id), '');
  d.remove(sup, who(d, 'peter').id);
  assert.equal(who(d, 'peter'), undefined);
  d.remove(amina, sup.id);
  assert.equal(who(d, 'supervisor'), undefined);
});

test('nobody can remove their own account', () => {
  const d = dir();
  for (const u of ['amina', 'supervisor', 'peter']) assert.notEqual(d.removeBlocker(who(d, u), who(d, u).id), '');
  assert.equal(d.removeBlocker(who(d, 'amina'), who(d, 'amina').id), 'You cannot remove your own account.');
});

test('managers can remove each other while there are two, but the last manager is protected', () => {
  const d = new StaffDirectory(), amina = who(d, 'amina');
  d.remove(amina, who(d, 'manager2').id);                                    // two managers -> one left
  assert.equal(d.list().filter(s => s.role === 'manager').length, 1);
  // Safety net: even a stale manager session (someone no longer in the list) cannot remove the final manager.
  const stale = new Staff({ id: 99, name: 'Old session', username: 'gone', password: 'x', role: 'manager' });
  assert.equal(d.removeBlocker(stale, amina.id), 'The last manager account cannot be removed.');
  assert.throws(() => d.remove(stale, amina.id), /last manager/);
  assert.ok(who(d, 'amina'));
});

test('bakers cannot remove anyone', () => {
  const d = dir();
  assert.equal(d.removeBlocker(who(d, 'peter'), who(d, 'supervisor').id), 'You are not allowed to remove accounts.');
});

test('only a manager can reset a password; the old one stops working', () => {
  const d = dir(), amina = who(d, 'amina'), peter = who(d, 'peter');
  assert.throws(() => d.resetPassword(who(d, 'supervisor'), peter.id, 'newpass1'), /Only a manager/);
  assert.throws(() => d.resetPassword(peter, peter.id, 'newpass1'), /Only a manager/);
  assert.throws(() => d.resetPassword(amina, peter.id, 'short'), /at least 6/);
  d.resetPassword(amina, peter.id, 'newpass1');
  const auth = new AuthService(d, new SessionStore());
  assert.throws(() => auth.login('peter', 'baker123'), AuthError);
  assert.equal(auth.login('peter', 'newpass1').username, 'peter');
});

test('session flags: managers and supervisors manage staff, only managers reset passwords', () => {
  const d = dir(), auth = new AuthService(d, new SessionStore());
  const flags = u => { const p = { amina: 'manager123', supervisor: 'super123', peter: 'baker123' }[u]; auth.login(u, p); const c = auth.current(); return [c.canManageStaff, c.canResetPasswords]; };
  assert.deepEqual(flags('amina'), [true, true]);
  assert.deepEqual(flags('supervisor'), [true, false]);
  assert.deepEqual(flags('peter'), [false, false]);
});

test('a removed person who is still signed in is signed out on the next check', () => {
  const d = dir(), session = new SessionStore(), auth = new AuthService(d, session);
  auth.login('peter', 'baker123');
  assert.equal(auth.current().username, 'peter');
  d.remove(who(d, 'amina'), who(d, 'peter').id);
  assert.equal(auth.current(), null);
  assert.throws(() => auth.login('peter', 'baker123'), AuthError);
});

test('saved in the browser: an added account survives a reload and can sign in', () => {
  mem.clear();
  const first = new LocalStaffDirectory();
  assert.equal(first.list().length, 4);                                       // the four starting accounts
  first.add(first.find('amina'), newBaker);
  const reloaded = new LocalStaffDirectory();                                 // like refreshing the page
  assert.equal(reloaded.find('grace').name, 'Grace Achieng');
  const auth = new AuthService(reloaded, new LocalSessionStore());
  assert.equal(auth.login('grace', 'bread2026').role, 'baker');
});

test('a password reset in one tab is seen by another tab, and a removal signs that person out', () => {
  mem.clear();
  const tabA = new LocalStaffDirectory(), tabB = new LocalStaffDirectory();
  const authB = new AuthService(tabB, new LocalSessionStore());
  authB.login('peter', 'baker123');
  tabA.resetPassword(tabA.find('amina'), tabA.find('peter').id, 'changed99');
  assert.throws(() => new AuthService(tabB, new SessionStore()).login('peter', 'baker123'), AuthError);
  tabA.remove(tabA.find('amina'), tabA.find('peter').id);
  assert.equal(authB.current(), null);                                        // tab B notices on its next click
});
