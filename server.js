// server.js
const express = require("express");
const bodyParser = require("body-parser");
const TronWeb = require("tronweb");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(__dirname)); // يخدم index.html من نفس المجلد

// ==== إعداد المتغيرات الحساسة عبر Environment Variables ====
// ضع PRIVATE_KEY و OWNER_ADDRESS في إعدادات Render (Environment)
// مثال أسماء المتغيرات المستخدمة هنا:
//   TRON_PRIVATE_KEY
//   OWNER_ADDRESS
//   USDT_CONTRACT (اختياري، افتراضي TRC20 USDT address)
const OWNER_PRIVATE_KEY = process.env.TRON_PRIVATE_KEY || "";
const OWNER_ADDRESS = process.env.OWNER_ADDRESS || ""; // عنوان محفظتك الذي سيُرسل منه USDT
const USDT_CONTRACT = process.env.USDT_CONTRACT || "TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj"; // default USDT TRC20

if (!OWNER_PRIVATE_KEY || !OWNER_ADDRESS) {
  console.warn("تحذير: لم يتم ضبط TRON_PRIVATE_KEY أو OWNER_ADDRESS في متغيرات البيئة. عمليات السحب ستفشل حتى تضبطهما.");
}

// إعداد TronWeb (سيعمل فقط إذا كان PRIVATE KEY مضبوط)
const tronWeb = new TronWeb({
  fullHost: "https://api.trongrid.io",
  privateKey: OWNER_PRIVATE_KEY,
});

// ===== بيانات العمل المؤقتة (في الذاكرة) =====
// هيكل لكل لاعب:
// balances[playerId] = {
//   balance: Number,      // إجمالي USDT
//   jumpCount: Number,    // عدد القفزات التي قام بها اللاعب
//   lastIncrement: Number // فرق الزيادة الحالي (يبدأ 50 ثم +50 كل قفزة)
// }
const balances = {};

// ===== منطق حساب مكافأة القفزة =====
function computeRewardForNextJump(playerId) {
  // إذا اللاعب جديد: أول قفزة = 100، lastIncrement نبدأ بها 50
  if (!balances[playerId]) {
    return { reward: 100, nextIncrement: 50 };
  }
  const state = balances[playerId];
  const jumpCount = state.jumpCount || 0;

  if (jumpCount === 0) {
    // لم يقفز من قبل
    return { reward: 100, nextIncrement: 50 };
  } else if (jumpCount === 1) {
    // بعد أول قفزة الثانية = 150
    return { reward: 150, nextIncrement: 100 }; // بعد تطبيق هذه ستصبح increment 100
  } else if (jumpCount === 2) {
    // الثالثة = 250
    return { reward: 250, nextIncrement: 150 };
  } else {
    // للقفز الرابع وما بعده: نستخدم نمط الزيادة التي تزداد بمقدار 50 كل مرة
    // نحسب من الحالة المخزنة:
    const prevReward = state.lastReward || 250; // إذا اختفى شيء، نفترض 250
    const prevIncrement = state.lastIncrement || 150; // إذا اختفى شيء، نفترض 150
    const newIncrement = prevIncrement + 50; // زيادة الفرق بمقدار 50
    const reward = prevReward + newIncrement;
    return { reward, nextIncrement: newIncrement };
  }
}

// ===== نقطة نهاية للقيام بقفزة (server-side compute) =====
// Client يرسل playerId (يخزنه محلياً في المتصفح أو في localStorage)
app.post("/jump", (req, res) => {
  const { playerId } = req.body;
  if (!playerId) return res.status(400).json({ error: "playerId مطلوب" });

  // التأكد من تهيئة الحالة إن لم تكن موجودة
  if (!balances[playerId]) {
    balances[playerId] = { balance: 0, jumpCount: 0, lastReward: 0, lastIncrement: 50 };
  }

  // احسب المكافأة للقفزة التالية
  const { reward, nextIncrement } = computeRewardForNextJump(playerId);

  // حدِّث الحالة
  balances[playerId].balance += reward;
  balances[playerId].jumpCount = (balances[playerId].jumpCount || 0) + 1;
  balances[playerId].lastReward = reward;
  balances[playerId].lastIncrement = nextIncrement;

  // أعد الرصيد الحالي والمكافأة الممنوحة الآن
  res.json({
    success: true,
    reward,
    balance: balances[playerId].balance
  });
});

// ===== جلب الرصيد الحالي للاعب =====
app.get("/balance/:playerId", (req, res) => {
  const playerId = req.params.playerId;
  const bal = balances[playerId] ? balances[playerId].balance : 0;
  res.json({ balance: bal });
});

// ===== عملية السحب (يدوي فقط) =====
// Client يرسل { playerId, toAddress }
// نتحقق من أن الرصيد >= الحد ثم نرسل USDT (خصم 2%)
app.post("/withdraw", async (req, res) => {
  const { playerId, toAddress } = req.body;
  if (!playerId || !toAddress) return res.status(400).json({ error: "playerId و toAddress مطلوبان" });

  const state = balances[playerId];
  const balance = state ? state.balance : 0;

  const MIN_WITHDRAW = 250;
  if (balance < MIN_WITHDRAW) {
    return res.status(400).json({ error: `الرصيد غير كافٍ للسحب؛ الحد الأدنى ${MIN_WITHDRAW}` });
  }

  // احسب المبلغ بعد خصم 2%
  const feePercent = 0.02;
  const sendAmountUSDT = balance * (1 - feePercent); // وحدة بالدولار USDT
  const sendAmountSun = Math.floor(sendAmountUSDT * 1e6); // TRC20: 1 USDT = 1e6 وحدة

  // تأكد أن مفتاح المالك مضبوط
  if (!OWNER_PRIVATE_KEY || !OWNER_ADDRESS) {
    return res.status(500).json({ error: "سحب معطّل: إعدادات المفتاح في السيرفر غير مضبوطة" });
  }

  try {
    const contract = await tronWeb.contract().at(USDT_CONTRACT);

    // تنفيذ النقل
    const tx = await contract.transfer(toAddress, sendAmountSun).send({
      feeLimit: 100_000_000
    });

    // تصفير رصيد اللاعب بعد نجاح السحب (نحتفظ بسجل مبسط فقط)
    balances[playerId].balance = 0;
    balances[playerId].jumpCount = 0;
    balances[playerId].lastReward = 0;
    balances[playerId].lastIncrement = 50;

    return res.json({ success: true, tx });
  } catch (err) {
    console.error("خطأ أثناء إجراء السحب:", err);
    return res.status(500).json({ error: "فشل في تنفيذ معاملة السحب" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
