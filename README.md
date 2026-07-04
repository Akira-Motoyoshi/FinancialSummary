# 貯金ザウルス

水色基調のLiquid Glass UIで、収支・固定費・予算・貯金目標・分析を管理するローカルファーストPWAです。

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
