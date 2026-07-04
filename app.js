const STORAGE_KEY = "chokin-zaurus-v2";

const CATEGORIES = [
  { id: "salary", name: "給与", type: "income", icon: "¥", color: "#62ad88" },
  { id: "other-income", name: "その他収入", type: "income", icon: "＋", color: "#86bfa5" },
  { id: "food", name: "食費", type: "expense", icon: "食", color: "#ed9b57" },
  { id: "daily", name: "日用品", type: "expense", icon: "日", color: "#efbd67" },
  { id: "transport", name: "交通", type: "expense", icon: "交", color: "#6da7cf" },
  { id: "housing", name: "住居", type: "expense", icon: "家", color: "#9181c2" },
  { id: "utilities", name: "水道光熱", type: "expense", icon: "光", color: "#68b7b2" },
  { id: "communication", name: "通信", type: "expense", icon: "通", color: "#7197c4" },
  { id: "entertainment", name: "娯楽", type: "expense", icon: "遊", color: "#db758a" },
  { id: "medical", name: "医療", type: "expense", icon: "医", color: "#d87575" },
  { id: "other-expense", name: "その他", type: "expense", icon: "他", color: "#9aa49e" },
];

const yen = new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 });
const dateLabel = new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric" });
const monthLabel = new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "long" });
const today = () => new Date();
const localISO = (date = today()) => {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
};
const monthKey = (date = today()) => localISO(date).slice(0, 7);
const id = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const parseLocalDate = (value) => new Date(`${value}T12:00:00`);
const categoryById = (categoryId) => CATEGORIES.find((category) => category.id === categoryId) || CATEGORIES.at(-1);

function offsetMonth(monthOffset) {
  const date = today();
  date.setDate(1);
  date.setMonth(date.getMonth() + monthOffset);
  return monthKey(date);
}

function dateInMonth(month, day) {
  return `${month}-${String(day).padStart(2, "0")}`;
}

function makeInitialState() {
  return {
    transactions: [],
    recurring: [],
    budgets: {
      monthly: 0,
      categories: {},
    },
    savings: { enabled: false, mode: "fixed", value: 0 },
    savingsGoals: [],
  };
}

function loadState() {
  const defaults = makeInitialState();
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved || typeof saved !== "object") return defaults;
    saved.transactions = Array.isArray(saved.transactions) ? saved.transactions : defaults.transactions;
    saved.recurring = Array.isArray(saved.recurring) ? saved.recurring : defaults.recurring;
    saved.budgets = {
      monthly: Number.isFinite(Number(saved.budgets?.monthly)) ? Number(saved.budgets.monthly) : defaults.budgets.monthly,
      categories: saved.budgets?.categories && typeof saved.budgets.categories === "object"
        ? saved.budgets.categories
        : defaults.budgets.categories,
    };
    saved.savings = {
      enabled: typeof saved.savings?.enabled === "boolean" ? saved.savings.enabled : defaults.savings.enabled,
      mode: ["fixed", "percent"].includes(saved.savings?.mode) ? saved.savings.mode : defaults.savings.mode,
      value: Number.isFinite(Number(saved.savings?.value)) ? Number(saved.savings.value) : defaults.savings.value,
    };
    if (!Array.isArray(saved.savingsGoals)) {
      saved.savingsGoals = [];
    }
    return saved;
  } catch {
    return defaults;
  }
}

let state = loadState();
let currentPage = "home";
let toastTimer;
let ocrPreviewUrl = "";
let latestOCRResult = null;
let autoAnalyzeLatestSelection = false;

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function totalsForMonth(month = monthKey()) {
  const items = state.transactions.filter((transaction) => transaction.date.startsWith(month));
  return items.reduce(
    (result, transaction) => {
      result[transaction.type] += Number(transaction.amount);
      return result;
    },
    { income: 0, expense: 0 },
  );
}

function categorySpend(month = monthKey()) {
  return state.transactions
    .filter((transaction) => transaction.type === "expense" && transaction.date.startsWith(month))
    .reduce((result, transaction) => {
      result[transaction.category] = (result[transaction.category] || 0) + Number(transaction.amount);
      return result;
    }, {});
}

function savingsReserve(income) {
  if (!state.savings.enabled) return 0;
  return state.savings.mode === "percent"
    ? Math.round(income * Math.min(Number(state.savings.value), 100) / 100)
    : Number(state.savings.value);
}

function savingsSummary() {
  const current = state.savingsGoals.reduce((sum, goal) => sum + Number(goal.currentAmount), 0);
  const target = state.savingsGoals.reduce((sum, goal) => sum + Number(goal.targetAmount), 0);
  const remaining = Math.max(target - current, 0);
  return { current, target, remaining, rate: target ? Math.min(Math.round(current / target * 100), 100) : 0 };
}

function glassCard(content, { className = "", action = "", id: itemId = "" } = {}) {
  if (!action) return `<article class="glass-card ${className}">${content}</article>`;
  return `<button type="button" class="glass-card tap-card ${className}" data-action="${action}"${itemId ? ` data-id="${itemId}"` : ""}>${content}</button>`;
}

function runRecurring() {
  const now = today();
  const current = monthKey(now);
  let created = 0;
  state.recurring.filter((rule) => rule.active && Number(rule.day) <= now.getDate()).forEach((rule) => {
    const alreadyCreated = state.transactions.some(
      (transaction) => transaction.recurringId === rule.id && transaction.date.startsWith(current),
    );
    if (alreadyCreated) return;
    state.transactions.push({
      id: id(),
      type: rule.type,
      amount: Number(rule.amount),
      date: dateInMonth(current, Number(rule.day)),
      category: rule.category,
      memo: rule.name,
      source: "recurring",
      recurringId: rule.id,
    });
    created += 1;
  });
  if (created) saveState();
  return created;
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2200);
}

function transactionRows(items, limit) {
  const rows = [...items].sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
  if (!rows.length) return '<div class="empty">該当する収支はありません</div>';
  return rows.map((transaction) => {
    const category = categoryById(transaction.category);
    const sign = transaction.type === "income" ? "+" : "−";
    const source = transaction.source === "recurring" ? "・固定費から自動記録" : "";
    return `
      <button class="transaction-row" data-action="edit-transaction" data-id="${transaction.id}">
        <span class="category-icon">${category.icon}</span>
        <span class="row-main">
          <span class="row-title">${escapeHtml(transaction.memo || category.name)}</span>
          <span class="row-sub">${dateLabel.format(parseLocalDate(transaction.date))}・${category.name}${source}</span>
        </span>
        <span class="row-amount ${transaction.type}">${sign}${yen.format(transaction.amount)}</span>
      </button>`;
  }).join("");
}

function budgetAlerts() {
  const spend = categorySpend();
  const { expense } = totalsForMonth();
  const alerts = [];
  if (state.budgets.monthly && expense > state.budgets.monthly) {
    alerts.push(`月間予算を${yen.format(expense - state.budgets.monthly)}超過しています`);
  }
  Object.entries(state.budgets.categories).forEach(([categoryId, budget]) => {
    if ((spend[categoryId] || 0) > budget) {
      alerts.push(`${categoryById(categoryId).name}の予算を${yen.format(spend[categoryId] - budget)}超過しています`);
    }
  });
  return alerts;
}

function renderHome() {
  const totals = totalsForMonth();
  const reserve = savingsReserve(totals.income);
  const available = totals.income - totals.expense - reserve;
  const alerts = budgetAlerts();
  const summary = savingsSummary();
  const spend = categorySpend();
  const categories = Object.entries(spend).sort((a, b) => b[1] - a[1]);
  const subscriptions = getSubscriptions().slice(0, 2);
  const recent = state.transactions.filter((transaction) => transaction.date.startsWith(monthKey()))
    .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);
  let degree = 0;
  const donut = categories.map(([categoryId, amount]) => {
    const start = degree;
    degree += totals.expense ? amount / totals.expense * 360 : 0;
    return `${categoryById(categoryId).color} ${start}deg ${degree}deg`;
  }).join(",");
  document.querySelector("#page-home").innerHTML = `
    <div class="home-layout">
      ${glassCard(`
        <p class="hero-label">貯金額</p>
        <div class="hero-value">${yen.format(summary.current)}</div>
        <div class="hero-stats">
          <span>現在額 <strong>${yen.format(available)}</strong></span>
          <span>収入 <strong>${yen.format(totals.income)}</strong></span>
          <span>目標 <strong>${yen.format(summary.target)}</strong></span>
        </div>
        <div class="progress"><span style="width:${summary.rate}%"></span></div>
        <div class="hero-progress-meta"><span>目標まであと ${yen.format(summary.remaining)}</span><strong>${summary.rate}%</strong></div>
      `, { className: "hero", action: "go-savings" })}
      ${alerts.map((alert) => `<div class="alert"><span>!</span><span>${alert}</span></div>`).join("")}
      <div class="home-card-grid">
        ${glassCard(`
          <div class="section-head"><h3>支出の内訳</h3><span class="card-chevron">›</span></div>
          <div class="mini-donut-row">
            <div class="mini-donut" style="background:conic-gradient(${donut || "#dfeaf5 0deg 360deg"})"><span>${yen.format(totals.expense)}</span></div>
            <div class="mini-legend">${categories.slice(0, 3).map(([categoryId, amount]) => `
              <span><i style="background:${categoryById(categoryId).color}"></i>${categoryById(categoryId).name}<strong>${totals.expense ? Math.round(amount / totals.expense * 100) : 0}%</strong></span>`).join("") || "<small>支出はありません</small>"}</div>
          </div>
        `, { action: "go-analysis" })}
        ${glassCard(`
          <div class="section-head"><h3>サブスク</h3><span class="card-chevron">›</span></div>
          <div class="compact-list">${subscriptions.map((rule) => `<span><b>${escapeHtml(rule.name)}</b><strong>${yen.format(rule.amount)}</strong></span>`).join("") || "<small>登録はありません</small>"}</div>
          <span class="all-link">すべて見る</span>
        `, { action: "go-analysis" })}
        ${glassCard(`
          <div class="section-head"><h3>最近の履歴</h3><span class="card-chevron">›</span></div>
          <div class="compact-list">${recent.map((item) => `<span><b>${escapeHtml(item.memo || categoryById(item.category).name)}</b><strong>${item.type === "income" ? "+" : "−"}${yen.format(item.amount)}</strong></span>`).join("") || "<small>履歴はありません</small>"}</div>
          <span class="all-link">すべて見る</span>
        `, { action: "go-list" })}
        ${glassCard(`
          <div class="section-head"><h3>今月の目標</h3><span class="card-chevron">›</span></div>
          <strong class="card-big-number">${yen.format(reserve)}</strong>
          <span class="card-caption">先取り貯金の設定額</span>
          <div class="progress compact"><span style="width:${summary.rate}%"></span></div>
        `, { action: "go-savings" })}
      </div>
      ${glassCard(`
        <div class="section-head"><h3>今月の収支</h3><span class="card-chevron">›</span></div>
        <div class="balance-strip">
          <div><span>収入</span><strong class="income">${yen.format(totals.income)}</strong></div>
          <div><span>支出</span><strong>${yen.format(totals.expense)}</strong></div>
          <div><span>収支</span><strong class="${totals.income - totals.expense < 0 ? "expense" : "income"}">${yen.format(totals.income - totals.expense)}</strong></div>
        </div>
      `, { action: "go-analysis" })}
    </div>`;
}

function renderList() {
  const page = document.querySelector("#page-list");
  const oldSearch = page.querySelector("#search")?.value || "";
  const oldType = page.querySelector("#type-filter")?.value || "all";
  const oldMonth = page.querySelector("#month-filter")?.value || monthKey();
  const availableMonths = [...new Set(state.transactions.map((transaction) => transaction.date.slice(0, 7)))]
    .sort().reverse();
  if (!availableMonths.includes(monthKey())) availableMonths.unshift(monthKey());
  page.innerHTML = `
    <div class="section-head"><h2>収支リスト</h2><span class="row-sub">${state.transactions.length}件</span></div>
    <div class="filters">
      <input id="search" type="search" placeholder="メモ・カテゴリを検索" value="${escapeHtml(oldSearch)}" />
      <select id="type-filter">
        <option value="all">すべて</option><option value="expense">支出</option><option value="income">収入</option>
      </select>
      <select id="month-filter" class="month-filter">
        <option value="all">すべての期間</option>
        ${availableMonths.map((month) => `<option value="${month}">${month.replace("-", "年")}月</option>`).join("")}
      </select>
    </div>
    <article class="card" id="transaction-list"></article>`;
  page.querySelector("#type-filter").value = oldType;
  page.querySelector("#month-filter").value = oldMonth;
  updateFilteredList();
}

function updateFilteredList() {
  const page = document.querySelector("#page-list");
  const query = page.querySelector("#search").value.trim().toLowerCase();
  const type = page.querySelector("#type-filter").value;
  const month = page.querySelector("#month-filter").value;
  const items = state.transactions.filter((transaction) => {
    const category = categoryById(transaction.category);
    const matchesQuery = !query || `${transaction.memo} ${category.name}`.toLowerCase().includes(query);
    return matchesQuery && (type === "all" || transaction.type === type) && (month === "all" || transaction.date.startsWith(month));
  });
  page.querySelector("#transaction-list").innerHTML = transactionRows(items);
}

function renderRecurring() {
  const currentDay = today().getDate();
  document.querySelector("#page-recurring").innerHTML = `
    <div class="section-head"><div><h2>固定費</h2><p class="row-sub">記録日以降の起動時に自動登録</p></div><button class="secondary-button" data-action="add-recurring">＋ 追加</button></div>
    <article class="card">
      ${state.recurring.length ? state.recurring.map((rule) => {
        const category = categoryById(rule.category);
        const status = !rule.active ? "停止中" : Number(rule.day) <= currentDay ? "今月記録済み" : `次回 ${rule.day}日`;
        return `
          <button class="recurring-row" data-action="edit-recurring" data-id="${rule.id}">
            <span class="category-icon">${category.icon}</span>
            <span class="row-main"><span class="row-title">${escapeHtml(rule.name)}</span><span class="row-sub">毎月${rule.day}日・${status}</span></span>
            <span class="row-amount ${rule.type}">${rule.type === "income" ? "+" : "−"}${yen.format(rule.amount)}</span>
          </button>`;
      }).join("") : '<div class="empty">固定費はまだありません</div>'}
    </article>`;
}

function getSubscriptions() {
  const fixedCostCategories = new Set(["housing", "utilities"]);
  return state.recurring.filter(
    (rule) => rule.active && rule.type === "expense" && !fixedCostCategories.has(rule.category),
  );
}

function getCashFlowForecast() {
  const totals = totalsForMonth();
  const currentDay = today().getDate();
  const upcoming = state.recurring.filter((rule) => rule.active && Number(rule.day) > currentDay);
  const scheduledIncome = upcoming
    .filter((rule) => rule.type === "income")
    .reduce((sum, rule) => sum + Number(rule.amount), 0);
  const scheduledExpense = upcoming
    .filter((rule) => rule.type === "expense")
    .reduce((sum, rule) => sum + Number(rule.amount), 0);
  return {
    currentNet: totals.income - totals.expense,
    scheduledIncome,
    scheduledExpense,
    projectedNet: totals.income - totals.expense + scheduledIncome - scheduledExpense,
    upcoming,
  };
}

function getMonthlyReport() {
  const current = totalsForMonth();
  const previous = totalsForMonth(offsetMonth(-1));
  const spend = categorySpend();
  const topCategoryEntry = Object.entries(spend).sort((a, b) => b[1] - a[1])[0];
  const expenseChange = current.expense - previous.expense;
  const savingsRate = current.income
    ? Math.round(Math.max(0, current.income - current.expense) / current.income * 100)
    : 0;
  return {
    current,
    previous,
    expenseChange,
    savingsRate,
    topCategory: topCategoryEntry ? categoryById(topCategoryEntry[0]) : null,
    topCategoryAmount: topCategoryEntry?.[1] || 0,
    budgetRate: state.budgets.monthly
      ? Math.round(current.expense / state.budgets.monthly * 100)
      : 0,
  };
}

function renderAnalysis() {
  const months = Array.from({ length: 6 }, (_, index) => offsetMonth(index - 5));
  const monthTotals = months.map((month) => ({ month, ...totalsForMonth(month) }));
  const maxValue = Math.max(...monthTotals.flatMap((item) => [item.income, item.expense]), 1);
  const spend = categorySpend();
  const categoryEntries = Object.entries(spend).sort((a, b) => b[1] - a[1]);
  const totalSpend = categoryEntries.reduce((sum, [, amount]) => sum + amount, 0);
  let degree = 0;
  const gradients = categoryEntries.map(([categoryId, amount]) => {
    const start = degree;
    degree += totalSpend ? (amount / totalSpend) * 360 : 0;
    return `${categoryById(categoryId).color} ${start}deg ${degree}deg`;
  });
  const subscriptions = getSubscriptions();
  const subscriptionMonthly = subscriptions.reduce((sum, rule) => sum + Number(rule.amount), 0);
  const currentExpenses = state.transactions.filter((item) => item.type === "expense" && item.date.startsWith(monthKey()));
  const weeklySpend = [1, 2, 3, 4, 5].map((week) => currentExpenses
    .filter((item) => Math.min(Math.ceil(Number(item.date.slice(8)) / 7), 5) === week)
    .reduce((sum, item) => sum + Number(item.amount), 0));
  const weeklyMax = Math.max(...weeklySpend, 1);
  const fixedSpend = currentExpenses.filter((item) => item.source === "recurring").reduce((sum, item) => sum + Number(item.amount), 0);
  const variableSpend = Math.max(totalSpend - fixedSpend, 0);
  const forecast = getCashFlowForecast();
  const report = getMonthlyReport();
  const expenseDirection = report.expenseChange <= 0 ? "減少" : "増加";
  const insights = window.InsightsService?.buildInsights({
    currentTotals: report.current,
    previousTotals: report.previous,
    categorySpend: spend,
    categoryNames: Object.fromEntries(CATEGORIES.map((category) => [category.id, category.name])),
    categoryBudgets: state.budgets.categories,
    budgetRate: report.budgetRate,
    subscriptionMonthly,
  });
  document.querySelector("#page-analysis").innerHTML = `
    <div class="section-head"><h2>分析</h2><span class="row-sub">${monthLabel.format(today())}</span></div>
    <div class="stack">
      <article class="card">
        <h3>月別収支</h3>
        <div class="chart-scroll"><div class="bar-chart">
          ${monthTotals.map((item) => `
            <div class="bar-group"><div class="bars">
              <span class="bar income-bar" title="収入 ${yen.format(item.income)}" style="height:${Math.max((item.income / maxValue) * 100, 1)}%"></span>
              <span class="bar expense-bar" title="支出 ${yen.format(item.expense)}" style="height:${Math.max((item.expense / maxValue) * 100, 1)}%"></span>
            </div><span class="bar-label">${Number(item.month.slice(5))}月</span></div>`).join("")}
        </div></div>
        <div class="legend"><span><i style="background:var(--mint)"></i>収入</span><span><i style="background:var(--orange)"></i>支出</span></div>
      </article>
      <article class="card">
        <div class="section-head"><h3>カテゴリ別支出</h3><strong>${yen.format(totalSpend)}</strong></div>
        ${categoryEntries.length ? `
          <div class="donut-wrap">
            <div class="donut" style="background:conic-gradient(${gradients.join(",")})"></div>
            <div class="category-legend">${categoryEntries.map(([categoryId, amount]) => {
              const category = categoryById(categoryId);
              return `<div><span><i style="display:inline-block;background:${category.color}"></i> ${category.name}</span><strong>${Math.round(amount / totalSpend * 100)}%</strong></div>`;
            }).join("")}</div>
          </div>` : '<div class="empty">今月の支出はありません</div>'}
      </article>
      <article class="card">
        <div class="section-head"><div><p class="card-kicker">WEEKLY TREND</p><h3>週別推移</h3></div><strong>${yen.format(totalSpend)}</strong></div>
        <div class="weekly-spend-chart">${weeklySpend.map((amount, index) => `
          <div><strong>${amount ? yen.format(amount) : "—"}</strong><span style="height:${Math.max(amount / weeklyMax * 100, 3)}%"></span><small>${index + 1}週</small></div>`).join("")}
        </div>
      </article>
      <article class="card">
        <div class="section-head"><div><p class="card-kicker">COST BALANCE</p><h3>固定費・変動費</h3></div><span class="row-sub">今月</span></div>
        <div class="cost-compare">
          <div><span><b>固定費</b><strong>${yen.format(fixedSpend)}</strong></span><i><em style="width:${totalSpend ? fixedSpend / totalSpend * 100 : 0}%"></em></i></div>
          <div><span><b>変動費</b><strong>${yen.format(variableSpend)}</strong></span><i><em style="width:${totalSpend ? variableSpend / totalSpend * 100 : 0}%"></em></i></div>
        </div>
      </article>
      <article class="card forecast-card">
        <div class="section-head"><div><p class="card-kicker">CASH FLOW</p><h3>月末収支予測</h3></div><span class="forecast-status">予定反映済み</span></div>
        <div class="forecast-value ${forecast.projectedNet < 0 ? "expense" : "income"}">${yen.format(forecast.projectedNet)}</div>
        <div class="summary-grid">
          <div><span>現在の収支</span><strong>${yen.format(forecast.currentNet)}</strong></div>
          <div><span>今後の固定収入</span><strong>+${yen.format(forecast.scheduledIncome)}</strong></div>
          <div><span>今後の固定支出</span><strong>−${yen.format(forecast.scheduledExpense)}</strong></div>
        </div>
        <p class="card-note">${forecast.upcoming.length ? `今月残り${forecast.upcoming.length}件の固定費を反映` : "今月の固定費はすべて反映済み"}</p>
      </article>
      <article class="card">
        <div class="section-head">
          <div><p class="card-kicker">SUBSCRIPTIONS</p><h3>サブスク分析</h3></div>
          <div class="annual-total"><span>年額</span><strong>${yen.format(subscriptionMonthly * 12)}</strong></div>
        </div>
        ${subscriptions.length ? `
          <div class="subscription-list">${subscriptions.map((rule) => `
            <div class="subscription-row">
              <span class="category-icon">${categoryById(rule.category).icon}</span>
              <span class="row-main"><span class="row-title">${escapeHtml(rule.name)}</span><span class="row-sub">毎月${rule.day}日</span></span>
              <span class="subscription-price"><strong>${yen.format(rule.amount)}</strong><small>月額</small></span>
            </div>`).join("")}
          </div>
          <div class="subscription-summary"><span>月額合計</span><strong>${yen.format(subscriptionMonthly)}</strong></div>
        ` : '<div class="empty">分析対象のサブスクはありません</div>'}
      </article>
      <article class="card">
        <div class="section-head"><div><p class="card-kicker">MONTHLY REPORT</p><h3>月次レポート</h3></div><span class="row-sub">${monthLabel.format(today())}</span></div>
        <div class="report-grid">
          <div><span>貯蓄率</span><strong>${report.savingsRate}%</strong></div>
          <div><span>予算消化</span><strong class="${report.budgetRate > 100 ? "danger" : ""}">${report.budgetRate}%</strong></div>
          <div><span>前月比</span><strong class="${report.expenseChange > 0 ? "expense" : "income"}">${report.expenseChange > 0 ? "+" : "−"}${yen.format(Math.abs(report.expenseChange))}</strong></div>
          <div><span>最大支出</span><strong>${report.topCategory?.name || "なし"}</strong></div>
        </div>
        <p class="report-insight">支出は前月より${yen.format(Math.abs(report.expenseChange))}${expenseDirection}。${report.topCategory ? `${report.topCategory.name}が最も多く、${yen.format(report.topCategoryAmount)}です。` : "今月の支出はまだありません。"}</p>
      </article>
      ${insights ? `
        <article class="card ai-insight-card">
          <div class="section-head">
            <div><p class="card-kicker">SMART INSIGHTS</p><h3>AI支出分析</h3></div>
            <span class="ai-badge">RULES · API READY</span>
          </div>
          <div class="ai-score"><span>家計スコア</span><strong>${insights.spendingAnalysis.score}</strong><small>/ 100</small></div>
          <h4>${escapeHtml(insights.spendingAnalysis.headline)}</h4>
          <p class="ai-analysis-copy">${escapeHtml(insights.spendingAnalysis.detail)}</p>
          <div class="ai-fact-grid">
            <div><span>今月の支出傾向</span><strong>${report.expenseChange <= 0 ? "改善傾向" : "増加傾向"}</strong></div>
            <div><span>増えているカテゴリ</span><strong>${report.topCategory?.name || "なし"}</strong></div>
            <div><span>節約候補</span><strong>${escapeHtml(insights.savingTips[0]?.title || "固定費の確認")}</strong></div>
            <div><span>目標達成可能性</span><strong>${Math.min(insights.spendingAnalysis.score, 99)}%</strong></div>
          </div>
          <div class="ai-monthly-comment">
            <span>今月のAIコメント</span>
            <p>${escapeHtml(insights.monthlyComment)}</p>
          </div>
        </article>
        <div class="analysis-section-title"><p class="card-kicker">NEXT ACTION</p><h2>アドバイス</h2></div>
        <article class="card">
          <div class="section-head"><div><p class="card-kicker">SAVING IDEAS</p><h3>節約提案</h3></div><span class="row-sub">ルール分析</span></div>
          <div class="saving-tip-list">${insights.savingTips.map((tip, index) => `
            <div class="saving-tip">
              <span class="tip-number">0${index + 1}</span>
              <span class="row-main"><span class="row-title">${escapeHtml(tip.title)}</span><span class="row-sub">${escapeHtml(tip.detail)}</span></span>
              <span class="tip-impact"><small>節約目安</small><strong>${yen.format(tip.impact)}</strong></span>
            </div>`).join("")}
          </div>
        </article>
        <article class="card personality-card">
          <div class="personality-mark">${escapeHtml(insights.personality.mark)}</div>
          <div>
            <p class="card-kicker">MONEY PERSONALITY</p>
            <h3>${escapeHtml(insights.personality.type)}</h3>
            <p>${escapeHtml(insights.personality.description)}</p>
          </div>
        </article>
        <article class="card">
          <div class="section-head"><div><p class="card-kicker">SAVINGS GOALS</p><h3>目標別貯金提案</h3></div><span class="row-sub">自動提案</span></div>
          <div class="goal-suggestion-list">${insights.goalSuggestions.map((goal) => `
            <div class="goal-suggestion">
              <div class="goal-head"><strong>${escapeHtml(goal.name)}</strong><span>${goal.months}か月</span></div>
              <div class="goal-amount">${yen.format(goal.targetAmount)}</div>
              <div class="goal-progress"><span style="width:${Math.min(100, Math.round(goal.monthlyAmount / goal.targetAmount * 100))}%"></span></div>
              <div class="goal-meta"><span>毎月 ${yen.format(goal.monthlyAmount)}</span><span>${escapeHtml(goal.reason)}</span></div>
            </div>`).join("")}
          </div>
        </article>
      ` : ""}
    </div>`;
}

function budgetRows() {
  const spend = categorySpend();
  const entries = Object.entries(state.budgets.categories);
  if (!entries.length) return '<div class="empty">カテゴリ予算はありません</div>';
  return entries.map(([categoryId, amount]) => {
    const used = spend[categoryId] || 0;
    const rate = amount ? Math.round(used / amount * 100) : 0;
    return `
      <button class="budget-row" data-action="edit-budget" data-category="${categoryId}">
        <div class="budget-meta"><strong>${categoryById(categoryId).name}</strong><span class="${rate > 100 ? "danger" : ""}">${yen.format(used)} / ${yen.format(amount)}</span></div>
        <div class="progress ${rate > 100 ? "over" : ""}"><span style="width:${Math.min(rate, 100)}%"></span></div>
      </button>`;
  }).join("");
}

function renderBudget() {
  document.querySelector("#page-budget").innerHTML = `
    <div class="section-head"><h2>予算と貯金</h2><span class="row-sub">${monthLabel.format(today())}</span></div>
    <div class="stack">
      <article class="card settings-grid">
        <h3>月間予算</h3>
        <label class="inline-field"><span>予算額</span><input id="monthly-budget" type="number" min="0" value="${state.budgets.monthly}" /></label>
        <button class="primary-button" data-action="save-monthly-budget">月間予算を保存</button>
      </article>
      <article class="card">
        <div class="section-head"><h3>カテゴリ別予算</h3><button data-action="add-budget">＋ 追加</button></div>
        <div id="category-budgets">${budgetRows()}</div>
      </article>
      <article class="card settings-grid">
        <div class="section-head"><div><h3>貯金モード</h3><p class="row-sub">貯金予定額を「使える金額」から確保</p></div><input id="savings-enabled" type="checkbox" ${state.savings.enabled ? "checked" : ""} /></div>
        <label class="inline-field"><span>計算方法</span><select id="savings-mode"><option value="fixed">定額</option><option value="percent">収入の割合</option></select></label>
        <label class="inline-field"><span id="savings-value-label">毎月の貯金額</span><input id="savings-value" type="number" min="0" value="${state.savings.value}" /></label>
        <button class="primary-button" data-action="save-savings">貯金設定を保存</button>
      </article>
    </div>`;
  document.querySelector("#savings-mode").value = state.savings.mode;
  updateSavingsLabel();
}

function renderSavings() {
  const summary = savingsSummary();
  const weeklyTarget = savingsReserve(totalsForMonth().income);
  const weeklyBars = [0.24, 0.49, 0.73, 1].map((ratio) => Math.round(weeklyTarget * ratio));
  document.querySelector("#page-savings").innerHTML = `
    <div class="stack">
      ${glassCard(`
        <p class="hero-label">現在の貯金額</p>
        <div class="hero-value">${yen.format(summary.current)}</div>
        <div class="savings-summary-grid">
          <div><span>今月の目標</span><strong>${yen.format(weeklyTarget)}</strong></div>
          <div><span>目標まで</span><strong>${yen.format(summary.remaining)}</strong></div>
          <div><span>達成率</span><strong>${summary.rate}%</strong></div>
        </div>
        <div class="progress"><span style="width:${summary.rate}%"></span></div>
      `, { className: "savings-hero" })}
      ${glassCard(`
        <div class="section-head"><div><h3>週別の貯金推移</h3><p class="row-sub">今月の積立目安</p></div><strong>${yen.format(weeklyTarget)}</strong></div>
        <div class="weekly-chart">${weeklyBars.map((amount, index) => `
          <div><span style="height:${weeklyTarget ? Math.max(amount / weeklyTarget * 100, 6) : 6}%"></span><small>${index + 1}週</small></div>`).join("")}
        </div>
      `)}
      <div class="section-head savings-goal-head"><div><h2>貯金目標</h2><p class="row-sub">${state.savingsGoals.length}件の目標</p></div><button class="secondary-button" data-action="add-savings-goal">＋ 追加</button></div>
      <div class="goal-card-list">
        ${state.savingsGoals.length ? state.savingsGoals.map((goal) => {
          const rate = Number(goal.targetAmount) ? Math.min(Math.round(Number(goal.currentAmount) / Number(goal.targetAmount) * 100), 100) : 0;
          return glassCard(`
            <div class="section-head"><div><h3>${escapeHtml(goal.name)}</h3><p class="row-sub">${goal.deadline ? `${escapeHtml(goal.deadline)}まで` : "期限なし"}</p></div><span class="card-chevron">›</span></div>
            <div class="goal-figures"><strong>${yen.format(goal.currentAmount)}</strong><span>/ ${yen.format(goal.targetAmount)}</span></div>
            <div class="progress compact"><span style="width:${rate}%"></span></div>
            <div class="goal-foot"><span>あと ${yen.format(Math.max(Number(goal.targetAmount) - Number(goal.currentAmount), 0))}</span><strong>${rate}%</strong></div>
          `, { action: "edit-savings-goal", id: goal.id });
        }).join("") : '<div class="empty glass-card">目標を追加すると進捗を管理できます</div>'}
      </div>
    </div>`;
}

function renderSettings() {
  const items = [
    ["go-list", "☷", "収支履歴", "検索・フィルタ・編集"],
    ["go-recurring", "↻", "固定費", "自動記録の追加・編集"],
    ["go-budget", "◎", "予算と貯金設定", "月間・カテゴリ別予算"],
  ];
  document.querySelector("#page-settings").innerHTML = `
    <div class="stack settings-page">
      ${glassCard(`
        <p class="card-kicker">MANAGE</p>
        <h2>家計の設定</h2>
        <p class="card-note">記録・固定費・予算をまとめて管理できます。</p>
      `)}
      <div class="settings-list">${items.map(([action, icon, title, note]) => `
        <button class="glass-card settings-link" data-action="${action}"><span class="settings-symbol">${icon}</span><span><strong>${title}</strong><small>${note}</small></span><i>›</i></button>`).join("")}</div>
      <button class="glass-card settings-link danger-link" data-action="reset-data"><span class="settings-symbol">↻</span><span><strong>すべてのデータを消去</strong><small>収支・固定費・予算・目標を空にします</small></span><i>›</i></button>
    </div>`;
}

function renderAll() {
  renderHome();
  renderList();
  renderRecurring();
  renderAnalysis();
  renderBudget();
  renderSavings();
  renderSettings();
}

function switchPage(pageName) {
  const previousPage = currentPage;
  const applyPageChange = () => {
    currentPage = pageName;
    document.querySelectorAll(".page").forEach((page) => page.classList.toggle("active", page.dataset.page === pageName));
    document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.target === pageName));
    const titles = {
      home: ["MY FINANCE", "ホーム"], savings: ["SAVINGS", "貯金"], list: ["TRANSACTIONS", "収支履歴"],
      recurring: ["RECURRING", "固定費"], analysis: ["INSIGHTS", "分析"], budget: ["PLANNING", "予算と貯金"],
      settings: ["PREFERENCES", "設定"],
    };
    document.querySelector("#page-eyebrow").textContent = titles[pageName]?.[0] || "MY FINANCE";
    document.querySelector("#page-title").textContent = titles[pageName]?.[1] || "ホーム";
    window.scrollTo({ top: 0, behavior: previousPage === pageName ? "auto" : "smooth" });
  };
  if (previousPage === pageName) {
    applyPageChange();
  } else if (document.startViewTransition) {
    document.startViewTransition(applyPageChange);
  } else {
    const activePage = document.querySelector(".page.active");
    activePage?.classList.add("page-exit");
    window.setTimeout(() => {
      activePage?.classList.remove("page-exit");
      applyPageChange();
    }, 140);
  }
}

function setCategoryOptions(select, type, selected) {
  select.innerHTML = CATEGORIES.filter((category) => category.type === type)
    .map((category) => `<option value="${category.id}">${category.name}</option>`).join("");
  if (selected && [...select.options].some((option) => option.value === selected)) select.value = selected;
}

function applyCategorySuggestion() {
  const form = document.querySelector("#transaction-form");
  const hint = document.querySelector("#transaction-category-hint");
  if (form.elements.type.value !== "expense") {
    hint.textContent = "自動分類は支出入力で利用できます";
    return;
  }
  const suggestion = window.InsightsService?.classifyCategory(form.elements.memo.value);
  if (!suggestion) {
    hint.textContent = "店名や用途を入力すると自動分類します";
    return;
  }
  if ([...form.elements.category.options].some((option) => option.value === suggestion.categoryId)) {
    form.elements.category.value = suggestion.categoryId;
  }
  hint.textContent = `${categoryById(suggestion.categoryId).name}候補・確信度 ${Math.round(suggestion.confidence * 100)}%`;
}

function openTransaction(transactionId) {
  const dialog = document.querySelector("#transaction-dialog");
  const form = document.querySelector("#transaction-form");
  const transaction = state.transactions.find((item) => item.id === transactionId);
  form.reset();
  form.elements.id.value = transaction?.id || "";
  const type = transaction?.type || "expense";
  form.elements.type.value = type;
  form.elements.amount.value = transaction?.amount || "";
  form.elements.date.value = transaction?.date || localISO();
  form.elements.memo.value = transaction?.memo || "";
  setCategoryOptions(form.elements.category, type, transaction?.category);
  document.querySelector("#transaction-category-hint").textContent = transaction
    ? "メモを変更すると再分類します"
    : "店名や用途を入力すると自動分類します";
  document.querySelector("#transaction-dialog-title").textContent = transaction ? "収支を編集" : "収支を追加";
  document.querySelector("#delete-transaction-button").classList.toggle("hidden", !transaction);
  dialog.showModal();
}

function openSavingsGoal(goalId) {
  const dialog = document.querySelector("#savings-goal-dialog");
  const form = document.querySelector("#savings-goal-form");
  const goal = state.savingsGoals.find((item) => item.id === goalId);
  form.reset();
  form.elements.id.value = goal?.id || "";
  form.elements.name.value = goal?.name || "";
  form.elements.targetAmount.value = goal?.targetAmount || "";
  form.elements.currentAmount.value = goal?.currentAmount || 0;
  form.elements.deadline.value = goal?.deadline || "";
  document.querySelector("#savings-goal-dialog-title").textContent = goal ? "貯金目標を編集" : "貯金目標を追加";
  document.querySelector("#delete-savings-goal-button").classList.toggle("hidden", !goal);
  dialog.showModal();
}

function openRecurring(ruleId, options = {}) {
  const dialog = document.querySelector("#recurring-dialog");
  const form = document.querySelector("#recurring-form");
  const rule = state.recurring.find((item) => item.id === ruleId);
  form.reset();
  form.elements.id.value = rule?.id || "";
  const type = rule?.type || "expense";
  form.elements.type.value = type;
  form.elements.name.value = rule?.name || "";
  form.elements.amount.value = rule?.amount || "";
  form.elements.day.value = rule?.day || 1;
  form.elements.active.checked = rule ? rule.active : true;
  setCategoryOptions(form.elements.category, type, rule?.category || (options.subscription ? "entertainment" : ""));
  form.elements.name.placeholder = options.subscription ? "例：Netflix" : "例：家賃";
  document.querySelector("#recurring-dialog-title").textContent = rule
    ? "固定費を編集"
    : options.subscription ? "サブスクを追加" : "固定費を追加";
  document.querySelector("#delete-recurring-button").classList.toggle("hidden", !rule);
  dialog.showModal();
}

function openBudget(categoryId) {
  const form = document.querySelector("#budget-form");
  setCategoryOptions(form.elements.category, "expense", categoryId);
  form.elements.category.disabled = Boolean(categoryId);
  form.elements.amount.value = categoryId ? state.budgets.categories[categoryId] : "";
  document.querySelector("#budget-dialog").showModal();
}

function cleanupOCRPreview() {
  if (ocrPreviewUrl) URL.revokeObjectURL(ocrPreviewUrl);
  ocrPreviewUrl = "";
}

function resetOCRDialog() {
  const form = document.querySelector("#ocr-form");
  cleanupOCRPreview();
  latestOCRResult = null;
  form.reset();
  document.querySelector("#ocr-preview").removeAttribute("src");
  document.querySelector("#ocr-filename").textContent = "";
  document.querySelector("#ocr-preview-wrap").classList.add("hidden");
  document.querySelector("#ocr-upload-step").classList.remove("hidden");
  document.querySelector("#ocr-review-step").classList.add("hidden");
  document.querySelector("#ocr-single-fields").classList.remove("hidden");
  document.querySelector("#ocr-batch-fields").classList.add("hidden");
  document.querySelector("#ocr-batch-list").innerHTML = "";
  ["date", "amount", "merchant", "paymentMethod", "category"].forEach((name) => {
    form.elements[name].disabled = false;
  });
  document.querySelector("#ocr-submit-button").textContent = "確認して登録";
  document.querySelector("#analyze-ocr-button").disabled = true;
  document.querySelector("#analyze-ocr-button .button-label").classList.remove("hidden");
  document.querySelector("#analyze-ocr-button .button-loading").classList.add("hidden");
}

function openOCRDialog(pickLatest = false) {
  resetOCRDialog();
  const dialog = document.querySelector("#ocr-dialog");
  const fileInput = document.querySelector("#ocr-file");
  autoAnalyzeLatestSelection = pickLatest;
  dialog.showModal();
  if (pickLatest) {
    try {
      fileInput.click();
    } catch {
      autoAnalyzeLatestSelection = false;
      showToast("写真を選択してください");
    }
  }
}

function ocrCategoryOptions(candidates = []) {
  const candidateIds = candidates.map((candidate) => candidate.categoryId);
  const orderedCategories = [
    ...candidateIds.map(categoryById),
    ...CATEGORIES.filter((category) => category.type === "expense" && !candidateIds.includes(category.id)),
  ];
  return orderedCategories
    .map((category, index) => `<option value="${category.id}">${index < candidateIds.length ? "候補・" : ""}${category.name}</option>`)
    .join("");
}

function setOCRCategoryOptions(result) {
  const select = document.querySelector("#ocr-form").elements.category;
  select.innerHTML = ocrCategoryOptions(result.categoryCandidates);
  select.value = result.categoryCandidates[0]?.categoryId || "other-expense";
  const topCandidate = result.categoryCandidates[0];
  document.querySelector("#ocr-category-hint").textContent = topCandidate
    ? `最有力候補：${categoryById(topCandidate.categoryId).name}（${Math.round(topCandidate.score * 100)}%）`
    : "候補を選択してください";
}

function renderOCRBatch(transactions) {
  const paymentMethods = ["PayPay", "クレジットカード", "現金", "その他"];
  document.querySelector("#ocr-batch-count").textContent = `${transactions.length}件の明細を検出`;
  document.querySelector("#ocr-batch-list").innerHTML = transactions.map((transaction, index) => `
    <article class="ocr-batch-item" data-source-type="${escapeHtml(transaction.sourceType || "auto")}">
      <div class="ocr-batch-title">
        <label><input class="ocr-batch-include" type="checkbox" checked /> 登録する</label>
        <strong>明細 ${index + 1}</strong>
      </div>
      <div class="ocr-field-grid">
        <label class="field">日付<input data-field="date" type="date" value="${escapeHtml(transaction.date)}" /></label>
        <label class="field">金額<input data-field="amount" type="number" min="1" inputmode="numeric" value="${Number(transaction.amount) || ""}" /></label>
      </div>
      <label class="field">店名<input data-field="merchant" maxlength="50" value="${escapeHtml(transaction.merchant)}" /></label>
      <div class="ocr-field-grid">
        <label class="field">支払い方法<select data-field="paymentMethod">${paymentMethods.map((method) =>
          `<option value="${method}" ${method === transaction.paymentMethod ? "selected" : ""}>${method}</option>`).join("")}</select></label>
        <label class="field">カテゴリ<select data-field="category">${ocrCategoryOptions(transaction.categoryCandidates)}</select></label>
      </div>
    </article>`).join("");
}

function showOCRResult(result) {
  const form = document.querySelector("#ocr-form");
  const transactions = result.transactions || [];
  const isBatch = transactions.length > 1;
  latestOCRResult = result;
  form.elements.rawText.value = result.rawText;
  form.elements.date.value = result.date;
  form.elements.amount.value = result.amount;
  form.elements.merchant.value = result.merchant;
  form.elements.paymentMethod.value = result.paymentMethod;
  setOCRCategoryOptions(result);
  document.querySelector("#ocr-single-fields").classList.toggle("hidden", isBatch);
  document.querySelector("#ocr-batch-fields").classList.toggle("hidden", !isBatch);
  ["date", "amount", "merchant", "paymentMethod", "category"].forEach((name) => {
    form.elements[name].disabled = isBatch;
  });
  if (isBatch) renderOCRBatch(transactions);
  document.querySelector("#ocr-submit-button").textContent = isBatch
    ? `${transactions.length}件を確認して登録`
    : "確認して登録";
  document.querySelector("#ocr-upload-step").classList.add("hidden");
  document.querySelector("#ocr-review-step").classList.remove("hidden");
}

function updateSavingsLabel() {
  const mode = document.querySelector("#savings-mode")?.value;
  const label = document.querySelector("#savings-value-label");
  if (label) label.textContent = mode === "percent" ? "収入に対する割合（%）" : "毎月の貯金額";
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[character]);
}

function closeDialogSmooth(dialog, afterClose) {
  if (!dialog?.open) {
    afterClose?.();
    return;
  }
  dialog.classList.add("dialog-closing");
  window.setTimeout(() => {
    dialog.close();
    dialog.classList.remove("dialog-closing");
    afterClose?.();
  }, 170);
}

document.querySelectorAll(".nav-item").forEach((button) => {
  if (button.dataset.target) button.addEventListener("click", () => switchPage(button.dataset.target));
});

document.querySelector("#header-settings-button").addEventListener("click", () => switchPage("settings"));

document.addEventListener("click", (event) => {
  const actionElement = event.target.closest("[data-action]");
  if (!actionElement) return;
  const { action, id: itemId, category } = actionElement.dataset;
  if (action === "go-list") switchPage("list");
  if (action === "go-savings") switchPage("savings");
  if (action === "go-analysis") switchPage("analysis");
  if (action === "go-recurring") switchPage("recurring");
  if (action === "go-budget") switchPage("budget");
  if (action === "go-settings") switchPage("settings");
  if (action === "open-record-sheet") document.querySelector("#record-action-dialog").showModal();
  if (action === "record-manual") {
    closeDialogSmooth(document.querySelector("#record-action-dialog"), () => openTransaction());
  }
  if (action === "record-ocr") {
    closeDialogSmooth(document.querySelector("#record-action-dialog"), () => openOCRDialog(true));
  }
  if (action === "record-subscription") {
    closeDialogSmooth(document.querySelector("#record-action-dialog"), () => openRecurring(undefined, { subscription: true }));
  }
  if (action === "edit-transaction") openTransaction(itemId);
  if (action === "add-savings-goal") openSavingsGoal();
  if (action === "edit-savings-goal") openSavingsGoal(itemId);
  if (action === "add-recurring") openRecurring();
  if (action === "edit-recurring") openRecurring(itemId);
  if (action === "add-budget") openBudget();
  if (action === "edit-budget") openBudget(category);
  if (action === "save-monthly-budget") {
    state.budgets.monthly = Math.max(0, Number(document.querySelector("#monthly-budget").value));
    saveState(); renderAll(); switchPage("budget"); showToast("月間予算を保存しました");
  }
  if (action === "save-savings") {
    state.savings = {
      enabled: document.querySelector("#savings-enabled").checked,
      mode: document.querySelector("#savings-mode").value,
      value: Math.max(0, Number(document.querySelector("#savings-value").value)),
    };
    saveState(); renderAll(); switchPage("budget"); showToast("貯金設定を保存しました");
  }
  if (action === "reset-data") {
    if (!window.confirm("入力したすべてのデータを消去しますか？この操作は元に戻せません。")) return;
    state = makeInitialState();
    saveState(); renderAll(); switchPage("home");
    showToast("すべてのデータを消去しました");
  }
});

document.addEventListener("input", (event) => {
  if (["search", "type-filter", "month-filter"].includes(event.target.id)) updateFilteredList();
});
document.addEventListener("change", (event) => {
  if (event.target.id === "savings-mode") updateSavingsLabel();
  if (["type-filter", "month-filter"].includes(event.target.id)) updateFilteredList();
});

document.querySelectorAll(".close-dialog").forEach((button) => {
  button.addEventListener("click", () => closeDialogSmooth(button.closest("dialog")));
});

document.querySelector("#ocr-file").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  cleanupOCRPreview();
  if (!file) {
    autoAnalyzeLatestSelection = false;
    document.querySelector("#ocr-preview-wrap").classList.add("hidden");
    document.querySelector("#analyze-ocr-button").disabled = true;
    return;
  }
  ocrPreviewUrl = URL.createObjectURL(file);
  document.querySelector("#ocr-preview").src = ocrPreviewUrl;
  document.querySelector("#ocr-filename").textContent = file.name;
  document.querySelector("#ocr-preview-wrap").classList.remove("hidden");
  document.querySelector("#analyze-ocr-button").disabled = false;
  if (autoAnalyzeLatestSelection) {
    autoAnalyzeLatestSelection = false;
    await analyzeSelectedOCRFile();
  }
});

async function analyzeSelectedOCRFile() {
  const form = document.querySelector("#ocr-form");
  const file = form.elements.image.files[0];
  const button = document.querySelector("#analyze-ocr-button");
  const loading = button.querySelector(".button-loading");
  if (!file) return false;

  button.disabled = true;
  button.querySelector(".button-label").classList.add("hidden");
  loading.textContent = "OCRを準備中…";
  loading.classList.remove("hidden");
  try {
    const result = await window.OCRService.analyze(file, {
      sourceType: form.elements.sourceType.value,
      onProgress(progress) {
        loading.textContent = `解析中 ${Math.round(progress * 100)}%`;
      },
    });
    showOCRResult(result);
    return true;
  } catch (error) {
    showToast(error?.message || "画像を解析できませんでした");
    return false;
  } finally {
    button.disabled = false;
    button.querySelector(".button-label").classList.remove("hidden");
    loading.textContent = "解析中…";
    loading.classList.add("hidden");
  }
}

document.querySelector("#analyze-ocr-button").addEventListener("click", async () => {
  await analyzeSelectedOCRFile();
});

document.querySelector("#ocr-back-button").addEventListener("click", resetOCRDialog);
document.querySelector("#ocr-dialog").addEventListener("close", cleanupOCRPreview);

document.querySelectorAll('input[name="type"]').forEach((input) => {
  input.addEventListener("change", () => {
    const form = input.closest("form");
    setCategoryOptions(form.elements.category, input.value);
    if (form.id === "transaction-form") applyCategorySuggestion();
  });
});

document.querySelector('#transaction-form [name="memo"]').addEventListener("input", applyCategorySuggestion);

document.querySelector("#transaction-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  const existingIndex = state.transactions.findIndex((transaction) => transaction.id === data.id);
  const transaction = {
    id: data.id || id(),
    type: data.type,
    amount: Number(data.amount),
    date: data.date,
    category: data.category,
    memo: data.memo.trim(),
    source: existingIndex >= 0 ? state.transactions[existingIndex].source : "manual",
    ...(existingIndex >= 0 && state.transactions[existingIndex].recurringId
      ? { recurringId: state.transactions[existingIndex].recurringId } : {}),
  };
  if (existingIndex >= 0) state.transactions[existingIndex] = transaction;
  else state.transactions.push(transaction);
  saveState(); form.closest("dialog").close(); renderAll(); switchPage(currentPage);
  showToast(existingIndex >= 0 ? "収支を更新しました" : "収支を追加しました");
});

document.querySelector("#savings-goal-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  const existingIndex = state.savingsGoals.findIndex((goal) => goal.id === data.id);
  const goal = {
    id: data.id || id(),
    name: data.name.trim(),
    targetAmount: Math.max(1, Number(data.targetAmount)),
    currentAmount: Math.max(0, Number(data.currentAmount)),
    deadline: data.deadline,
  };
  if (existingIndex >= 0) state.savingsGoals[existingIndex] = goal;
  else state.savingsGoals.push(goal);
  saveState(); form.closest("dialog").close(); renderAll(); switchPage("savings");
  showToast(existingIndex >= 0 ? "貯金目標を更新しました" : "貯金目標を追加しました");
});

document.querySelector("#delete-savings-goal-button").addEventListener("click", () => {
  const goalId = document.querySelector("#savings-goal-form").elements.id.value;
  state.savingsGoals = state.savingsGoals.filter((goal) => goal.id !== goalId);
  saveState(); document.querySelector("#savings-goal-dialog").close(); renderAll(); switchPage("savings");
  showToast("貯金目標を削除しました");
});

document.querySelector("#ocr-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  const isBatchMode = !document.querySelector("#ocr-batch-fields").classList.contains("hidden");
  const batchItems = [...document.querySelectorAll("#ocr-batch-list .ocr-batch-item")]
    .filter((item) => item.querySelector(".ocr-batch-include").checked);
  const entries = isBatchMode
    ? batchItems.map((item) => ({
      date: item.querySelector('[data-field="date"]').value,
      amount: Number(item.querySelector('[data-field="amount"]').value),
      merchant: item.querySelector('[data-field="merchant"]').value.trim(),
      paymentMethod: item.querySelector('[data-field="paymentMethod"]').value,
      category: item.querySelector('[data-field="category"]').value,
      sourceType: item.dataset.sourceType,
    }))
    : [{
      date: data.date,
      amount: Number(data.amount),
      merchant: data.merchant?.trim(),
      paymentMethod: data.paymentMethod,
      category: data.category,
      sourceType: latestOCRResult?.sourceType || data.sourceType,
    }];
  if (!entries.length || entries.some((entry) => !entry.date || !entry.amount || !entry.merchant)) {
    showToast("登録する明細の日付・金額・店名を確認してください");
    return;
  }
  entries.forEach((entry) => state.transactions.push({
    id: id(),
    type: "expense",
    amount: entry.amount,
    date: entry.date,
    category: entry.category,
    memo: `${entry.merchant}（${entry.paymentMethod}）`,
    paymentMethod: entry.paymentMethod,
    source: "ocr",
    ocr: {
      provider: latestOCRResult?.provider || "tesseract",
      sourceType: entry.sourceType,
      rawText: data.rawText.trim(),
    },
  }));
  saveState();
  form.closest("dialog").close();
  renderAll();
  switchPage("list");
  showToast(`OCR結果を${entries.length}件登録しました`);
});

document.querySelector("#delete-transaction-button").addEventListener("click", () => {
  const transactionId = document.querySelector("#transaction-form").elements.id.value;
  state.transactions = state.transactions.filter((transaction) => transaction.id !== transactionId);
  saveState(); document.querySelector("#transaction-dialog").close(); renderAll(); switchPage(currentPage);
  showToast("収支を削除しました");
});

document.querySelector("#recurring-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  const existingIndex = state.recurring.findIndex((rule) => rule.id === data.id);
  const rule = {
    id: data.id || id(),
    type: data.type,
    name: data.name.trim(),
    amount: Number(data.amount),
    day: Number(data.day),
    category: data.category,
    active: form.elements.active.checked,
  };
  if (existingIndex >= 0) state.recurring[existingIndex] = rule;
  else state.recurring.push(rule);
  saveState();
  const generated = runRecurring();
  form.closest("dialog").close(); renderAll(); switchPage("recurring");
  showToast(generated ? "固定費を保存し、今月分を記録しました" : "固定費を保存しました");
});

document.querySelector("#delete-recurring-button").addEventListener("click", () => {
  const ruleId = document.querySelector("#recurring-form").elements.id.value;
  state.recurring = state.recurring.filter((rule) => rule.id !== ruleId);
  saveState(); document.querySelector("#recurring-dialog").close(); renderAll(); switchPage("recurring");
  showToast("固定費を削除しました（過去の収支は残ります）");
});

document.querySelector("#budget-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const category = form.elements.category.value;
  const amount = Math.max(0, Number(form.elements.amount.value));
  if (amount === 0) delete state.budgets.categories[category];
  else state.budgets.categories[category] = amount;
  saveState(); form.closest("dialog").close(); renderAll(); switchPage("budget");
  showToast(amount === 0 ? "カテゴリ予算を削除しました" : "カテゴリ予算を保存しました");
});

const generatedCount = runRecurring();
saveState();
renderAll();
if (generatedCount) showToast(`固定費を${generatedCount}件、自動記録しました`);
requestAnimationFrame(() => document.body.classList.add("app-ready"));

if ("serviceWorker" in navigator && ["http:", "https:"].includes(location.protocol)) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
