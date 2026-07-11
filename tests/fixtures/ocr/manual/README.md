# Manual OCR fixtures

添付されたPayPay履歴4枚と三井住友カード明細2枚を、個人情報を含まないOCRテキストに手修正して保存した評価セットです。

画像そのものはリポジトリに保存せず、expected.jsonをgolden expectationとして利用します。

追加の回帰fixture:

- `paypay-refund-charge.txt`: 返金・チャージ・ポイント・通常支出の混在
- `paypay-transfer-regression.txt`: 送金・受取フィルタ
- `card-email-notice-01.txt` / `card-email-notice-02.txt`: 三井住友カード利用通知
