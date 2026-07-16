# 栞交換日記

『傲慢と善良』（辻村深月）を読みながら、感想と価値観の移り変わりを
友人同士で記録・共有するアプリです。

要件定義の詳細は [要件定義書.md](../要件定義書.md)（プロジェクトルート）を参照してください。

✅ v5からSupabase（共有データベース）と連携し、誰かが投稿・編集すると
他のメンバーが開いたとき（あるいは開いたまま）も最新の内容が反映されます。

---

## セットアップ手順（初回のみ）

### 1. Supabaseプロジェクトを作る

1. [supabase.com](https://supabase.com) でアカウント作成 → 「New project」
2. 作成できたら、左メニュー「SQL Editor」を開き、[`supabase/schema.sql`](supabase/schema.sql)
   の中身を貼り付けて実行する（テーブル作成・アクセス許可・初期データ投入まで一括で行われます）
3. 左メニュー「Project Settings」→「Data API」で、以下の2つを控える
   - **Project URL**（`https://xxxxx.supabase.co`）
   - **anon / publishable キー**（`sb_publishable_...` から始まるもの。公開前提の鍵なので
     アプリに埋め込んで問題ありません。`sb_secret_...` の方は絶対に使わないこと）

### 2. ローカルに環境変数を設定する

`.env.example` を `.env.local` としてコピーし、上で控えた値を入れます。

```bash
cp .env.example .env.local
```

```
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_xxxxxxxxxxxxxxxxxxxxxxxx
```

`.env.local` はコミットされません（`.gitignore`済み）。

### 3. ローカルで動作確認する

```bash
npm install
npm run dev
```

表示されるURL（通常 http://localhost:5173 ）をブラウザで開くと確認できます。

---

## GitHub Pages で公開する手順

### 1. GitHubにリポジトリを作成する

1. GitHub（https://github.com）にログインし、右上の「+」→「New repository」
2. リポジトリ名を決める（例: `shiori-koukan-nikki`）
   - **この名前は後で `vite.config.js` の設定と一致させる必要があります**
3. 「Public」を選択して作成（Privateだと無料プランではPagesが使えません）
   - ※ 実際の日記の中身（感想・回答など）はSupabase側に保存され、この
     GitHubリポジトリにはアプリのコードしか入りません

### 2. このフォルダの中身をリポジトリにアップロードする

```bash
cd shiori-app
git remote add origin https://github.com/【あなたのGitHubユーザー名】/shiori-koukan-nikki.git
git push -u origin main
```

### 3. リポジトリにSupabaseの接続情報をSecretsとして登録する

GitHub Actionsのビルド時にも環境変数が必要なため、リポジトリ側にも登録します。

1. リポジトリの「Settings」タブ →左メニュー「Secrets and variables」→「Actions」
2. 「New repository secret」で以下の2つを登録
   - Name: `VITE_SUPABASE_URL` / Value: SupabaseのProject URL
   - Name: `VITE_SUPABASE_ANON_KEY` / Value: Supabaseのanon/publishableキー

### 4. リポジトリ名を `vite.config.js` に反映する

`vite.config.js` の `base` を、実際に作ったリポジトリ名に合わせて書き換えます。

```js
base: "/あなたが作ったリポジトリ名/",
```

例えばリポジトリ名が `shiori-koukan-nikki` ならそのままで問題ありません。

### 5. GitHub Pagesを有効化する

1. リポジトリの「Settings」タブを開く
2. 左メニューの「Pages」を選択
3. 「Build and deployment」の「Source」を **「GitHub Actions」** に設定

これで `main` ブランチに push するたびに、Secretsの値を使って自動でビルド・公開されます
（`.github/workflows/deploy.yml` がその設定ファイルです）。

### 6. 公開されたURLを確認する

数分待つと、以下のようなURLでアクセスできるようになります。

```
https://【あなたのGitHubユーザー名】.github.io/【リポジトリ名】/
```

「Settings」→「Pages」の画面上部にも、公開後のURLが表示されます。
このURLを友人に共有すれば、それぞれのスマホ・PCからアクセスでき、
誰かが投稿すると他の人の画面にも反映されます。

---

## 今後の注意点

- 質問文や本の目次は `src/App.jsx` 内の `BOOK` / `QUESTIONS` を編集すると変更できます。
  DB化はしていないため、変更したら再度pushしてデプロイし直してください。
- **認証は行っていません**（要件定義書どおり「パスワードなし・共有リンクを知る友人だけ」の
  想定）。Supabaseのanon/publishableキーとURLが分かれば誰でも読み書きできてしまう作りのため、
  URLを不特定多数に共有しないよう注意してください。
- v5（現行版）でSupabase連携により追加・変更した点：
  - members / reviews / answers / reactions / comments をSupabaseに保存
  - Realtime購読により、他メンバーの投稿・リアクション・コメント・削除が
    自動的に画面へ反映される（`src/api.js` の `subscribeToChanges`）
  - データ取得・保存に失敗した場合は画面上部にエラーメッセージを表示
- v4で要件定義書に合わせて追加した点：
  - 表示名に加えてアイコン（絵文字アバター）を選べる
  - リアクションを感想投稿だけでなく、各人生観の回答にも個別に付けられる
  - 「価値観の推移」タブでメンバーを切り替えて、他メンバーの回答推移も
    ネタバレルールに従って閲覧できる（自分が未読の範囲は隠れる）
  - 投稿フォームで未回答の質問を視覚的に強調表示
  - ログイン画面のメンバー一覧からユーザーを削除できる（確認ステップあり。
    本人の投稿や、他の投稿に残る本人のリアクション・コメントも合わせて削除される）
