import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  MessageSquare,
  StickyNote,
  X,
  Send,
  Trash2,
  Compass,
  Clock,
  Loader2,
  CornerDownRight,
  Reply,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppSettings } from "@/context/AppSettingsContext";
import { useLanguage } from "@/context/LanguageContext";
import {
  BookComment,
  getOrCreateGuestUser,
  getLocalNotes,
  saveLocalNote,
  deleteLocalNote,
  fetchCloudComments,
  postCloudComment,
  deleteCloudComment,
} from "@/lib/commentsStorage";
import { toast } from "sonner";

interface ReaderNotesSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  bookId: string;
  bookTitle?: string;
  isBookshelf?: boolean;
  currentPage: number; // 0-based
  totalPages: number;
  onNavigateToPage: (pageNumber: number) => void; // 1-based page number
}

export const ReaderNotesSidebar: React.FC<ReaderNotesSidebarProps> = ({
  isOpen,
  onClose,
  bookId,
  bookTitle,
  isBookshelf = false,
  currentPage,
  totalPages,
  onNavigateToPage,
}) => {
  const { user } = useAppSettings();
  const { t, formatDate } = useLanguage();
  const [comments, setComments] = useState<BookComment[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [inputText, setInputText] = useState<string>("");
  const [replyingTo, setReplyingTo] = useState<BookComment | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);

  // Close float window on outside click / tap
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement;
      if (sidebarRef.current && sidebarRef.current.contains(target)) {
        return;
      }
      if (target.closest("#reader-notes-toggle-btn") || target.closest("#reader-notes-toggle-btn-fullscreen")) {
        return;
      }
      onClose();
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [isOpen, onClose]);

  const displayCurrentPageNumber = currentPage + 1;

  // Load comments / notes automatically on open
  const loadNotes = async () => {
    if (!bookId) return;
    setIsLoading(true);
    try {
      if (isBookshelf) {
        // Load cloud comments from R2 / API
        const cloudList = await fetchCloudComments(bookId);
        setComments(cloudList);
      } else {
        // Load local notes
        const localList = getLocalNotes(bookId);
        setComments(localList);
      }
    } catch (err) {
      console.error("Error loading reader notes:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadNotes();
    }
  }, [isOpen, bookId, isBookshelf]);

  // Start discussion / reply to a tapped comment
  const handleStartReply = (note: BookComment) => {
    setReplyingTo(note);
    if (note.page > 0 && note.page !== displayCurrentPageNumber) {
      onNavigateToPage(note.page);
    }
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 50);
  };

  // Handle Note / Comment Submission
  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = inputText.trim();
    if (!trimmed) {
      toast.error(t("enterNotePrompt"));
      return;
    }

    const notePage = replyingTo?.page ? replyingTo.page : displayCurrentPageNumber;

    if (isBookshelf) {
      // Bookshelf book: upload to R2 (signed-in user OR auto-generated guest reader)
      setIsSubmitting(true);
      try {
        let authorName = "Reader";
        let authorId = "anonymous";
        let avatarUrl: string | undefined = undefined;

        if (user) {
          authorName = user.name || user.email?.split("@")[0] || "Reader";
          authorId = user.uid || user.email || "user";
          avatarUrl = user.avatarUrl || user.photoURL;
        } else {
          // Auto-generate guest reader profile
          const guest = getOrCreateGuestUser();
          authorName = guest.name;
          authorId = guest.id;
        }

        const result = await postCloudComment({
          bookId,
          bookTitle,
          page: notePage,
          content: trimmed,
          userId: authorId,
          userName: authorName,
          userAvatar: avatarUrl,
          replyToId: replyingTo ? replyingTo.id : undefined,
          replyToName: replyingTo ? replyingTo.userName : undefined,
          replyToSnippet: replyingTo ? replyingTo.content.slice(0, 80) : undefined,
        });

        if (result.success && result.comment) {
          setComments((prev) => [result.comment!, ...prev.filter((c) => c.id !== result.comment!.id)]);
          setInputText("");
          setReplyingTo(null);
          toast.success(replyingTo ? t("replyPosted") : t("commentPublished"));
        } else {
          toast.error(t("commentFailed"));
        }
      } catch (err: any) {
        toast.error(`Error: ${err.message || t("commentFailed")}`);
      } finally {
        setIsSubmitting(false);
      }
    } else {
      // Local book: save locally
      setIsSubmitting(true);
      try {
        let authorName = "Reader";
        let authorId = "local-user";
        let avatarUrl: string | undefined = undefined;

        if (user) {
          authorName = user.name || user.email?.split("@")[0] || "Reader";
          authorId = user.uid || user.email || "user";
          avatarUrl = user.avatarUrl || user.photoURL;
        } else {
          const guest = getOrCreateGuestUser();
          authorName = guest.name;
          authorId = guest.id;
        }

        const savedNote = saveLocalNote(bookId, {
          bookTitle,
          page: notePage,
          content: trimmed,
          userName: authorName,
          userAvatar: avatarUrl,
          userId: authorId,
          replyToId: replyingTo ? replyingTo.id : undefined,
          replyToName: replyingTo ? replyingTo.userName : undefined,
          replyToSnippet: replyingTo ? replyingTo.content.slice(0, 80) : undefined,
        });

        setComments((prev) => [savedNote, ...prev]);
        setInputText("");
        setReplyingTo(null);
        toast.success(replyingTo ? t("replySaved") : t("noteSaved"));
      } catch (err: any) {
        toast.error(`Failed to save note: ${err.message}`);
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  // Handle Note Deletion
  const handleDelete = async (e: React.MouseEvent, note: BookComment) => {
    e.stopPropagation();
    if (note.isLocal || !isBookshelf) {
      deleteLocalNote(bookId, note.id);
      setComments((prev) => prev.filter((c) => c.id !== note.id));
      if (replyingTo?.id === note.id) setReplyingTo(null);
      toast.success(t("noteRemoved"));
    } else {
      const guest = getOrCreateGuestUser();
      const currentUserId = user ? (user.uid || user.email) : guest.id;
      try {
        await deleteCloudComment(bookId, note.id, currentUserId);
        setComments((prev) => prev.filter((c) => c.id !== note.id));
        if (replyingTo?.id === note.id) setReplyingTo(null);
        toast.success(t("commentDeleted"));
      } catch (err) {
        toast.error(t("deleteCommentFailed"));
      }
    }
  };

  const handleQuickLocate = (e: React.MouseEvent, pageNumber: number) => {
    e.stopPropagation();
    if (pageNumber > 0) {
      onNavigateToPage(pageNumber);
      toast.info(`${t("jumpedToPage")} ${pageNumber}`, {
        duration: 1500,
      });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  };

  const formatTimestamp = (ts: number) => {
    if (!ts) return "";
    const diff = Date.now() - ts;
    if (diff < 60000) return t("justNow");
    if (diff < 3600000) return `${Math.floor(diff / 60000)}${t("minutesAgo")}`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}${t("hoursAgo")}`;
    return formatDate(ts, { month: "short", day: "numeric" });
  };

  const guest = getOrCreateGuestUser();

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Full Backdrop (Tap outside to close float window) */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/25 md:bg-black/10 z-40"
          />

          {/* Float Sidebar Container */}
          <motion.aside
            ref={sidebarRef}
            initial={{ x: "100%", opacity: 0.5 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "100%", opacity: 0 }}
            transition={{ type: "spring", damping: 28, stiffness: 280 }}
            className="fixed top-12 bottom-0 right-0 w-full sm:w-[380px] md:w-[410px] bg-background/95 backdrop-blur-md border-l border-border/70 shadow-2xl z-50 flex flex-col overflow-hidden select-none"
            id="reader-notes-float-sidebar"
          >
            {/* Clean Header */}
            <div className="p-3.5 border-b border-border/60 bg-muted/20 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-md bg-primary/10 text-primary">
                  {isBookshelf ? (
                    <MessageSquare className="w-4 h-4" />
                  ) : (
                    <StickyNote className="w-4 h-4" />
                  )}
                </div>
                <h3 className="text-sm font-bold text-foreground leading-tight flex items-center gap-1.5">
                  {isBookshelf ? t("discussion") : t("notes")}
                  <span className="text-[11px] font-mono px-1.5 py-0.2 bg-primary/15 text-primary rounded-full font-semibold">
                    {comments.length}
                  </span>
                </h3>
              </div>

              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground rounded-md"
                onClick={onClose}
                title={t("cancel")}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            {/* Note Composer / Input Section */}
            <div className="p-3 border-b border-border/50 bg-background/80 flex flex-col gap-2">
              {/* Active Replying Banner */}
              {replyingTo && (
                <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-primary/10 border border-primary/25 text-xs text-primary font-medium animate-in fade-in slide-in-from-top-1 duration-150">
                  <div className="flex items-center gap-1.5 min-w-0 truncate">
                    <CornerDownRight className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate text-[11.5px]">
                      {t("replyingTo")} <span className="font-bold">{replyingTo.userName}</span>
                      {replyingTo.page > 0 && <span className="font-mono ml-0.5">(P.{replyingTo.page})</span>}
                      : <span className="italic opacity-85">"{replyingTo.content.slice(0, 40)}{replyingTo.content.length > 40 ? "..." : ""}"</span>
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setReplyingTo(null)}
                    className="p-1 hover:bg-primary/20 rounded text-primary transition-colors shrink-0"
                    title={t("cancelReply")}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}

              {/* Note input */}
              <form onSubmit={handleSubmit} className="flex flex-col gap-2">
                <div className="relative">
                  <textarea
                    ref={textareaRef}
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={
                      replyingTo
                        ? t("replyPlaceholder", { name: replyingTo.userName })
                        : isBookshelf
                        ? t("thoughtPlaceholder", { page: displayCurrentPageNumber })
                        : t("notePlaceholder", { page: displayCurrentPageNumber })
                    }
                    rows={replyingTo ? 2 : 3}
                    className="w-full text-xs p-2.5 rounded-lg border border-border/60 bg-muted/15 focus:bg-background focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none resize-none transition-colors"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="text-[10.5px] text-muted-foreground/80 truncate">
                    {!user && (
                      <span className="italic">
                        {t("postingAs")} <span className="font-semibold text-foreground/90">{guest.name}</span>
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    {replyingTo && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setReplyingTo(null)}
                        className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                      >
                        {t("cancel")}
                      </Button>
                    )}
                    <Button
                      type="submit"
                      disabled={isSubmitting || !inputText.trim()}
                      size="sm"
                      className="h-7 px-3 text-xs font-bold gap-1 shadow-xs"
                    >
                      {isSubmitting ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Send className="w-3 h-3" />
                      )}
                      {replyingTo ? t("reply") : isBookshelf ? t("post") : t("save")}
                    </Button>
                  </div>
                </div>
              </form>
            </div>

            {/* Notes List (Direct stream with quick locate badges & tap to reply) */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
              {isLoading && comments.length === 0 ? (
                <div className="py-12 flex flex-col items-center justify-center text-muted-foreground gap-2">
                  <Loader2 className="w-5 h-5 animate-spin text-primary" />
                  <span className="text-xs">{t("loadingNotes")}</span>
                </div>
              ) : comments.length === 0 ? (
                <div className="py-12 flex flex-col items-center justify-center text-center text-muted-foreground gap-2 px-4">
                  <div className="p-3 rounded-full bg-muted/40 text-muted-foreground/60">
                    {isBookshelf ? (
                      <MessageSquare className="w-6 h-6" />
                    ) : (
                      <StickyNote className="w-6 h-6" />
                    )}
                  </div>
                  <p className="text-xs font-semibold text-foreground">
                    {isBookshelf ? t("noCommentsYet") : t("noNotesYet")}
                  </p>
                </div>
              ) : (
                comments.map((note) => {
                  const isOwnNote =
                    note.isLocal ||
                    (user && (note.userId === user.uid || note.userId === user.email)) ||
                    (guest && note.userId === guest.id);

                  const isBeingRepliedTo = replyingTo?.id === note.id;

                  return (
                    <motion.div
                      key={note.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      onClick={() => handleStartReply(note)}
                      className={`p-3 rounded-lg border transition-all text-xs flex flex-col gap-1.5 cursor-pointer group relative ${
                        isBeingRepliedTo
                          ? "bg-primary/10 border-primary ring-1 ring-primary/40 shadow-xs"
                          : note.page === displayCurrentPageNumber
                          ? "bg-primary/5 border-primary/30 shadow-xs hover:border-primary/60"
                          : "bg-muted/10 border-border/50 hover:border-border hover:bg-muted/20"
                      }`}
                      title={t("tapToDiscuss")}
                    >
                      {/* Note Header: User & Quick Locate Mark beside User Name */}
                      <div className="flex items-center justify-between gap-1.5">
                        <div className="flex items-center gap-1.5 min-w-0 flex-1">
                          {/* Avatar */}
                          {note.userAvatar ? (
                            <img
                              src={note.userAvatar}
                              alt={note.userName}
                              className="w-5 h-5 rounded-full object-cover shrink-0 border border-border"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <div className="w-5 h-5 rounded-full bg-primary/20 text-primary flex items-center justify-center text-[10px] font-bold shrink-0">
                              {(note.userName || "R").charAt(0).toUpperCase()}
                            </div>
                          )}

                          {/* Username */}
                          <span className="font-bold text-foreground truncate text-[11px]">
                            {note.userName || "Reader"}
                          </span>

                          {/* Quick Locate Mark beside User Name */}
                          {note.page > 0 && (
                            <button
                              type="button"
                              onClick={(e) => handleQuickLocate(e, note.page)}
                              className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-primary/10 hover:bg-primary hover:text-primary-foreground text-primary font-mono text-[10px] font-bold transition-all group cursor-pointer shadow-2xs border border-primary/20"
                              title={`${t("jumpToPage")} ${note.page}`}
                            >
                              <Compass className="w-2.5 h-2.5 group-hover:rotate-45 transition-transform" />
                              <span>P. {note.page}</span>
                            </button>
                          )}
                        </div>

                        {/* Timestamp & Actions */}
                        <div className="flex items-center gap-1 shrink-0">
                          <span className="text-[10px] text-muted-foreground/70 flex items-center gap-0.5">
                            <Clock className="w-2.5 h-2.5" />
                            {formatTimestamp(note.timestamp)}
                          </span>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleStartReply(note);
                            }}
                            className="p-1 text-muted-foreground/60 hover:text-primary transition-colors rounded opacity-80 group-hover:opacity-100"
                            title={t("reply")}
                          >
                            <Reply className="w-3 h-3" />
                          </button>

                          {isOwnNote && (
                            <button
                              type="button"
                              onClick={(e) => handleDelete(e, note)}
                              className="p-1 text-muted-foreground/50 hover:text-destructive transition-colors rounded"
                              title={t("deleteNote")}
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Quoted parent reply context if applicable */}
                      {note.replyToName && (
                        <div className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted/60 text-[10px] text-muted-foreground font-medium border border-border/40 w-fit max-w-full truncate">
                          <CornerDownRight className="w-2.5 h-2.5 shrink-0 text-primary" />
                          <span className="truncate">
                            {t("replyingTo")} <span className="font-semibold text-foreground">@{note.replyToName}</span>
                            {note.replyToSnippet ? `: "${note.replyToSnippet.slice(0, 35)}..."` : ""}
                          </span>
                        </div>
                      )}

                      {/* Note Content */}
                      <p className="text-foreground/90 whitespace-pre-wrap leading-relaxed break-words text-[11.5px] select-text">
                        {note.content}
                      </p>
                    </motion.div>
                  );
                })
              )}
            </div>

            {/* Clean Footer */}
            <div className="p-2 border-t border-border/40 bg-muted/30 text-[10px] text-muted-foreground flex items-center justify-between px-3">
              <span className="text-[10px] text-muted-foreground/80">
                {t("tapToDiscuss")}
              </span>
              <span className="font-mono">
                p. {displayCurrentPageNumber} / {totalPages || 1}
              </span>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
};
