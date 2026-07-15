# 栞交換日記

『傲慢と善良』（辻村深月）を読みながら、感想と価値観の移り変わりを
友人同士で記録・共有するプロトタイプアプリです。

要件定義の詳細は [要件定義書.md](../要件定義書.md)（プロジェクトルート）を参照してください。

⚠️ このプロトタイプはデータをブラウザのメモリ上にのみ保持します。
ページをリロードすると入力内容は消えます（動作確認・デザイン確認用）。

---

## GitHub Pages で公開する手順

### 1. GitHubにリポジトリを作成する

1. GitHub（https://github.com）にログインし、右上の「+」→「New repository」
2. リポジトリ名を決める（例: `shiori-koukan-nikki`）
   - **この名前は後で `vite.config.js` の設定と一致させる必要があります**
3. 「Public」を選択して作成（Privateだと無料プランではPagesが使えません）

### 2. このフォルダの中身をリポジトリにアップロードする

パソコンに Git が入っていれば、ターミナルで以下を実行します（フォルダのパスは適宜置き換えてください）。

```bash
cd shiori-app
git init
git add .
git commit -m "first commit"
git branch -M main
git remote add origin https://github.com/【あなたのGitHubユーザー名】/shiori-koukan-nikki.git
git push -u origin main
```

Gitを使ったことがない場合は、GitHubの画面から「Add file」→「Upload files」で
このフォルダの中身をドラッグ＆ドロップしてアップロードする方法でも構いません。

### 3. リポジトリ名を `vite.config.js` に反映する

`vite.config.js` の `base` を、実際に作ったリポジトリ名に合わせて書き換えます。

```js
base: "/あなたが作ったリポジトリ名/",
```

例えばリポジトリ名が `shiori-koukan-nikki` ならそのままで問題ありません。

### 4. GitHub Pagesを有効化する

1. リポジトリの「Settings」タブを開く
2. 左メニューの「Pages」を選択
3. 「Build and deployment」の「Source」を **「GitHub Actions」** に設定

これで `main` ブランチに push するたびに、自動でビルド・公開されます
（`.github/workflows/deploy.yml` がその設定ファイルです）。

### 5. 公開されたURLを確認する

数分待つと、以下のようなURLでアクセスできるようになります。

```
https://【あなたのGitHubユーザー名】.github.io/【リポジトリ名】/
```

「Settings」→「Pages」の画面上部にも、公開後のURLが表示されます。
このURLを友人に共有すれば、それぞれのスマホ・PCからアクセスできます。

---

## ローカルで動作確認する場合

```bash
npm install
npm run dev
```

表示されるURL（通常 http://localhost:5173 ）をブラウザで開くと確認できます。

---

## 今後の注意点

- 現状はデータが保存されないプロトタイプです。実際に友人同士で使い続けるには、
  Supabase や Firebase のようなデータベースと接続する改修が別途必要です。
- 質問文や本の目次は `src/App.jsx` 内の `BOOK` / `QUESTIONS` を編集すると変更できます。
- v4（現行版）で要件定義書に合わせて追加した点：
  - 表示名に加えてアイコン（絵文字アバター）を選べる
  - リアクションを感想投稿だけでなく、各人生観の回答にも個別に付けられる
  - 「価値観の推移」タブでメンバーを切り替えて、他メンバーの回答推移も
    ネタバレルールに従って閲覧できる（自分が未読の範囲は隠れる）
  - 投稿フォームで未回答の質問を視覚的に強調表示
  - ログイン画面のメンバー一覧からユーザーを削除できる（確認ステップあり。
    本人の投稿や、他の投稿に残る本人のリアクション・コメントも合わせて削除される）
