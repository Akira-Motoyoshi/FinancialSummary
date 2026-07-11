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

  function transactionTypeOf(transaction) {
    const explicit = transaction?.transactionType || transaction?.ocr?.transactionType;
    if (["expense", "income", "transfer_out", "transfer_in", "charge", "refund", "point", "unknown"].includes(explicit)) {
      return explicit;
    }
    const direction = directionOf(transaction);
    if (direction === "internal_transfer") return "charge";
    if (["expense", "income", "transfer_out", "transfer_in", "refund", "point"].includes(direction)) return direction;
    return transaction?.type === "income" ? "income" : "expense";
  }

  function kindOf(transaction) {
    const transactionType = transactionTypeOf(transaction);
    const status = statusOf(transaction);
    if (transactionType === "charge") return "charge";
    if (transactionType === "point") return "point";
    if (status === "excluded") {
      return "excluded";
    }
    if (status === "pending") return "pending";
    return transactionType;
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
      point: 0,
      excluded: 0,
      net: 0,
      reviewCount: 0,
    };
    transactions.filter((transaction) => !month || transaction.date?.startsWith(month)).forEach((transaction) => {
      const amount = Number(transaction.amount) || 0;
      const kind = kindOf(transaction);
      if (transaction?.ocr?.needsReview || statusOf(transaction) === "pending") result.reviewCount += 1;
      if (kind === "income") result.income += amount;
      else if (kind === "expense") result.expense += amount;
      else if (kind === "refund") result.refund += amount;
      else if (kind === "transfer_in") result.transferIn += amount;
      else if (kind === "transfer_out") result.transferOut += amount;
      else if (kind === "charge") result.charge += amount;
      else if (kind === "pending") result.pending += amount;
      else if (kind === "point") result.point += amount;
      else result.excluded += amount;
    });
    result.net = result.income + result.refund - result.expense;
    result.expenseTotal = result.expense;
    result.incomeTotal = result.income;
    result.transferOutTotal = result.transferOut;
    result.transferInTotal = result.transferIn;
    result.chargeTotal = result.charge;
    result.refundTotal = result.refund;
    result.pointTotal = result.point;
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
    if (filter === "review") return Boolean(transaction?.ocr?.needsReview) || statusOf(transaction) === "pending";
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
    transactionTypeOf,
    kindOf,
    totalsForTransactions,
    categorySpendForTransactions,
    matchesTypeFilter,
    labelFor,
    signFor,
  });
})(window);
