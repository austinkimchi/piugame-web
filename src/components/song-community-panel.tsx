"use client";

import { Archive, BookmarkCheck, ChevronDown, MessageSquare, Plus, Save, Send, Tag, ThumbsDown, ThumbsUp, Trash2, SquarePlay } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";

import { UsernamePrompt } from "@/components/username-prompt";
import { useAdminViewMode } from "@/lib/admin-view-mode";
import type { CommunityPost, PublicUser, SongCommunityState } from "@/lib/auth";
import type { PublicSong } from "@/lib/types";

interface SongCommunityPanelProps {
  user: PublicUser | null;
  song: PublicSong;
  initialState: SongCommunityState;
  selectedChartToken: string | null;
  afterCommunity?: ReactNode;
  readOnly?: boolean;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";
type MessageScope = "tag" | "post" | "note";

export function SongCommunityPanel({ user, song, initialState, selectedChartToken, afterCommunity, readOnly = false }: SongCommunityPanelProps) {
  const { viewingAsRegular } = useAdminViewMode();
  const [note, setNote] = useState(initialState.note);
  const [tagInput, setTagInput] = useState("");
  const [communityTags, setCommunityTags] = useState(initialState.communityTags);
  const [tagVotes, setTagVotes] = useState(initialState.tagVotes);
  const [posts, setPosts] = useState(initialState.posts);
  const [postBody, setPostBody] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [notesOpen, setNotesOpen] = useState(Boolean(initialState.note));
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [tagMessage, setTagMessage] = useState("");
  const [postMessage, setPostMessage] = useState("");
  const [noteMessage, setNoteMessage] = useState("");
  const selectedTags = useMemo(
    () => communityTags.filter((tag) => tag.chartToken === selectedChartToken),
    [communityTags, selectedChartToken],
  );
  const userVotesForChart = useMemo(
    () => tagVotes.filter((vote) => vote.chartToken === selectedChartToken),
    [selectedChartToken, tagVotes],
  );
  const canUseCommunity = Boolean(user?.username && !user.mutedUntil && !readOnly);
  const canViewModeration = !readOnly && (!user?.roles.includes("admin") || !viewingAsRegular);
  const activeUserPost = useMemo(() => posts.find((post) => post.authorId === user?.id && post.canArchive) ?? null, [posts, user?.id]);
  const canCreatePost = canUseCommunity && Boolean(selectedChartToken) && !activeUserPost;

  const applyState = useCallback((state: SongCommunityState) => {
    setNote(state.note);
    setCommunityTags(state.communityTags);
    setTagVotes(state.tagVotes);
    setPosts(state.posts);
  }, []);

  useEffect(() => {
    if (!selectedChartToken) {
      return;
    }

    let cancelled = false;
    const params = new URLSearchParams({ chart: selectedChartToken });

    async function loadChartCommunity() {
      const response = await fetch(`/api/songs/${encodeURIComponent(song.slug)}/community?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      const state = (await response.json()) as SongCommunityState;
      if (cancelled) {
        return;
      }
      applyState(state);
      setNotesOpen(Boolean(state.note));
    }

    void loadChartCommunity();

    return () => {
      cancelled = true;
    };
  }, [applyState, selectedChartToken, song.slug]);

  function clearMessages() {
    setTagMessage("");
    setPostMessage("");
    setNoteMessage("");
  }

  function setScopedMessage(scope: MessageScope, value: string) {
    if (scope === "tag") {
      setTagMessage(value);
    } else if (scope === "post") {
      setPostMessage(value);
    } else {
      setNoteMessage(value);
    }
  }

  async function mutate(action: string, payload: Record<string, unknown>, scope: MessageScope) {
    if (!user) {
      return null;
    }

    setStatus("saving");
    clearMessages();
    const response = await fetch(`/api/songs/${encodeURIComponent(song.slug)}/community`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, chartToken: selectedChartToken, ...payload }),
    });
    const body = (await response.json()) as { state?: SongCommunityState; error?: string };
    if (!response.ok || !body.state) {
      setStatus("error");
      setScopedMessage(scope, body.error ?? "Could not save right now.");
      return null;
    }

    applyState(body.state);
    setStatus("saved");
    window.setTimeout(() => setStatus("idle"), 1200);
    return body.state;
  }

  async function addTag() {
    const tag = tagInput.trim();
    if (!tag || !selectedChartToken) {
      setStatus("error");
      clearMessages();
      setTagMessage(selectedChartToken ? "Add a tag first." : "Select a chart before adding a tag.");
      return;
    }
    const state = await mutate("add-tag", { chartToken: selectedChartToken, tag }, "tag");
    if (state) {
      setTagInput("");
    }
  }

  async function voteTag(tag: string, vote: 1 | -1) {
    if (!selectedChartToken) {
      return;
    }
    await mutate("vote-tag", { chartToken: selectedChartToken, tag, vote }, "tag");
  }

  async function saveNote() {
    if (!selectedChartToken) {
      setStatus("error");
      clearMessages();
      setNoteMessage("Select a chart before saving a note.");
      return;
    }
    await mutate("note", { note }, "note");
  }

  async function createPost() {
    if (!selectedChartToken) {
      setStatus("error");
      clearMessages();
      setPostMessage("Select a chart before posting.");
      return;
    }
    const state = await mutate("create-post", { body: postBody, youtubeUrl, caption }, "post");
    if (state) {
      setPostBody("");
      setYoutubeUrl("");
      setCaption("");
    }
  }

  async function deletePost(post: CommunityPost) {
    await mutate("delete-post", { postId: post.id }, "post");
  }

  async function archivePost(post: CommunityPost) {
    await mutate("archive-post", { postId: post.id }, "note");
  }

  async function removePost(event: MouseEvent<HTMLButtonElement>, post: CommunityPost) {
    const notes = event.shiftKey ? "" : window.prompt("Moderator notes for removing this post") ?? "";
    await mutate("remove-post", { postId: post.id, notes }, "post");
  }

  async function muteUser(event: MouseEvent<HTMLButtonElement>, post: CommunityPost) {
    const notes = event.shiftKey ? "" : window.prompt(`Moderator notes for muting ${post.username}`) ?? "";
    await mutate("mute-user", { targetUserId: post.authorId, notes, days: 7 }, "post");
  }

  return (
    <>
      <section className="mt-6 border-b border-[#d9ded2] pb-6">
        <div className="mb-3 flex items-center gap-2 text-sm font-black uppercase text-[#596153]">
          <Tag aria-hidden="true" size={17} />
          Tags
        </div>
        <div className="flex flex-wrap gap-2">
          {selectedTags.length > 0 ? (
            selectedTags.map((tag) => (
              <span key={`${tag.chartToken}:${tag.tag}`} className={`inline-flex items-center gap-2 border px-3 py-1.5 text-sm font-bold ${tag.mine ? "border-[#1f7a43] bg-[#e7f6eb] text-[#1f5f39]" : "border-[#d8dfd1] bg-white text-[#3d4638]"}`}>
                {tag.tag}
                <span className="text-xs text-[#66705f]">{tag.score}</span>
                {canUseCommunity && tag.myVote === null ? (
                  <>
                    <button className="text-[#66705f] hover:text-[#1f7a43]" onClick={() => void voteTag(tag.tag, 1)} title={`Upvote ${tag.tag}`} type="button">
                      <ThumbsUp aria-hidden="true" size={13} />
                    </button>
                    <button className="text-[#66705f] hover:text-[#9b2b1f]" onClick={() => void voteTag(tag.tag, -1)} title={`Downvote ${tag.tag}`} type="button">
                      <ThumbsDown aria-hidden="true" size={13} />
                    </button>
                  </>
                ) : null}
              </span>
            ))
          ) : (
            <p className="text-sm font-medium text-[#66705f]">
              {selectedChartToken ? `No visible community tags for ${selectedChartToken} yet.` : "Choose a chart to view its community tags."}
            </p>
          )}
        </div>

        {!readOnly && user && !user.username ? <div className="mt-4"><UsernamePrompt /></div> : null}
        {!readOnly && user?.mutedUntil ? <p className="mt-4 text-sm font-bold text-[#9b2b1f]">You are muted from community actions until {new Date(user.mutedUntil).toLocaleDateString()}.</p> : null}
        {canUseCommunity ? (
          <div className="mt-4 flex gap-2">
            <input
              className="min-w-0 flex-1 border border-[#d8dfd1] bg-white px-3 py-2 text-sm font-bold text-[#171916] outline-none focus:border-[#28c950]"
              maxLength={40}
              onChange={(event) => setTagInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void addTag();
                }
              }}
              disabled={!selectedChartToken}
              placeholder={selectedChartToken ? `brackets, crossover, drill for ${selectedChartToken}` : "Select a chart token above first"}
              value={tagInput}
            />
            <button className="inline-flex h-10 w-10 shrink-0 items-center justify-center bg-[#171916] text-white hover:bg-[#28c950] disabled:bg-[#aeb8a5]" disabled={!selectedChartToken} onClick={() => void addTag()} title="Add tag" type="button">
              <Plus aria-hidden="true" size={18} />
            </button>
          </div>
        ) : null}
        {tagMessage ? <p className="mt-3 text-sm font-bold text-[#e3412f]">{tagMessage}</p> : null}
        {userVotesForChart.length > 0 ? (
          <details className="mt-4 text-sm">
            <summary className="cursor-pointer font-black uppercase text-[#596153]">My tag votes</summary>
            <div className="mt-2 flex flex-wrap gap-2">
              {userVotesForChart.map((vote) => (
                <span key={`${vote.chartToken}:${vote.tag}`} className="border border-[#d8dfd1] bg-[#f7f8f2] px-2 py-1 text-xs font-bold text-[#596153]">
                  {vote.vote > 0 ? "+" : "-"} {vote.tag}
                </span>
              ))}
            </div>
          </details>
        ) : null}
      </section>

      <section className="mt-6 border-b border-[#d9ded2] pb-6">
        <div className="mb-3 flex items-center gap-2 text-sm font-black uppercase text-[#596153]">
          <BookmarkCheck aria-hidden="true" size={17} />
          Community
        </div>
        {!readOnly && !user ? (
          <div className="border border-[#d8dfd1] bg-white p-4">
            <p className="text-sm font-bold text-[#3d4638]">Sign in to post comments, add videos, contribute tags, and keep private notes.</p>
          </div>
        ) : null}
        {canCreatePost ? (
          <div className="mb-5 grid gap-3 border border-[#d8dfd1] bg-white p-4">
            <textarea
              className="min-h-24 resize-y border border-[#d8dfd1] bg-[#f7f8f2] p-3 text-sm font-medium text-[#171916] outline-none focus:border-[#28c950]"
              maxLength={1600}
              onChange={(event) => setPostBody(event.target.value)}
              placeholder="Talk about the map, patterns, tech, or chart feel."
              value={postBody}
            />
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.75fr)_auto]">
              <input className="min-h-10 border border-[#d8dfd1] bg-[#f7f8f2] px-3 text-sm font-bold outline-none focus:border-[#28c950]" onChange={(event) => setYoutubeUrl(event.target.value)} placeholder="YouTube URL optional" value={youtubeUrl} />
              <input className="min-h-10 border border-[#d8dfd1] bg-[#f7f8f2] px-3 text-sm font-bold outline-none focus:border-[#28c950]" onChange={(event) => setCaption(event.target.value)} placeholder="Caption optional" value={caption} />
              <button className="inline-flex min-h-10 items-center justify-center gap-2 bg-[#171916] px-4 text-sm font-black text-white hover:bg-[#28c950]" onClick={() => void createPost()} type="button">
                <Send aria-hidden="true" size={16} />
                Post
              </button>
            </div>
          </div>
        ) : null}
        {canUseCommunity && activeUserPost ? (
          <p className="mb-5 border border-[#d8dfd1] bg-white p-3 text-sm font-bold text-[#596153]">
            Archive your current post in Private Notes before posting again.
          </p>
        ) : null}
        {postMessage ? <p className="mb-5 text-sm font-bold text-[#e3412f]">{postMessage}</p> : null}
        <div className="grid gap-4">
          {posts.length > 0 ? posts.map((post) => (
            <article key={post.id} className="border-l-4 border-[#d8dfd1] bg-white p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-black text-[#171916]">{post.username}</p>
                  <p className="text-xs font-bold uppercase text-[#66705f]">{new Date(post.createdAt).toLocaleDateString()}</p>
                </div>
                <div className="flex gap-2">
                  {!readOnly && post.canArchive ? (
                    <button aria-label="Archive post" className="inline-flex h-8 w-8 items-center justify-center text-[#66705f] hover:text-[#28c950] disabled:opacity-55" disabled={status === "saving"} onClick={() => void archivePost(post)} title="Archive post" type="button">
                      <Archive aria-hidden="true" size={14} />
                    </button>
                  ) : null}
                  {!readOnly && post.canDelete && (!post.canModerate || !canViewModeration) ? (
                    <button aria-label="Delete post" className="inline-flex h-8 w-8 items-center justify-center text-[#66705f] hover:text-[#9b2b1f]" onClick={() => void deletePost(post)} title="Delete post" type="button">
                      <Trash2 aria-hidden="true" size={14} />
                    </button>
                  ) : null}
                  {post.canModerate && canViewModeration ? (
                    <>
                      <button className="text-xs font-black uppercase text-[#9b2b1f] hover:text-[#171916]" onClick={(event) => void removePost(event, post)} title="Hold Shift to skip notes" type="button">
                        Remove
                      </button>
                      <button className="text-xs font-black uppercase text-[#9b2b1f] hover:text-[#171916]" onClick={(event) => void muteUser(event, post)} title="Hold Shift to skip notes" type="button">
                        Mute
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
              {post.body ? <p className="whitespace-pre-wrap text-sm font-medium leading-6 text-[#3d4638]">{post.body}</p> : null}
              {post.youtubeVideoId ? (
                <div className="mt-3 overflow-hidden border border-[#d8dfd1] bg-[#11130f]">
                  <iframe
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                    className="aspect-video w-full"
                    referrerPolicy="strict-origin-when-cross-origin"
                    src={`https://www.youtube.com/embed/${post.youtubeVideoId}`}
                    title={post.caption ?? "Community YouTube video"}
                  />
                </div>
              ) : null}
              {post.caption ? <p className="mt-2 inline-flex items-center gap-2 text-xs font-bold text-[#66705f]"><SquarePlay aria-hidden="true" size={14} />{post.caption}</p> : null}
            </article>
          )) : <p className="text-sm font-medium text-[#66705f]">No community posts yet.</p>}
        </div>
      </section>

      {afterCommunity}

      {!readOnly && user ? (
        <section className="mt-6 border-b border-[#d9ded2] pb-6">
          <button className="flex w-full items-center justify-between gap-3 text-left text-sm font-black uppercase text-[#596153]" onClick={() => setNotesOpen((value) => !value)} type="button">
            <span className="inline-flex items-center gap-2">
              <MessageSquare aria-hidden="true" size={17} />
              Private Notes
            </span>
            <ChevronDown aria-hidden="true" className={`transition ${notesOpen ? "rotate-180" : ""}`} size={17} />
          </button>
          {notesOpen ? (
            <div className="mt-3">
              <textarea
                className="min-h-32 w-full resize-y border border-[#d8dfd1] bg-white p-3 text-sm font-medium text-[#171916] outline-none focus:border-[#28c950]"
                maxLength={4000}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Chart goals, pattern reminders, session notes..."
                value={note}
              />
              <div className="mt-3 flex items-center justify-between gap-3">
                <p className={`text-sm font-bold ${noteMessage ? "text-[#e3412f]" : "text-[#66705f]"}`}>{noteMessage || (status === "saved" ? "Saved." : `${note.length}/4000`)}</p>
                <button className="inline-flex items-center gap-2 bg-[#171916] px-4 py-2 text-sm font-black text-white hover:bg-[#28c950] disabled:bg-[#aeb8a5]" disabled={status === "saving" || !user.username} onClick={() => void saveNote()} type="button">
                  <Save aria-hidden="true" size={17} />
                  Save note
                </button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
