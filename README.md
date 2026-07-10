# 貯金ザウルス（FinancialSummary）

スクリーンショットを端末内OCRで読み取り、内容を確認してから安全に登録できる、ローカルファーストの家計簿PWAです。PayPay履歴、三井住友カードの利用通知・明細一覧、レシートに対応しています。

## 特長

- OCR画像は外部送信せず、ブラウザ内のTesseract.jsで解析
- PayPayの支払い・送金・受取・チャージ・返金・ポイントを区別
- カード明細の複数取引抽出と、通知メールとの重複候補判定
- OCR確認画面で登録対象・要確認・除外理由を確認、各項目を編集可能
- 登録直後の結果確認と「今回分を取り消す」操作
- 通常収支と内部移動・返金・未確定明細を分離して集計
- 収支・固定費・予算・貯金目標・検索・分析・バックアップ
- オフライン起動とiPhoneホーム画面追加に対応

## 安全設計

- 家計データはブラウザの`localStorage`にだけ保存します。
- OCR元画像は永続保存せず、確認中だけ端末内で表示します。
- ポイント、チャージ、合計行、見出し行は通常支出へ自動登録しません。
- 重複候補は登録前に警告し、カード通知と確定明細は統合できます。
- 設定画面からJSONバックアップの書き出し・復元ができます。

端末やブラウザのデータ消去で家計データも消えるため、定期的にJSONバックアップを保存してください。

## 必要環境

- Node.js 20以上
- pnpm
- OCR実行時のみ、初回のTesseract言語データ取得にインターネット接続が必要です。

## セットアップと起動

```bash
git clone https://github.com/Akira-Motoyoshi/FinancialSummary.git
cd FinancialSummary
pnpm install
pnpm run dev
```

ブラウザで `http://localhost:8787/` を開きます。同じWi-Fi内のiPhoneから確認する場合は、MacのローカルIPアドレスとポート`8787`を使ってください。

本番ビルドを確認する場合:

```bash
pnpm run build
pnpm run preview
```

## 検証

```bash
pnpm run lint
pnpm run typecheck
pnpm test
pnpm run build
```

テストにはOCR文字列fixtureと期待値を含み、PayPayの除外・送受金・返金、カード複数明細、加盟店正規化、重複候補、家計集計の分離を検証します。

## 主な構成

- `app.js`: 画面、状態管理、登録フロー
- `ocr-service.js`: OCR前処理、画面判定、抽出、正規化、重複候補
- `ledger-service.js`: 通常収支・内部移動・返金・未確定の集計ルール
- `insights-service.js`: 端末内ルールベース分析
- `tests/fixtures/ocr/manual/`: 実画像を再現したOCR評価fixtureと期待値
- `sw.js`: PWAの静的アセットキャッシュ
- `scripts/build.mjs`: `dist/`生成
- `scripts/serve.mjs`: 依存なしのローカル確認サーバー

## PWAとして使う

HTTPSで公開したURLをSafariで開き、共有メニューから「ホーム画面に追加」を選択します。ブラウザのURL欄がない独立したアプリ表示になります。更新後に古い画面が残る場合は、PWAを完全に終了して開き直してください。

## デプロイ

VercelはFramework Presetを`Other`、Build Commandを`pnpm run build`、Output Directoryを`dist`に設定します。環境変数は不要です。`vercel.json`にService Workerとmanifestの配信ヘッダーを定義しています。

## 現在の制約

- OCRは画像品質や文字サイズに依存し、すべての明細を自動確定できるものではありません。
- iOSのWeb/PWA制約上、写真ライブラリの「最新スクリーンショット」を無許可で自動取得できないため、画像選択画面へ案内します。
- データ同期やアカウント機能は未実装です。複数端末間の同期はしません。

## リポジトリ

- GitHub: https://github.com/Akira-Motoyoshi/FinancialSummary
- Vercelデプロイ: https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FAkira-Motoyoshi%2FFinancialSummary
