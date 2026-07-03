(function createOCRService(global) {
  const DATE_PATTERN = /(20\d{2})[年./-]\s*(\d{1,2})[月./-]\s*(\d{1,2})日?/;
  const AMOUNT_LABELS = /(合計|総額|支払|利用金額|決済金額|お会計|請求額|税込)/i;
  const GENERIC_LINES = /(paypay|支払い完了|利用明細|カードご利用|レシート|領収書|取引日時|支払方法|合計|総額)/i;
  const CATEGORY_RULES = [
    ["food", /(スーパー|コンビニ|セブン|ファミマ|ローソン|カフェ|レストラン|食料|飲食|マート)/i],
    ["daily", /(amazon|ドラッグ|薬局|日用品|ホームセンター|無印)/i],
    ["transport", /(jr|suica|pasmo|電車|鉄道|タクシー|uber|バス)/i],
    ["housing", /(家賃|住宅|管理費)/i],
    ["utilities", /(電気|ガス|水道|光熱)/i],
    ["communication", /(docomo|softbank|au|スマホ|携帯|通信|wifi|インターネット)/i],
    ["entertainment", /(netflix|spotify|prime|映画|ゲーム|youtube|動画|娯楽)/i],
    ["medical", /(病院|クリニック|診療|医療|処方|薬)/i],
  ];

  function localDate(file) {
    const date = file?.lastModified ? new Date(file.lastModified) : new Date();
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 10);
  }

  function linesOf(text) {
    return String(text || "").split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  }

  function parseDate(text, fallback) {
    const match = String(text).match(DATE_PATTERN);
    if (!match) return fallback;
    const [, year, month, day] = match;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function amountsInLine(line) {
    return [...line.matchAll(/(?:[¥￥]\s*)?(\d[\d,\s]{0,11})\s*(?:円|JPY)?/gi)]
      .map((match) => Number(match[1].replace(/[,\s]/g, "")))
      .filter((amount) => Number.isFinite(amount) && amount > 0 && amount < 100000000 && !(amount >= 1900 && amount <= 2100));
  }

  function parseAmount(text) {
    const lines = linesOf(text);
    const labelled = lines.filter((line) => AMOUNT_LABELS.test(line)).flatMap(amountsInLine);
    if (labelled.length) return Math.max(...labelled);
    const currency = lines.filter((line) => /[¥￥円]|JPY/i.test(line)).flatMap(amountsInLine);
    return currency.length ? Math.max(...currency) : 0;
  }

  function parsePaymentMethod(text) {
    if (/paypay/i.test(text)) return "PayPay";
    if (/(visa|mastercard|master card|jcb|amex|クレジット|カード)/i.test(text)) return "クレジットカード";
    if (/(現金|お預り|お釣り)/i.test(text)) return "現金";
    return "その他";
  }

  function parseSourceType(text, requested) {
    if (requested && requested !== "auto") return requested;
    if (/paypay/i.test(text)) return "paypay";
    if (/(visa|mastercard|jcb|amex|カードご利用|請求)/i.test(text)) return "card";
    return "receipt";
  }

  function parseMerchant(text) {
    return linesOf(text).find((line) =>
      line.length >= 2
      && line.length <= 40
      && !GENERIC_LINES.test(line)
      && !DATE_PATTERN.test(line)
      && !/[¥￥]\s*\d|\d+\s*円/.test(line)
      && !/^\d[\d\s./:-]+$/.test(line),
    ) || "";
  }

  function categoryCandidates(text) {
    const matched = CATEGORY_RULES.filter(([, pattern]) => pattern.test(text)).map(([categoryId]) => categoryId);
    return [...new Set([...matched, "other-expense"])].slice(0, 3).map((categoryId, index) => ({
      categoryId,
      score: matched.includes(categoryId) ? Math.max(0.62, 0.9 - index * 0.12) : 0.5,
    }));
  }

  function parseText(rawText, options = {}) {
    const text = String(rawText || "").trim();
    return {
      sourceType: parseSourceType(text, options.sourceType),
      rawText: text,
      date: parseDate(text, options.fallbackDate || ""),
      amount: parseAmount(text),
      merchant: parseMerchant(text),
      paymentMethod: parsePaymentMethod(text),
      categoryCandidates: categoryCandidates(text),
    };
  }

  async function analyze(file, options = {}) {
    if (!(file instanceof File)) throw new Error("画像ファイルを選択してください");
    if (!file.type.startsWith("image/")) throw new Error("画像形式のファイルを選択してください");
    if (!global.Tesseract?.createWorker) throw new Error("OCRエンジンを読み込めません。通信状態を確認してください");

    let worker;
    try {
      worker = await global.Tesseract.createWorker("jpn+eng", 1, {
        logger(message) {
          if (message.status === "recognizing text") options.onProgress?.(message.progress || 0);
        },
      });
      const { data } = await worker.recognize(file);
      if (!data.text?.trim()) throw new Error("文字を読み取れませんでした。鮮明な画像で再試行してください");
      return {
        provider: "tesseract",
        confidence: Number(data.confidence) || 0,
        ...parseText(data.text, { sourceType: options.sourceType, fallbackDate: localDate(file) }),
      };
    } catch (error) {
      if (error?.message?.includes("文字を読み取れません")) throw error;
      throw new Error("OCR解析に失敗しました。通信状態と画像の鮮明さを確認してください");
    } finally {
      await worker?.terminate().catch(() => {});
    }
  }

  global.OCRService = Object.freeze({ analyze, parseText, provider: "tesseract" });
})(window);
