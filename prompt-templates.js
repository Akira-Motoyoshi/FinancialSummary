(function createPromptTemplates(global) {
  const templates = Object.freeze({
    spendingAnalysis: `あなたは家計改善アドバイザーです。
月収: {{income}}円、月支出: {{expense}}円、カテゴリ別支出: {{categorySpend}}。
事実に基づき、支出傾向と改善点を日本語で簡潔に説明してください。`,
    monthlyComment: `今月の支出{{expense}}円、前月比{{expenseChange}}円、予算消化率{{budgetRate}}%です。
責めない口調で、良かった点と来月の小さな行動を1つ提案してください。`,
    personality: `収入、支出、貯蓄率、固定費率から、お金の使い方を1タイプに分類してください。
診断名、強み、注意点を短く返してください。`,
    savingsGoals: `月の余剰資金{{surplus}}円と支出{{expense}}円をもとに、
無理のない貯金目標を2つ、目標額・月額・期間付きで提案してください。`,
  });

  function render(name, values) {
    return Object.entries(values).reduce(
      (text, [key, value]) => text.replaceAll(`{{${key}}}`, String(value)),
      templates[name] || "",
    );
  }

  global.PromptTemplates = Object.freeze({ templates, render });
})(window);
