// Dev utility: list accounts or set a new password.
//
//   node reset-password.js                        list every account
//   node reset-password.js 9939017545 newpass     set that account's password
//
// Passwords are bcrypt hashes, so a forgotten one cannot be recovered —
// only replaced. Safe to run while the server is up.

const bcrypt = require('bcryptjs');
const { db, queries } = require('./database');

const [phoneArg, passwordArg] = process.argv.slice(2);

function list() {
  const users = db.prepare(`
    SELECT u.id, u.name, u.phone, u.created_at,
           (SELECT COUNT(*) FROM sos_sessions s WHERE s.victim_id = u.id) AS sos_sent
    FROM users u ORDER BY u.id
  `).all();

  console.log('\nAccounts in server/database.db:\n');
  users.forEach((u) => {
    console.log(`  ${String(u.id).padStart(2)}. ${u.name.padEnd(12)} ${u.phone.padEnd(12)} ${u.sos_sent} SOS sent`);
  });
  console.log('\nSet a password with:  node reset-password.js <phone> <new password>\n');
}

async function reset(phone, password) {
  if (password.length < 4) {
    console.error('Password must be at least 4 characters.');
    process.exit(1);
  }

  const user = queries.getUserByPhone.get(phone);
  if (!user) {
    console.error(`No account with phone ${phone}.`);
    list();
    process.exit(1);
  }

  const hashed = await bcrypt.hash(password, 10);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashed, user.id);

  // Prove it round-trips before claiming success.
  const stored = queries.getUserByPhone.get(phone).password;
  const works = await bcrypt.compare(password, stored);

  console.log(works
    ? `\nDone. ${user.name} (${phone}) can now sign in with: ${password}\n`
    : '\nSomething went wrong — the new password does not verify.\n');
  process.exit(works ? 0 : 1);
}

if (!phoneArg) list();
else if (!passwordArg) {
  console.error('Usage: node reset-password.js <phone> <new password>');
  process.exit(1);
} else reset(phoneArg, passwordArg);
