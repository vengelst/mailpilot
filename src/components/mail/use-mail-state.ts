/**
 * Central state hook for the mail workspace. Declares every useState / useRef
 * that the workspace and its sub-hooks / sub-components share. Returns the
 * full "state bag" which is then threaded through to actions, sync, and UI.
 */

import { useMemo, useRef, useState } from "react";
import {
  DEFAULT_MAIL_SCROLL_BATCH,
  type Account,
  type Attachment,
  type AutomationRunSummary,
  type ComposeForm,
  type ComposeMode,
  type ContactCandidate,
  type Email,
  type Folder,
  type FolderTreeNode,
  type LabelDef,
  type LocalFlagFilter,
  type MailContextMenuState,
  type MailScrollBatchOption,
  type MobileSwipeAction,
  type PendingSwipeTrashUndo,
  type SignatureData,
  type SyncProgress,
  ancestorPaths,
  buildFolderTree,
} from "./mail-types";

export function useMailState() {
  // --- Core domain state ---
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [emails, setEmails] = useState<Email[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [selectedFolderPath, setSelectedFolderPath] = useState("INBOX");
  const [moveTargetFolder, setMoveTargetFolder] = useState("");
  const [query, setQuery] = useState("");
  const [uiError, setUiError] = useState("");
  const [uiInfo, setUiInfo] = useState("");

  // --- Sender-profile toast ---
  const [senderProfileToast, setSenderProfileToast] = useState<{
    fromEmail: string;
    fromName: string;
    targetFolder: string;
    emailId: string;
  } | null>(null);
  const senderProfileToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Loading indicators ---
  const [isLoadingEmails, setIsLoadingEmails] = useState(false);
  const [isLoadingMoreEmails, setIsLoadingMoreEmails] = useState(false);
  const [emailsHasMore, setEmailsHasMore] = useState(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgress>(null);

  // --- Mobile pane & swipe ---
  const [mobilePane, setMobilePane] = useState<"left" | "middle" | "right">("middle");
  const [, setMobileDrawerDragX] = useState(0);
  const [leftSwipeAction, setLeftSwipeAction] = useState<MobileSwipeAction>("trash");
  const [rightSwipeAction, setRightSwipeAction] = useState<MobileSwipeAction>("mark_read");
  const [mailSwipeOffsets, setMailSwipeOffsets] = useState<Record<string, number>>({});
  const [mailSwipeFeedback, setMailSwipeFeedback] = useState<Record<string, MobileSwipeAction>>({});
  const [pendingSwipeTrashUndos, setPendingSwipeTrashUndos] = useState<PendingSwipeTrashUndo[]>([]);

  // --- Filters & sort ---
  const [tab, setTab] = useState<"all" | "unread">("all");
  const [hasAttachmentsFilter, setHasAttachmentsFilter] = useState(false);
  const [actionRequiredFilter, setActionRequiredFilter] = useState(false);
  const [localFlagFilter, setLocalFlagFilter] = useState<LocalFlagFilter>("all");
  const [sort, setSort] = useState<"date_desc" | "date_asc" | "from_asc" | "subject_asc">("date_desc");

  // --- Contact candidates ---
  const [contactCandidates, setContactCandidates] = useState<ContactCandidate[]>([]);

  // --- Attachment targets ---
  const [attachmentTargets, setAttachmentTargets] = useState<
    Record<string, { provider: "google_drive" | "onedrive" | "mock"; targetPath: string }>
  >({});

  // --- UI panels ---
  const [emailDetailMenuOpen, setEmailDetailMenuOpen] = useState(false);
  const [maximizedBodyMenuOpen, setMaximizedBodyMenuOpen] = useState(false);
  const [foldersOpen, setFoldersOpen] = useState(true);
  const [mobileMainHeaderExpanded, setMobileMainHeaderExpanded] = useState(true);
  const [accountExpanded, setAccountExpanded] = useState(true);
  const [expandedFolderPaths, setExpandedFolderPaths] = useState<Set<string>>(new Set());

  // --- Body ---
  const [bodyContent, setBodyContent] = useState<{ text: string; html: string } | null>(null);
  const [isLoadingBody, setIsLoadingBody] = useState(false);
  const [bodyError, setBodyError] = useState("");
  const [bodyMode, setBodyMode] = useState<"text" | "html">("html");
  const [showExternalImages, setShowExternalImages] = useState(false);
  const [printMode, setPrintMode] = useState<"html" | "text">("html");
  const [isBodyMaximized, setIsBodyMaximized] = useState(false);

  // --- Multi-select ---
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const lastSelectedIdRef = useRef<string | null>(null);
  const shiftHeldRef = useRef(false);

  // --- Misc UI ---
  const [emptyFolderModalOpen, setEmptyFolderModalOpen] = useState(false);
  const [dragOverFolderPath, setDragOverFolderPath] = useState<string | null>(null);
  const [attachmentPreviewOpen, setAttachmentPreviewOpen] = useState<Set<string>>(new Set());
  const dragExpandTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [emptyConfirmText, setEmptyConfirmText] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [showSyncMenu, setShowSyncMenu] = useState(false);
  const [newMailCheckIntervalMinutes, setNewMailCheckIntervalMinutes] = useState(30);
  const [runOnAppStart, setRunOnAppStart] = useState(false);
  const [folderCountDisplayMode, setFolderCountDisplayMode] = useState<"compact" | "uga">("compact");

  // --- Automation ---
  const [automationRuns, setAutomationRuns] = useState<AutomationRunSummary[]>([]);
  const [automationDashboardOpen, setAutomationDashboardOpen] = useState(false);
  const [automationLoading, setAutomationLoading] = useState(false);
  const [automationSaving, setAutomationSaving] = useState(false);
  const [automationRunningNow, setAutomationRunningNow] = useState(false);

  // --- Mail scroll / batch ---
  const [mailScrollBatchSize, setMailScrollBatchSize] = useState<MailScrollBatchOption>(DEFAULT_MAIL_SCROLL_BATCH);

  // --- Context menu ---
  const [mailContextMenu, setMailContextMenu] = useState<MailContextMenuState | null>(null);
  const [contextMoveTargetFolder, setContextMoveTargetFolder] = useState("");
  const [contextAttachmentId, setContextAttachmentId] = useState("");

  // --- Signatures ---
  const [signatures, setSignatures] = useState<SignatureData[]>([]);

  // --- Popup / link ---
  const [popupEmailId, setPopupEmailId] = useState<string | null>(null);
  const [pendingLinkUrl, setPendingLinkUrl] = useState<string | null>(null);

  // --- Folder management ---
  const [isManagingFolder, setIsManagingFolder] = useState(false);
  const [mobileMovePanelOpen, setMobileMovePanelOpen] = useState(false);
  const [mobileNewFolderName, setMobileNewFolderName] = useState("");
  const [mobileNewFolderParentPath, setMobileNewFolderParentPath] = useState("");

  // --- Label system ---
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [labelList, setLabelList] = useState<LabelDef[]>([]);
  const [labelsExpanded, setLabelsExpanded] = useState(true);
  const [labelDropdownOpen, setLabelDropdownOpen] = useState(false);
  const [newLabelInline, setNewLabelInline] = useState("");

  // --- Auto-Prompt (sender classification) ---
  const [checkedSenders] = useState(() => new Set<string>());
  const [senderPromptVisible, setSenderPromptVisible] = useState(false);
  const [senderPromptData, setSenderPromptData] = useState<{
    email: string;
    domain: string;
    fromName: string;
  } | null>(null);
  const [senderPromptCategory, setSenderPromptCategory] = useState("Sonstiges");
  const [senderPromptFolder, setSenderPromptFolder] = useState("");
  const [senderPromptSaving, setSenderPromptSaving] = useState(false);

  // --- Auto-move toast ---
  const [autoMoveToast, setAutoMoveToast] = useState<{ emailId: string; folder: string } | null>(null);
  const autoMoveToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingAutoMoveRef = useRef<{ emailId: string; folder: string } | null>(null);

  // --- Compose ---
  const composeEditorRef = useRef<HTMLDivElement | null>(null);
  const mailBodyIframeRef = useRef<HTMLIFrameElement | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeMode, setComposeMode] = useState<ComposeMode>("new");
  const [composeSaving, setComposeSaving] = useState(false);
  const [composeForm, setComposeForm] = useState<ComposeForm>({
    draftId: null,
    accountId: "",
    to: "",
    cc: "",
    bcc: "",
    subject: "",
    bodyHtml: "",
    sendAtLocal: "",
  });
  const composeInitializedRef = useRef(false);

  // --- Internal refs ---
  const autoCheckInFlightRef = useRef(false);
  const syncAllProgressPollRef = useRef<number | null>(null);
  const automationRefreshRef = useRef<number | null>(null);
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const loadMoreInFlightRef = useRef(false);
  const loadMoreEmailsRef = useRef<() => Promise<void>>(async () => {});
  const emailsNextCursorRef = useRef<string | null>(null);
  const emailsHasMoreRef = useRef(false);
  const isLoadingEmailsRef = useRef(false);
  const pendingSwipeTrashUndosRef = useRef<PendingSwipeTrashUndo[]>([]);
  const selectedAccountIdRef = useRef(selectedAccountId);
  const selectedFolderPathRef = useRef(selectedFolderPath);
  const swipeTrashUndoSeqRef = useRef(0);
  const activeLoadEmailsRequestIdRef = useRef(0);
  const activeLoadEmailRequestIdRef = useRef(0);
  const mobileDrawerGestureRef = useRef<{
    x: number;
    y: number;
    pane: "left" | "middle" | "right";
  } | null>(null);
  const mailRowSwipeStartRef = useRef<{ id: string; x: number; y: number } | null>(null);
  const swipeFeedbackTimeoutsRef = useRef<Record<string, number>>({});

  // --- Layout (resizable columns) ---
  const [folderWidth, setFolderWidth] = useState(280);
  const [listWidth, setListWidth] = useState(430);

  // --- Idle-based full sync ---
  const lastUserActionRef = useRef(Date.now());
  const idleFullSyncDoneRef = useRef(false);

  // ---------------------------------------------------------------------------
  // Derived values (useMemo)
  // ---------------------------------------------------------------------------

  const isAllAccounts = selectedAccountId === "__all__";

  const selectedEmailCandidates = useMemo(() => {
    if (!selectedEmail) return [];
    return contactCandidates.filter((c) => c.emailId === selectedEmail.id);
  }, [contactCandidates, selectedEmail]);

  const folderTree = useMemo(() => buildFolderTree(folders), [folders]);

  const effectiveExpandedFolderPaths = useMemo(() => {
    const next = new Set(expandedFolderPaths);
    if (selectedFolderPath) {
      const folder = folders.find((f) => f.path === selectedFolderPath);
      const delimiter = folder?.delimiter || "/";
      for (const a of ancestorPaths(selectedFolderPath, delimiter)) next.add(a);
    }
    return next;
  }, [expandedFolderPaths, selectedFolderPath, folders]);

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === selectedAccountId) ?? null,
    [accounts, selectedAccountId],
  );

  const accountRootLabel = selectedAccount?.imapUsername || selectedAccount?.name || "Konto";

  const currentFolder = useMemo(
    () => folders.find((f) => f.path === selectedFolderPath) ?? null,
    [folders, selectedFolderPath],
  );

  const latestAutomationRun = automationRuns[0] ?? null;
  const latestRunStartedAt = latestAutomationRun?.startedAt ?? null;
  const nextScheduledRunAt = useMemo(() => {
    if (!latestRunStartedAt) return null;
    const base = new Date(latestRunStartedAt).getTime();
    if (!Number.isFinite(base)) return null;
    return new Date(base + Math.max(1, Math.round(newMailCheckIntervalMinutes)) * 60 * 1000).toISOString();
  }, [latestRunStartedAt, newMailCheckIntervalMinutes]);

  const folderEmptyKind: "trash" | "spam" | null = useMemo(() => {
    if (!currentFolder) return null;
    if (currentFolder.specialUse === "trash") return "trash";
    if (currentFolder.specialUse === "spam") return "spam";
    const lower = currentFolder.path.toLowerCase();
    if (/trash|papierkorb|deleted|gel(ö|oe)scht|\bbin\b/.test(lower)) return "trash";
    if (/spam|junk|unerw(ü|ue)nscht|werbung/.test(lower)) return "spam";
    return null;
  }, [currentFolder]);

  const contextMenuEmail = useMemo(() => {
    if (!mailContextMenu) return null;
    return emails.find((email) => email.id === mailContextMenu.emailId) ?? null;
  }, [mailContextMenu, emails]);

  const contextMenuTargetIds = mailContextMenu?.targetIds ?? [];
  const contextMenuIsBulk = contextMenuTargetIds.length > 1;
  const contextMenuAttachments = contextMenuEmail?.attachments ?? [];
  const selectedContextAttachment =
    contextMenuAttachments.find((a: Attachment) => a.id === contextAttachmentId) ??
    contextMenuAttachments[0] ??
    null;

  const mobileNewFolderParentOptions = useMemo(() => {
    return folders
      .map((folder) => folder.path)
      .filter((path) => path.trim().length > 0)
      .sort((a, b) => a.localeCompare(b, "de", { sensitivity: "base" }));
  }, [folders]);

  const hasSelectedEmail = !!selectedEmail;
  const rightDrawerEnabled = hasSelectedEmail;
  const isMobileLeftPaneVisible = foldersOpen && mobilePane === "left";
  const isMobileRightPaneVisible = mobilePane === "right" && rightDrawerEnabled;
  const isMobileDrawerOpen = isMobileLeftPaneVisible || isMobileRightPaneVisible;

  return {
    // Core domain
    accounts, setAccounts,
    folders, setFolders,
    emails, setEmails,
    selectedEmail, setSelectedEmail,
    selectedAccountId, setSelectedAccountId,
    selectedFolderPath, setSelectedFolderPath,
    moveTargetFolder, setMoveTargetFolder,
    query, setQuery,
    uiError, setUiError,
    uiInfo, setUiInfo,
    senderProfileToast, setSenderProfileToast,
    senderProfileToastTimerRef,

    // Loading
    isLoadingEmails, setIsLoadingEmails,
    isLoadingMoreEmails, setIsLoadingMoreEmails,
    emailsHasMore, setEmailsHasMore,
    isLoadingDetail, setIsLoadingDetail,
    isSyncing, setIsSyncing,
    syncProgress, setSyncProgress,

    // Mobile
    mobilePane, setMobilePane,
    setMobileDrawerDragX,
    leftSwipeAction, setLeftSwipeAction,
    rightSwipeAction, setRightSwipeAction,
    mailSwipeOffsets, setMailSwipeOffsets,
    mailSwipeFeedback, setMailSwipeFeedback,
    pendingSwipeTrashUndos, setPendingSwipeTrashUndos,

    // Filters
    tab, setTab,
    hasAttachmentsFilter, setHasAttachmentsFilter,
    actionRequiredFilter, setActionRequiredFilter,
    localFlagFilter, setLocalFlagFilter,
    sort, setSort,

    // Contact candidates
    contactCandidates, setContactCandidates,

    // Attachment targets
    attachmentTargets, setAttachmentTargets,

    // UI panels
    emailDetailMenuOpen, setEmailDetailMenuOpen,
    maximizedBodyMenuOpen, setMaximizedBodyMenuOpen,
    foldersOpen, setFoldersOpen,
    mobileMainHeaderExpanded, setMobileMainHeaderExpanded,
    accountExpanded, setAccountExpanded,
    expandedFolderPaths, setExpandedFolderPaths,

    // Body
    bodyContent, setBodyContent,
    isLoadingBody, setIsLoadingBody,
    bodyError, setBodyError,
    bodyMode, setBodyMode,
    showExternalImages, setShowExternalImages,
    printMode, setPrintMode,
    isBodyMaximized, setIsBodyMaximized,

    // Selection
    selectedIds, setSelectedIds,
    lastSelectedIdRef,
    shiftHeldRef,

    // Misc UI
    emptyFolderModalOpen, setEmptyFolderModalOpen,
    dragOverFolderPath, setDragOverFolderPath,
    attachmentPreviewOpen, setAttachmentPreviewOpen,
    dragExpandTimeoutRef,
    emptyConfirmText, setEmptyConfirmText,
    bulkBusy, setBulkBusy,
    showSyncMenu, setShowSyncMenu,
    newMailCheckIntervalMinutes, setNewMailCheckIntervalMinutes,
    runOnAppStart, setRunOnAppStart,
    folderCountDisplayMode, setFolderCountDisplayMode,

    // Automation
    automationRuns, setAutomationRuns,
    automationDashboardOpen, setAutomationDashboardOpen,
    automationLoading, setAutomationLoading,
    automationSaving, setAutomationSaving,
    automationRunningNow, setAutomationRunningNow,

    // Scroll batch
    mailScrollBatchSize, setMailScrollBatchSize,

    // Context menu
    mailContextMenu, setMailContextMenu,
    contextMoveTargetFolder, setContextMoveTargetFolder,
    contextAttachmentId, setContextAttachmentId,

    // Signatures
    signatures, setSignatures,

    // Popup / link
    popupEmailId, setPopupEmailId,
    pendingLinkUrl, setPendingLinkUrl,

    // Folder management
    isManagingFolder, setIsManagingFolder,
    mobileMovePanelOpen, setMobileMovePanelOpen,
    mobileNewFolderName, setMobileNewFolderName,
    mobileNewFolderParentPath, setMobileNewFolderParentPath,

    // Label system
    selectedLabel, setSelectedLabel,
    labelList, setLabelList,
    labelsExpanded, setLabelsExpanded,
    labelDropdownOpen, setLabelDropdownOpen,
    newLabelInline, setNewLabelInline,

    // Auto-Prompt
    checkedSenders,
    senderPromptVisible, setSenderPromptVisible,
    senderPromptData, setSenderPromptData,
    senderPromptCategory, setSenderPromptCategory,
    senderPromptFolder, setSenderPromptFolder,
    senderPromptSaving, setSenderPromptSaving,

    // Auto-move
    autoMoveToast, setAutoMoveToast,
    autoMoveToastTimerRef,
    pendingAutoMoveRef,

    // Compose
    composeEditorRef,
    mailBodyIframeRef,
    composeOpen, setComposeOpen,
    composeMode, setComposeMode,
    composeSaving, setComposeSaving,
    composeForm, setComposeForm,
    composeInitializedRef,

    // Internal refs
    autoCheckInFlightRef,
    syncAllProgressPollRef,
    automationRefreshRef,
    listScrollRef,
    loadMoreSentinelRef,
    loadMoreInFlightRef,
    loadMoreEmailsRef,
    emailsNextCursorRef,
    emailsHasMoreRef,
    isLoadingEmailsRef,
    pendingSwipeTrashUndosRef,
    selectedAccountIdRef,
    selectedFolderPathRef,
    swipeTrashUndoSeqRef,
    activeLoadEmailsRequestIdRef,
    activeLoadEmailRequestIdRef,
    mobileDrawerGestureRef,
    mailRowSwipeStartRef,
    swipeFeedbackTimeoutsRef,

    // Layout
    folderWidth, setFolderWidth,
    listWidth, setListWidth,

    // Idle sync
    lastUserActionRef,
    idleFullSyncDoneRef,

    // Derived
    isAllAccounts,
    selectedEmailCandidates,
    folderTree,
    effectiveExpandedFolderPaths,
    selectedAccount,
    accountRootLabel,
    currentFolder,
    nextScheduledRunAt,
    folderEmptyKind,
    contextMenuEmail,
    contextMenuTargetIds,
    contextMenuIsBulk,
    contextMenuAttachments,
    selectedContextAttachment,
    mobileNewFolderParentOptions,
    hasSelectedEmail,
    rightDrawerEnabled,
    isMobileLeftPaneVisible,
    isMobileRightPaneVisible,
    isMobileDrawerOpen,
  };
}

export type MailStateReturn = ReturnType<typeof useMailState>;
