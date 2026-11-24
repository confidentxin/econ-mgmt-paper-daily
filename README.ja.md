# 経営・経済学文献デイリー

経済学・経営学の大学院生向けの毎日の文献サイトです。Crossref から UTD24、FT50、ABS 3/4 の新着論文を収集し、研究領域ごとに分類して、抽象語を評価し、中国語のタイトル・要約・推薦理由を作成します。

これが **经管科研站** の日本語紹介です。主な説明は[簡体字中国語](README.md)にあります。フレームワークの構成は[フレームワーク資料](docs/framework.md)を参照してください。

## 主な機能

- 452 の英語ジャーナル、899 の ISSN を対象に、3 時間ごとに Crossref を確認します。
- 経済学、ファイナンス、会計学、経営学、マーケティング、情報システム、学際研究に分類します。
- 抽象語を 0〜100 点で独立して 2 回評価します。ジャーナルのランクによって採用基準を変えますが、評価モデルにはジャーナル名を見せません。
- 精选論文、トピックページ、北京時間 8:00 の日報、週報、月報、RSS、公開 API、MCP を提供します。
- Node.js 24、PostgreSQL 17、Docker Compose で動作します。

## ローカル実行

Docker、Node.js 24、OpenAI 互換のモデル API キーが必要です。

```bash
git clone https://github.com/confidentxin/econ-mgmt-paper-daily.git
cd econ-mgmt-paper-daily
node scripts/init-env.ts --llm-key <your-model-api-key>
docker compose up -d --build
```

<http://localhost:3000> を開いてください。管理画面は `/admin`、パスワードは `.env` にあります。論文の収集とモデル呼び出しを行わず画面だけを確認する場合は、`COLLECT_ENABLED=false` と `MODEL_CALLS_ENABLED=false` を設定してください。

## 現在の制限

MVP には、FMS の中国語ジャーナル 85 誌、被引用数・ダウンロード数に基づく热度、メール・Feishu 配信はまだ含まれていません。Crossref に抽象語がない Elsevier の論文もあるため、タイトルだけの論文は抽象語または本文の補完を待ち、評価されません。分類と採用基準は初期値であり、人手でラベル付けした標本による校正はまだ行っていません。

公開運用前に、法的ページの運営主体、施行日、連絡先を入力してください。

## テスト

```bash
npm run typecheck
npm run test:standalone
DATABASE_URL=postgres://…/xxx_test npm test
npm run build -w @aihot/web
npm run test:web
```

テスト用データベース名の末尾は `_test` または `_ci` にしてください。

ブラウザテストには Playwright の Chromium と WebKit が必要です。バックアップ統合テストには `pg_dump` と `pg_restore` が必要で、未インストールの場合はスキップされます。POSIX シグナルに依存する終了処理テストは Windows ではスキップされ、Linux/macOS とプロジェクトの Docker 環境で実行されます。

## ライセンス

コードは MIT License に基づき提供されます。上流の帰属表示と第三者素材の注意事項は [NOTICE](NOTICE) にあります。論文メタデータは Crossref に由来し、論文自体は著者と出版社の財産です。
