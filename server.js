const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');

// ১. প্রজেক্ট ১: gmds-rider (রাইডার ইনফো ও ডেলিভারি অর্ডার ডাটাবেজ)
const serviceAccountRider = require('./gmds-rider-firebase-adminsdk-fbsvc-5e2c86a7be.json');
const riderApp = admin.initializeApp({
  credential: admin.credential.cert(serviceAccountRider),
  databaseURL: "https://gmds-rider-default-rtdb.firebaseio.com"
}, 'riderApp');

// ২. প্রজেক্ট ২: gmds-super-app (ফুড অর্ডার ও হোটেল স্ট্যাটাস ডাটাবেজ)
const serviceAccountSuperApp = require('./gmds-super-app-firebase-adminsdk-fbsvc-ca2037936a.json');
const superApp = admin.initializeApp({
  credential: admin.credential.cert(serviceAccountSuperApp),
  databaseURL: "https://gmds-super-app-default-rtdb.asia-southeast1.firebasedatabase.app"
}, 'superApp');

const dbRider = riderApp.database();
const dbSuperApp = superApp.database();

// ৩. টেলিগ্রাম বট টোকেন কনফিগারেশন
const TOKEN = '8782106739:AAGI7mtNLQG-1Z0xV1SKdF2ZNX9Vcc9Am7E';
const bot = new TelegramBot(TOKEN, { polling: true });

// মিনি অ্যাপের GitHub Pages লাইভ লিংক
const MINI_APP_URL = 'https://sakilmandal004-wq.github.io/GMDS-rider-app/';

// ৪. /start কমান্ড এবং কন্টাক্ট শেয়ারিং রিকোয়েস্ট
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

// ৫. ফোন নম্বর কন্টাক্ট রিসিভ করে gmds-rider ডাটাবেজে ভেরিফিকেশন
bot.on('contact', async (msg) => {
    const chatId = msg.chat.id;
    const rawPhone = msg.contact.phone_number;
    const phone = rawPhone.replace(/[^0-9]/g, '').slice(-10); // শুধু ১০ ডিজিটের মোবাইল নম্বর নেওয়া

    try {
        const riderRef = dbRider.ref('gmds_riders/' + phone);
        const snapshot = await riderRef.once('value');

        if (snapshot.exists()) {
            // সিকিউরিটির জন্য টেলিগ্রাম চ্যাট আইডি সেভ করে রাখা
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
            bot.sendMessage(chatId, "❌ এই নম্বরটি আমাদের রাইডার সিস্টেমে রেজিস্টার্ড নয়। অ্যাডমিনের সাথে যোগাযোগ করুন।");
        }
    } catch (error) {
        bot.sendMessage(chatId, "⚠️ সার্ভার এরর! পরে আবার চেষ্টা করুন।");
    }
});

// ৬. ডিউটি অন/অফ ইন্টারঅ্যাক্টিভ বাটন হ্যান্ডলার
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

// ৭. ফুড অর্ডার মনিটর (gmds-super-app) ও অনলাইন রাইডারদের DM নোটিফিকেশন পাঠানো
const foodOrdersRef = dbSuperApp.ref('all_orders');
foodOrdersRef.on('child_added', async (snapshot) => {
    const order = snapshot.val();
    const orderKey = snapshot.key;

    if (!order || (order.status !== 'Pending' && order.status !== 'Confirmed')) return;

    // শুধুমাত্র অনলাইন রাইডারদের খুঁজে বের করা
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

// ৮. পার্সেল/রাইড অর্ডার মনিটর (gmds-rider) ও অনলাইন রাইডারদের DM নোটিফিকেশন পাঠানো
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

console.log("🛡️ GMDS Pro Telegram Bot & Dual Firebase Server is running securely...");
