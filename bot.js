require('dotenv').config();


const irc = require('irc');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Load config from .env
const {
    IRC_NICK,
    IRC_USERNAME,
    IRC_PASSWORD,
    IRC_SERVER,
    IRC_CHANNEL,
    IRC_WHITELIST,
    IRC_TIMEZONE
} = process.env;

if (!IRC_NICK || !IRC_USERNAME || !IRC_SERVER || !IRC_CHANNEL) {
    console.error('Missing required IRC configuration in .env');
    process.exit(1);
}

// Prepare whitelist array
const whitelist = (IRC_WHITELIST || '')
    .split(',')
    .map(name => name.trim().toLowerCase())
    .filter(Boolean);

// Ensure data directory exists for DB
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}
const dbPath = path.join(dataDir, 'warnings.db');

// Setup SQLite DB
const db = new sqlite3.Database(dbPath);
db.serialize(() => {
    db.run(`
    CREATE TABLE IF NOT EXISTS warnings (
      nick TEXT PRIMARY KEY,
      timestamp INTEGER
    )
  `);
});

const warningTimeout = 15 * 60 * 1000; // 15 minutes


function isFriday() {
    const tz = IRC_TIMEZONE || 'UTC';
    // Get current date/time in target timezone, including DST
    const now = new Date();
    // Use Intl.DateTimeFormat to get weekday in target timezone (handles DST)
    const weekday = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' })
        .format(now);
    return weekday === 'Fri';
}

function removeUrls(text) {
    return text.replace(/https?:\/\/[^\s]+/gi, '');
}

function percentCapitalLetters(text) {
    const letters = text.replace(/[^A-Za-z]/g, '');
    if (letters.length === 0) return 100;
    const caps = letters.replace(/[^A-Z]/g, '');
    return (caps.length / letters.length) * 100;
}

// Connect without auto-join channels initially
const client = new irc.Client(IRC_SERVER, IRC_NICK, {
    userName: IRC_USERNAME,
    realName: IRC_USERNAME,
    channels: ['#' + IRC_CHANNEL],
    autoRejoin: true,
    autoConnect: true,
    port: 6697,
    secure: true, // change to true and port 6697 for SSL if needed
});

client.addListener('registered', () => {
    console.log('Connected to IRC server');

    if (IRC_PASSWORD) {
        client.say('NickServ', `IDENTIFY ${IRC_USERNAME} ${IRC_PASSWORD}`);
        console.log(`[AUTH] Sent IDENTIFY to NickServ for ${IRC_USERNAME}`);
    } else {
        if (IRC_CHANNEL) {
            // No password, join immediately
            client.join('#' + IRC_CHANNEL);
            console.log(`Joined channel ${IRC_CHANNEL} without NickServ auth`);
        } else {
            console.error('No channel specified in .env, cannot join.');
            process.exit(1);
        }
    }
});

// Wait for NickServ confirmation before joining channel (only if password given)
if (IRC_PASSWORD) {
    client.addListener('notice', (from, to, message) => {
        if (from === 'NickServ' && message.toLowerCase().includes('you are now identified')) {
            console.log('NickServ authentication successful, joining channel...');
            client.join(IRC_CHANNEL);
        }
    });
}

client.addListener('error', (message) => {
    console.error('IRC ERROR:', message);
});

function checkAndHandleWarning(nick, channel, capitalPercent) {
    if (whitelist.includes(nick.toLowerCase())) {
        console.log(`Skipping warning/kick for whitelisted user: ${nick}`);
        return;
    }

    const now = Date.now();
    db.get('SELECT timestamp FROM warnings WHERE nick = ?', [nick], (err, row) => {
        if (err) {
            console.error('DB Error:', err);
            return;
        }

        if (row) {
            if (now - row.timestamp < warningTimeout) {
                // Kick user
                console.log(`Kicking ${nick} for second offense (${capitalPercent.toFixed(1)}%)`);
                client.send('KICK', channel, nick, "IT'S CAPSLOCK FRIDAY, BITCHES");
                db.run('DELETE FROM warnings WHERE nick = ?', [nick]);
            } else {
                // Warning expired → update timestamp
                console.log(`Warning ${nick} (expired, updating timestamp)`);
                client.notice(nick, `WARNING – It’s Friday. Use MORE CAPITAL LETTERS or face the kick.`);
                db.run(`UPDATE warnings SET timestamp = ? WHERE nick = ?`, [now, nick]);
            }
        } else {
            // First offense → insert warning
            console.log(`Warning ${nick} (first offense)`);
            client.notice(nick, `WARNING – It’s Friday. Use MORE CAPITAL LETTERS or face the kick.`);
            db.run(`INSERT INTO warnings (nick, timestamp) VALUES (?, ?)`, [nick, now]);
}

    });
}

client.addListener('message', (from, to, message) => {
    if (!isFriday()) return;

    const cleaned = removeUrls(message);
    const capPercent = percentCapitalLetters(cleaned);

    if (capPercent >= 80) {
        db.run('DELETE FROM warnings WHERE nick = ?', [from]);
        return;
    }

    checkAndHandleWarning(from, to, capPercent);
});

// client.addListener('raw', (message) => {
//     console.log('[IRC RAW]', message);
// });
