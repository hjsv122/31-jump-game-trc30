const express = require("express");
const TronWeb = require("tronweb");
const bodyParser = require("body-parser");
const bip39 = require("bip39");
const hdkey = require("hdkey");
const ethUtil = require("ethereumjs-util");

const app = express();
app.use(bodyParser.json());
app.use(express.static(__dirname));

// إعداد اتصال Tron
const fullNode = "https://api.trongrid.io";
const solidityNode = "https://api.trongrid.io";
const eventServer = "https://api.trongrid.io";

// قراءة Seed Phrase من Render
const seedPhrase = process.env.SEED_PHRASE;
const ownerAddress = process.env.OWNER_ADDRESS;

// تحويل الـ Seed Phrase إلى Private Key
async function getPrivateKeyFromSeed(seed) {
    const seedBuffer = await bip39.mnemonicToSeed(seed);
    const hdwallet = hdkey.fromMasterSeed(seedBuffer);
    const addrNode = hdwallet.derive("m/44'/195'/0'/0/0"); // مسار TRON
    const privateKey = addrNode.privateKey.toString("hex");
    return privateKey;
}

let tronWeb;
let privateKey;

// تهيئة TronWeb بعد استخراج Private Key
(async () => {
    privateKey = await getPrivateKeyFromSeed(seedPhrase);
    tronWeb = new TronWeb(fullNode, solidityNode, eventServer, privateKey);
})();

// أرباح اللاعبين (مخزنة في السيرفر مؤقتًا)
let playerBalances = {};

// تسجيل القفز
app.post("/jump", (req, res) => {
    const { playerId, amount } = req.body;
    if (!playerBalances[playerId]) playerBalances[playerId] = 0;
    playerBalances[playerId] += amount;
    res.json({ balance: playerBalances[playerId] });
});

// طلب السحب
app.post("/withdraw", async (req, res) => {
    const { playerId, toAddress } = req.body;

    if (!playerBalances[playerId] || playerBalances[playerId] < 250) {
        return res.status(400).json({ error: "الرصيد غير كافٍ للسحب" });
    }

    const amount = playerBalances[playerId];
    const fee = amount * 0.02;
    const finalAmount = amount - fee;

    try {
        const tradeobj = await tronWeb.transactionBuilder.sendTrx(
            toAddress,
            tronWeb.toSun(finalAmount),
            ownerAddress
        );
        const signedTxn = await tronWeb.trx.sign(tradeobj, privateKey);
        const receipt = await tronWeb.trx.sendRawTransaction(signedTxn);

        if (receipt.result) {
            playerBalances[playerId] = 0; // تصفير الرصيد بعد السحب
            res.json({ success: true, txid: receipt.txid });
        } else {
            res.status(500).json({ error: "فشل إرسال المعاملة" });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// تشغيل السيرفر
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
