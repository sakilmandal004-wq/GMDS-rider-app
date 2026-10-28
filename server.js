const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');
const http = require('http');

// ১. সবার আগে HTTP সার্ভার (Render পোর্ট পায়, তাই ডিপ্লয় "Live" হবে)
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('GMDS Rider Telegram Bot Server is active!\n');
}).listen(PORT, '0.0.0.0', () => {
  console.log(`Server is listening on port ${PORT}`);
});

process.on('unhandledRejection', (e) => console.error('Unhandled rejection:', e && e.message ? e.message : e));
process.on('uncaughtException', (e) => console.error('Uncaught exception:', e && e.message ? e.message : e));

// ২. সার্ভিস অ্যাকাউন্ট লোডার
// পদ্ধতি A (সহজ): PREFIX_SERVICE_ACCOUNT = পুরো JSON ফাইলের লেখা
// পদ্ধতি B: আলাদা আলাদা PREFIX_PRIVATE_KEY, PREFIX_CLIENT_EMAIL, PREFIX_PROJECT_ID ...
function loadServiceAccount(prefix) {
  const raw = process.env[prefix + '_SERVICE_ACCOUNT'];
  if (raw) {
    let sa;
    try { sa = JSON.parse(raw); }
    catch (e) { throw new Error(prefix + '_SERVICE_ACCOUNT সঠিক JSON নয়'); }
    if (!sa.private_key) throw new Error(prefix + '_SERVICE_ACCOUNT-এর ভেতরে private_key নেই');
    sa.private_key = String(sa.private_key).replace(/\\n/g, '\n');
    return sa;
  }

  let key = process.env[prefix + '_PRIVATE_KEY'];
  if (!key) throw new Error(`Render Environment-এ ${prefix}_PRIVATE_KEY (অথবা ${prefix}_SERVICE_ACCOUNT) সেট করা নেই`);
  key = key.trim().replace(/^["']|["']$/g, '').replace(/\\n/g, '\n');

  const sa = {
    type: process.env[prefix + '_TYPE'] || 'service_account',
    project_id: process.env[prefix + '_PROJECT_ID'],
    private_key_id: process.env[prefix + '_PRIVATE_KEY_ID'],
    private_key: key,
    client_email: process.env[prefix + '_CLIENT_EMAIL'],
    client_id: process.env[prefix + '_CLIENT_ID'],
    auth_uri: process.env[prefix + '_AUTH_URI'] || 'https://accounts.google.com/o/oauth2/auth',
    token_uri: process.env[prefix + '_TOKEN_URI'] || 'https://oauth2.googleapis.com/token',
    auth_provider_x509_cert_url: process.env[prefix + '_AUTH_PROVIDER_CERT_URL'] || 'https://www.googleapis.com/oauth2/v1/certs',
    client_x509_cert_url: process.env[prefix + '_CLIENT_CERT_URL']
  };
  if (!sa.project_id || !sa.client_email) throw new Error(`${prefix}_PROJECT_ID / ${prefix}_CLIENT_EMAIL সেট করা নেই`);
  return sa;
}

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function startBot() {
  const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  if (!TOKEN) throw new Error('TELEGRAM_BOT_TOKEN Environment-এ সেট করা নেই');

  const riderApp = admin.initializeApp({
    credential: admin.credential.cert(loadServiceAccount('RIDER')),
    databaseURL: 'https://gmds-rider-default-rtdb.firebaseio.com'
  }, 'riderApp');

  const superApp = admin.initializeApp({
    credential: admin.credential.cert(loadServiceAccount('SUPER')),
    databaseURL: 'https://gmds-super-app-default-rtdb.asia-southeast1.firebasedatabase.app'
  }, 'superApp');

  const dbRider = riderApp.database();
  const dbSuperApp = superApp.database();

  const bot = new TelegramBot(TOKEN, { polling: true });
  bot.on('polling_error', (e) => console.error('Polling error:', e.code || '', e.message));

  const MINI_APP_URL = 'https://sakilmandal004-wq.github.io/GMDS-rider-app/';
  const openPanelBtn = [{ text: '🚀 Open Rider Panel', web_app: { url: MINI_APP_URL } }];

  // /start
  bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, '🚀 <b>GMDS Rider Secure Portal</b>-এ স্বাগতম!\n\nআপনার রেজিস্টার্ড ফোন নম্বর দিয়ে অ্যাকাউন্ট ভেরিফাই করুন:', {
      parse_mode: 'HTML',
      reply_markup: {
        keyboard: [[{ text: '📱 Share Phone Number', request_contact: true }]],
        resize_keyboard: true,
        one_time_keyboard: true
      }
    }).catch(console.error);
  });

  // ফোন ভেরিফিকেশন
  bot.on('contact', async (msg) => {
    const chatId = msg.chat.id;
    const phone = String(msg.contact.phone_number).replace(/[^0-9]/g, '').slice(-10);
    try {
      const riderRef = dbRider.ref('gmds_riders/' + phone);
      const snapshot = await riderRef.once('value');
      if (snapshot.exists()) {
        await riderRef.update({ telegramChatId: chatId, lastActive: Date.now() });
        await bot.sendMessage(chatId, '✅ <b>Verification Successful!</b>\n\nনিচের প্যানেল ওপেন করুন অথবা ডিউটি অন/অফ করুন:', {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              openPanelBtn,
              [{ text: '🟢 Duty ON', callback_data: 'duty_on' }, { text: '🔴 Duty OFF', callback_data: 'duty_off' }]
            ]
          }
        });
      } else {
        await bot.sendMessage(chatId, '❌ এই নম্বরটি আমাদের রাইডার সিস্টেমে রেজিস্টার্ড নয়।');
      }
    } catch (error) {
      console.error('contact error:', error.message);
      bot.sendMessage(chatId, '⚠️ সার্ভার এরর!').catch(() => {});
    }
  });

  // ডিউটি অন/অফ
  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;
    try {
      const snapshot = await dbRider.ref('gmds_riders').orderByChild('telegramChatId').equalTo(chatId).once('value');
      if (!snapshot.exists()) {
        return bot.answerCallbackQuery(query.id, { text: 'দয়া করে আগে /start লিখে ভেরিফাই করুন!' });
      }
      const riderPhone = Object.keys(snapshot.val())[0];
      const goOnline = data === 'duty_on';
      if (data !== 'duty_on' && data !== 'duty_off') return bot.answerCallbackQuery(query.id);

      await dbRider.ref('gmds_riders/' + riderPhone).update({ dutyStatus: goOnline ? 'online' : 'offline' });
      await bot.answerCallbackQuery(query.id, { text: goOnline ? '🟢 আপনার ডিউটি এখন ONLINE!' : '🔴 আপনার ডিউটি এখন OFFLINE!' });
      await bot.editMessageReplyMarkup({
        inline_keyboard: [
          openPanelBtn,
          [goOnline
            ? { text: '🔴 Click to GO OFFLINE', callback_data: 'duty_off' }
            : { text: '🟢 Click to GO ONLINE', callback_data: 'duty_on' }]
        ]
      }, { chat_id: chatId, message_id: query.message.message_id }).catch(() => {});
    } catch (e) {
      console.error('callback error:', e.message);
      bot.answerCallbackQuery(query.id, { text: 'ত্রুটি হয়েছে!' }).catch(() => {});
    }
  });

  // অনলাইন সব রাইডারকে মেসেজ
  async function notifyOnlineRiders(text) {
    const snap = await dbRider.ref('gmds_riders').orderByChild('dutyStatus').equalTo('online').once('value');
    if (!snap.exists()) return;
    snap.forEach((c) => {
      const r = c.val();
      if (r && r.telegramChatId) {
        bot.sendMessage(r.telegramChatId, text, {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [[{ text: '🚀 Open Panel to Accept', web_app: { url: MINI_APP_URL } }]] }
        }).catch((e) => console.error('send fail:', e.message));
      }
    });
  }

  // শুধু নতুন অর্ডারে নোটিফিকেশন (রিস্টার্টে পুরনো অর্ডারের স্প্যাম হবে না)
  async function watchOrders(ref, label, build) {
    const q = ref.limitToLast(200);
    const seen = new Set();
    const initial = await q.once('value');
    initial.forEach((c) => { seen.add(c.key); });
    q.on('child_added', (snap) => {
      if (seen.has(snap.key)) return;
      seen.add(snap.key);
      const o = snap.val();
      if (!o || (o.status !== 'Pending' && o.status !== 'Confirmed')) return;
      notifyOnlineRiders(build(o)).catch((e) => console.error(label + ' notify error:', e.message));
    }, (err) => console.error(label + ' listener error:', err.message));
    console.log(label + ' watcher started');
  }

  watchOrders(dbSuperApp.ref('all_orders'), 'FOOD', (o) =>
    `🍔 <b>NEW FOOD ORDER AVAILABLE!</b>\n\n📍 Drop: ${esc(o.address || 'Customer Location')}\n💰 Total: ₹${esc(o.grandTotal || o.total || 0)}`
  ).catch((e) => console.error('FOOD watcher failed:', e.message));

  watchOrders(dbRider.ref('delivery_orders'), 'PARCEL', (o) =>
    `📦 <b>NEW PARCEL/RIDE BOOKING!</b>\n\n📍 Pickup: ${esc(o.details && o.details.pickup || 'Location')}\n🏁 Drop: ${esc(o.details && o.details.drop || 'Location')}\n💰 Fare: ₹${esc((o.details && o.details.totalFare) || o.price || 0)}`
  ).catch((e) => console.error('PARCEL watcher failed:', e.message));

  console.log('🛡️ Telegram Bot & Server is running...');
}

try {
  startBot();
} catch (e) {
  // সার্ভার চালু থাকবে, কিন্তু লগে পরিষ্কার কারণ দেখাবে
  console.error('❌ BOT START FAILED:', e.message);
}
p
