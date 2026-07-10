(function createLedgerService(global) {
  const LABELS = {
    expense: "支出",
    income: "収入",
    pending: "未確定",
    transfer_in: "受取",
    transfer_out: "送金",
    charge: "チャージ",
    refund: "返金",
    point: "ポイント",
    excluded: "除外",
  };

  function directionOf(transaction) {
    return transaction?.ocr?.direction || transaction?.type || "unknown";
  }

  function statusOf(transaction) {
    return transaction?.ocr?.status || "settled";
  }

  function kindOf(transaction) {
    const direction = directionOf(transaction);
    const status = statusOf(transaction);
    if (direction === "internal_transfer") return "charge";
    if (direction === "point") return "point";
    if (status === "excluded") {
      return "excluded";
    }
    if (status === "pending") return "pending";
    if (direction === "refund") return "refund";
    if (direction === "transfer_in") return "transfer_in";
    if (direction === "transfer_out") return "transfer_out";
    return transaction?.type === "income" ? "income" : "expense";
  }

  function totalsForTransactions(transactions, month = "") {
    const result = {
      income: 0,
      expense: 0,
      refund: 0,
      transferIn: 0,
      transferOut: 0,
      charge: 0,
      pending: 0,
      excluded: 0,
      net: 0,
    };
    transactions.filter((transaction) => !month || transaction.date?.startsWith(month)).forEach((transaction) => {
      const amount = Number(transaction.amount) || 0;
      const kind = kindOf(transaction);
      if (kind === "income") result.income += amount;
      else if (kind === "expense") result.expense += amount;
      else if (kind === "refund") result.refund += amount;
      else if (kind === "transfer_in") result.transferIn += amount;
      else if (kind === "transfer_out") result.transferOut += amount;
      else if (kind === "charge") result.charge += amount;
      else if (kind === "pending") result.pending += amount;
      else result.excluded += amount;
    });
    result.net = result.income + result.refund - result.expense;
    return result;
  }

  function categorySpendForTransactions(transactions, month = "") {
    return transactions
      .filter((transaction) => kindOf(transaction) === "expense" && (!month || transaction.date?.startsWith(month)))
      .reduce((result, transaction) => {
        result[transaction.category] = (result[transaction.category] || 0) + Number(transaction.amount || 0);
        return result;
      }, {});
  }

  function matchesTypeFilter(transaction, filter) {
    if (filter === "all") return true;
    const kind = kindOf(transaction);
    if (filter === "transfer") return kind === "transfer_in" || kind === "transfer_out" || kind === "charge";
    return kind === filter;
  }

  function labelFor(transaction) {
    return LABELS[kindOf(transaction)] || "その他";
  }

  function signFor(transaction) {
    const kind = kindOf(transaction);
    if (["income", "refund", "transfer_in"].includes(kind)) return "+";
    if (["point", "excluded"].includes(kind)) return "";
    return "−";
  }

  global.LedgerService = Object.freeze({
    directionOf,
    statusOf,
    kindOf,
    totalsForTransactions,
    categorySpendForTransactions,
    matchesTypeFilter,
    labelFor,
    signFor,
  });
})(window);
