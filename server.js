const express = require("express");
const bodyParser = require("body-parser");
const TronWeb = require("tronweb");
const cors = require("cors");

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(__dirname)); // لعرض ملفات HTML

// بيانات محفظتك (الخاصة فقط بالسحب)
const ownerAddress = "TKmjAd6z7pAZpv2tQfie1Zt7ihX1XhZBTS";
const ownerPrivateKey = "Tornado Wolf End Enough Speed Reform Nut Broccoli Sting flash purchase".split(" ").join(" ");

const tronWeb = new TronWeb({
    fullHost: "https://api.trongrid.io",
    privateKey: ownerPrivateKey,
});

const usdtContractAddress = "TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj"; // USDT TRC20
const MIN_WITHDRAW = 250; // أقل مبلغ للسحب

let balances = {}; // لتخزين رصيد كل لاعب بناءً على عنوان محفظته

// ✅ استلام الأرباح من العميل
app.post("/update-balance", (req, res) => {
    const { wallet, profit } = req.body;
    if (!wallet || typeof profit !== "number") {
        return res.status(400).json({ error: "بيانات غير صالحة" });
    }

    if (!balances[wallet]) balances[wallet] = 0;
    balances[wallet] += profit;

    res.json({ balance: balances[wallet] });
});

// ✅ الحصول على الرصيد الحالي
app.post("/get-balance", (req, res) => {
    const { wallet } = req.body;
    res.json({ balance: balances[wallet] || 0 });
});

// ✅ تنفيذ السحب
app.post("/withdraw", async (req, res) => {
    const { wallet } = req.body;

    if (!balances[wallet] || balances[wallet] < MIN_WITHDRAW) {
        return res.status(400).json({ error: "الرصيد غير كافٍ للسحب" });
    }

    const amount = balances[wallet];
    const fee = amount * 0.02;
    const sendAmount = amount - fee;

    try {
        const contract = await tronWeb.contract().at(usdtContractAddress);

        const tx = await contract.transfer(wallet, sendAmount * 1e6).send({
            feeLimit: 100_000_000,
        });

        balances[wallet] = 0; // تصفير الرصيد بعد السحب

        res.json({ success: true, tx });
    } catch (err) {
        console.error("فشل السحب:", err);
        res.status(500).json({ error: "فشل في عملية السحب" });
    }
});

app.listen(port, () => {
    console.log(`الخادم يعمل على المنفذ ${port}`);
});
