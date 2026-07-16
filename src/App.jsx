import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import * as api from "./api";
import { isSupabaseConfigured } from "./supabaseClient";

/* ------------------------------------------------------------------
   栞交換日記 プロトタイプ v5（Supabase連携）
   『傲慢と善良』（辻村深月）を題材にした、章ごとの感想＋人生観の
   移り変わりを記録・共有するアプリ。

   v5での変更点:
   - データをSupabase（共有DB）に保存し、誰かが更新すると他の人が
     開いたとき／開いたままのときも最新の内容が反映されるように
     （postgres_changesのRealtime購読 + 全件再取得）
   - members/reviews/answers/reactions/commentsはすべてSupabase由来。
     取得後は従来どおりのin-memoryな形に組み立て直し、既存のUI
     コンポーネントは変更なしで動くようにしてある（src/api.js参照）

   v4での変更点（要件定義書との差分埋め）:
   - 表示名に加えてアイコン（絵文字アバター）を設定できるように
   - リアクションを感想投稿だけでなく、各人生観の回答にも個別に付けられるように
   - 「自分の変化」を「価値観の推移」に拡張し、メンバーを切り替えて
     他メンバーの回答推移も閲覧可能に（閲覧者自身の既読範囲でネタバレ判定）
   - 投稿フォームで未回答の質問を視覚的に強調
   - ユーザーの削除（確認ステップあり）
------------------------------------------------------------------- */

// ---------- 初期データ ----------

const APP_NAME = "栞交換日記";

const BOOK = {
  title: "傲慢と善良",
  author: "辻村深月",
  // index 0 は「読む前」の仮想章。実際の章は index 1 から。
  chapters: [
    { id: "p0", part: "はじめに", label: "読む前", isPreface: true },
    { id: "p1c1", part: "第一部", label: "第一章" },
    { id: "p1c2", part: "第一部", label: "第二章" },
    { id: "p1c3", part: "第一部", label: "第三章" },
    { id: "p1c4", part: "第一部", label: "第四章" },
    { id: "p1c5", part: "第一部", label: "第五章" },
    { id: "p1c6", part: "第一部", label: "第六章" },
    { id: "p2c1", part: "第二部", label: "第一章" },
    { id: "p2c2", part: "第二部", label: "第二章" },
    { id: "p2c3", part: "第二部", label: "第三章" },
  ],
};

const QUESTIONS = {
  p0: { text: "本のタイトルと表紙だけを見て、どんな話だと想像する？　結婚や恋愛に対して今どんな考えを持っている？", theme: "読む前の価値観" },
  p1c1: { text: "結婚相手を選ぶとき、条件（年収・学歴・容姿など）はどれくらい重視する？", theme: "結婚の条件" },
  p1c2: { text: "マッチングアプリでの出会いに抵抗はある？", theme: "出会い方" },
  p1c3: { text: "同棲は結婚前に必要だと思う？", theme: "同棲について" },
  p1c4: { text: "「なんとなく結婚に踏み切れない」相手とは、どうすべきだと思う？", theme: "踏み切れなさ" },
  p1c5: { text: "今のパートナーに満足している？その理由は？", theme: "今の関係への満足度" },
  p1c6: { text: "親の意見や期待は、自分の結婚相手選びにどれくらい影響している？", theme: "親の影響" },
  p2c1: { text: "「善良である」ことは、自分の意思がないことだと思う？", theme: "善良さの意味" },
  p2c2: { text: "相手の過去の嘘や隠し事を知ったら、関係を続けられる？", theme: "過去の秘密" },
  p2c3: { text: "自分の中にある「傲慢さ」と「善良さ」、どちらが強いと思う？", theme: "傲慢と善良" },
};

const AVATAR_SUGGESTIONS = ["🐢", "🐝", "🦊", "🐧", "🐰", "🐼", "🦉", "🐙", "🐨", "🦋", "🐳", "🦔"];

const EMOJI_SUGGESTIONS = ["📖", "😢", "🤔", "😳", "💭", "🔥", "😮", "🥺"];

const chapterIndex = (id) => BOOK.chapters.findIndex((c) => c.id === id);

function progressLabel(idx) {
  if (idx == null || idx < 0) return "まだ何も投稿していません";
  const ch = BOOK.chapters[idx];
  if (ch.isPreface) return "読む前の価値観のみ投稿済み";
  return `${ch.part}・${ch.label}まで`;
}

// review（Supabaseから取得後、この形に組み立て直す。src/api.js参照）: {
//   id, userId, startChapterId, endChapterId, date,
//   reviewText,
//   answers: [{ id, chapterId, text, reactions: [{userId, emoji}] }],   // 範囲内の全章分
//   reactions: [{userId, emoji}],       // 投稿全体へのリアクション
//   comments: [{userId, text, date}],
//   editedAt: string | null            // 編集済みなら日時
// }
// 初期シードデータは supabase/schema.sql 側に用意してある。

// ---------- 小さな汎用コンポーネント ----------

function RangeBadge({ startChapterId, endChapterId }) {
  const s = BOOK.chapters.find((c) => c.id === startChapterId);
  const e = BOOK.chapters.find((c) => c.id === endChapterId);
  if (!s || !e) return null;
  if (startChapterId === endChapterId) {
    return (
      <span className="chapter-badge">
        {s.part}・{s.label}
      </span>
    );
  }
  const sameLabel = `${s.part}・${s.label}`;
  const eLabel = s.part === e.part ? e.label : `${e.part}・${e.label}`;
  return (
    <span className="chapter-badge">
      {sameLabel} 〜 {eLabel}
    </span>
  );
}

// ---------- メインアプリ ----------

export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [newUserName, setNewUserName] = useState("");
  const [newUserAvatar, setNewUserAvatar] = useState(AVATAR_SUGGESTIONS[0]);
  const [members, setMembers] = useState([]);
  const [avatars, setAvatars] = useState({});
  const [confirmDeleteMember, setConfirmDeleteMember] = useState(null);

  // 各ユーザーの読書進捗：{ userId: chapterIndex 最後まで読んだ章のindex }
  // index 0 は「読む前」。-1 は「読む前すら未投稿」を意味する。
  // Supabaseからの取得が終わるまでは空。
  const [progress, setProgress] = useState({});

  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncError, setSyncError] = useState(null);
  const [view, setView] = useState("timeline"); // timeline | byMember | post | valueShift
  const [openReviewId, setOpenReviewId] = useState(null);
  const [valueShiftMember, setValueShiftMember] = useState(null);

  // Supabaseから全データを取得し直して画面に反映する。
  // 自分の投稿・リアクション操作の直後と、他メンバーの変更を検知した
  // Realtimeイベントの両方からこの関数を呼ぶ。
  const refresh = useCallback(async () => {
    try {
      const data = await api.fetchAll();
      setMembers(data.members);
      setAvatars(data.avatars);
      setProgress(data.progress);
      setReviews(data.reviews);
      setSyncError(null);
      return data;
    } catch (err) {
      console.error(err);
      setSyncError(
        err?.message?.includes("未設定")
          ? err.message
          : "データの取得・保存に失敗しました。通信状況を確認し、しばらくしてからやり直してください。"
      );
      return null;
    }
  }, []);

  // Realtime購読で複数のテーブル変更イベントがまとめて届いても、
  // 再取得は1回にまとめる（連投コメント等での過剰リクエストを防ぐ）。
  const refreshTimer = useRef(null);
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      refresh();
    }, 300);
  }, [refresh]);

  useEffect(() => {
    let active = true;
    refresh().finally(() => {
      if (active) setLoading(false);
    });
    const unsubscribe = api.subscribeToChanges(() => scheduleRefresh());
    return () => {
      active = false;
      unsubscribe();
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [refresh, scheduleRefresh]);

  // 編集中のreview id。nullなら新規投稿モード。
  const [editingReviewId, setEditingReviewId] = useState(null);

  const myProgressIndex = currentUser ? progress[currentUser] ?? -1 : -1;
  const nextChapterIndex = Math.min(myProgressIndex + 1, BOOK.chapters.length - 1);

  // 投稿フォーム state（範囲選択）
  const [formStartIndex, setFormStartIndex] = useState(nextChapterIndex);
  const [formEndIndex, setFormEndIndex] = useState(nextChapterIndex);
  const [formReview, setFormReview] = useState("");
  const [formAnswers, setFormAnswers] = useState({}); // { chapterId: text }
  const [formDate, setFormDate] = useState(new Date().toISOString().slice(0, 10));

  function resetFormToNext() {
    const idx = progress[currentUser] ?? -1;
    const next = Math.min(idx + 1, BOOK.chapters.length - 1);
    setFormStartIndex(next);
    setFormEndIndex(next);
    setFormReview("");
    setFormAnswers({});
    setFormDate(new Date().toISOString().slice(0, 10));
    setEditingReviewId(null);
  }

  function handleLogin(name) {
    setCurrentUser(name);
    setValueShiftMember(name);
    const idx = progress[name] ?? -1;
    const next = Math.min(idx + 1, BOOK.chapters.length - 1);
    setFormStartIndex(next);
    setFormEndIndex(next);
    setFormAnswers({});
    setEditingReviewId(null);
  }

  // 投稿カードの「編集する」から呼ばれる。フォームに既存の内容を流し込み、
  // 投稿タブへ切り替える。
  function startEditReview(review) {
    setEditingReviewId(review.id);
    setFormStartIndex(chapterIndex(review.startChapterId));
    setFormEndIndex(chapterIndex(review.endChapterId));
    setFormReview(review.reviewText);
    const answerMap = {};
    review.answers.forEach((a) => (answerMap[a.chapterId] = a.text));
    setFormAnswers(answerMap);
    setFormDate(review.date);
    setOpenReviewId(null);
    setView("post");
  }

  async function deleteReview(reviewId) {
    if (openReviewId === reviewId) setOpenReviewId(null);
    await api.deleteReview(reviewId);
    await refresh();
  }

  async function handleRegister() {
    const name = newUserName.trim();
    if (!name) return;
    if (!members.includes(name)) {
      await api.registerMember(name, newUserAvatar);
    }
    setNewUserName("");
    handleLogin(name);
    await refresh();
  }

  // メンバーを削除する。本人の投稿と、他メンバーの投稿に残る本人の
  // リアクション・コメントは、DB側のON DELETE CASCADEで自動的に整理される。
  async function deleteMember(name) {
    if (valueShiftMember === name) setValueShiftMember(null);
    setConfirmDeleteMember(null);
    await api.deleteMember(name);
    await refresh();
  }

  const rangeChapterIds = useMemo(() => {
    if (formEndIndex < formStartIndex) return [];
    return BOOK.chapters.slice(formStartIndex, formEndIndex + 1).map((c) => c.id);
  }, [formStartIndex, formEndIndex]);

  const allAnswersFilled =
    rangeChapterIds.length > 0 &&
    rangeChapterIds.every((cid) => (formAnswers[cid] || "").trim().length > 0);

  async function submitReview() {
    if (!formReview.trim() || !allAnswersFilled) return;
    const startChapterId = BOOK.chapters[formStartIndex].id;
    const endChapterId = BOOK.chapters[formEndIndex].id;
    const editingSource = editingReviewId ? reviews.find((r) => r.id === editingReviewId) : null;
    const answers = rangeChapterIds.map((cid) => ({ chapterId: cid, text: formAnswers[cid].trim() }));

    if (editingReviewId) {
      await api.updateReview(editingReviewId, {
        startChapterId,
        endChapterId,
        date: formDate,
        reviewText: formReview.trim(),
        answers,
        existingAnswers: editingSource?.answers || [],
      });
    } else {
      await api.createReview({
        userName: currentUser,
        startChapterId,
        endChapterId,
        date: formDate,
        reviewText: formReview.trim(),
        answers,
      });
    }

    await api.bumpProgress(currentUser, formEndIndex);
    resetFormToNext();
    setView("timeline");
    await refresh();
  }

  async function toggleReaction(reviewId, emoji) {
    const review = reviews.find((r) => r.id === reviewId);
    const already = Boolean(review?.reactions.some((x) => x.userId === currentUser && x.emoji === emoji));
    await api.toggleReviewReaction(reviewId, currentUser, emoji, already);
    await refresh();
  }

  async function toggleAnswerReaction(reviewId, chapterId, emoji) {
    const review = reviews.find((r) => r.id === reviewId);
    const answer = review?.answers.find((a) => a.chapterId === chapterId);
    if (!answer) return;
    const already = answer.reactions.some((x) => x.userId === currentUser && x.emoji === emoji);
    await api.toggleAnswerReaction(answer.id, currentUser, emoji, already);
    await refresh();
  }

  async function addComment(reviewId, text) {
    if (!text.trim()) return;
    await api.addComment(reviewId, currentUser, text.trim());
    await refresh();
  }

  const canView = (endChapterId) => {
    const myIdx = progress[currentUser] ?? -1;
    return chapterIndex(endChapterId) <= myIdx;
  };

  const sortedReviews = useMemo(() => [...reviews].sort((a, b) => (a.date < b.date ? 1 : -1)), [reviews]);

  // 表示中メンバー（valueShiftMember）の回答推移。ネタバレ判定は常に
  // 「閲覧者（currentUser）が読み進めた範囲か」で行う。誰の回答を見ていても同じ基準。
  const valueShiftHistory = useMemo(() => {
    const targetUser = valueShiftMember || currentUser;
    if (!targetUser) return [];
    const flat = [];
    reviews
      .filter((r) => r.userId === targetUser)
      .forEach((r) => {
        r.answers.forEach((a) => {
          flat.push({
            chapterId: a.chapterId,
            text: a.text,
            date: r.date,
            reviewId: r.id,
            reactions: a.reactions || [],
            locked: !canView(a.chapterId),
          });
        });
      });
    return flat.sort((a, b) => chapterIndex(a.chapterId) - chapterIndex(b.chapterId));
  }, [reviews, valueShiftMember, currentUser, progress]);

  // ---------- 読み込み中 ----------
  if (loading) {
    return (
      <div className="app-shell login-shell">
        <style>{GLOBAL_CSS}</style>
        <div className="login-card">
          <div className="login-emblem">🔖</div>
          <p className="app-name-eyebrow">{APP_NAME}</p>
          <p className="login-sub">読み込み中…</p>
          {syncError && <div className="sync-error-banner">{syncError}</div>}
        </div>
      </div>
    );
  }

  // ---------- ログイン画面 ----------
  if (!currentUser) {
    return (
      <div className="app-shell login-shell">
        <style>{GLOBAL_CSS}</style>
        <div className="login-card">
          {syncError && <div className="sync-error-banner">{syncError}</div>}
          <div className="login-emblem">🔖</div>
          <p className="app-name-eyebrow">{APP_NAME}</p>
          <h1 className="login-book-title">『{BOOK.title}』</h1>
          <p className="login-book-author">{BOOK.author}</p>
          <p className="login-sub">
            読みながら、感想と価値観の移り変わりを{members.length}人で記録するノート
          </p>

          <div className="login-section">
            <p className="login-label">メンバーを選ぶ</p>
            <div className="member-grid">
              {members.length === 0 && (
                <p className="member-grid-empty">メンバーがいません。下から登録してください。</p>
              )}
              {members.map((m) =>
                confirmDeleteMember === m ? (
                  <span className="member-delete-confirm" key={m}>
                    {m}を削除しますか？
                    <button className="member-delete-yes" onClick={() => deleteMember(m)}>
                      削除する
                    </button>
                    <button className="member-delete-no" onClick={() => setConfirmDeleteMember(null)}>
                      やめる
                    </button>
                  </span>
                ) : (
                  <span className="member-row" key={m}>
                    <button className="member-chip" onClick={() => handleLogin(m)}>
                      <span className="member-chip-avatar">{avatars[m] || "🔖"}</span>
                      {m}
                    </button>
                    <button
                      className="member-delete-btn"
                      onClick={() => setConfirmDeleteMember(m)}
                      aria-label={`${m}を削除`}
                      title={`${m}を削除`}
                    >
                      ×
                    </button>
                  </span>
                )
              )}
            </div>
          </div>

          <div className="login-divider">
            <span>または新しく登録</span>
          </div>

          <div className="login-register">
            <p className="login-label">アイコンを選ぶ</p>
            <div className="avatar-grid">
              {AVATAR_SUGGESTIONS.map((e) => (
                <button
                  key={e}
                  className={"avatar-chip" + (newUserAvatar === e ? " avatar-chip-active" : "")}
                  onClick={() => setNewUserAvatar(e)}
                  type="button"
                >
                  {e}
                </button>
              ))}
            </div>
            <input
              className="text-input"
              placeholder="表示名を入力"
              value={newUserName}
              onChange={(e) => setNewUserName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleRegister()}
            />
            <button className="btn-primary" onClick={handleRegister}>
              登録して入る
            </button>
          </div>
          <p className="login-footnote">パスワードは不要です。共有リンクを知る友人だけの本棚。</p>
        </div>
      </div>
    );
  }

  // ---------- メイン画面 ----------
  return (
    <div className="app-shell">
      <style>{GLOBAL_CSS}</style>
      {syncError && <div className="sync-error-banner sync-error-banner-main">{syncError}</div>}

      <header className="app-header">
        <div className="header-left">
          <span className="header-emblem">🔖</span>
          <div>
            <div className="header-book-title">『{BOOK.title}』</div>
            <div className="header-sub">{BOOK.author}｜{APP_NAME}</div>
          </div>
        </div>
        <div className="header-right">
          <span className="header-user">
            <span className="header-user-avatar">{avatars[currentUser] || "🔖"}</span>
            {currentUser} さん
          </span>
          <button className="header-switch" onClick={() => setCurrentUser(null)}>
            ユーザー切替
          </button>
        </div>
      </header>

      <nav className="tab-bar">
        <button className={"tab" + (view === "timeline" ? " tab-active" : "")} onClick={() => setView("timeline")}>
          タイムライン
        </button>
        <button className={"tab" + (view === "byMember" ? " tab-active" : "")} onClick={() => setView("byMember")}>
          進捗マップ
        </button>
        <button
          className={"tab" + (view === "post" ? " tab-active" : "")}
          onClick={() => {
            if (editingReviewId) resetFormToNext();
            setView("post");
          }}
        >
          感想を書く
        </button>
        <button
          className={"tab" + (view === "valueShift" ? " tab-active" : "")}
          onClick={() => {
            setValueShiftMember(currentUser);
            setView("valueShift");
          }}
        >
          価値観の推移
        </button>
      </nav>

      <main className="app-main">
        {view === "timeline" && (
          <TimelineView
            reviews={sortedReviews}
            currentUser={currentUser}
            canView={canView}
            openReviewId={openReviewId}
            setOpenReviewId={setOpenReviewId}
            toggleReaction={toggleReaction}
            toggleAnswerReaction={toggleAnswerReaction}
            addComment={addComment}
            progress={progress}
            members={members}
            avatars={avatars}
            onEdit={startEditReview}
            onDelete={deleteReview}
          />
        )}

        {view === "byMember" && (
          <ByMemberView
            reviews={reviews}
            members={members}
            avatars={avatars}
            progress={progress}
            currentUser={currentUser}
            canView={canView}
            openReviewId={openReviewId}
            setOpenReviewId={setOpenReviewId}
            toggleAnswerReaction={toggleAnswerReaction}
            onEdit={startEditReview}
            onDelete={deleteReview}
          />
        )}

        {view === "post" && (
          <PostView
            formStartIndex={formStartIndex}
            setFormStartIndex={setFormStartIndex}
            formEndIndex={formEndIndex}
            setFormEndIndex={setFormEndIndex}
            formReview={formReview}
            setFormReview={setFormReview}
            formAnswers={formAnswers}
            setFormAnswers={setFormAnswers}
            formDate={formDate}
            setFormDate={setFormDate}
            rangeChapterIds={rangeChapterIds}
            myProgressIndex={myProgressIndex}
            allAnswersFilled={allAnswersFilled}
            submitReview={submitReview}
            editingReviewId={editingReviewId}
            onCancelEdit={() => {
              resetFormToNext();
              setView("timeline");
            }}
          />
        )}

        {view === "valueShift" && (
          <ValueShiftView
            history={valueShiftHistory}
            members={members}
            avatars={avatars}
            currentUser={currentUser}
            selectedMember={valueShiftMember || currentUser}
            onSelectMember={setValueShiftMember}
            toggleAnswerReaction={toggleAnswerReaction}
          />
        )}
      </main>
    </div>
  );
}

// ---------- タイムライン（投稿順） ----------

function TimelineView({
  reviews,
  currentUser,
  canView,
  openReviewId,
  setOpenReviewId,
  toggleReaction,
  toggleAnswerReaction,
  addComment,
  progress,
  members,
  avatars,
  onEdit,
  onDelete,
}) {
  return (
    <div className="timeline">
      <div className="progress-strip">
        <div className="progress-strip-title">みんなの進み具合</div>
        <div className="progress-strip-list">
          {members.map((m) => {
            const idx = progress[m] ?? -1;
            const label = progressLabel(idx);
            return (
              <div className="progress-strip-item" key={m}>
                <span className="progress-strip-name">
                  <span className="progress-strip-avatar">{avatars[m] || "🔖"}</span>
                  {m}
                </span>
                <span className="progress-strip-chap">{label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {reviews.length === 0 && (
        <div className="empty-state">まだ投稿がありません。最初の感想を書いてみましょう。</div>
      )}

      {reviews.map((r) => {
        const unlocked = canView(r.endChapterId);
        const isOpen = openReviewId === r.id;
        return (
          <div className="review-card" key={r.id}>
            <div className="review-card-head">
              <span className="review-author">
                <span className="review-author-avatar">{avatars[r.userId] || "🔖"}</span>
                {r.userId}
              </span>
              <RangeBadge startChapterId={r.startChapterId} endChapterId={r.endChapterId} />
              <span className="review-date">{r.date}</span>
            </div>

            {!unlocked ? (
              <div className="spoiler-guard">
                <span className="spoiler-icon">🔒</span>
                <span>
                  あなたはまだこの範囲を読んでいません。<br />
                  ネタバレを避けるため、内容は表示されません。
                </span>
              </div>
            ) : !isOpen ? (
              <button className="reveal-btn" onClick={() => setOpenReviewId(r.id)}>
                栞を引いて感想を見る 🔖
              </button>
            ) : (
              <ReviewBody
                review={r}
                currentUser={currentUser}
                toggleReaction={toggleReaction}
                toggleAnswerReaction={toggleAnswerReaction}
                addComment={addComment}
                onEdit={onEdit}
                onDelete={onDelete}
                onClose={() => setOpenReviewId(null)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function ReviewBody({ review: r, currentUser, toggleReaction, toggleAnswerReaction, addComment, onEdit, onDelete, onClose }) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const isMine = r.userId === currentUser;

  return (
    <div className="review-body">
      <p className="review-text">{r.reviewText}</p>
      {r.editedAt && <div className="edited-tag">（{r.editedAt} に編集済み）</div>}

      <div className="answers-stack">
        {r.answers.map((a) => (
          <div className="answer-block" key={a.chapterId}>
            <div className="answer-question">
              <RangeBadge startChapterId={a.chapterId} endChapterId={a.chapterId} />
              <span className="answer-question-text">{QUESTIONS[a.chapterId]?.text}</span>
            </div>
            <div className="answer-text">「{a.text}」</div>
            <ReactionBar
              reactions={a.reactions || []}
              currentUser={currentUser}
              compact
              onToggle={(emoji) => toggleAnswerReaction(r.id, a.chapterId, emoji)}
            />
          </div>
        ))}
      </div>

      <div className="review-reaction-label">この投稿全体へのリアクション</div>
      <ReactionBar reactions={r.reactions} currentUser={currentUser} onToggle={(emoji) => toggleReaction(r.id, emoji)} />
      <CommentThread comments={r.comments} currentUser={currentUser} onAdd={(text) => addComment(r.id, text)} />

      <div className="review-footer-row">
        <button className="collapse-btn" onClick={onClose}>
          閉じる
        </button>

        {isMine && (
          <div className="owner-actions">
            <button className="owner-edit-btn" onClick={() => onEdit(r)}>
              編集する
            </button>
            {!confirmingDelete ? (
              <button className="owner-delete-btn" onClick={() => setConfirmingDelete(true)}>
                削除する
              </button>
            ) : (
              <span className="owner-delete-confirm">
                本当に削除しますか？
                <button className="owner-delete-yes" onClick={() => onDelete(r.id)}>
                  削除する
                </button>
                <button className="owner-delete-no" onClick={() => setConfirmingDelete(false)}>
                  やめる
                </button>
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ReactionBar({ reactions, currentUser, onToggle, compact }) {
  const counts = {};
  reactions.forEach((r) => {
    counts[r.emoji] = (counts[r.emoji] || 0) + 1;
  });
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <div className={"reaction-bar" + (compact ? " reaction-bar-compact" : "")}>
      {Object.entries(counts).map(([emoji, count]) => {
        const mine = reactions.some((r) => r.userId === currentUser && r.emoji === emoji);
        return (
          <button key={emoji} className={"reaction-pill" + (mine ? " reaction-pill-mine" : "")} onClick={() => onToggle(emoji)}>
            {emoji} {count}
          </button>
        );
      })}
      <div className="reaction-add-wrap">
        <button className="reaction-add-btn" onClick={() => setPickerOpen((v) => !v)}>
          + リアクション
        </button>
        {pickerOpen && (
          <div className="reaction-picker">
            {EMOJI_SUGGESTIONS.map((e) => (
              <button
                key={e}
                className="reaction-picker-item"
                onClick={() => {
                  onToggle(e);
                  setPickerOpen(false);
                }}
              >
                {e}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CommentThread({ comments, currentUser, onAdd }) {
  const [text, setText] = useState("");
  return (
    <div className="comment-thread">
      {comments.map((c, i) => (
        <div className="comment-item" key={i}>
          <span className="comment-author">{c.userId}</span>
          <span className="comment-text">{c.text}</span>
        </div>
      ))}
      <div className="comment-input-row">
        <input
          className="text-input comment-input"
          placeholder={`${currentUser} としてコメント`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onAdd(text);
              setText("");
            }
          }}
        />
        <button
          className="comment-send"
          onClick={() => {
            onAdd(text);
            setText("");
          }}
        >
          送る
        </button>
      </div>
    </div>
  );
}

// ---------- 進捗マップ（メンバー別・横並び時系列） ----------

function ByMemberView({
  reviews,
  members,
  avatars,
  progress,
  currentUser,
  canView,
  openReviewId,
  setOpenReviewId,
  toggleAnswerReaction,
  onEdit,
  onDelete,
}) {
  // メンバーごとに、投稿を章の開始位置順に並べる
  const byMember = useMemo(() => {
    const map = {};
    members.forEach((m) => (map[m] = []));
    reviews.forEach((r) => {
      if (!map[r.userId]) map[r.userId] = [];
      map[r.userId].push(r);
    });
    Object.keys(map).forEach((m) => {
      map[m].sort((a, b) => chapterIndex(a.startChapterId) - chapterIndex(b.startChapterId));
    });
    return map;
  }, [reviews, members]);

  return (
    <div className="by-member">
      <p className="by-member-intro">
        横方向がメンバー、縦方向が章の進行です。下に行くほど物語が進みます。
      </p>
      <div className="by-member-scroll">
        <div className="by-member-grid" style={{ gridTemplateColumns: `repeat(${members.length}, minmax(150px, 1fr))` }}>
          {members.map((m) => (
            <div className="by-member-col-head" key={m}>
              <span className="by-member-name">
                <span className="by-member-avatar">{avatars[m] || "🔖"}</span>
                {m}
              </span>
              <span className="by-member-progress">{progressLabel(progress[m] ?? -1)}</span>
            </div>
          ))}

          {members.map((m) => {
            const list = byMember[m] || [];
            return (
              <div className="by-member-col" key={m + "-col"}>
                {list.length === 0 && <div className="by-member-empty">まだ投稿なし</div>}
                {list.map((r) => {
                  const unlocked = canView(r.endChapterId);
                  const isOpen = openReviewId === r.id;
                  return (
                    <div className="by-member-item" key={r.id}>
                      <div className="by-member-item-head">
                        <RangeBadge startChapterId={r.startChapterId} endChapterId={r.endChapterId} />
                        <span className="by-member-date">{r.date}</span>
                      </div>
                      {!unlocked ? (
                        <div className="by-member-locked">🔒 未読のため非表示</div>
                      ) : !isOpen ? (
                        <button className="by-member-reveal" onClick={() => setOpenReviewId(r.id)}>
                          栞を引く 🔖
                        </button>
                      ) : (
                        <ByMemberOpenCard
                          review={r}
                          currentUser={currentUser}
                          toggleAnswerReaction={toggleAnswerReaction}
                          onEdit={onEdit}
                          onDelete={onDelete}
                          onClose={() => setOpenReviewId(null)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ByMemberOpenCard({ review: r, currentUser, toggleAnswerReaction, onEdit, onDelete, onClose }) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const isMine = r.userId === currentUser;

  return (
    <div className="by-member-open">
      <p className="by-member-review-text">{r.reviewText}</p>
      {r.editedAt && <div className="edited-tag edited-tag-small">（{r.editedAt} 編集済み）</div>}
      {r.answers.map((a) => (
        <div className="by-member-answer" key={a.chapterId}>
          <span className="by-member-answer-chap">{BOOK.chapters[chapterIndex(a.chapterId)].label}</span>
          「{a.text}」
          <ReactionBar
            reactions={a.reactions || []}
            currentUser={currentUser}
            compact
            onToggle={(emoji) => toggleAnswerReaction(r.id, a.chapterId, emoji)}
          />
        </div>
      ))}
      <div className="review-footer-row">
        <button className="collapse-btn" onClick={onClose}>
          閉じる
        </button>
        {isMine && (
          <div className="owner-actions">
            <button className="owner-edit-btn" onClick={() => onEdit(r)}>
              編集する
            </button>
            {!confirmingDelete ? (
              <button className="owner-delete-btn" onClick={() => setConfirmingDelete(true)}>
                削除する
              </button>
            ) : (
              <span className="owner-delete-confirm">
                削除しますか？
                <button className="owner-delete-yes" onClick={() => onDelete(r.id)}>
                  削除する
                </button>
                <button className="owner-delete-no" onClick={() => setConfirmingDelete(false)}>
                  やめる
                </button>
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- 投稿フォーム（範囲＋章ごとの人生観回答） ----------

function PostView({
  formStartIndex,
  setFormStartIndex,
  formEndIndex,
  setFormEndIndex,
  formReview,
  setFormReview,
  formAnswers,
  setFormAnswers,
  formDate,
  setFormDate,
  rangeChapterIds,
  myProgressIndex,
  allAnswersFilled,
  submitReview,
  editingReviewId,
  onCancelEdit,
}) {
  // 編集時は、元々選んでいた終了章も選択可能上限に含める
  // （編集中に他の投稿で進捗が変わっていても、自分の編集対象の範囲は保持できるように）
  const baseMax = Math.min(myProgressIndex + 1, BOOK.chapters.length - 1);
  const maxSelectable = editingReviewId ? Math.max(baseMax, formEndIndex) : baseMax;

  function handleStartChange(v) {
    const idx = Number(v);
    setFormStartIndex(idx);
    if (formEndIndex < idx) setFormEndIndex(idx);
  }

  function handleAnswerChange(chapterId, text) {
    setFormAnswers((prev) => ({ ...prev, [chapterId]: text }));
  }

  return (
    <div className="post-view">
      <div className="post-card">
        <h2 className="post-heading">{editingReviewId ? "投稿を編集する" : "どこまで読みましたか？"}</h2>
        <p className="post-desc">
          まとめ読みした場合は開始章と終了章を選べば、その範囲を一括で投稿できます。
          まだ本を読み始めていなければ「読む前」を選んで、今の価値観だけ書き込むこともできます。
        </p>

        <div className="range-row">
          <div className="range-field">
            <label className="field-label">開始章</label>
            <select className="text-input" value={formStartIndex} onChange={(e) => handleStartChange(e.target.value)}>
              {BOOK.chapters.map((c, i) => (
                <option key={c.id} value={i} disabled={i > maxSelectable}>
                  {c.part}・{c.label}
                  {i > maxSelectable ? "（未読）" : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="range-field">
            <label className="field-label">終了章</label>
            <select
              className="text-input"
              value={formEndIndex}
              onChange={(e) => setFormEndIndex(Number(e.target.value))}
            >
              {BOOK.chapters.map((c, i) => (
                <option key={c.id} value={i} disabled={i > maxSelectable || i < formStartIndex}>
                  {c.part}・{c.label}
                  {i > maxSelectable ? "（未読）" : ""}
                </option>
              ))}
            </select>
          </div>
        </div>

        <label className="field-label">読んだ日</label>
        <input type="date" className="text-input" value={formDate} onChange={(e) => setFormDate(e.target.value)} />

        <label className="field-label">
          感想（範囲全体について1つでOK・ネタバレ含んでOK・未読の人には隠れます）
        </label>
        <textarea
          className="text-input textarea"
          rows={5}
          placeholder="読んだ範囲について感じたことをまとめて書いてください"
          value={formReview}
          onChange={(e) => setFormReview(e.target.value)}
        />

        <div className="question-section">
          <div className="question-section-head">
            <div className="question-section-title">
              この範囲に含まれる人生観の問い（すべて回答必須）
            </div>
            <div className={"question-progress" + (allAnswersFilled ? " question-progress-done" : "")}>
              {rangeChapterIds.filter((cid) => (formAnswers[cid] || "").trim().length > 0).length} / {rangeChapterIds.length} 件回答済み
            </div>
          </div>
          {rangeChapterIds.map((cid) => {
            const ch = BOOK.chapters[chapterIndex(cid)];
            const q = QUESTIONS[cid];
            const isUnanswered = !(formAnswers[cid] || "").trim();
            return (
              <div className={"question-card" + (isUnanswered ? " question-card-unanswered" : "")} key={cid}>
                <div className="question-label">
                  {ch.part}・{ch.label}
                  {isUnanswered && <span className="question-unanswered-badge">未回答</span>}
                </div>
                <div className="question-text">{q.text}</div>
                <textarea
                  className="text-input textarea"
                  rows={2}
                  placeholder="この章の時点での考えを書いてください"
                  value={formAnswers[cid] || ""}
                  onChange={(e) => handleAnswerChange(cid, e.target.value)}
                />
              </div>
            );
          })}
        </div>

        <div className="post-actions">
          <button className="btn-primary btn-wide" disabled={!formReview.trim() || !allAnswersFilled} onClick={submitReview}>
            {editingReviewId ? "更新する" : "投稿する"}
          </button>
          {editingReviewId && (
            <button className="btn-cancel-edit" onClick={onCancelEdit}>
              編集をやめる
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- 価値観の推移 ----------

function ValueShiftView({
  history,
  members,
  avatars,
  currentUser,
  selectedMember,
  onSelectMember,
  toggleAnswerReaction,
}) {
  const byTheme = useMemo(() => {
    const grouped = {};
    history.forEach((r) => {
      const q = QUESTIONS[r.chapterId];
      if (!q) return;
      if (!grouped[q.theme]) grouped[q.theme] = [];
      grouped[q.theme].push({ ...r, questionText: q.text });
    });
    return grouped;
  }, [history]);

  const themeKeys = Object.keys(byTheme);
  const isSelf = selectedMember === currentUser;

  return (
    <div className="my-answers">
      <p className="my-answers-intro">
        同じテーマについて、章が進むごとに考えがどう変わったかを並べています。
        誰の推移を見ても、あなた自身がまだ読んでいない範囲はネタバレ防止のため隠れます。
      </p>

      <div className="member-select-row">
        {members.map((m) => (
          <button
            key={m}
            className={"member-select-chip" + (m === selectedMember ? " member-select-chip-active" : "")}
            onClick={() => onSelectMember(m)}
          >
            <span className="member-select-avatar">{avatars[m] || "🔖"}</span>
            {m === currentUser ? "あなた" : m}
          </button>
        ))}
      </div>

      {themeKeys.length === 0 && (
        <div className="empty-state">
          {isSelf
            ? "まだ回答がありません。「感想を書く」から投稿すると、ここに考えの変化が積み重なっていきます。"
            : `${selectedMember} さんの回答はまだありません。`}
        </div>
      )}

      {themeKeys.map((theme) => (
        <div className="theme-block" key={theme}>
          <div className="theme-title">{theme}</div>
          <div className="theme-timeline">
            {byTheme[theme].map((r, i) => (
              <div className="theme-step" key={r.chapterId + r.reviewId}>
                <div className="theme-step-marker">
                  <span className="theme-step-dot" />
                  {i < byTheme[theme].length - 1 && <span className="theme-step-line" />}
                </div>
                <div className="theme-step-body">
                  <div className="theme-step-head">
                    <RangeBadge startChapterId={r.chapterId} endChapterId={r.chapterId} />
                    <span className="theme-step-date">{r.date}</span>
                  </div>
                  {r.locked ? (
                    <div className="theme-step-locked">🔒 あなたが未読のため非表示</div>
                  ) : (
                    <>
                      <div className="theme-step-answer">「{r.text}」</div>
                      <ReactionBar
                        reactions={r.reactions}
                        currentUser={currentUser}
                        compact
                        onToggle={(emoji) => toggleAnswerReaction(r.reviewId, r.chapterId, emoji)}
                      />
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------- スタイル ----------

const GLOBAL_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@500;700&family=Noto+Sans+JP:wght@400;500;700&display=swap');

:root {
  --paper: #F7F3EC;
  --paper-deep: #EFE8DA;
  --ink: #26241F;
  --ink-soft: #5B564A;
  --indigo: #2B3A55;
  --indigo-soft: #47597c;
  --vermilion: #C0533D;
  --sage: #7A8B6F;
  --line: #DDD3BE;
}

* { box-sizing: border-box; }

.app-shell {
  min-height: 100vh;
  background: var(--paper);
  font-family: 'Noto Sans JP', sans-serif;
  color: var(--ink);
  display: flex;
  flex-direction: column;
}

.sync-error-banner {
  background: #FBEDE9;
  border: 1px solid var(--vermilion);
  color: var(--vermilion);
  border-radius: 10px;
  padding: 10px 14px;
  font-size: 12.5px;
  line-height: 1.6;
  margin-bottom: 16px;
  text-align: left;
}
.sync-error-banner-main {
  margin: 12px 14px 0;
}

/* ---------- ログイン画面 ---------- */

.login-shell {
  align-items: center;
  justify-content: center;
  padding: 24px;
  background:
    radial-gradient(circle at 15% 10%, rgba(43,58,85,0.06), transparent 45%),
    radial-gradient(circle at 85% 90%, rgba(192,83,61,0.07), transparent 45%),
    var(--paper);
}

.login-card {
  width: 100%;
  max-width: 420px;
  background: #FFFDF8;
  border: 1px solid var(--line);
  border-radius: 18px;
  padding: 36px 28px 28px;
  box-shadow: 0 18px 40px -20px rgba(43,58,85,0.35);
  text-align: center;
}

.login-emblem { font-size: 34px; margin-bottom: 6px; }

.app-name-eyebrow {
  font-size: 12px;
  letter-spacing: 0.28em;
  color: var(--vermilion);
  font-weight: 700;
  margin: 0 0 10px;
}

.login-book-title {
  font-family: 'Shippori Mincho', serif;
  font-size: 34px;
  font-weight: 700;
  margin: 0 0 4px;
  color: var(--indigo);
  letter-spacing: 0.05em;
  line-height: 1.35;
}

.login-book-author {
  font-size: 13px;
  color: var(--ink-soft);
  margin: 0 0 18px;
  letter-spacing: 0.08em;
}

.login-sub {
  font-size: 13px;
  line-height: 1.7;
  color: var(--ink-soft);
  margin: 0 0 24px;
}

.login-section { text-align: left; margin-bottom: 18px; }

.login-label {
  font-size: 12px;
  color: var(--ink-soft);
  margin: 0 0 10px;
  font-weight: 500;
}

.member-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.member-chip {
  font-family: 'Noto Sans JP', sans-serif;
  border: 1px solid var(--indigo);
  background: transparent;
  color: var(--indigo);
  padding: 8px 16px;
  border-radius: 999px;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.member-chip:hover { background: var(--indigo); color: #fff; }
.member-chip-avatar { font-size: 15px; }

.member-grid-empty {
  font-size: 12.5px;
  color: var(--ink-soft);
}

.member-row {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.member-delete-btn {
  border: 1px solid var(--line);
  background: transparent;
  color: var(--ink-soft);
  width: 24px;
  height: 24px;
  border-radius: 50%;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: border-color 0.15s, color 0.15s;
}
.member-delete-btn:hover { border-color: var(--vermilion); color: var(--vermilion); }

.member-delete-confirm {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--vermilion);
  background: #FBEDE9;
  border: 1px solid var(--vermilion);
  border-radius: 999px;
  padding: 6px 10px;
}
.member-delete-yes {
  border: none;
  background: var(--vermilion);
  color: #fff;
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 11px;
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
}
.member-delete-no {
  border: none;
  background: transparent;
  color: var(--ink-soft);
  font-size: 11px;
  cursor: pointer;
  text-decoration: underline;
  font-family: inherit;
  white-space: nowrap;
}

.avatar-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 4px;
}
.avatar-chip {
  border: 1px solid var(--line);
  background: #fff;
  border-radius: 10px;
  width: 36px;
  height: 36px;
  font-size: 17px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color 0.15s, background 0.15s;
}
.avatar-chip-active { border-color: var(--vermilion); background: #FBEDE9; }

.login-divider {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--ink-soft);
  font-size: 11px;
  margin: 18px 0;
}
.login-divider::before, .login-divider::after {
  content: "";
  flex: 1;
  height: 1px;
  background: var(--line);
}

.login-register { display: flex; flex-direction: column; gap: 10px; text-align: left; }

.login-footnote {
  margin-top: 18px;
  font-size: 11px;
  color: var(--ink-soft);
  opacity: 0.8;
}

/* ---------- 共通フォーム部品 ---------- */

.text-input {
  width: 100%;
  border: 1px solid var(--line);
  background: #fff;
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 14px;
  font-family: inherit;
  color: var(--ink);
  outline: none;
  transition: border-color 0.15s;
}
.text-input:focus { border-color: var(--indigo); }
.textarea { resize: vertical; line-height: 1.6; }

.btn-primary {
  background: var(--indigo);
  color: #fff;
  border: none;
  border-radius: 10px;
  padding: 11px 18px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.15s, transform 0.1s;
}
.btn-primary:hover { background: var(--indigo-soft); }
.btn-primary:active { transform: scale(0.98); }
.btn-primary:disabled { background: #B9B2A0; cursor: not-allowed; }
.btn-wide { width: 100%; margin-top: 20px; padding: 13px; font-size: 15px; }

/* ---------- ヘッダー / タブ ---------- */

.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  background: #FFFDF8;
  border-bottom: 1px solid var(--line);
  position: sticky;
  top: 0;
  z-index: 10;
}
.header-left { display: flex; align-items: center; gap: 10px; }
.header-emblem { font-size: 22px; }
.header-book-title {
  font-family: 'Shippori Mincho', serif;
  font-size: 19px;
  font-weight: 700;
  color: var(--indigo);
  letter-spacing: 0.03em;
  line-height: 1.3;
}
.header-sub { font-size: 11px; color: var(--ink-soft); }
.header-right { display: flex; align-items: center; gap: 10px; }
.header-user { font-size: 12px; color: var(--ink-soft); display: inline-flex; align-items: center; gap: 5px; }
.header-user-avatar { font-size: 16px; }
.header-switch {
  border: 1px solid var(--line);
  background: transparent;
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 11px;
  color: var(--ink-soft);
  cursor: pointer;
}

.tab-bar {
  display: flex;
  gap: 4px;
  padding: 8px 10px 0;
  background: #FFFDF8;
  border-bottom: 1px solid var(--line);
  position: sticky;
  top: 57px;
  z-index: 9;
  overflow-x: auto;
}
.tab {
  flex: 1;
  min-width: 84px;
  border: none;
  background: transparent;
  padding: 10px 6px;
  font-size: 12.5px;
  font-family: inherit;
  color: var(--ink-soft);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: color 0.15s, border-color 0.15s;
  white-space: nowrap;
}
.tab-active { color: var(--indigo); border-bottom-color: var(--vermilion); font-weight: 700; }

.app-main {
  flex: 1;
  max-width: 720px;
  width: 100%;
  margin: 0 auto;
  padding: 18px 14px 60px;
}

/* ---------- タイムライン ---------- */

.progress-strip {
  background: #FFFDF8;
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 14px 16px;
  margin-bottom: 18px;
}
.progress-strip-title {
  font-size: 12px;
  color: var(--ink-soft);
  margin-bottom: 8px;
  font-weight: 500;
}
.progress-strip-list { display: flex; flex-direction: column; gap: 6px; }
.progress-strip-item {
  display: flex;
  justify-content: space-between;
  font-size: 12.5px;
}
.progress-strip-name { color: var(--ink); font-weight: 500; display: inline-flex; align-items: center; gap: 5px; }
.progress-strip-avatar { font-size: 13px; }
.progress-strip-chap { color: var(--ink-soft); }

.empty-state {
  text-align: center;
  color: var(--ink-soft);
  font-size: 13px;
  padding: 40px 20px;
  line-height: 1.7;
}

.review-card {
  background: #FFFDF8;
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 16px;
  margin-bottom: 14px;
}
.review-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}
.review-author { font-weight: 700; font-size: 13.5px; color: var(--indigo); display: inline-flex; align-items: center; gap: 5px; }
.review-author-avatar { font-size: 15px; }
.chapter-badge {
  font-size: 11px;
  background: var(--paper-deep);
  color: var(--ink-soft);
  padding: 3px 9px;
  border-radius: 999px;
  white-space: nowrap;
}
.review-date { font-size: 11px; color: var(--ink-soft); margin-left: auto; }

.spoiler-guard {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--paper-deep);
  border: 1px dashed var(--line);
  border-radius: 10px;
  padding: 14px;
  font-size: 12.5px;
  color: var(--ink-soft);
  line-height: 1.6;
}
.spoiler-icon { font-size: 18px; }

.reveal-btn {
  width: 100%;
  border: 1px solid var(--vermilion);
  color: var(--vermilion);
  background: #fff;
  border-radius: 10px;
  padding: 12px;
  font-size: 13.5px;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.reveal-btn:hover { background: var(--vermilion); color: #fff; }

.review-body { animation: unfold 0.25s ease; }
@keyframes unfold {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}
.review-text {
  font-size: 14px;
  line-height: 1.8;
  margin: 0 0 12px;
  white-space: pre-wrap;
}

.answers-stack { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }

.answer-block {
  background: var(--paper-deep);
  border-left: 3px solid var(--sage);
  border-radius: 8px;
  padding: 10px 12px;
}
.answer-question {
  display: flex;
  align-items: baseline;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 11.5px;
  color: var(--ink-soft);
  margin-bottom: 4px;
}
.answer-question-text { color: var(--ink-soft); }
.answer-text {
  font-size: 13.5px;
  color: var(--ink);
  line-height: 1.6;
  margin-bottom: 6px;
}

.review-reaction-label {
  font-size: 11px;
  color: var(--ink-soft);
  margin-bottom: 6px;
}

.reaction-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
  position: relative;
}
.reaction-bar-compact { margin-bottom: 0; }
.reaction-bar-compact .reaction-pill,
.reaction-bar-compact .reaction-add-btn {
  padding: 2px 8px;
  font-size: 11px;
}
.reaction-pill {
  border: 1px solid var(--line);
  background: #fff;
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
}
.reaction-pill-mine { border-color: var(--vermilion); background: #FBEDE9; }
.reaction-add-wrap { position: relative; }
.reaction-add-btn {
  border: 1px dashed var(--line);
  background: transparent;
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 12px;
  color: var(--ink-soft);
  cursor: pointer;
  font-family: inherit;
}
.reaction-picker {
  position: absolute;
  top: 30px;
  left: 0;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 6px;
  display: flex;
  gap: 4px;
  box-shadow: 0 8px 20px -8px rgba(0,0,0,0.25);
  z-index: 5;
}
.reaction-picker-item {
  border: none;
  background: transparent;
  font-size: 16px;
  padding: 4px 6px;
  cursor: pointer;
  border-radius: 6px;
}
.reaction-picker-item:hover { background: var(--paper-deep); }

.comment-thread {
  border-top: 1px solid var(--line);
  padding-top: 10px;
}
.comment-item {
  font-size: 12.5px;
  margin-bottom: 6px;
  line-height: 1.6;
}
.comment-author { font-weight: 700; color: var(--indigo); margin-right: 6px; }
.comment-text { color: var(--ink); }
.comment-input-row { display: flex; gap: 6px; margin-top: 8px; }
.comment-input { flex: 1; }
.comment-send {
  border: none;
  background: var(--indigo);
  color: #fff;
  border-radius: 8px;
  padding: 0 14px;
  font-size: 12.5px;
  cursor: pointer;
  font-family: inherit;
}

.collapse-btn {
  margin-top: 10px;
  border: none;
  background: transparent;
  color: var(--ink-soft);
  font-size: 12px;
  cursor: pointer;
  text-decoration: underline;
  font-family: inherit;
  padding: 0;
}

.edited-tag {
  font-size: 10.5px;
  color: var(--ink-soft);
  opacity: 0.75;
  margin: -6px 0 10px;
}
.edited-tag-small { margin: -4px 0 8px; }

.review-footer-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 10px;
}
.owner-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.owner-edit-btn {
  border: 1px solid var(--indigo);
  background: transparent;
  color: var(--indigo);
  border-radius: 8px;
  padding: 5px 12px;
  font-size: 11.5px;
  cursor: pointer;
  font-family: inherit;
}
.owner-edit-btn:hover { background: var(--indigo); color: #fff; }
.owner-delete-btn {
  border: 1px solid var(--vermilion);
  background: transparent;
  color: var(--vermilion);
  border-radius: 8px;
  padding: 5px 12px;
  font-size: 11.5px;
  cursor: pointer;
  font-family: inherit;
}
.owner-delete-btn:hover { background: var(--vermilion); color: #fff; }
.owner-delete-confirm {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--vermilion);
}
.owner-delete-yes {
  border: none;
  background: var(--vermilion);
  color: #fff;
  border-radius: 6px;
  padding: 4px 9px;
  font-size: 11px;
  cursor: pointer;
  font-family: inherit;
}
.owner-delete-no {
  border: none;
  background: transparent;
  color: var(--ink-soft);
  font-size: 11px;
  cursor: pointer;
  text-decoration: underline;
  font-family: inherit;
}

.post-actions { display: flex; flex-direction: column; gap: 8px; }
.btn-cancel-edit {
  border: none;
  background: transparent;
  color: var(--ink-soft);
  font-size: 12px;
  cursor: pointer;
  text-decoration: underline;
  font-family: inherit;
  padding: 4px;
}

/* ---------- 進捗マップ（メンバー別横並び） ---------- */

.by-member-intro {
  font-size: 12.5px;
  color: var(--ink-soft);
  line-height: 1.7;
  margin-bottom: 14px;
}
.by-member-scroll {
  overflow-x: auto;
  padding-bottom: 8px;
}
.by-member-grid {
  display: grid;
  gap: 10px;
  min-width: 560px;
}
.by-member-col-head {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 10px 6px;
  background: var(--indigo);
  color: #fff;
  border-radius: 10px;
  position: sticky;
  top: 0;
}
.by-member-name { font-weight: 700; font-size: 13px; display: inline-flex; align-items: center; gap: 5px; }
.by-member-avatar { font-size: 14px; }
.by-member-progress { font-size: 10.5px; opacity: 0.85; }

.by-member-col {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-left: 1px dashed var(--line);
  padding: 0 6px 6px;
}
.by-member-empty {
  font-size: 11px;
  color: var(--ink-soft);
  text-align: center;
  padding: 14px 0;
  opacity: 0.7;
}
.by-member-item {
  background: #FFFDF8;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 10px;
}
.by-member-item-head {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 8px;
}
.by-member-date { font-size: 10px; color: var(--ink-soft); }
.by-member-locked {
  font-size: 11px;
  color: var(--ink-soft);
  background: var(--paper-deep);
  border-radius: 8px;
  padding: 8px;
  text-align: center;
}
.by-member-reveal {
  width: 100%;
  border: 1px solid var(--vermilion);
  color: var(--vermilion);
  background: #fff;
  border-radius: 8px;
  padding: 8px;
  font-size: 11.5px;
  font-family: inherit;
  cursor: pointer;
}
.by-member-reveal:hover { background: var(--vermilion); color: #fff; }
.by-member-open { animation: unfold 0.2s ease; }
.by-member-review-text {
  font-size: 12.5px;
  line-height: 1.6;
  margin: 0 0 8px;
}
.by-member-answer {
  font-size: 11.5px;
  background: var(--paper-deep);
  border-left: 3px solid var(--sage);
  border-radius: 6px;
  padding: 6px 8px;
  margin-bottom: 6px;
  line-height: 1.5;
}
.by-member-answer .reaction-bar-compact { margin-top: 6px; }
.by-member-answer-chap {
  font-weight: 700;
  color: var(--indigo);
  margin-right: 4px;
}

/* ---------- 投稿フォーム ---------- */

.post-card {
  background: #FFFDF8;
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 20px;
}
.post-heading {
  font-family: 'Shippori Mincho', serif;
  font-size: 18px;
  color: var(--indigo);
  margin: 0 0 6px;
}
.post-desc {
  font-size: 12px;
  color: var(--ink-soft);
  margin: 0 0 16px;
  line-height: 1.6;
}
.range-row {
  display: flex;
  gap: 10px;
}
.range-field { flex: 1; }
.field-label {
  display: block;
  font-size: 12px;
  color: var(--ink-soft);
  margin: 14px 0 6px;
  font-weight: 500;
}
.field-label:first-of-type { margin-top: 0; }

.question-section { margin-top: 20px; }
.question-section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.question-section-title {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--vermilion);
}
.question-progress {
  font-size: 11px;
  color: var(--ink-soft);
  font-weight: 500;
}
.question-progress-done { color: var(--sage); }
.question-card {
  background: var(--paper-deep);
  border-radius: 10px;
  padding: 14px;
  margin-bottom: 12px;
  border: 1px solid transparent;
  transition: border-color 0.15s;
}
.question-card-unanswered { border-color: var(--vermilion); }
.question-label {
  font-size: 11px;
  color: var(--indigo);
  font-weight: 700;
  margin-bottom: 4px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.question-unanswered-badge {
  font-size: 10px;
  font-weight: 700;
  color: #fff;
  background: var(--vermilion);
  padding: 1px 7px;
  border-radius: 999px;
}
.question-text {
  font-size: 13.5px;
  color: var(--ink);
  margin-bottom: 10px;
  line-height: 1.6;
}

/* ---------- 価値観の推移 ---------- */

.member-select-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 22px;
}
.member-select-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--line);
  background: #FFFDF8;
  color: var(--ink-soft);
  padding: 7px 14px;
  border-radius: 999px;
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}
.member-select-chip-active {
  border-color: var(--indigo);
  color: var(--indigo);
  background: #EEF1F7;
  font-weight: 700;
}
.member-select-avatar { font-size: 14px; }

.my-answers-intro {
  font-size: 12.5px;
  color: var(--ink-soft);
  line-height: 1.7;
  margin-bottom: 20px;
}
.theme-block { margin-bottom: 28px; }
.theme-title {
  font-family: 'Shippori Mincho', serif;
  font-size: 16px;
  color: var(--indigo);
  margin-bottom: 12px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--line);
}
.theme-timeline { display: flex; flex-direction: column; }
.theme-step { display: flex; gap: 12px; }
.theme-step-marker {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 14px;
}
.theme-step-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--vermilion);
  flex-shrink: 0;
  margin-top: 4px;
}
.theme-step-line {
  flex: 1;
  width: 2px;
  background: var(--line);
  margin-top: 2px;
}
.theme-step-body { padding-bottom: 18px; flex: 1; }
.theme-step-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.theme-step-date { font-size: 11px; color: var(--ink-soft); }
.theme-step-answer {
  font-size: 13.5px;
  background: var(--paper-deep);
  border-radius: 8px;
  padding: 10px 12px;
  line-height: 1.6;
  margin-bottom: 6px;
}
.theme-step-locked {
  font-size: 11.5px;
  color: var(--ink-soft);
  background: var(--paper-deep);
  border: 1px dashed var(--line);
  border-radius: 8px;
  padding: 10px 12px;
}

@media (max-width: 420px) {
  .app-main { padding: 14px 10px 50px; }
  .login-card { padding: 28px 20px 22px; }
  .range-row { flex-direction: column; gap: 0; }
}
`;
