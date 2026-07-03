(function createInsightsService(global) {
  const classificationRules = [
    { categoryId: "food", keywords: ["スーパー", "コンビニ", "セブン", "ファミマ", "ローソン", "カフェ", "レストラン", "マート", "食事"] },
    { categoryId: "daily", keywords: ["amazon", "ドラッグ", "薬局", "日用品", "無印", "ホームセンター"] },
    { categoryId: "transport", keywords: ["jr", "suica", "pasmo", "電車", "鉄道", "タクシー", "uber", "バス"] },
    { categoryId: "housing", keywords: ["家賃", "住宅", "管理費"] },
    { categoryId: "utilities", keywords: ["電気", "ガス", "水道", "光熱"] },
    { categoryId: "communication", keywords: ["docomo", "softbank", "スマホ", "携帯", "通信", "インターネット", "wifi"] },
    { categoryId: "entertainment", keywords: ["netflix", "spotify", "prime", "映画", "ゲーム", "youtube", "動画配信", "娯楽"] },
    { categoryId: "medical", keywords: ["病院", "クリニック", "診療", "医療", "処方"] },
  ];

  function classifyCategory(text) {
    const normalized = String(text || "").trim().toLowerCase();
    if (!normalized) return null;
    const matched = classificationRules.find((rule) =>
      rule.keywords.some((keyword) => normalized.includes(keyword.toLowerCase())),
    );
    return matched
      ? { categoryId: matched.categoryId, confidence: 0.9, reason: "店名・メモのキーワード" }
      : { categoryId: "other-expense", confidence: 0.52, reason: "一致するルールなし" };
  }

  function buildInsights(data) {
    const income = Number(data.currentTotals.income) || 0;
    const expense = Number(data.currentTotals.expense) || 0;
    const previousExpense = Number(data.previousTotals.expense) || 0;
    const surplus = Math.max(0, income - expense);
    const savingsRate = income ? Math.round(surplus / income * 100) : 0;
    const subscriptionMonthly = Number(data.subscriptionMonthly) || 0;
    const fixedRate = income ? Math.round(subscriptionMonthly / income * 100) : 0;
    const sortedSpend = Object.entries(data.categorySpend).sort((a, b) => b[1] - a[1]);
    const [topCategoryId, topAmount = 0] = sortedSpend[0] || [];
    const topCategoryName = data.categoryNames[topCategoryId] || "支出";
    const expenseChange = expense - previousExpense;

    const savingTips = [];
    const foodSpend = Number(data.categorySpend.food) || 0;
    const foodBudget = Number(data.categoryBudgets.food) || 0;
    if (foodBudget && foodSpend > foodBudget * 0.8) {
      savingTips.push({
        title: "食費を週単位で管理",
        detail: `残り予算を週割りすると、使いすぎに早く気づけます。`,
        impact: Math.max(1000, Math.round(foodSpend * 0.08)),
      });
    }
    if (subscriptionMonthly > 0) {
      savingTips.push({
        title: "サブスクを1件だけ見直す",
        detail: `月額${subscriptionMonthly.toLocaleString("ja-JP")}円のうち、利用頻度が低いものを確認しましょう。`,
        impact: Math.round(subscriptionMonthly * 0.2),
      });
    }
    if (savingTips.length < 2 || (data.categorySpend.entertainment || 0) > expense * 0.1) {
      savingTips.push({
        title: "娯楽費に小さな上限を設定",
        detail: "楽しみを残しつつ、月初に使える枠を決める方法がおすすめです。",
        impact: Math.max(1000, Math.round((data.categorySpend.entertainment || 5000) * 0.1)),
      });
    }

    let personality;
    if (savingsRate >= 30) {
      personality = { type: "堅実プランナー", mark: "P", description: "先を見ながら余白を残せる、計画性の高いタイプです。" };
    } else if (data.budgetRate > 100) {
      personality = { type: "アクティブチャレンジャー", mark: "C", description: "体験を大切にする行動派。先取り貯金で強みが活きます。" };
    } else if (fixedRate >= 20) {
      personality = { type: "安定バランサー", mark: "B", description: "毎月の安定を重視するタイプ。固定費の定期点検が効果的です。" };
    } else {
      personality = { type: "しなやかバランサー", mark: "S", description: "使う・残すのバランスを柔軟に整えられるタイプです。" };
    }

    const emergencyTarget = Math.max(100000, expense * 3);
    const monthlySaving = Math.max(5000, Math.round(surplus * 0.3 / 1000) * 1000);
    const joyTarget = Math.max(50000, Math.round(income * 0.5 / 1000) * 1000);
    const goalSuggestions = [
      {
        name: "生活防衛資金",
        targetAmount: emergencyTarget,
        monthlyAmount: monthlySaving,
        months: Math.max(1, Math.ceil(emergencyTarget / monthlySaving)),
        reason: "生活費3か月分を目安に備える",
      },
      {
        name: "ごほうび・旅行資金",
        targetAmount: joyTarget,
        monthlyAmount: Math.max(3000, Math.round(surplus * 0.15 / 1000) * 1000),
        months: Math.max(1, Math.ceil(joyTarget / Math.max(3000, Math.round(surplus * 0.15 / 1000) * 1000))),
        reason: "楽しみのために無理なく積み立てる",
      },
    ];

    return {
      spendingAnalysis: {
        headline: `${topCategoryName}が今月の支出の中心です`,
        detail: `${topCategoryName}は${topAmount.toLocaleString("ja-JP")}円。貯蓄率は${savingsRate}%で、${expenseChange <= 0 ? "前月より支出を抑えられています" : "前月より支出が増えています"}。`,
        score: Math.min(100, Math.max(0, savingsRate + 55)),
      },
      savingTips: savingTips.slice(0, 2),
      personality,
      monthlyComment: expenseChange <= 0
        ? `今月は前月より${Math.abs(expenseChange).toLocaleString("ja-JP")}円コンパクトに。今のペースを保ちながら、余剰分の一部を目標貯金へ回せそうです。`
        : `今月は前月より${expenseChange.toLocaleString("ja-JP")}円増えています。まずは${topCategoryName}だけを確認すると、無理なく整えやすくなります。`,
      goalSuggestions,
    };
  }

  global.InsightsService = Object.freeze({
    provider: "rules",
    classifyCategory,
    buildInsights,
  });
})(window);
