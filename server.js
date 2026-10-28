const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');
const http = require('http');

// ১. Render-এর পোর্ট স্ক্যানিং ঠিক রাখার জন্য স্মল HTTP সার্ভার
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('GMDS Rider Telegram Bot Server is active!\n');
}).listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});

// ২. gmds-rider প্রজেক্ট এনভায়রনমেন্ট ভ্যারিয়েবল থেকে লোড
const riderApp = admin.initializeApp({
  credential: admin.credential.cert({
    type: process.env.RIDER_TYPE,
    project_id: process.env.RIDER_PROJECT_ID,
    private_key_id: process.env.RIDER_PRIVATE_KEY_ID,
    private_key: process.env.RIDER_PRIVATE_KEY ? process.env.RIDER_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined,
    client_email: process.env.RIDER_CLIENT_EMAIL,
    client_id: process.env.RIDER_CLIENT_ID,
    auth_uri: process.env.RIDER_AUTH_URI,
    token_uri: process.env.RIDER_TOKEN_URI,
    auth_provider_x509_cert_url: process.env.RIDER_AUTH_PROVIDER_CERT_URL,
    client_x509_cert_url: process.env.RIDER_CLIENT_CERT_URL
  }),
  databaseURL: "https://gmds-rider-default-rtdb.firebaseio.com"
}, 'riderApp');

// ৩. gmds-super-app প্রজেক্ট এনভায়রনমেন্ট ভ্যারিয়েবল থেকে লোড
const superApp = admin.initializeApp({
  credential: admin.credential.cert({
    type: process.env.SUPER_TYPE,
    project_id: process.env.SUPER_PROJECT_ID,
    private_key_id: process.env.SUPER_PRIVATE_KEY_ID,
    private_key: process.env.SUPER_PRIVATE_KEY ? process.env.SUPER_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined,
    client_email: process.env.SUPER_CLIENT_EMAIL,
    client_id: process.env.SUPER_CLIENT_ID,
    auth_uri: process.env.SUPER_AUTH_URI,
    token_uri: process.env.SUPER_TOKEN_URI,
    auth_provider_x509_cert_url: process.env.SUPER_AUTH_PROVIDER_CERT_URL,
    client_x509_cert_url: process.env.SUPER_CLIENT_CERT_URL
  }),
  databaseURL: "https://gmds-super-app-default-rtdb.asia-southeast1.firebasedatabase.app"
}, 'superApp');

const dbRider = riderApp.database();
const dbSuperApp = superApp.database();

// ৪. টেলিগ্রাম বট টোকেন
const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8782106739:AAGI7mtNLQG-1Z0xV1SKdF2ZNX9Vcc9Am7E';
const bot = new TelegramBot(TOKEN, { polling: true });

const MINI_APP_URL = 'https://sakilmandal004-wq.github.io/GMDS-rider-app/';

// ৫. /start কমান্ড এবং কন্টাক্ট শেয়ারিং
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, "🚀 **GMDS Rider Secure Portal**-এ স্বাগতম!\n\nআপনার রেজিস্টার্ড ফোন নম্বর দিয়ে অ্যাকাউন্ট ভেরিফাই করুন:", {
        parse_mode: 'Markdown',
        reply_markup: {
            keyboard: [
                [{ text: "📱 Share Phone Number", request_contact: true }]
            ],
            resize_keyboard: true,
            one_time_keyboard: true
        }
    });
});

// ৬. ফোন নম্বর ভেরিফিকেশন
bot.on('contact', async (msg) => {
    const chatId = msg.chat.id;
    const phone = msg.contact.phone_number.replace(/[^0-9]/g, '').slice(-10);

    try {
        const riderRef = dbRider.ref('gmds_riders/' + phone);
        const snapshot = await riderRef.once('value');

        if (snapshot.exists()) {
            await riderRef.update({ telegramChatId: chatId, lastActive: Date.now() });

            bot.sendMessage(chatId, "✅ **Verification Successful!**\n\nনিচের প্যানেল ওপেন করুন অথবা ডিউটি অন/অফ করুন:", {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "🚀 Open Rider Panel", web_app: { url: MINI_APP_URL } }],
                        [
                            { text: "🟢 Duty ON", callback_data: "duty_on" },
                            { text: "🔴 Duty OFF", callback_data: "duty_off" }
                        ]
                    ]
                }
            });
        } else {
            bot.sendMessage(chatId, "❌ এই নম্বরটি আমাদের রাইডার সিস্টেমে রেজিস্টার্ড নয়।");
        }
    } catch (error) {
        bot.sendMessage(chatId, "⚠️ সার্ভার এরর!");
    }
});

// ৭. ডিউটি অন/অফ টগল বাটন
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    try {
        const ridersRef = dbRider.ref('gmds_riders');
        const snapshot = await ridersRef.orderByChild('telegramChatId').equalTo(chatId).once('value');

        if (!snapshot.exists()) {
            bot.answerCallbackQuery(query.id, { text: "দয়া করে আগে /start লিখে ভেরিফাই করুন!" });
            return;
        }

        let riderPhone = Object.keys(snapshot.val())[0];

        if (data === 'duty_on') {
            await dbRider.ref('gmds_riders/' + riderPhone).update({ dutyStatus: 'online' });
            bot.answerCallbackQuery(query.id, { text: "🟢 আপনার ডিউটি এখন ONLINE!" });
            bot.editMessageReplyMarkup({
                inline_keyboard: [
                    [{ text: "🚀 Open Rider Panel", web_app: { url: MINI_APP_URL } }],
                    [{ text: "🔴 Click to GO OFFLINE", callback_data: "duty_off" }]
                ]
            }, { chat_id: chatId, message_id: query.message.message_id });

        } else if (data === 'duty_off') {
            await dbRider.ref('gmds_riders/' + riderPhone).update({ dutyStatus: 'offline' });
            bot.answerCallbackQuery(query.id, { text: "🔴 আপনার ডিউটি এখন OFFLINE!" });
            bot.editMessageReplyMarkup({
                inline_keyboard: [
                    [{ text: "🚀 Open Rider Panel", web_app: { url: MINI_APP_URL } }],
                    [{ text: "🟢 Click to GO ONLINE", callback_data: "duty_on" }]
                ]
            }, { chat_id: chatId, message_id: query.message.message_id });
        }
    } catch (e) {
        bot.answerCallbackQuery(query.id, { text: "ত্রুটি হয়েছে!" });
    }
});

// ৮. ফুড অর্ডার নোটিফিকেশন
const foodOrdersRef = dbSuperApp.ref('all_orders');
foodOrdersRef.on('child_added', async (snapshot) => {
    const order = snapshot.val();
    const orderKey = snapshot.key;

    if (!order || (order.status !== 'Pending' && order.status !== 'Confirmed')) return;

    const ridersRef = dbRider.ref('gmds_riders');
    const ridersSnapshot = await ridersRef.orderByChild('dutyStatus').equalTo('online').once('value');

    if (!ridersSnapshot.exists()) return;

    ridersSnapshot.forEach((childSnap) => {
        const rider = childSnap.val();
        if (rider.telegramChatId) {
            bot.sendMessage(rider.telegramChatId, `🍔 **NEW FOOD ORDER AVAILABLE!**\n\n📍 Drop: ${order.address || 'Customer Location'}\n💰 Total: ₹${order.grandTotal || order.total || 0}`, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "🚀 Open Panel to Accept", web_app: { url: MINI_APP_URL } }]
                    ]
                }
            });
        }
    });
});

// ৯. পার্সেল অর্ডার নোটিফিকেশন
const parcelOrdersRef = dbRider.ref('delivery_orders');
parcelOrdersRef.on('child_added', async (snapshot) => {
    const order = snapshot.val();
    const orderKey = snapshot.key;

    if (!order || (order.status !== 'Pending' && order.status !== 'Confirmed')) return;

    const ridersRef = dbRider.ref('gmds_riders');
    const ridersSnapshot = await ridersRef.orderByChild('dutyStatus').equalTo('online').once('value');

    if (!ridersSnapshot.exists()) return;

    ridersSnapshot.forEach((childSnap) => {
        const rider = childSnap.val();
        if (rider.telegramChatId) {
            bot.sendMessage(rider.telegramChatId, `📦 **NEW PARCEL/RIDE BOOKING!**\n\n📍 Pickup: ${order.details?.pickup || 'Location'}\n🏁 Drop: ${order.details?.drop || 'Location'}\n💰 Fare: ₹${order.details?.totalFare || order.price || 0}`, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "🚀 Open Panel to Accept", web_app: { url: MINI_APP_URL } }]
                    ]
                }
            });
        }
    });
});

console.log("🛡️ High-Security Environment-based Telegram Bot & Server is running...");
