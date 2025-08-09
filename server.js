// server.js
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const TronWeb = require('tronweb');
const cors = require('cors');
const bip39 = require('bip39');
const hdkey = require('ethereumjs-wallet').hdkey;

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(__dirname));

const MNEMONIC = process.env.MNEMONIC; // اتركه فارغًا إذا ستضع TRON_PRIVATE_KEY مباشرة
let PRIVATE_KEY = process.env.TRON_PRIVATE_KEY;
const OWNER_ADDRESS = process.env.OWNER_ADDRESS;

// إذا لم يُعطَ PRIVATE_KEY لكن أعطيت MNEMONIC، نستخلص المفتاح من العبارة السرية
async function derivePrivateKeyFromMnemonic(mnemonic, accountIndex = 0) {
  if (!mnemonic) throw new Error('mnemonic not provided');
  const seed = await bip39.mnemonicToSeed(mnemonic); // Buffer
  const hdwallet = hdkey.fromMasterSeed(seed);
  // مسار Tron هو m/44'/195'/0'/0/0 (195 هو coin type ل Tron)
  const path = `m/44'/195'/${accountIndex}'/0/0`;
  const wallet = hdwallet.derivePath(path).getWallet();
  const privateKeyBuf = wallet.getPrivateKey(); // Buffer
  return privateKeyBuf.toString('hex');
}

(async () => {
  try {
    if (!PRIVATE_KEY && MNEMONIC) {
      console.log('Deriving private key from MNEMONIC...');
      PRIVATE_KEY = await derivePrivateKeyFromMnemonic(MNEMONIC, 0);
      console.log('Derived private key (hidden) — use with care.');
    }
  } catch (e) {
    console.error('Error deriving private key from mnemonic:', e.message);
  }

  if (!PRIVATE_KEY) {
    console.warn('Warning: TRON_PRIVATE_KEY not set. /withdraw will not work until configured.');
  }
})();

const tronWeb = new TronWeb({
  fullHost: 'https://api.trongrid.io',
  privateKey: PRIVATE_KEY || ''
});

// عنوان عقد USDT TRC20 - راجع Tronscan إذا أردت تأكيد العنوان الصحيح
const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'; // شائع الاستخدام

function toTokenUnits(amountFloat, decimals = 6) {
  // نحسب الوحدة كـ BigInt لنتجنب أخطاء الدقة
  const factor = BigInt(10 ** decimals);
  const whole = Math.floor(amountFloat);
  const fraction = Math.round((amountFloat - whole) * (10 ** decimals));
  return (BigInt(whole) * factor) + BigInt(fraction);
}

app.post('/withdraw', async (req, res) => {
  try {
    const { address, amount } = req.body;
    if (!address || !amount) return res.status(400).json({ success: false, message: 'address and amount required' });

    const numericAmount = parseFloat(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) return res.status(400).json({ success: false, message: 'invalid amount' });

    if (!PRIVATE_KEY || !OWNER_ADDRESS) {
      return res.status(500).json({ success: false, message: 'Server not configured with private key and owner address.' });
    }

    // حساب خصم 2%
    const fee = numericAmount * 0.02;
    const finalAmount = numericAmount - fee;

    // تحويل للمقادير داخل العقد (USDT TRC20 غالباً 6 منازل عشرية)
    const decimals = 6;
    const tokenAmountBigInt = toTokenUnits(finalAmount, decimals);
    const tokenAmountStr = tokenAmountBigInt.toString();

    // Load the USDT contract
    const contract = await tronWeb.contract().at(USDT_CONTRACT);

    // send transfer transaction (transfer(to, amount))
    // نستخدم broadcastTransaction أو send() حسب النسخة — هنا نستخدم send() المبسط
    const result = await contract.transfer(address, tokenAmountStr).send({
      // feeLimit يمكن ضبطه إن احتجت
      feeLimit: 1_000_000_000
    });

    console.log('Withdraw result:', result);
    return res.json({ success: true, message: 'تم إرسال السحب', tx: result });

  } catch (err) {
    console.error('Withdraw error:', err);
    return res.status(500).json({ success: false, message: 'خطأ في السحب: ' + (err.message || err) });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  if (!PRIVATE_KEY || !OWNER_ADDRESS) {
    console.log('Warning: TRON_PRIVATE_KEY/MNEMONIC or OWNER_ADDRESS not set. /withdraw will fail until configured.');
  }
});
