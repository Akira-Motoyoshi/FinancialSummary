import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

async function loadOCRService() {
  const context = { window: {} };
  vm.runInNewContext(await read("ocr-service.js"), context);
  return context.window.OCRService;
}

test("PWA metadata and app entry points are present", async () => {
  const [html, manifestText, version, worker] = await Promise.all([read("index.html"), read("manifest.webmanifest"), read("app-version.js"), read("sw.js")]);
  const manifest = JSON.parse(manifestText);

  assert.match(html, /name="viewport"[^>]*viewport-fit=cover/);
  assert.match(html, /rel="manifest" href="\.\/manifest\.webmanifest"/);
  assert.match(html, /apple-mobile-web-app-capable/);
  assert.match(html, /id="transaction-form"/);
  assert.match(html, /id="ocr-form"/);
  assert.match(html, /id="savings-goal-form"/);
  assert.match(html, /\.\/ledger-service\.js/);
  assert.match(html, /data-action="record-subscription"/);
  assert.match(html, /\.\/app-version\.js/);
  assert.match(version, /APP_VERSION = "1\.00"/);
  assert.match(worker, /importScripts\("\.\/app-version\.js"\)/);
  assert.match(worker, /APP_VERSION\.replace/);
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.name, "貯金ザウルス");
  assert.equal(manifest.short_name, "貯金ザウルス");
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
  assert.ok(manifest.icons.some((icon) => icon.sizes === "192x192"));
  assert.ok(manifest.icons.some((icon) => icon.sizes === "512x512"));
});

test("repository includes reproducible local and deployment instructions", async () => {
  const [packageText, readme, server] = await Promise.all([
    read("package.json"),
    read("README.md"),
    read("scripts/serve.mjs"),
  ]);
  const packageJson = JSON.parse(packageText);
  assert.equal(packageJson.scripts.dev, "node scripts/serve.mjs .");
  assert.equal(packageJson.scripts.preview, "node scripts/serve.mjs dist");
  assert.match(readme, /pnpm run lint/);
  assert.match(readme, /端末内OCR/);
  assert.match(readme, /JSONバックアップ/);
  assert.match(server, /Cache-Control/);
});

test("service worker caches only declared static assets", async () => {
  const worker = await read("sw.js");
  assert.match(worker, /event\.request\.mode === "navigate"/);
  assert.match(worker, /url\.origin !== self\.location\.origin/);
  assert.match(worker, /APP_ASSETS\.includes\(assetPath\)/);
  assert.match(worker, /\.\/ledger-service\.js/);
  assert.doesNotMatch(worker, /caches\.match\(event\.request\)[\s\S]*if \(cached\) return cached/);
});

test("household totals exclude transfers, charges, points, and pending notices", async () => {
  const service = await read("ledger-service.js");
  const context = { window: {} };
  vm.runInNewContext(service, context);
  const ledger = context.window.LedgerService;
  const transactions = [
    { id: "income", type: "income", amount: 200000, date: "2026-07-01", category: "salary" },
    { id: "expense", type: "expense", amount: 3000, date: "2026-07-02", category: "food" },
    { id: "refund", type: "income", amount: 500, date: "2026-07-03", category: "other-income", ocr: { direction: "refund", status: "refund_completed" } },
    { id: "send", type: "expense", amount: 1200, date: "2026-07-04", category: "other-expense", ocr: { direction: "transfer_out", status: "settled" } },
    { id: "receive", type: "income", amount: 977, date: "2026-07-05", category: "other-income", ocr: { direction: "transfer_in", status: "settled" } },
    { id: "charge", type: "expense", amount: 5000, date: "2026-07-06", category: "other-expense", ocr: { direction: "internal_transfer", status: "excluded" } },
    { id: "point", type: "expense", amount: 75, date: "2026-07-07", category: "other-expense", ocr: { direction: "point", status: "excluded" } },
    { id: "pending", type: "expense", amount: 1000, date: "2026-07-08", category: "transport", ocr: { direction: "expense", status: "pending" } },
  ];

  const totals = ledger.totalsForTransactions(transactions, "2026-07");
  assert.equal(JSON.stringify(totals), JSON.stringify({
    income: 200000,
    expense: 3000,
    refund: 500,
    transferIn: 977,
    transferOut: 1200,
    charge: 5000,
    pending: 1000,
    point: 75,
    excluded: 0,
    net: 197500,
    reviewCount: 1,
    expenseTotal: 3000,
    incomeTotal: 200000,
    transferOutTotal: 1200,
    transferInTotal: 977,
    chargeTotal: 5000,
    refundTotal: 500,
    pointTotal: 75,
  }));
  assert.equal(JSON.stringify(ledger.categorySpendForTransactions(transactions, "2026-07")), JSON.stringify({ food: 3000 }));
  assert.equal(ledger.matchesTypeFilter(transactions[3], "transfer"), true);
  assert.equal(ledger.matchesTypeFilter(transactions[3], "transfer_out"), true);
  assert.equal(ledger.matchesTypeFilter(transactions[4], "transfer_in"), true);
  assert.equal(ledger.matchesTypeFilter(transactions[2], "refund"), true);
  assert.equal(ledger.matchesTypeFilter(transactions[5], "charge"), true);
  assert.equal(ledger.matchesTypeFilter(transactions[6], "point"), true);
  assert.equal(ledger.matchesTypeFilter(transactions[7], "pending"), true);
  assert.equal(ledger.matchesTypeFilter(transactions[7], "review"), true);
  assert.equal(ledger.labelFor(transactions[2]), "返金");
  assert.equal(ledger.signFor(transactions[6]), "");
  assert.equal(ledger.transactionTypeOf(transactions[5]), "charge");
  assert.equal(ledger.transactionTypeOf(transactions[6]), "point");
});

test("all PWA assets referenced by the manifest exist", async () => {
  const manifest = JSON.parse(await read("manifest.webmanifest"));
  await Promise.all(manifest.icons.map((icon) => readFile(new URL(`..\/${icon.src.replace("./", "")}`, import.meta.url))));
});

test("a fresh install starts empty and can be safely handed to another person", async () => {
  const app = await read("app.js");

  assert.match(app, /const STORAGE_KEY = "chokin-zaurus-v2"/);
  assert.match(app, /transactions: \[\]/);
  assert.match(app, /recurring: \[\]/);
  assert.match(app, /monthly: 0/);
  assert.match(app, /savings: \{ enabled: false, mode: "fixed", value: 0 \}/);
  assert.match(app, /savingsGoals: \[\]/);
  assert.match(app, /すべてのデータを消去/);
  assert.doesNotMatch(app, /280000|210000|生活防衛資金|動画配信|スマホ料金/);
});

test("OCR review and recovery affordances are present", async () => {
  const [html, app] = await Promise.all([read("index.html"), read("app.js")]);
  assert.match(html, /id="ocr-complete-dialog"/);
  assert.match(html, /id="merchant-alias-dialog"/);
  assert.match(html, /id="data-import-file"/);
  assert.match(html, /id="ocr-error-message"/);
  assert.match(html, /id="transaction-ocr-fields"/);
  assert.match(html, /name="transactionType"/);
  assert.match(app, /merchantAliases: \{\}/);
  assert.match(app, /applyMerchantAliases/);
  assert.match(app, /showOCRRegistrationComplete/);
  assert.match(app, /undoLastOCRRegistration/);
  assert.match(app, /previousTransaction/);
  assert.match(app, /\.\.\.\(existing \|\| \{\}\)/);
  assert.match(app, /重複候補が/);
  assert.match(app, /exportStateBackup/);
  assert.match(app, /restoreStateBackup/);
  assert.match(app, /LedgerService\.matchesTypeFilter/);
  assert.match(app, /今回のOCR登録を取り消しました/);
  assert.match(app, /この取引を削除しますか/);
  assert.match(app, /transaction\.ocr = \{/);
  assert.match(app, /transactionType/);
  assert.match(app, /送金枠/);
  assert.match(app, /受取枠/);
  assert.match(app, /返金枠/);
  assert.match(app, /件の支出 \+ .*件の別枠/);
  assert.match(app, /家計簿ザウルス v\$\{window\.APP_VERSION/);
});

test("OCR uses a real browser engine instead of fixed mock profiles", async () => {
  const [html, service] = await Promise.all([read("index.html"), read("ocr-service.js")]);
  assert.match(html, /\.\/vendor\/tesseract\.min\.js/);
  assert.match(service, /createWorker\("jpn\+eng"/);
  assert.match(service, /provider: "tesseract"/);
  assert.doesNotMatch(service, /mockProfiles/);

  const context = { window: {} };
  vm.runInNewContext(service, context);
  const parsed = context.window.OCRService.parseText(
    "PayPay\n支払い完了\nセブン-イレブン\n2026年7月3日\n支払金額 1,280円",
    { sourceType: "auto", fallbackDate: "2026-07-04" },
  );
  assert.equal(parsed.sourceType, "paypay_history");
  assert.equal(parsed.date, "2026-07-03");
  assert.equal(parsed.amount, 1280);
  assert.equal(parsed.merchant, "セブン-イレブン");
  assert.equal(parsed.paymentMethod, "PayPay");

  const transactions = context.window.OCRService.extractTransactions(
    "PayPay\nセブン-イレブン\n7月3日 18:42\n-1,280円\nスターバックス\n7月2日 09:10\n-550円",
    { sourceType: "paypay", fallbackDate: "2026-07-04" },
  );
  assert.equal(transactions.length, 2);
  assert.equal(
    JSON.stringify(transactions.map(({ date, amount, merchant }) => ({ date, amount, merchant }))),
    JSON.stringify([
      { date: "2026-07-03", amount: 1280, merchant: "セブン-イレブン" },
      { date: "2026-07-02", amount: 550, merchant: "スターバックス" },
    ]),
  );

  const noisyText = [
    "||||||||||||||||||||",
    "--------------------",
    "レシート",
    "株式会社サンプルマート",
    "TEL 03-1234-5678",
    "2026/07/04 19:42",
    "商品A 198円",
    "====================",
    "合計 ￥1,198",
  ].join("\n");
  const cleaned = context.window.OCRService.cleanOCRText(noisyText);
  const noisyParsed = context.window.OCRService.parseText(noisyText, { fallbackDate: "2026-07-04" });
  assert.doesNotMatch(cleaned, /[|=]{4}|-{4}/);
  assert.equal(noisyParsed.date, "2026-07-04");
  assert.equal(noisyParsed.amount, 1198);
  assert.equal(noisyParsed.merchant, "株式会社サンプルマート");

  const invalidNumbers = context.window.OCRService.parseText(
    "サンプルストア\n取引日時 2026/99/42 19:42\n合計",
    { fallbackDate: "2026-07-04" },
  );
  assert.equal(invalidNumbers.date, "2026-07-04");
  assert.equal(invalidNumbers.amount, 0);

  const paypayWithPoints = context.window.OCRService.extractTransactions(
    [
      "PayPay",
      "支払い完了",
      "セブン-イレブン",
      "2026年7月3日 18:42",
      "1,280円",
      "PayPayポイント 44pt",
      "残高 3,000円",
    ].join("\n"),
    { fallbackDate: "2026-07-04" },
  );
  assert.equal(paypayWithPoints[0].sourceType, "paypay_history");
  assert.equal(paypayWithPoints[0].amount, 1280);
  assert.equal(paypayWithPoints[0].merchantNormalized, "セブン-イレブン");
  assert.equal(paypayWithPoints[1].direction, "point");
  assert.equal(paypayWithPoints[1].status, "excluded");
  assert.equal(paypayWithPoints[1].amount, 44);
  assert.equal(paypayWithPoints[1].unit, "pt");

  const cardNotice = context.window.OCRService.extractTransactions(
    [
      "三井住友カード",
      "カードご利用のお知らせ",
      "ご利用日時：2026/07/03 18:42",
      "ご利用店：モバイルＳｕｉｃａ（Ａｐｐｌｅ）",
      "ご利用金額：1,000円",
      "本メールに心当たりがない場合",
    ].join("\n"),
    { fallbackDate: "2026-07-04" },
  )[0];
  assert.equal(cardNotice.sourceType, "card_email_notice");
  assert.equal(cardNotice.status, "pending");
  assert.equal(cardNotice.merchantNormalized, "モバイルSuica");
  assert.equal(cardNotice.amount, 1000);

  const statement = context.window.OCRService.extractTransactions(
    [
      "お支払い分のご利用明細",
      "検索",
      "カード名",
      "利用日 加盟店名 金額 支払回数",
      "7/03 モバイルＳｕｉｃａ（Ａｐｐｌｅ） 1,000円 1回払い",
      "7/04 ＦＩＴ ＰＬＡＣＥ 7,678円 1回払い",
    ].join("\n"),
    { fallbackDate: "2026-07-05" },
  );
  assert.equal(statement.length, 2);
  assert.equal(statement[0].sourceType, "card_statement");
  assert.equal(statement[0].status, "settled");
  assert.equal(statement[0].merchantNormalized, "モバイルSuica");
  assert.equal(statement[1].merchantNormalized, "FIT PLACE");
  assert.equal(statement[1].amount, 7678);

  const matched = context.window.OCRService.matchExistingTransactions(
    statement.slice(0, 1),
    [{
      id: "notice-1",
      amount: 1000,
      date: "2026-07-03",
      memo: "モバイルSuica（クレジットカード）",
      paymentMethod: "クレジットカード",
      source: "ocr",
      ocr: { sourceType: "card_email_notice", status: "pending", merchantNormalized: "モバイルSuica" },
    }],
  );
  assert.deepEqual(matched[0].duplicateCandidateIds, ["notice-1"]);
  assert.equal(matched[0].duplicateCandidates[0].cardPair, true);

  const statementScreenshot = context.window.OCRService.extractTransactions(
    [
      "7月27日 お支払い分のご利用明細",
      "日付、金額、明細の名前（店名、ETCなど）",
      "まいばすけっと 119円",
      "26.06.15",
      "1回払い",
      "FIT PLACE 3,278円",
      "26.06.18",
      "1回払い",
      "モバイルSuica（AppleV） 1,000円",
      "26.06.19",
      "1回払い",
    ].join("\n"),
    { fallbackDate: "2026-07-27" },
  );
  assert.equal(statementScreenshot.length, 3);
  assert.equal(statementScreenshot[0].date, "2026-06-15");
  assert.equal(statementScreenshot[0].amount, 119);
  assert.equal(statementScreenshot[1].amount, 3278);
  assert.equal(statementScreenshot[2].merchantNormalized, "モバイルSuica");

  const paypayScreenshot = context.window.OCRService.extractTransactions(
    [
      "取引履歴",
      "エスポット 446円",
      "エスポット 淵野辺店",
      "2026年7月6日 18時44分",
      "残高",
      "支払い完了",
      "PayPayポイント 44pt",
      "2026年7月6日18時44分",
      "付与処理中",
      "Hiroki Kato さんに送る 1,200円",
      "2026年7月6日 12時02分",
      "残高",
      "受け取り完了",
    ].join("\n"),
    { fallbackDate: "2026-07-10" },
  );
  assert.equal(
    JSON.stringify(paypayScreenshot.map(({ date, amount, direction, status }) => ({ date, amount, direction, status }))),
    JSON.stringify([
      { date: "2026-07-06", amount: 446, direction: "expense", status: "settled" },
      { date: "2026-07-06", amount: 44, direction: "point", status: "excluded" },
      { date: "2026-07-06", amount: 1200, direction: "transfer_out", status: "settled" },
    ]),
  );

  const noisyPayPay = context.window.OCRService.extractTransactions(
    await read("tests/fixtures/ocr/manual/paypay-noisy-dot-amount.txt"),
    { fallbackDate: "2026-06-28" },
  );
  const charge = noisyPayPay.find((transaction) => transaction.direction === "internal_transfer");
  const apollo = noisyPayPay.find((transaction) => transaction.merchantNormalized === "apollostation");
  const mcdonalds = noisyPayPay.find((transaction) => transaction.merchantNormalized === "マクドナルド");
  const transfer = noisyPayPay.find((transaction) => transaction.direction === "transfer_out");
  assert.equal(charge?.amount, 13070);
  assert.equal(charge?.transactionType, "charge");
  assert.equal(charge?.status, "excluded");
  assert.equal(noisyPayPay.some((transaction) => transaction.amount === 70), false);
  assert.equal(noisyPayPay.filter((transaction) => transaction.direction === "point").length, 1);
  assert.equal(noisyPayPay.find((transaction) => transaction.direction === "point")?.transactionType, "point");
  assert.equal(apollo?.amount, 15000);
  assert.equal(mcdonalds?.amount, 150);
  assert.equal(transfer?.amount, 600);
});

test("manual PayPay and card-statement fixtures keep transfers, exclusions, and statement rows separate", async () => {
  const [service, expectedText] = await Promise.all([
    read("ocr-service.js"),
    read("tests/fixtures/ocr/manual/expected.json"),
  ]);
  const expected = JSON.parse(expectedText);
  const context = { window: {} };
  vm.runInNewContext(service, context);

  for (const [name, fixture] of Object.entries(expected.fixtures)) {
    const rawText = await read("tests/fixtures/ocr/manual/" + name + ".txt");
    const transactions = context.window.OCRService.extractTransactions(rawText, { fallbackDate: "2026-07-11" });
    assert.equal(transactions[0].screenType, fixture.screenType, name + " screen type");
    assert.equal(transactions.length, fixture.transactions.length, name + " transaction count");
    assert.ok(transactions.every((transaction) => transaction.currency === "JPY"), name + " currency");
    assert.ok(transactions.every((transaction) => transaction.paymentMethod === fixture.paymentMethod), name + " payment method");
    assert.equal(
      JSON.stringify(transactions.map((transaction) => ({
        merchantNormalized: transaction.merchantNormalized,
        amount: transaction.amount,
        transactionAt: transaction.transactionAt,
        direction: transaction.direction,
        status: transaction.status,
        category: transaction.category,
        excluded: transaction.excluded,
        excludeReason: transaction.excludeReason,
      }))),
      JSON.stringify(fixture.transactions.map((transaction) => ({
        merchantNormalized: transaction.merchantNormalized,
        amount: transaction.amount,
        transactionAt: transaction.transactionAt,
        direction: transaction.direction,
        status: transaction.status,
        category: transaction.category || "",
        excluded: transaction.excluded,
        excludeReason: transaction.excludeReason || "",
      }))),
      name + " golden values",
    );
  }

  const paypay = context.window.OCRService.extractTransactions(
    await read("tests/fixtures/ocr/manual/paypay-history-01.txt"),
    { fallbackDate: "2026-07-11" },
  );
  assert.equal(paypay.filter((transaction) => transaction.direction === "point").length, 2);
  assert.equal(paypay.filter((transaction) => transaction.direction === "internal_transfer").length, 1);
  assert.equal(paypay.find((transaction) => transaction.direction === "internal_transfer")?.transactionType, "charge");
  assert.equal(paypay.find((transaction) => transaction.direction === "refund").status, "refund_completed");
  assert.equal(paypay.find((transaction) => transaction.direction === "refund")?.transactionType, "refund");
  assert.equal(paypay.some((transaction) => transaction.direction === "expense" && transaction.amount === 13070), false);

  const card = context.window.OCRService.extractTransactions(
    await read("tests/fixtures/ocr/manual/card-statement-02.txt"),
    { fallbackDate: "2026-07-11" },
  );
  assert.equal(card.some((transaction) => transaction.amount === 53083), false);
  assert.equal(card.some((transaction) => transaction.date === "2026-05-26"), false);
  assert.equal(card.filter((transaction) => transaction.merchantNormalized === "モバイルSuica").length, 3);
  assert.equal(context.window.OCRService.normalizeMerchant("ＥＮＥＯＳ－ＳＳ"), "ENEOS-SS");
});

test("PayPay noisy fixture keeps dot amounts and point units safe", async () => {
  const service = await loadOCRService();
  const records = service.extractTransactions(await read("tests/fixtures/ocr/manual/paypay-noisy-dot-amount.txt"), { fallbackDate: "2026-07-11" });
  assert.equal(records.some((record) => record.amount === 70), false);
  assert.equal(records.find((record) => record.transactionType === "charge")?.amount, 13070);
  assert.equal(JSON.stringify(records.filter((record) => record.transactionType === "point").map((record) => [record.amount, record.unit])), JSON.stringify([[75, "pt"]]));
});

test("PayPay points are extracted once and excluded from expense", async () => {
  const service = await loadOCRService();
  const records = service.extractTransactions(await read("tests/fixtures/ocr/manual/paypay-history-01.txt"), { fallbackDate: "2026-07-11" });
  assert.equal(JSON.stringify(records.filter((record) => record.transactionType === "point").map((record) => record.amount)), JSON.stringify([69, 75]));
  assert.ok(records.filter((record) => record.transactionType === "point").every((record) => record.excludedFromExpense && record.unit === "pt"));
});

test("PayPay transfer regression classifies outgoing and incoming transfers", async () => {
  const service = await loadOCRService();
  const records = service.extractTransactions(await read("tests/fixtures/ocr/manual/paypay-transfer-regression.txt"), { fallbackDate: "2026-07-11" });
  assert.equal(records.filter((record) => record.transactionType === "transfer_out").length, 3);
  assert.equal(records.find((record) => record.merchantNormalized.includes("から受け取る"))?.transactionType, "transfer_in");
  assert.ok(records.every((record) => record.excludedFromExpense));
});

test("PayPay refund and charge regression never becomes expense", async () => {
  const service = await loadOCRService();
  const records = service.extractTransactions(await read("tests/fixtures/ocr/manual/paypay-refund-charge.txt"), { fallbackDate: "2026-07-11" });
  assert.equal(records.find((record) => record.transactionType === "refund")?.amount, 13624);
  assert.equal(records.find((record) => record.transactionType === "charge")?.amount, 13070);
  assert.equal(records.find((record) => record.transactionType === "expense")?.amount, 15000);
  assert.equal(records.filter((record) => record.transactionType === "expense").length, 1);
});

test("card statement regression excludes headers, totals, and payment labels", async () => {
  const service = await loadOCRService();
  const records = service.extractTransactions(await read("tests/fixtures/ocr/manual/card-statement-02.txt"), { fallbackDate: "2026-07-11" });
  assert.equal(records.some((record) => record.amount === 53083), false);
  assert.equal(records.some((record) => /1回払い|ApplePay|本吉/.test(record.merchantRaw)), false);
  assert.equal(records.find((record) => record.merchantNormalized === "東京西横丁")?.amount, 900);
});

test("card email notices stay pending and use the notification merchant and amount", async () => {
  const service = await loadOCRService();
  const records = service.extractTransactions(await read("tests/fixtures/ocr/manual/card-email-notice-02.txt"), { fallbackDate: "2026-07-11" });
  assert.equal(records[0].sourceType, "card_email_notice");
  assert.equal(records[0].amount, 1000);
  assert.equal(records[0].status, "pending");
  assert.equal(records[0].transactionType, "expense");
});

test("amounts without currency or nearby date remain review candidates", async () => {
  const service = await loadOCRService();
  const records = service.extractTransactions("取引履歴\nノイズ店\n999\n2026年7月1日", { fallbackDate: "2026-07-11" });
  assert.equal(records[0].amount, 999);
  assert.equal(records[0].needsReview, true);
  assert.equal(records[0].amountHasCurrency, false);
  const distant = service.extractTransactions("取引履歴\nノイズ店 999円\n不要な行\n不要な行\n不要な行\n不要な行\n2026年7月1日", { fallbackDate: "2026-07-11" });
  assert.equal(distant[0].dateAmountNearby, false);
  assert.equal(distant[0].needsReview, true);
});

test("changing normalized transaction type changes ledger classification", async () => {
  const service = await read("ledger-service.js");
  const context = { window: {} };
  vm.runInNewContext(service, context);
  const item = { type: "expense", transactionType: "expense", amount: 1000, date: "2026-07-11", category: "food" };
  assert.equal(context.window.LedgerService.totalsForTransactions([item]).expenseTotal, 1000);
  item.transactionType = "transfer_out";
  assert.equal(context.window.LedgerService.totalsForTransactions([item]).expenseTotal, 0);
  assert.equal(context.window.LedgerService.totalsForTransactions([item]).transferOutTotal, 1000);
});

test("PayPay charge amounts keep all digits including comma and dot grouping", async () => {
  const service = await loadOCRService();
  const records = service.extractTransactions(await read("tests/fixtures/ocr/manual/paypay-charge-amount-regression.txt"), { fallbackDate: "2026-07-11" });
  assert.equal(JSON.stringify(records.map((record) => record.amount)), JSON.stringify([1200, 5000, 13070]));
  assert.ok(records.every((record) => record.transactionType === "charge" && record.excludedFromExpense));
  assert.equal(records.some((record) => [5, 200].includes(record.amount)), false);
});

test("PayPay points normalize to one pt candidate per entry", async () => {
  const service = await loadOCRService();
  const records = service.extractTransactions(await read("tests/fixtures/ocr/manual/paypay-point-pt-regression.txt"), { fallbackDate: "2026-07-11" });
  assert.equal(JSON.stringify(records.map((record) => [record.merchantNormalized, record.amount, record.unit, record.transactionType])), JSON.stringify([
    ["PayPayポイント", 1000, "pt", "point"],
    ["PayPayポイント", 75, "pt", "point"],
  ]));
});

test("small truncated-looking PayPay charge remains review-only with a warning", async () => {
  const service = await loadOCRService();
  const records = service.extractTransactions(await read("tests/fixtures/ocr/manual/paypay-noisy-amount-review.txt"), { fallbackDate: "2026-07-11" });
  assert.equal(records[0].amount, 5);
  assert.equal(records[0].needsReview, true);
  assert.ok(records[0].reasons.some((reason) => reason.includes("桁落ち")));
});
