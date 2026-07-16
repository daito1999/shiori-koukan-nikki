-- 栞交換日記 データベーススキーマ
-- Supabaseダッシュボード「SQL Editor」で、このファイルの内容をそのまま
-- 実行してください（新しいクエリを作成 → 貼り付け → Run）。
--
-- 設計方針:
--   ・要件定義書どおり「パスワードなし・友人間クローズド利用」のため、
--     認証は行わず、公開用キー（publishable key）を持つ人は誰でも
--     読み書きできる想定にしています（RLSポリシーはanon/authenticated双方に開放）。
--     これは既存プロトタイプの「isMineなら編集・削除ボタンを出す」という
--     UI上の制約と同じ信頼モデルを、そのままDB層に引き継いだものです。
--   ・本（BOOK）・質問（QUESTIONS）は当面1冊固定運用のため、アプリ側の
--     定数のままとし、DBには持たせていません（複数冊対応が必要になった
--     段階で別途テーブル化します）。

-- ---------- members: 参加メンバー ----------
create table if not exists members (
  name text primary key,
  avatar text not null default '🔖',
  progress_index integer not null default -1, -- -1: 読む前すら未投稿
  created_at timestamptz not null default now()
);

-- ---------- reviews: 感想投稿（読んだ範囲＋感想本文） ----------
create table if not exists reviews (
  id uuid primary key default gen_random_uuid(),
  user_name text not null references members(name) on delete cascade,
  start_chapter_id text not null,
  end_chapter_id text not null,
  review_date date not null,
  review_text text not null,
  edited_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------- answers: 範囲内の章ごとの人生観回答 ----------
create table if not exists answers (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references reviews(id) on delete cascade,
  chapter_id text not null,
  answer_text text not null
);

-- ---------- review_reactions: 投稿全体へのリアクション ----------
create table if not exists review_reactions (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references reviews(id) on delete cascade,
  user_name text not null references members(name) on delete cascade,
  emoji text not null,
  unique (review_id, user_name, emoji)
);

-- ---------- answer_reactions: 個々の回答へのリアクション ----------
create table if not exists answer_reactions (
  id uuid primary key default gen_random_uuid(),
  answer_id uuid not null references answers(id) on delete cascade,
  user_name text not null references members(name) on delete cascade,
  emoji text not null,
  unique (answer_id, user_name, emoji)
);

-- ---------- comments: 投稿へのコメント ----------
create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references reviews(id) on delete cascade,
  user_name text not null references members(name) on delete cascade,
  comment_text text not null,
  comment_date date not null,
  created_at timestamptz not null default now()
);

-- ---------- RLS: 友人間クローズド利用のため、公開キーでの読み書きを許可 ----------
alter table members enable row level security;
alter table reviews enable row level security;
alter table answers enable row level security;
alter table review_reactions enable row level security;
alter table answer_reactions enable row level security;
alter table comments enable row level security;

create policy "members: 誰でも読み書き" on members
  for all using (true) with check (true);
create policy "reviews: 誰でも読み書き" on reviews
  for all using (true) with check (true);
create policy "answers: 誰でも読み書き" on answers
  for all using (true) with check (true);
create policy "review_reactions: 誰でも読み書き" on review_reactions
  for all using (true) with check (true);
create policy "answer_reactions: 誰でも読み書き" on answer_reactions
  for all using (true) with check (true);
create policy "comments: 誰でも読み書き" on comments
  for all using (true) with check (true);

-- ---------- Realtime: 他メンバーの更新をリアルタイムに反映するため有効化 ----------
alter publication supabase_realtime add table members;
alter publication supabase_realtime add table reviews;
alter publication supabase_realtime add table answers;
alter publication supabase_realtime add table review_reactions;
alter publication supabase_realtime add table answer_reactions;
alter publication supabase_realtime add table comments;

-- ---------- 初期データ（太郎・花子のシードレビュー） ----------
insert into members (name, avatar, progress_index) values
  ('太郎', '🐢', 1),
  ('花子', '🐝', 3)
on conflict (name) do nothing;

with r0 as (
  insert into reviews (user_name, start_chapter_id, end_chapter_id, review_date, review_text)
  values ('太郎', 'p0', 'p0', '2026-06-28', 'まだ読んでないけど、タイトルからして重そうな話。婚活ものらしいので今から身構えてる。')
  returning id
)
insert into answers (review_id, chapter_id, answer_text)
select id, 'p0', '今は結婚願望あまりない。周りが結婚し始めて焦る気持ちはあるけど、妥協はしたくない。' from r0;

with r1 as (
  insert into reviews (user_name, start_chapter_id, end_chapter_id, review_date, review_text)
  values ('花子', 'p1c1', 'p1c1', '2026-07-01', '架の視点から始まって、婚活市場のシビアさがリアル。条件で判断してしまう自分にも心当たりがある……。')
  returning id
), a1 as (
  insert into answers (review_id, chapter_id, answer_text)
  select id, 'p1c1', '正直、年収と価値観の合う・合わないは見てしまう。でもそれを「傲慢」と言われると耳が痛い。' from r1
  returning id, review_id
)
insert into review_reactions (review_id, user_name, emoji)
select review_id, '太郎', '🤔' from a1;

with r1b as (select id from reviews where user_name = '花子' and start_chapter_id = 'p1c1'),
     a1b as (select id from answers where review_id in (select id from r1b))
insert into answer_reactions (answer_id, user_name, emoji)
select id, '太郎', '🤔' from a1b;

insert into comments (review_id, user_name, comment_text, comment_date)
select id, '花子', 'わかる、条件で見るの悪いことじゃないと思うけどね', '2026-07-02'
from reviews where user_name = '花子' and start_chapter_id = 'p1c1';

with r2 as (
  insert into reviews (user_name, start_chapter_id, end_chapter_id, review_date, review_text)
  values ('太郎', 'p1c1', 'p1c1', '2026-07-02', '第一章、思ったよりテンポよく読めた。架がどんな決断をするのか気になる。')
  returning id
)
insert into answers (review_id, chapter_id, answer_text)
select id, 'p1c1', '条件はある程度大事だけど、それより「一緒にいて楽か」を重視したい派。' from r2;

with r3 as (
  insert into reviews (user_name, start_chapter_id, end_chapter_id, review_date, review_text)
  values ('花子', 'p1c2', 'p1c3', '2026-07-05', '第二章〜第三章を一気読み。真実の視点が入ってきて、印象がだいぶ変わった。善良さの裏にあるものが見えてくる感じ。')
  returning id
)
insert into answers (review_id, chapter_id, answer_text)
select id, 'p1c2', 'マッチングアプリ自体には抵抗ないけど、会う前の情報が少なすぎるのは怖いなと思う。' from r3
union all
select id, 'p1c3', '同棲は必要だと思ってたけど、この章読んでちょっと揺らいだ。一緒に住まなくても分かることもあるのかも。' from r3;

with r3b as (select id from reviews where user_name = '花子' and start_chapter_id = 'p1c2')
insert into review_reactions (review_id, user_name, emoji)
select id, '花子', '😮' from r3b
union all
select id, '太郎', '📖' from r3b;

with a3 as (
  select answers.id from answers
  join reviews on reviews.id = answers.review_id
  where reviews.user_name = '花子' and reviews.start_chapter_id = 'p1c2' and answers.chapter_id = 'p1c3'
)
insert into answer_reactions (answer_id, user_name, emoji)
select id, '花子', '😮' from a3;
