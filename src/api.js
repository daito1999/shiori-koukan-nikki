import { supabase } from "./supabaseClient";

const NOT_CONFIGURED_ERROR = new Error(
  "Supabaseが未設定です。.env.local に VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY を設定してください。"
);

function requireClient() {
  if (!supabase) throw NOT_CONFIGURED_ERROR;
  return supabase;
}

// 全データを取得し、既存のUIコンポーネントがそのまま使える形（App.jsx v4までの
// in-memory state と同じ形）に組み立て直す。5人程度の小規模利用が前提のため、
// 差分更新はせず毎回まるごと取得し直すシンプルな作りにしている。
export async function fetchAll() {
  const client = requireClient();

  const [
    { data: memberRows, error: e1 },
    { data: reviewRows, error: e2 },
    { data: answerRows, error: e3 },
    { data: reviewReactionRows, error: e4 },
    { data: answerReactionRows, error: e5 },
    { data: commentRows, error: e6 },
  ] = await Promise.all([
    client.from("members").select("*").order("created_at"),
    client.from("reviews").select("*").order("created_at", { ascending: false }),
    client.from("answers").select("*"),
    client.from("review_reactions").select("*"),
    client.from("answer_reactions").select("*"),
    client.from("comments").select("*").order("created_at"),
  ]);
  const err = e1 || e2 || e3 || e4 || e5 || e6;
  if (err) throw err;

  const members = memberRows.map((m) => m.name);
  const avatars = Object.fromEntries(memberRows.map((m) => [m.name, m.avatar]));
  const progress = Object.fromEntries(memberRows.map((m) => [m.name, m.progress_index]));

  const reviews = reviewRows.map((r) => ({
    id: r.id,
    userId: r.user_name,
    startChapterId: r.start_chapter_id,
    endChapterId: r.end_chapter_id,
    date: r.review_date,
    reviewText: r.review_text,
    editedAt: r.edited_at ? r.edited_at.slice(0, 10) : null,
    answers: answerRows
      .filter((a) => a.review_id === r.id)
      .map((a) => ({
        id: a.id,
        chapterId: a.chapter_id,
        text: a.answer_text,
        reactions: answerReactionRows
          .filter((x) => x.answer_id === a.id)
          .map((x) => ({ userId: x.user_name, emoji: x.emoji })),
      })),
    reactions: reviewReactionRows
      .filter((x) => x.review_id === r.id)
      .map((x) => ({ userId: x.user_name, emoji: x.emoji })),
    comments: commentRows
      .filter((c) => c.review_id === r.id)
      .map((c) => ({ userId: c.user_name, text: c.comment_text, date: c.comment_date })),
  }));

  return { members, avatars, progress, reviews };
}

export async function registerMember(name, avatar) {
  const { error } = await requireClient().from("members").insert({ name, avatar, progress_index: -1 });
  if (error) throw error;
}

// メンバーを削除すると、外部キーのON DELETE CASCADEにより本人の投稿・回答・
// 他の投稿に残る本人のリアクション/コメントもDB側で自動的に削除される。
export async function deleteMember(name) {
  const { error } = await requireClient().from("members").delete().eq("name", name);
  if (error) throw error;
}

export async function bumpProgress(name, endIndex) {
  const client = requireClient();
  const { data, error: readErr } = await client
    .from("members")
    .select("progress_index")
    .eq("name", name)
    .single();
  if (readErr) throw readErr;
  const current = data?.progress_index ?? -1;
  const { error } = await client
    .from("members")
    .update({ progress_index: Math.max(current, endIndex) })
    .eq("name", name);
  if (error) throw error;
}

export async function createReview({ userName, startChapterId, endChapterId, date, reviewText, answers }) {
  const client = requireClient();
  const { data: review, error } = await client
    .from("reviews")
    .insert({
      user_name: userName,
      start_chapter_id: startChapterId,
      end_chapter_id: endChapterId,
      review_date: date,
      review_text: reviewText,
    })
    .select()
    .single();
  if (error) throw error;

  const rows = answers.map((a) => ({ review_id: review.id, chapter_id: a.chapterId, answer_text: a.text }));
  const { error: aErr } = await client.from("answers").insert(rows);
  if (aErr) throw aErr;
  return review;
}

// 編集時は、章ごとの既存回答をchapterIdで突き合わせて更新し、リアクションを
// 維持する。範囲から外れた章の回答だけ削除する（削除された回答へのリアクション
// はCASCADEで一緒に消える）。
export async function updateReview(reviewId, { startChapterId, endChapterId, date, reviewText, answers, existingAnswers }) {
  const client = requireClient();
  const { error } = await client
    .from("reviews")
    .update({
      start_chapter_id: startChapterId,
      end_chapter_id: endChapterId,
      review_date: date,
      review_text: reviewText,
      edited_at: new Date().toISOString(),
    })
    .eq("id", reviewId);
  if (error) throw error;

  const existingByChapter = Object.fromEntries(existingAnswers.map((a) => [a.chapterId, a]));
  const keepChapterIds = new Set(answers.map((a) => a.chapterId));

  for (const a of answers) {
    const existing = existingByChapter[a.chapterId];
    if (existing) {
      const { error: uErr } = await client.from("answers").update({ answer_text: a.text }).eq("id", existing.id);
      if (uErr) throw uErr;
    } else {
      const { error: iErr } = await client
        .from("answers")
        .insert({ review_id: reviewId, chapter_id: a.chapterId, answer_text: a.text });
      if (iErr) throw iErr;
    }
  }
  for (const existing of existingAnswers) {
    if (!keepChapterIds.has(existing.chapterId)) {
      const { error: dErr } = await client.from("answers").delete().eq("id", existing.id);
      if (dErr) throw dErr;
    }
  }
}

export async function deleteReview(reviewId) {
  const { error } = await requireClient().from("reviews").delete().eq("id", reviewId);
  if (error) throw error;
}

export async function toggleReviewReaction(reviewId, userName, emoji, alreadyReacted) {
  const client = requireClient();
  const { error } = alreadyReacted
    ? await client.from("review_reactions").delete().match({ review_id: reviewId, user_name: userName, emoji })
    : await client.from("review_reactions").insert({ review_id: reviewId, user_name: userName, emoji });
  if (error) throw error;
}

export async function toggleAnswerReaction(answerId, userName, emoji, alreadyReacted) {
  const client = requireClient();
  const { error } = alreadyReacted
    ? await client.from("answer_reactions").delete().match({ answer_id: answerId, user_name: userName, emoji })
    : await client.from("answer_reactions").insert({ answer_id: answerId, user_name: userName, emoji });
  if (error) throw error;
}

export async function addComment(reviewId, userName, text) {
  const { error } = await requireClient()
    .from("comments")
    .insert({
      review_id: reviewId,
      user_name: userName,
      comment_text: text,
      comment_date: new Date().toISOString().slice(0, 10),
    });
  if (error) throw error;
}

// members/reviews/answers/reactions/commentsのいずれかが変化したら
// onChangeを呼ぶ。呼び出し側で全件再取得して画面に反映する想定。
export function subscribeToChanges(onChange) {
  if (!supabase) return () => {};
  const channel = supabase
    .channel("shiori-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "members" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "reviews" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "answers" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "review_reactions" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "answer_reactions" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "comments" }, onChange)
    .subscribe();
  return () => supabase.removeChannel(channel);
}
