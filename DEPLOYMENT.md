# 部署說明

## GitHub Pages

正式網址：<https://baotoast.github.io/Turning-Traffic/>

專案同時提供兩種相容路徑：

1. 根目錄已有預先建立的 `index.html` 與 `assets/`，可供既有「Deploy from a branch」設定使用。
2. `.github/workflows/pages.yml` 會在 `main` 更新時重新建立 `github-pages-dist/`，可供「GitHub Actions」來源使用。

若網址未更新，請到 GitHub 專案的 **Actions** 查看 `Deploy GitHub Pages`，或到 **Settings → Pages** 確認 Source。

## GPT Site

正式網址：<https://turning-traffic-tw.mitoast.chatgpt.site>

Sites 專案識別資訊保存在 `.openai/hosting.json`。請勿自行替換 `project_id`；後續更新應沿用同一個 Sites 專案。

## 發布前檢查

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm test:engine
pnpm build:github
```

## 版本更新

功能更新時，同步修改：

- `package.json` 的版本。
- `lib/traffic.ts` 的 `VERSION` 與 `VERSION_HISTORY`。
- `CHANGELOG.md`。
- 系統備份格式若改變，需提供向前相容的還原處理。
