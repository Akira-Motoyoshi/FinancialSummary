# 貯金ザウルス

水色基調のLiquid Glass UIで、収支・固定費・予算・貯金目標・分析を管理するローカルファーストPWAです。

## リンク

- [GitHubリポジトリ](https://github.com/Akira-Motoyoshi/FinancialSummary)
- [Vercelへデプロイ](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FAkira-Motoyoshi%2FFinancialSummary)

## 配布時の状態

- 初回起動時は収支・固定費・予算・貯金目標がすべて空です。
- 入力データとOCR画像は外部サーバーへ送信せず、端末内で処理します。
- 設定画面の「すべてのデータを消去」から、いつでも空の状態へ戻せます。

## ローカル起動

```bash
python3 -m http.server 8787
```

`http://localhost:8787/` を開いてください。

## 検証

```bash
pnpm run build
pnpm run lint
pnpm run typecheck
pnpm test
```

## デプロイ

VercelではFramework Presetを`Other`、Root Directoryをリポジトリ直下に設定します。現時点では環境変数は不要です。
