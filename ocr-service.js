(function createOCRService(global) {
  const mockProfiles = {
    paypay: {
      merchant: "セブン-イレブン",
      amount: 1280,
      paymentMethod: "PayPay",
      categoryCandidates: ["food", "daily", "other-expense"],
      text: ["PayPay", "支払い完了", "セブン-イレブン", "2026年7月3日 18:42", "1,280円"],
    },
    card: {
      merchant: "Amazon.co.jp",
      amount: 3980,
      paymentMethod: "クレジットカード",
      categoryCandidates: ["daily", "entertainment", "other-expense"],
      text: ["カードご利用明細", "Amazon.co.jp", "2026/07/03", "ご利用金額 3,980円", "Visa **** 1234"],
    },
    receipt: {
      merchant: "こつこつマート",
      amount: 4280,
      paymentMethod: "現金",
      categoryCandidates: ["food", "daily", "other-expense"],
      text: ["こつこつマート", "2026年07月03日", "食料品・日用品", "合計 ¥4,280", "現金"],
    },
  };

  function localDate(file) {
    const date = file?.lastModified ? new Date(file.lastModified) : new Date();
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 10);
  }

  function guessProfile(file, sourceType) {
    const filename = file?.name?.toLowerCase() || "";
    if (sourceType && mockProfiles[sourceType]) return sourceType;
    if (filename.includes("paypay")) return "paypay";
    if (filename.includes("card") || filename.includes("visa")) return "card";
    return "receipt";
  }

  async function analyze(file, options = {}) {
    if (!(file instanceof File)) throw new Error("画像ファイルを選択してください");
    if (!file.type.startsWith("image/")) throw new Error("画像形式のファイルを選択してください");

    const sourceType = guessProfile(file, options.sourceType);
    const profile = mockProfiles[sourceType];
    await new Promise((resolve) => setTimeout(resolve, 650));

    return {
      provider: "mock",
      sourceType,
      rawText: profile.text.join("\n"),
      date: localDate(file),
      amount: profile.amount,
      merchant: profile.merchant,
      paymentMethod: profile.paymentMethod,
      categoryCandidates: profile.categoryCandidates.map((categoryId, index) => ({
        categoryId,
        score: Math.max(0.52, 0.92 - index * 0.18),
      })),
    };
  }

  // 実OCRへ移行するときは、この同じ analyze(file, options) 形式の
  // アダプターへ差し替えれば、画面・登録処理は変更せずに利用できます。
  global.OCRService = Object.freeze({ analyze, provider: "mock" });
})(window);
