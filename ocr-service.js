(function createOCRService(global) {
  const DATE_PATTERN = /(20\d{2})\s*[年./-]\s*(\d{1,2})\s*[月./-]\s*(\d{1,2})\s*日?/;
  const TWO_DIGIT_DATE_PATTERN = /(?:^|\D)(\d{2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{1,2})\s*日?/;
  const SHORT_DATE_PATTERN = /(?:^|\D)(\d{1,2})\s*[月./-]\s*(\d{1,2})\s*日?/;
  const AMOUNT_LABELS = /(合計|総額|支払(?:金額|額)?|利用金額|ご利用金額|決済金額|お会計|請求額|税込|利用内容)/i;
  const POINT_PATTERN = /(paypay\s*ポイント|ポイント|\bpt\b|付与処理中)/i;
  const BALANCE_PATTERN = /(残高|カード残高|ポイント残高|ご利用可能額|利用可能額|引落口座)/i;
  const CHARGE_PATTERN = /(?:銀行からの)?チャージ|チャージ完了/i;
  const REFUND_PATTERN = /返金|返金完了/i;
  const TRANSFER_OUT_PATTERN = /(?:さん|様)?に送る|送金|振込/i;
  const TRANSFER_IN_PATTERN = /(?:さん|様)?から受け取る|受け取る|受取/i;
  const HEADER_PATTERN = /(検索|メニュー|カード名|利用者|お知らせ|ホーム|設定|ログアウト|戻る|明細一覧|絞り込み)/i;
  const GENERIC_LINES = /(paypay|支払い完了|受け取り完了|利用明細|カードご利用|レシート|領収書|取引日時|支払方法|支払金額|利用金額|金額|合計|総額|小計|消費税|お預り|お釣り|利用内容|ご利用日時|お支払い分のご利用明細)/i;
  const MERCHANT_NOISE = /(tel|fax|https?|www\.|登録番号|伝票|レジ|担当|店舗番号|会員|ポイント|バーコード|no[.:：\s]*\d|カード番号|お客さま|注意|お知らせ)/i;
  const SEPARATOR_ONLY = /^[\s|｜¦_\-―—–=+*.:：,，;；'"~^…·•□■◇◆○●◎△▽▲▼]+$/u;
  const SCREEN_LABELS = {
    paypay_history: "PayPay取引履歴",
    paypay_transfer_history: "PayPay送金・出金履歴",
    card_email_notice: "カード利用通知",
    card_statement: "カード利用明細",
    receipt: "レシート",
    unknown: "判定できませんでした",
  };
  const CATEGORY_RULES = [
    ["food", /(スーパー|コンビニ|セブン|ファミマ|ローソン|カフェ|レストラン|食料|飲食|マート|まいばすけっと|イオン|成城石井)/i],
    ["daily", /(amazon|ドラッグ|薬局|日用品|ホームセンター|無印|ニトリ)/i],
    ["transport", /(jr|suica|pasmo|電車|鉄道|タクシー|uber|バス|モバイル\s*suica)/i],
    ["housing", /(家賃|住宅|管理費)/i],
    ["utilities", /(電気|ガス|水道|光熱)/i],
    ["communication", /(docomo|softbank|au|スマホ|携帯|通信|wifi|インターネット)/i],
    ["entertainment", /(netflix|spotify|prime|映画|ゲーム|youtube|動画|娯楽)/i],
    ["medical", /(病院|クリニック|診療|医療|処方|薬)/i],
  ];
  const SCREEN_ALIASES = {
    paypay: "paypay_history",
    paypay_transfer: "paypay_transfer_history",
    card: "card_statement",
    card_email: "card_email_notice",
    statement: "card_statement",
    auto: "",
  };
  const TRANSACTION_TYPES = new Set([
    "expense", "income", "transfer_out", "transfer_in", "charge", "refund", "point", "unknown",
  ]);

  function transactionTypeForDirection(direction, fallback = "unknown") {
    const value = String(direction || "").trim();
    if (TRANSACTION_TYPES.has(value)) return value;
    if (value === "internal_transfer" || value === "charge") return "charge";
    if (["expense", "income", "transfer_out", "transfer_in", "refund", "point"].includes(value)) return value;
    return TRANSACTION_TYPES.has(fallback) ? fallback : "unknown";
  }

  function localDate(file) {
    const date = file?.lastModified ? new Date(file.lastModified) : new Date();
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 10);
  }

  function normalizedText(value) {
    return String(value || "")
      .normalize("NFKC")
      .replace(/　/g, " ")
      .replace(/(?<=\d)[OoＯ](?=\d)/g, "0")
      .replace(/(?<=\d)[Ilｌ](?=\d)/g, "1")
      .replace(/[，]/g, ",")
      .replace(/\s+/g, " ")
      .trim();
  }

  function cleanOCRText(text) {
    return String(text || "")
      .normalize("NFKC")
      .split(/\r?\n/)
      .map((line) => normalizedText(line)
        .replace(/[|｜¦]{2,}/g, " ")
        .replace(/^[|｜¦:：;；_\-―—–=+*.,，\s]+|[|｜¦:：;；_\-―—–=+*.,，\s]+$/g, "")
        .trim())
      .filter((line) => {
        if (!line || SEPARATOR_ONLY.test(line) || /(.)\1{5,}/u.test(line)) return false;
        const meaningful = (line.match(/[A-Za-z0-9ぁ-んァ-ヶ一-龠¥￥]/gu) || []).length;
        const symbols = (line.match(/[^\sA-Za-z0-9ぁ-んァ-ヶ一-龠¥￥]/gu) || []).length;
        return meaningful >= 2 && symbols <= Math.max(meaningful * 1.5, 8);
      })
      .join("\n");
  }

  function linesOf(text) {
    return cleanOCRText(text).split("\n").filter(Boolean);
  }

  function parseDate(text, fallback) {
    const match = normalizedText(text).match(DATE_PATTERN);
    if (!match) return fallback;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const candidate = String(year) + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
    const parsed = new Date(candidate + "T12:00:00");
    return parsed.getFullYear() === year && parsed.getMonth() + 1 === month && parsed.getDate() === day ? candidate : fallback;
  }

  function parseFlexibleDate(text, fallback) {
    const full = parseDate(text, "");
    if (full) return full;
    const twoDigit = normalizedText(text).match(TWO_DIGIT_DATE_PATTERN);
    if (twoDigit) {
      return parseDate("20" + twoDigit[1] + "-" + twoDigit[2] + "-" + twoDigit[3], fallback);
    }
    const match = normalizedText(text).match(SHORT_DATE_PATTERN);
    if (!match) return fallback;
    const year = String(fallback || new Date().getFullYear()).slice(0, 4);
    return parseDate(year + "-" + match[1] + "-" + match[2], fallback);
  }

  function parseTime(text) {
    const normalized = normalizedText(text);
    const match = normalized.match(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b/)
      || normalized.match(/(\d{1,2})\s*時\s*(\d{2})\s*分/);
    return match ? String(Number(match[1])).padStart(2, "0") + ":" + match[2] + (match[3] ? ":" + match[3] : "") : "";
  }

  function findDateLine(lines) {
    const full = lines.find((line) => Boolean(parseDate(line, "")));
    if (full) return full;
    const twoDigit = lines.find((line) => Boolean(normalizedText(line).match(TWO_DIGIT_DATE_PATTERN)));
    if (twoDigit) return twoDigit;
    return lines.find((line) => !/(tel|fax|電話|カード番号)/i.test(line) && Boolean(parseFlexibleDate(line, ""))) || "";
  }

  function isExcludedMoneyLine(line) {
    return POINT_PATTERN.test(line) || BALANCE_PATTERN.test(line) || /(?:カード番号|口座番号|TEL|電話)/i.test(line);
  }

  function amountsInLine(line, options = {}) {
    if (!options.allowExcluded && isExcludedMoneyLine(line)) return [];
    let amountText = normalizedText(line)
      .replace(DATE_PATTERN, " ")
      .replace(TWO_DIGIT_DATE_PATTERN, " ")
      .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, " ");
    amountText = amountText.replace(SHORT_DATE_PATTERN, (match, _month, _day, offset, input) => {
      const following = input.slice(offset + match.length);
      return /^\s*(?:\d|円|JPY)/i.test(following) ? match : " ";
    });
    const hasCurrency = /[¥￥円]|\bJPY\b/i.test(amountText);
    const hasLabel = AMOUNT_LABELS.test(amountText);
    if (!hasCurrency && !hasLabel && !options.allowBare) return [];
    return [...amountText.matchAll(/(?:[¥￥]\s*)?(\d{1,3}(?:[,\s.]\d{3})+|\d{1,9})\s*(?:円|JPY)?/gi)]
      .map((match) => Number(match[1].replace(/[,\s.]/g, "")))
      .filter((amount) => Number.isFinite(amount) && amount > 0 && amount < 100000000);
  }

  function amountFromLines(lines, options = {}) {
    const matches = lines
      .map((line, index) => ({
        amount: Math.max(0, ...amountsInLine(line, options)),
        index,
        labelled: AMOUNT_LABELS.test(line),
        currency: /[¥￥円]|\bJPY\b/i.test(line),
      }))
      .filter((item) => item.amount);
    matches.sort((a, b) => (Number(b.labelled) - Number(a.labelled)) || (Number(b.currency) - Number(a.currency)) || b.amount - a.amount);
    return matches[0] || { amount: 0, index: -1, labelled: false, currency: false };
  }

  function parsePaymentMethod(text) {
    if (/paypay/i.test(text)) return "PayPay";
    if (/(visa|mastercard|master card|jcb|amex|三井住友|クレジット|カード)/i.test(text)) return "クレジットカード";
    if (/(現金|お預り|お釣り)/i.test(text)) return "現金";
    return "その他";
  }

  function wordsFromData(data) {
    const words = Array.isArray(data?.words) ? data.words : [];
    return words
      .map((word) => ({
        text: normalizedText(word.text),
        confidence: Number(word.confidence) || 0,
        x0: Number(word.bbox?.x0) || 0,
        y0: Number(word.bbox?.y0) || 0,
        x1: Number(word.bbox?.x1) || 0,
        y1: Number(word.bbox?.y1) || 0,
      }))
      .filter((word) => word.text);
  }

  function buildLayout(data) {
    const words = wordsFromData(data);
    const height = Math.max(1, ...words.map((word) => word.y1));
    const headerWords = words.filter((word) => word.y0 < height * 0.18);
    return {
      words,
      imageHeight: height,
      headerText: headerWords.map((word) => word.text).join(" "),
      averageWordConfidence: words.length
        ? words.reduce((sum, word) => sum + word.confidence, 0) / words.length
        : Number(data?.confidence) || 0,
    };
  }

  function isTopNavigationLine(line, layout) {
    if (!layout?.headerText || !HEADER_PATTERN.test(line)) return false;
    const compactLine = normalizedText(line).replace(/\s/g, "");
    const compactHeader = normalizedText(layout.headerText).replace(/\s/g, "");
    return compactLine.length > 1 && compactHeader.includes(compactLine);
  }

  function requestedScreenType(value) {
    const normalized = normalizedText(value);
    return SCREEN_ALIASES[normalized] || (Object.hasOwn(SCREEN_LABELS, normalized) ? normalized : "");
  }

  function countKeywords(text, keywords) {
    return keywords.reduce((score, keyword) => score + (text.match(new RegExp(keyword, "gi")) || []).length, 0);
  }

  function detectScreenType(rawText, options = {}) {
    const text = cleanOCRText(rawText);
    const requested = requestedScreenType(options.sourceType);
    if (requested) {
      return { screenType: requested, screenTypeConfidence: 0.99, scores: { [requested]: 99 } };
    }
    const header = normalizedText(options.layout?.headerText);
    const corpus = text + "\n" + header;
    const scores = {
      paypay_history: countKeywords(corpus, ["PayPay", "取引履歴", "支払い完了", "受け取り完了", "残高", "ポイント", "付与処理中", "送る", "チャージ完了", "返金完了"]) * 1.3,
      paypay_transfer_history: countKeywords(corpus, ["絞り込み中", "出金", "送金", "譲渡", "さんに送る"]) * 1.35,
      card_email_notice: countKeywords(corpus, ["カード利用", "カードご利用", "利用内容", "ご利用日時", "承認照会", "利用通知", "三井住友カード", "ご利用金額"]) * 1.25,
      card_statement: countKeywords(corpus, ["お支払い分のご利用明細", "1回払い", "利用日", "明細", "検索", "カード名", "ご利用明細"]) * 1.2,
      receipt: countKeywords(corpus, ["レシート", "領収書", "合計", "小計", "お預り", "お釣り", "TEL", "消費税"]),
    };
    if (/支払い完了|受け取り完了/.test(corpus) && /PayPay/i.test(corpus)) scores.paypay_history += 3;
    if (/絞り込み中/.test(corpus) && /出金|送金|譲渡/.test(corpus)) scores.paypay_transfer_history += 4;
    if (/三井住友カード/.test(corpus) && /ご利用日時|利用内容/.test(corpus)) scores.card_email_notice += 3;
    if (/利用日/.test(corpus) && /1回払い|お支払い分/.test(corpus)) scores.card_statement += 3;
    const ordered = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const best = ordered[0] || ["unknown", 0];
    const next = ordered[1]?.[1] || 0;
    if (best[1] < 2) return { screenType: "unknown", screenTypeConfidence: 0.3, scores };
    const confidence = Math.min(0.98, 0.52 + best[1] * 0.055 + Math.max(0, best[1] - next) * 0.04);
    return { screenType: best[0], screenTypeConfidence: confidence, scores };
  }

  function merchantFromLine(line) {
    const cleaned = normalizedText(line)
      .replace(DATE_PATTERN, " ")
      .replace(SHORT_DATE_PATTERN, " ")
      .replace(/\d+回払い/gi, " ")
      .replace(/(?:[¥￥]\s*)?-?\d[\d,\s]{0,11}\s*(?:円|JPY)?/gi, " ")
      .replace(/(?:支払い完了|受け取り完了|支払(?:金額|額)?|利用金額|ご利用金額|決済金額|お会計|請求額|税込|合計|総額|小計|利用日|1回払い)/gi, " ")
      .replace(/(?:ご利用店|利用先|加盟店|店舗名|店名)\s*[:：]?/gi, " ")
      .replace(/[|:：・–—]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return cleaned.length >= 2
      && cleaned.length <= 60
      && /[A-Za-zぁ-んァ-ヶ一-龠]/.test(cleaned)
      && !GENERIC_LINES.test(cleaned)
      && !MERCHANT_NOISE.test(cleaned)
      && !HEADER_PATTERN.test(cleaned)
      && !/^\d|[¥￥]\s*\d|\d+\s*円/u.test(cleaned)
      ? cleaned
      : "";
  }

  function merchantFromLines(lines) {
    const candidates = lines
      .map((line, index) => ({ merchant: merchantFromLine(line), index }))
      .filter((item) => item.merchant);
    candidates.sort((a, b) => {
      const score = (item) =>
        (CATEGORY_RULES.some((rule) => rule[1].test(item.merchant)) ? 8 : 0)
        + (/[ぁ-んァ-ヶ一-龠]/u.test(item.merchant) ? 3 : 0)
        - item.index * 0.2;
      return score(b) - score(a);
    });
    return candidates[0]?.merchant || "";
  }

  function normalizeMerchant(value) {
    const raw = normalizedText(value);
    const compact = raw
      .replace(/[()（）［］\[\]]/g, " ")
      .replace(/(?:\/?|／)\s*iD\b/gi, " ")
      .replace(/(?:株式会社|有限会社|合同会社|\(株\)|\(有\)|\binc\.?|\bco\.?\s*,?\s*ltd\.?)/gi, " ")
      .replace(/(?:支店|店|店舗)\s*$/u, "")
      .replace(/\s+/g, " ")
      .trim();
    const key = compact.replace(/[\s・._-]/g, "").toLowerCase();
    if (/mobile.*suica|モバイルsuica/i.test(compact)) return "モバイルSuica";
    if (/fitplace/i.test(key)) return "FIT PLACE";
    if (/^eneosss$/i.test(key)) return "ENEOS-SS";
    if (/paypay/i.test(compact) && /ポイント|残高/.test(compact)) return "PayPay";
    return compact;
  }

  function categoryCandidates(text, direction = "expense") {
    if (["point", "internal_transfer", "transfer_out", "transfer_in", "refund"].includes(direction)) return [];
    const matched = CATEGORY_RULES
      .filter((rule) => rule[1].test(text))
      .map((rule) => rule[0]);
    return [...new Set([...matched, "other-expense"])].slice(0, 3).map((categoryId, index) => ({
      categoryId,
      score: matched.includes(categoryId) ? Math.max(0.62, 0.9 - index * 0.12) : 0.5,
    }));
  }

  function candidateDirection(line, screenType) {
    if (POINT_PATTERN.test(line)) return "point";
    if (CHARGE_PATTERN.test(line)) return "internal_transfer";
    if (REFUND_PATTERN.test(line)) return "refund";
    if (TRANSFER_OUT_PATTERN.test(line)) return "transfer_out";
    if (TRANSFER_IN_PATTERN.test(line)) return "transfer_in";
    if (screenType === "card_email_notice" || screenType === "card_statement" || /支払い完了|利用内容|ご利用明細/.test(line)) return "expense";
    return screenType === "unknown" ? "unknown" : "expense";
  }

  function candidateStatus(line, screenType, direction) {
    if (direction === "point" || POINT_PATTERN.test(line) || BALANCE_PATTERN.test(line)) return "excluded";
    if (direction === "internal_transfer") return "excluded";
    if (direction === "refund") return "refund_completed";
    if (screenType === "card_email_notice") return "pending";
    return "settled";
  }

  function buildCandidate(fields) {
    const merchantRaw = fields.merchantRaw || "";
    const merchantNormalized = normalizeMerchant(merchantRaw);
    const direction = fields.direction || "unknown";
    const transactionType = transactionTypeForDirection(fields.transactionType || direction);
    const status = fields.status || "settled";
    const categoryList = categoryCandidates(merchantRaw, direction);
    const date = fields.date || "";
    const time = fields.time || "";
    return {
      id: fields.id || "",
      sourceType: fields.sourceType,
      sourceName: SCREEN_LABELS[fields.sourceType] || SCREEN_LABELS.unknown,
      merchantRaw,
      merchantNormalized,
      merchant: merchantRaw,
      amount: Number(fields.amount) || 0,
      unit: fields.unit || "JPY",
      amountHasCurrency: fields.amountHasCurrency === true,
      dateAmountNearby: fields.dateAmountNearby === true,
      merchantQuality: fields.merchantQuality !== false && !/[�□■]{2,}/u.test(merchantRaw),
      currency: "JPY",
      date,
      transactionAt: date && time ? date + "T" + time : date,
      paymentMethod: fields.paymentMethod || "その他",
      direction,
      transactionType,
      excludedFromExpense: transactionType !== "expense",
      status,
      category: categoryList[0]?.categoryId || "",
      categoryCandidates: categoryList,
      rawText: fields.rawText || "",
      imageReference: fields.imageReference || "",
      reasons: fields.reasons || [],
      duplicateCandidateIds: [],
      duplicateCandidates: [],
      excluded: status === "excluded",
      excludeReason: fields.excludeReason || (status === "excluded" ? fields.reasons?.[0] || "除外候補" : ""),
      duplicateKey: [fields.paymentMethod || "その他", date, merchantNormalized, Number(fields.amount) || 0].join("|"),
    };
  }

  function extractPayPay(lines, context) {
    const records = [];
    let current = { date: context.fallbackDate, hasDate: false, merchant: "", amount: 0, amountHasCurrency: false, time: "", stateLine: "", startIndex: -1 };
    let pendingPointHeading = false;
    const addPoint = (amount) => records.push(buildCandidate({
      sourceType: context.screenType,
      date: current.date || context.fallbackDate,
      merchantRaw: "PayPayポイント",
      amount,
      unit: "pt",
      amountHasCurrency: false,
      paymentMethod: "PayPay",
      direction: "point",
      status: "excluded",
      rawText: context.rawText,
      imageReference: context.imageReference,
      reasons: ["ポイントは円の取引ではないため除外"],
    }));
    const dateNearCurrent = () => {
      for (let index = current.startIndex; index >= 0 && index <= Math.min(lines.length - 1, current.startIndex + 4); index += 1) {
        const candidate = parseFlexibleDate(lines[index], "");
        if (candidate) return { date: candidate, time: parseTime(lines[index]) || current.time };
      }
      return { date: current.date, time: current.time };
    };
    const finalize = () => {
      if (!current.amount || !current.merchant) return;
      const transactionDate = dateNearCurrent();
      const direction = candidateDirection(current.merchant + " " + current.stateLine, context.screenType);
      const reasons = direction === "point" ? ["ポイントは円の取引ではないため除外"]
        : direction === "internal_transfer" ? ["チャージは家計支出に含めないため除外"]
          : direction === "refund" ? ["返金として収入側の補正候補"]
            : direction === "transfer_out" ? ["送金のため登録前に確認が必要"]
              : direction === "transfer_in" ? ["受取・入金のため登録前に確認が必要"] : [];
      records.push(buildCandidate({
        sourceType: context.screenType,
        date: transactionDate.date,
        time: transactionDate.time,
        merchantRaw: current.merchant,
        amount: current.amount,
        amountHasCurrency: current.amountHasCurrency,
        dateAmountNearby: current.hasDate,
        paymentMethod: "PayPay",
        direction,
        status: candidateStatus(current.stateLine, context.screenType, direction),
        rawText: context.rawText,
        imageReference: context.imageReference,
        reasons,
        excludeReason: direction === "internal_transfer" ? "チャージのため除外" : "",
      }));
      current = { date: transactionDate.date || context.fallbackDate, hasDate: false, merchant: "", amount: 0, amountHasCurrency: false, time: "", stateLine: "", startIndex: -1 };
    };
    lines.forEach((line, lineIndex) => {
      const flowState = /支払い完了|受け取り完了|送る|送金|チャージ完了|返金完了/.test(line);
      if (DATE_PATTERN.test(line) || TWO_DIGIT_DATE_PATTERN.test(line) || SHORT_DATE_PATTERN.test(line)) {
        current.date = parseFlexibleDate(line, current.date || context.fallbackDate);
        current.hasDate = true;
        current.time = parseTime(line) || current.time;
        if (current.amount && current.merchant && /(に送る|から受け取る|返金|チャージ)/.test(current.merchant + " " + current.stateLine)) {
          finalize();
          return;
        }
      }
      const pointHeading = /paypay\s*ポイント/i.test(line);
      const pointValue = /\d[\d,\s.]*\s*pt\b/i.test(line);
      if (pointHeading || pointValue || pendingPointHeading) {
        if (pointValue) {
          finalize();
          addPoint(Math.max(...amountsInLine(line, { allowExcluded: true, allowBare: true }), 0));
          pendingPointHeading = false;
          return;
        }
        if (pointHeading) {
          if (pendingPointHeading) addPoint(0);
          finalize();
          pendingPointHeading = true;
          return;
        }
        addPoint(0);
        pendingPointHeading = false;
      }
      const inlineMerchant = merchantFromLine(line);
      if (inlineMerchant) {
        if (current.merchant && current.amount && current.hasDate && inlineMerchant !== current.merchant) finalize();
        if (!current.merchant || !current.amount) {
          current.merchant = inlineMerchant;
          current.startIndex = lineIndex;
          if (!current.amount) current.stateLine = "";
        }
      }
      if (BALANCE_PATTERN.test(line)) return;
      const amount = amountFromLines([line]);
      if (amount.amount) {
        current.amount = amount.amount;
        current.amountHasCurrency = amount.currency;
      }
      if (flowState && (current.merchant || current.amount)) current.stateLine += " " + line;
      if (/支払い完了|受け取り完了/.test(current.stateLine)) finalize();
    });
    if (pendingPointHeading) addPoint(0);
    finalize();
    return records;
  }

  function labelledValue(lines, label) {
    const matching = lines.find((line) => label.test(line));
    if (!matching) return "";
    return normalizedText(matching.replace(label, "").replace(/^\s*[:：-]?\s*/, ""));
  }

  function extractCardEmail(lines, context) {
    const merchantLabel = /(?:ご利用店|利用先|加盟店|店舗名|店名)\s*[:：]?/i;
    const merchant = labelledValue(lines, merchantLabel) || merchantFromLines(lines);
    const dateLine = labelledValue(lines, /(?:ご利用日時|利用日時|取引日時)\s*[:：]?/i)
      || findDateLine(lines);
    const money = amountFromLines(lines.filter((line) => AMOUNT_LABELS.test(line)), { allowBare: true });
    const fallbackMoney = money.amount ? money : amountFromLines(lines);
    const direction = "expense";
    return [buildCandidate({
      sourceType: context.screenType,
      date: parseFlexibleDate(dateLine, context.fallbackDate),
      time: parseTime(dateLine),
      merchantRaw: merchant,
      amount: fallbackMoney.amount,
      amountHasCurrency: fallbackMoney.currency === true,
      dateAmountNearby: Boolean(dateLine && fallbackMoney.amount),
      paymentMethod: "クレジットカード",
      direction,
      status: "pending",
      rawText: context.rawText,
      imageReference: context.imageReference,
      reasons: ["利用通知のため確定前として扱います"],
    })];
  }

  function extractCardStatement(lines, context) {
    const isStatementDateLine = (line) =>
      (DATE_PATTERN.test(line) || TWO_DIGIT_DATE_PATTERN.test(line) || SHORT_DATE_PATTERN.test(line))
      && !/(お支払い分|ご利用明細|検索|カード名|利用者|利用分)/i.test(line);
    const valueNear = (index) => {
      const offsets = [0, -1, -2];
      for (const offset of offsets) {
        const line = lines[index + offset];
        if (!line) continue;
        const money = amountFromLines([line], { allowBare: true });
        if (money.amount) return money;
      }
      return { amount: 0 };
    };
    const merchantNear = (index) => {
      const offsets = [0, -1, -2];
      for (const offset of offsets) {
        const merchant = merchantFromLine(lines[index + offset] || "");
        if (merchant) return merchant;
      }
      return "";
    };
    const records = lines.map((dateLine, index) => {
      if (!isStatementDateLine(dateLine)) return null;
      const money = valueNear(index);
      const merchant = merchantNear(index);
      return buildCandidate({
        sourceType: context.screenType,
        date: parseFlexibleDate(dateLine, context.fallbackDate),
        merchantRaw: merchant,
        amount: money.amount,
        amountHasCurrency: money.currency === true,
        dateAmountNearby: Boolean(money.amount),
        paymentMethod: "クレジットカード",
        direction: "expense",
        status: "settled",
        rawText: context.rawText,
        imageReference: context.imageReference,
        reasons: ["カード明細のため確定済みとして扱います"],
      });
    }).filter((record) => record && (record.amount || record.merchantRaw));
    return records;
  }

  function extractReceipt(lines, context) {
    const money = amountFromLines(lines.filter((line) => /(合計|総額|お会計|請求額)/i.test(line)), { allowBare: true });
    const fallbackMoney = money.amount ? money : amountFromLines(lines);
    const dateLine = findDateLine(lines);
    return [buildCandidate({
      sourceType: context.screenType,
      date: parseFlexibleDate(dateLine, context.fallbackDate),
      time: parseTime(dateLine),
      merchantRaw: merchantFromLines(lines),
      amount: fallbackMoney.amount,
      amountHasCurrency: fallbackMoney.currency === true,
      dateAmountNearby: Boolean(dateLine && fallbackMoney.amount),
      paymentMethod: parsePaymentMethod(context.rawText),
      direction: "expense",
      status: "settled",
      rawText: context.rawText,
      imageReference: context.imageReference,
      reasons: [],
    })];
  }

  function extractUnknown(lines, context) {
    const money = amountFromLines(lines, { allowBare: true });
    const dateLine = findDateLine(lines);
    return [buildCandidate({
      sourceType: "unknown",
      date: parseFlexibleDate(dateLine, context.fallbackDate),
      merchantRaw: merchantFromLines(lines),
      amount: money.amount,
      amountHasCurrency: money.currency === true,
      dateAmountNearby: false,
      paymentMethod: parsePaymentMethod(context.rawText),
      direction: "unknown",
      status: "settled",
      rawText: context.rawText,
      imageReference: context.imageReference,
      reasons: ["画面種別を判定できないため確認が必要"],
    })];
  }

  function extractTransactions(rawText, options = {}) {
    const raw = cleanOCRText(rawText);
    const detected = detectScreenType(raw, options);
    const context = {
      screenType: detected.screenType,
      fallbackDate: options.fallbackDate || "",
      rawText: raw,
      imageReference: options.imageReference || "",
    };
    const lines = linesOf(raw).filter((line) => !isTopNavigationLine(line, options.layout));
    let records;
    if (context.screenType === "paypay_history" || context.screenType === "paypay_transfer_history") records = extractPayPay(lines, context);
    else if (context.screenType === "card_email_notice") records = extractCardEmail(lines, context);
    else if (context.screenType === "card_statement") records = extractCardStatement(lines, context);
    else if (context.screenType === "receipt") records = extractReceipt(lines, context);
    else records = extractUnknown(lines, context);
    const usable = records.length ? records : extractUnknown(lines, context);
    const withMeta = usable.map((record, index) => ({
      ...record,
      id: record.id || "ocr-" + index,
      screenType: context.screenType,
      screenTypeConfidence: detected.screenTypeConfidence,
      screenScores: detected.scores,
    }));
    return options.score === false
      ? withMeta
      : withMeta.map((record) => confidenceForCandidate(record, options.ocrConfidence ?? 100));
  }

  function confidenceForCandidate(candidate, ocrConfidence) {
    const amount = candidate.amount > 0
      ? (candidate.unit === "pt" ? 1 : candidate.amountHasCurrency ? 0.94 : 0.45)
      : 0;
    const date = /^20\d{2}-\d{2}-\d{2}$/.test(candidate.date) ? 0.92 : 0;
    const merchant = candidate.merchantRaw && candidate.merchantNormalized ? 0.9 : 0;
    const direction = candidate.direction === "unknown" ? 0.35 : 0.92;
    const category = candidate.category ? candidate.categoryCandidates[0]?.score || 0.5 : candidate.direction === "point" ? 1 : 0.25;
    const screen = candidate.screenTypeConfidence || 0.35;
    const raw = Math.max(0, Math.min(1, Number(ocrConfidence) / 100));
    let decision = raw * 0.27 + amount * 0.23 + date * 0.16 + merchant * 0.18 + direction * 0.07 + category * 0.04 + screen * 0.05;
    if (candidate.status === "pending") decision -= 0.03;
    if (candidate.status === "excluded") decision = 0;
    const needsReview = candidate.status === "excluded"
      || ["transfer_out", "transfer_in", "refund", "internal_transfer", "unknown"].includes(candidate.direction)
      || !candidate.amount || !candidate.date || !candidate.merchantRaw || !candidate.amountHasCurrency
      || !candidate.dateAmountNearby || !candidate.merchantQuality
      || decision < 0.95;
    return {
      ...candidate,
      ocrConfidence: Math.round(raw * 100),
      decisionConfidence: Math.max(0, Math.min(0.99, decision)),
      confidence: Math.max(0, Math.min(0.99, decision)),
      needsReview,
      confidenceBreakdown: { amount, date, merchant, direction, category, screen },
    };
  }

  function dateDistance(left, right) {
    if (!left || !right) return Infinity;
    return Math.abs(new Date(left + "T12:00:00").getTime() - new Date(right + "T12:00:00").getTime()) / 86400000;
  }

  function merchantSimilarity(left, right) {
    const a = normalizeMerchant(left).replace(/\s/g, "").toLowerCase();
    const b = normalizeMerchant(right).replace(/\s/g, "").toLowerCase();
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.includes(b) || b.includes(a)) return 0.85;
    const shared = [...new Set(a)].filter((character) => b.includes(character)).length;
    return shared / Math.max(a.length, b.length);
  }

  function paymentCompatible(left, right) {
    return left === right || (/(クレジット|カード)/.test(left || "") && /(クレジット|カード)/.test(right || ""));
  }

  function matchExistingTransactions(candidates, transactions = []) {
    return candidates.map((candidate) => {
      if (!candidate.amount || candidate.status === "excluded") return candidate;
      const matches = transactions.map((transaction) => {
        const existingMerchant = transaction.ocr?.merchantNormalized || transaction.memo || "";
        const existingPayment = transaction.paymentMethod || transaction.ocr?.paymentMethod || "";
        const existingStatus = transaction.ocr?.status || "settled";
        const similarity = merchantSimilarity(candidate.merchantNormalized, existingMerchant);
        const days = dateDistance(candidate.date, transaction.date);
        const amountMatches = Number(candidate.amount) === Number(transaction.amount);
        const paymentMatches = paymentCompatible(candidate.paymentMethod, existingPayment);
        const statusPair = new Set([candidate.sourceType, transaction.ocr?.sourceType]);
        const cardPair = statusPair.has("card_email_notice") && statusPair.has("card_statement");
        const score = (amountMatches ? 0.42 : 0) + (paymentMatches ? 0.18 : 0) + (similarity * 0.25) + (days <= 3 ? 0.15 : 0) + (cardPair ? 0.1 : 0);
        return {
          id: transaction.id,
          score,
          sourceType: transaction.ocr?.sourceType || transaction.source || "manual",
          status: existingStatus,
          cardPair,
        };
      }).filter((match) => match.score >= 0.72);
      return {
        ...candidate,
        duplicateCandidateIds: matches.map((match) => match.id),
        duplicateCandidates: matches,
        needsReview: candidate.needsReview || matches.length > 0,
        reasons: matches.length ? [...candidate.reasons, "既存取引との重複候補"] : candidate.reasons,
      };
    });
  }

  function parseText(rawText, options = {}) {
    const transactions = extractTransactions(rawText, options);
    const primary = transactions.find((candidate) => candidate.status !== "excluded") || transactions[0];
    return {
      ...primary,
      sourceType: primary.screenType,
      rawText: cleanOCRText(rawText),
      transactions,
    };
  }

  function otsuThreshold(grayValues) {
    const histogram = new Array(256).fill(0);
    grayValues.forEach((value) => { histogram[value] += 1; });
    const total = grayValues.length;
    let totalSum = 0;
    histogram.forEach((count, value) => { totalSum += value * count; });
    let backgroundWeight = 0;
    let backgroundSum = 0;
    let bestVariance = -1;
    let threshold = 170;
    for (let value = 0; value < 256; value += 1) {
      backgroundWeight += histogram[value];
      if (!backgroundWeight) continue;
      const foregroundWeight = total - backgroundWeight;
      if (!foregroundWeight) break;
      backgroundSum += value * histogram[value];
      const backgroundMean = backgroundSum / backgroundWeight;
      const foregroundMean = (totalSum - backgroundSum) / foregroundWeight;
      const variance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2;
      if (variance > bestVariance) {
        bestVariance = variance;
        threshold = value;
      }
    }
    return Math.max(105, Math.min(215, threshold + 12));
  }

  function removeLongRules(data, width, height) {
    const isDark = (x, y) => data[(y * width + x) * 4] < 80;
    const clear = (x, y) => {
      for (let offset = -1; offset <= 1; offset += 1) {
        const row = y + offset;
        if (row < 0 || row >= height) continue;
        const pixel = (row * width + x) * 4;
        data[pixel] = 255;
        data[pixel + 1] = 255;
        data[pixel + 2] = 255;
      }
    };
    const horizontalMinimum = Math.max(90, Math.round(width * 0.32));
    for (let y = 0; y < height; y += 1) {
      let start = -1;
      for (let x = 0; x <= width; x += 1) {
        if (x < width && isDark(x, y)) {
          if (start < 0) start = x;
        } else if (start >= 0) {
          if (x - start >= horizontalMinimum) {
            for (let clearX = start; clearX < x; clearX += 1) clear(clearX, y);
          }
          start = -1;
        }
      }
    }
    const verticalMinimum = Math.max(120, Math.round(height * 0.24));
    for (let x = 0; x < width; x += 1) {
      let start = -1;
      for (let y = 0; y <= height; y += 1) {
        if (y < height && isDark(x, y)) {
          if (start < 0) start = y;
        } else if (start >= 0) {
          if (y - start >= verticalMinimum) {
            for (let clearY = start; clearY < y; clearY += 1) clear(x, clearY);
          }
          start = -1;
        }
      }
    }
  }

  function preprocessImage(file) {
    return new Promise((resolve) => {
      const image = new Image();
      const url = URL.createObjectURL(file);
      image.onload = () => {
        const scale = Math.min(3, 2600 / image.naturalWidth);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext("2d", { willReadFrequently: true });
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        const grays = new Uint8Array(canvas.width * canvas.height);
        for (let index = 0; index < pixels.data.length; index += 4) {
          const gray = pixels.data[index] * 0.299 + pixels.data[index + 1] * 0.587 + pixels.data[index + 2] * 0.114;
          grays[index / 4] = Math.round(gray);
        }
        const threshold = otsuThreshold(grays);
        for (let index = 0; index < pixels.data.length; index += 4) {
          const binary = grays[index / 4] < threshold ? 0 : 255;
          pixels.data[index] = binary;
          pixels.data[index + 1] = binary;
          pixels.data[index + 2] = binary;
          pixels.data[index + 3] = 255;
        }
        removeLongRules(pixels.data, canvas.width, canvas.height);
        context.putImageData(pixels, 0, 0);
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(url);
          resolve(blob || file);
        }, "image/png");
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(file);
      };
      image.src = url;
    });
  }

  function resultScore(result, options) {
    const parsed = parseText(result.data.text, options);
    const primary = parsed.transactions.find((candidate) => candidate.status !== "excluded") || parsed.transactions[0];
    return (Number(result.data.confidence) || 0)
      + (primary?.amount ? 24 : 0)
      + (primary?.date ? 14 : 0)
      + (primary?.merchantRaw ? 14 : 0)
      + (primary?.screenType !== "unknown" ? 8 : 0);
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
      await worker.setParameters({
        tessedit_pageseg_mode: requestedScreenType(options.sourceType) === "receipt" ? "6" : "11",
        preserve_interword_spaces: "1",
        user_defined_dpi: "300",
      });
      const processedImage = await preprocessImage(file);
      const processedRecognition = await worker.recognize(processedImage);
      options.onProgress?.(0);
      const originalRecognition = await worker.recognize(file);
      const recognition = resultScore(originalRecognition, { sourceType: options.sourceType, fallbackDate: localDate(file) })
        > resultScore(processedRecognition, { sourceType: options.sourceType, fallbackDate: localDate(file) })
        ? originalRecognition
        : processedRecognition;
      const data = recognition.data;
      if (!data.text?.trim()) throw new Error("文字を読み取れませんでした。鮮明な画像で再試行してください");
      const rawText = cleanOCRText(data.text);
      if (!rawText) throw new Error("文字を読み取れませんでした。鮮明な画像で再試行してください");
      const layout = buildLayout(data);
      const detected = detectScreenType(rawText, { sourceType: options.sourceType, layout });
      const baseTransactions = extractTransactions(rawText, {
        sourceType: options.sourceType,
        fallbackDate: localDate(file),
        imageReference: options.imageReference || "",
        layout,
        score: false,
      });
      const transactions = baseTransactions.map((candidate) => confidenceForCandidate(candidate, data.confidence));
      const primary = transactions.find((candidate) => candidate.status !== "excluded") || transactions[0];
      return {
        provider: "tesseract",
        confidence: Number(data.confidence) || 0,
        screenType: detected.screenType,
        screenTypeConfidence: detected.screenTypeConfidence,
        sourceType: detected.screenType,
        sourceName: SCREEN_LABELS[detected.screenType],
        rawText,
        words: layout.words,
        layout,
        ocrRuns: [
          { variant: "preprocessed", confidence: Number(processedRecognition.data.confidence) || 0 },
          { variant: "original", confidence: Number(originalRecognition.data.confidence) || 0 },
        ],
        ...primary,
        transactions,
      };
    } catch (error) {
      if (error?.message?.includes("文字を読み取れません")) throw error;
      throw new Error("OCR解析に失敗しました。通信状態と画像の鮮明さを確認してください");
    } finally {
      await worker?.terminate().catch(() => {});
    }
  }

  global.OCRService = Object.freeze({
    analyze,
    parseText,
    extractTransactions,
    detectScreenType,
    normalizeMerchant,
    transactionTypeForDirection,
    matchExistingTransactions,
    cleanOCRText,
    screenLabels: SCREEN_LABELS,
    provider: "tesseract",
  });
})(window);
