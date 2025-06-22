require('dotenv').config();
const irc = require('irc');

const {
  IRC_NICK,
  IRC_SERVER,
  IRC_PASSWORD,
  IRC_EMAIL,
  IRC_PORT = 6667,
  IRC_SECURE = 'false',
} = process.env;

if (!IRC_NICK || !IRC_SERVER || !IRC_PASSWORD || !IRC_EMAIL) {
  console.error('Please set IRC_NICK, IRC_SERVER, IRC_PASSWORD, and IRC_EMAIL in your .env');
  process.exit(1);
}

const client = new irc.Client(IRC_SERVER, IRC_NICK, {
  port: parseInt(IRC_PORT, 10),
  secure: IRC_SECURE.toLowerCase() === 'true',
  autoConnect: true,
  userName: IRC_NICK,
  realName: IRC_NICK,
  channels: [],
});

client.addListener('registered', () => {
  console.log(`Connected as ${IRC_NICK}. Sending NickServ REGISTER command...`);
  client.say('NickServ', `REGISTER ${IRC_PASSWORD} ${IRC_EMAIL}`);
});

client.addListener('message', (from, to, message) => {
  console.log(`[${from} -> ${to}]: ${message}`);
  if (from === 'NickServ' && /has been registered/.test(message)) {
    console.log('Registration successful!');
    client.disconnect('Done registering', () => process.exit(0));
  }
  if (from === 'NickServ' && /is already registered/.test(message)) {
    console.log('Nick is already registered.');
    client.disconnect('Already registered', () => process.exit(0));
  }
});

client.addListener('error', (err) => {
  console.error('IRC Error:', err);
});
