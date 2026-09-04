/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  DriveFileItem,
  DriveProgress,
  CachedDriveFileMeta,
  signInWithGoogleDrive,
  signOutGoogleDrive,
  getDriveAccessToken,
  getCurrentDriveUser,
  listDriveFiles,
  listDriveFolders,
  createDriveFolder,
  downloadDriveFile,
  uploadBookToGoogleDrive,
  getCachedDriveFilesMeta,
  removeCachedDriveFile,
  clearAllDriveCache,
  formatFileSize,
} from '@/lib/googleDrive';
import {
  Loader2,
  Folder,
  BookOpen,
  FileText,
  Layers,
  Image as ImageIcon,
  Search,
  RefreshCw,
  Upload,
  Download,
  FolderPlus,
  ChevronRight,
  HardDrive,
  Trash2,
  CheckCircle2,
  ExternalLink,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';

export function GoogleDriveIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 87.3 78" className={className}>
      <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
      <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44c-.8 1.4-1.2 2.95-1.2 4.5h27.5z" fill="#00ac47"/>
      <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335"/>
      <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/>
      <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/>
      <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>
    </svg>
  );
}

export interface GoogleDriveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialMode?: 'import' | 'export' | 'cache';
  exportFile?: {
    name: string;
    blob?: Blob | File;
    mimeType?: string;
  };
  onFileImported?: (file: File) => void;
  onExportSuccess?: (item: DriveFileItem) => void;
}

interface BreadcrumbItem {
  id: string;
  name: string;
}

export function GoogleDriveDialog({
  open,
  onOpenChange,
  initialMode = 'import',
  exportFile,
  onFileImported,
  onExportSuccess,
}: GoogleDriveDialogProps) {
  const [activeTab, setActiveTab] = useState<'import' | 'export' | 'cache'>(initialMode);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userProfile, setUserProfile] = useState<{ email?: string; name?: string; photoURL?: string } | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [popupBlocked, setPopupBlocked] = useState(false);

  const isInIframe = useMemo(() => {
    return typeof window !== 'undefined' && window.self !== window.top;
  }, []);

  // File browser states
  const [files, setFiles] = useState<DriveFileItem[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([{ id: 'root', name: 'My Drive' }]);
  const [currentFolderId, setCurrentFolderId] = useState('root');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'books' | 'comics' | 'epubs' | 'all'>('books');
  const [selectedFile, setSelectedFile] = useState<DriveFileItem | null>(null);

  // Transfer & streaming progress
  const [transferProgress, setTransferProgress] = useState<DriveProgress | null>(null);
  const [isTransferring, setIsTransferring] = useState(false);

  // Export states
  const [exportFileName, setExportFileName] = useState(exportFile?.name || 'MyBook.epub');
  const [exportFolderId, setExportFolderId] = useState('root');
  const [exportFolders, setExportFolders] = useState<DriveFileItem[]>([]);
  const [newFolderName, setNewFolderName] = useState('');
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);

  // IndexedDB cache states
  const [cachedMetas, setCachedMetas] = useState<CachedDriveFileMeta[]>([]);

  // Sync initial mode & export file when opened
  useEffect(() => {
    if (open) {
      if (initialMode) setActiveTab(initialMode);
      if (exportFile?.name) {
        setExportFileName(exportFile.name);
      }
      setPopupBlocked(false);
      checkAuthStatus();
      loadCachedFiles();
    }
  }, [open, initialMode, exportFile]);

  const checkAuthStatus = async () => {
    const token = await getDriveAccessToken();
    const user = getCurrentDriveUser();
    if (token && user) {
      setIsAuthenticated(true);
      setUserProfile({
        name: user.displayName || undefined,
        email: user.email || undefined,
        photoURL: user.photoURL || undefined,
      });
      fetchFiles(currentFolderId, searchQuery, filterType);
      fetchFolders();
    } else {
      setIsAuthenticated(false);
      setUserProfile(null);
    }
  };

  const handleSignIn = async () => {
    setIsAuthenticating(true);
    setPopupBlocked(false);
    try {
      const res = await signInWithGoogleDrive();
      setIsAuthenticated(true);
      setUserProfile({
        name: res.user.displayName || undefined,
        email: res.user.email || undefined,
        photoURL: res.user.photoURL || undefined,
      });
      toast.success('Connected to Google Drive');
      fetchFiles('root', searchQuery, filterType);
      fetchFolders();
    } catch (err: any) {
      const isBlocked = err?.code === 'auth/popup-blocked' || err?.message?.includes('popup-blocked');
      const isClosed = err?.code === 'auth/popup-closed-by-user' || err?.code === 'auth/cancelled-popup-request';

      if (isBlocked) {
        setPopupBlocked(true);
        toast.warning('Google sign-in pop-up was blocked by your browser. Please allow pop-ups or open the app in a new tab.');
      } else if (isClosed) {
        toast.info('Sign-in was cancelled.');
      } else {
        console.error('[GoogleDrive] Unexpected sign-in error:', err);
        toast.error(err.message || 'Google Drive sign-in failed');
      }
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOutGoogleDrive();
      setIsAuthenticated(false);
      setUserProfile(null);
      setFiles([]);
      setSelectedFile(null);
      toast.info('Disconnected from Google Drive');
    } catch (err: any) {
      toast.error('Failed to sign out');
    }
  };

  const fetchFiles = useCallback(async (folderId: string, search: string, filter: 'books' | 'comics' | 'epubs' | 'all') => {
    setLoadingFiles(true);
    setSelectedFile(null);
    try {
      const res = await listDriveFiles({
        folderId,
        searchQuery: search,
        filterType: filter,
      });
      setFiles(res.files);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Failed to list Google Drive files');
    } finally {
      setLoadingFiles(false);
    }
  }, []);

  const fetchFolders = async () => {
    try {
      const folders = await listDriveFolders('root');
      setExportFolders(folders);
    } catch (err) {
      console.warn('Folder listing warning:', err);
    }
  };

  const loadCachedFiles = async () => {
    const list = await getCachedDriveFilesMeta();
    setCachedMetas(list);
  };

  const handleNavigateFolder = (folder: DriveFileItem) => {
    setCurrentFolderId(folder.id);
    setBreadcrumbs(prev => [...prev, { id: folder.id, name: folder.name }]);
    setSearchQuery('');
    fetchFiles(folder.id, '', filterType);
  };

  const handleNavigateBreadcrumb = (index: number) => {
    const target = breadcrumbs[index];
    const newBreadcrumbs = breadcrumbs.slice(0, index + 1);
    setBreadcrumbs(newBreadcrumbs);
    setCurrentFolderId(target.id);
    setSearchQuery('');
    fetchFiles(target.id, '', filterType);
  };

  const handleCreateNewFolder = async () => {
    if (!newFolderName.trim()) return;
    setIsCreatingFolder(true);
    try {
      const folder = await createDriveFolder(newFolderName.trim(), currentFolderId);
      toast.success(`Created folder "${folder.name}"`);
      setNewFolderName('');
      setShowCreateFolder(false);
      fetchFiles(currentFolderId, searchQuery, filterType);
      fetchFolders();
    } catch (err: any) {
      toast.error(err.message || 'Failed to create folder');
    } finally {
      setIsCreatingFolder(false);
    }
  };

  // Direct client streaming download with IndexedDB caching
  const handleImportFile = async (fileToImport?: DriveFileItem) => {
    const item = fileToImport || selectedFile;
    if (!item) return;

    setIsTransferring(true);
    try {
      const downloadedFile = await downloadDriveFile(item, (prog) => {
        setTransferProgress(prog);
      });

      toast.success(`Imported: ${item.name}`);
      loadCachedFiles();
      if (onFileImported) {
        onFileImported(downloadedFile);
        onOpenChange(false);
      }
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Failed to download from Google Drive');
    } finally {
      setIsTransferring(false);
      setTransferProgress(null);
    }
  };

  // Direct client resumable upload
  const handleExportFile = async () => {
    if (!exportFile?.blob) {
      toast.error('No book or file is currently loaded to export.');
      return;
    }

    setIsTransferring(true);
    try {
      const uploadedItem = await uploadBookToGoogleDrive(exportFile.blob, {
        fileName: exportFileName || exportFile.name,
        mimeType: exportFile.mimeType,
        folderId: exportFolderId,
        onProgress: (prog) => {
          setTransferProgress(prog);
        },
      });

      toast.success(`Exported "${uploadedItem.name}" directly to Google Drive!`);
      if (onExportSuccess) {
        onExportSuccess(uploadedItem);
      }
      onOpenChange(false);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Failed to export to Google Drive');
    } finally {
      setIsTransferring(false);
      setTransferProgress(null);
    }
  };

  const handleClearCache = async () => {
    await clearAllDriveCache();
    await loadCachedFiles();
    toast.success('Cleared Google Drive temporary IndexedDB cache');
  };

  const handleRemoveSingleCache = async (fileId: string) => {
    await removeCachedDriveFile(fileId);
    await loadCachedFiles();
    toast.success('Removed from local cache');
  };

  // Render file icon by extension/mimeType
  const renderFileIcon = (file: DriveFileItem) => {
    if (file.isFolder) {
      return <Folder className="w-5 h-5 text-amber-500 shrink-0" />;
    }
    const name = file.name.toLowerCase();
    if (name.endsWith('.epub')) {
      return <BookOpen className="w-5 h-5 text-indigo-500 shrink-0" />;
    }
    if (name.endsWith('.pdf')) {
      return <FileText className="w-5 h-5 text-rose-500 shrink-0" />;
    }
    if (name.endsWith('.cbz') || name.endsWith('.cbr') || name.endsWith('.zip')) {
      return <Layers className="w-5 h-5 text-amber-600 shrink-0" />;
    }
    if (file.mimeType.startsWith('image/') || name.endsWith('.jpg') || name.endsWith('.png') || name.endsWith('.webp')) {
      return <ImageIcon className="w-5 h-5 text-emerald-500 shrink-0" />;
    }
    return <FileText className="w-5 h-5 text-blue-500 shrink-0" />;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl w-[95vw] sm:w-[90vw] md:max-w-3xl p-0 overflow-hidden border-border bg-card shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <DialogHeader className="p-4 sm:p-5 border-b border-border bg-card flex flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center p-1.5 shadow-xs">
              <GoogleDriveIcon className="w-full h-full" />
            </div>
            <div>
              <DialogTitle className="text-base sm:text-lg font-bold flex items-center gap-2">
                Google Drive
              </DialogTitle>
            </div>
          </div>
        </DialogHeader>

        {/* Auth / Account Bar */}
        {isAuthenticated && userProfile && (
          <div className="px-4 py-2.5 bg-muted/40 border-b border-border flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 truncate">
              {userProfile.photoURL ? (
                <img
                  src={userProfile.photoURL}
                  alt={userProfile.name || 'Google User'}
                  className="w-6 h-6 rounded-full object-cover shrink-0"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold text-[10px]">
                  {(userProfile.name || userProfile.email || 'G').charAt(0).toUpperCase()}
                </div>
              )}
              <div className="truncate">
                <span className="font-semibold text-foreground mr-1">{userProfile.name || 'Connected'}</span>
                <span className="text-muted-foreground text-[11px]">({userProfile.email})</span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-muted-foreground hover:text-foreground"
                onClick={handleSignOut}
              >
                Disconnect
              </Button>
            </div>
          </div>
        )}

        {/* Tab Navigation */}
        {isAuthenticated && initialMode !== 'export' && (
          <div className="flex items-center gap-1 px-4 pt-2 border-b border-border bg-card text-xs">
            <button
              onClick={() => setActiveTab('import')}
              className={`pb-2 px-3 font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
                activeTab === 'import'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Download className="w-3.5 h-3.5" />
              Import Books
            </button>
            <button
              onClick={() => {
                setActiveTab('cache');
                loadCachedFiles();
              }}
              className={`pb-2 px-3 font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
                activeTab === 'cache'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <HardDrive className="w-3.5 h-3.5" />
              Local Cache ({cachedMetas.length})
            </button>
          </div>
        )}

        {/* Transfer Progress Overlay */}
        {isTransferring && transferProgress && (
          <div className="p-4 bg-primary/5 border-b border-primary/20 space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold">
              <span className="flex items-center gap-2 text-primary">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {transferProgress.message || 'Processing transfer...'}
              </span>
              <span className="font-mono text-primary font-bold">{transferProgress.percent}%</span>
            </div>
            <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
              <div
                className="bg-primary h-full transition-all duration-200 rounded-full"
                style={{ width: `${transferProgress.percent}%` }}
              />
            </div>
            <div className="text-[11px] text-muted-foreground flex items-center justify-between">
              <span>Direct File Transfer</span>
              <span>{formatFileSize(transferProgress.loaded)} / {formatFileSize(transferProgress.total)}</span>
            </div>
          </div>
        )}

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-[360px]">
          {!isAuthenticated ? (
            /* Unauthenticated View */
            <div className="py-8 px-4 flex flex-col items-center text-center max-w-md mx-auto space-y-5">
              <div className="w-16 h-16 rounded-2xl bg-muted/60 flex items-center justify-center p-3 shadow-inner">
                <GoogleDriveIcon className="w-full h-full" />
              </div>
              <div className="space-y-2">
                <h3 className="text-lg font-bold text-foreground">Connect Google Drive</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Import comics, manga, EPUBs, and PDFs directly from your Google Drive into the Reader and Converter, or backup your converted books to Drive.
                </p>
              </div>

              {/* Popup Blocked Warning Box */}
              {popupBlocked && (
                <div className="w-full p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-900 dark:text-amber-200 text-left space-y-3">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <h4 className="text-sm font-semibold text-foreground">Pop-up Blocked by Browser</h4>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Your browser blocked the Google authentication pop-up. Because the app is running in an embedded preview, browsers frequently block pop-up windows by default.
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <a
                      href={window.location.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-primary text-primary-foreground text-xs font-semibold rounded-md shadow-xs hover:bg-primary/90 transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Open App in New Tab to Sign In
                    </a>
                    <button
                      type="button"
                      onClick={handleSignIn}
                      disabled={isAuthenticating}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-muted hover:bg-muted/80 text-foreground text-xs font-medium rounded-md border border-border transition-colors cursor-pointer"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isAuthenticating ? 'animate-spin' : ''}`} />
                      Try Again
                    </button>
                  </div>
                  <p className="text-[11px] text-muted-foreground border-t border-border/40 pt-2">
                    💡 Tip: Look for the Pop-up Blocked icon in your browser&apos;s address bar to allow pop-ups for this app.
                  </p>
                </div>
              )}

              {/* Official Google Styled Button */}
              <div className="w-full space-y-2">
                <button
                  type="button"
                  onClick={handleSignIn}
                  disabled={isAuthenticating}
                  className="w-full inline-flex items-center justify-center gap-3 px-5 py-2.5 bg-background hover:bg-muted/80 text-foreground text-sm font-medium border border-border rounded-md shadow-xs transition-all hover:shadow cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isAuthenticating ? (
                    <Loader2 className="w-4 h-4 animate-spin text-primary" />
                  ) : (
                    <svg className="w-4 h-4" viewBox="0 0 48 48">
                      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                    </svg>
                  )}
                  <span>{isAuthenticating ? 'Connecting...' : 'Sign in with Google'}</span>
                </button>

                {isInIframe && !popupBlocked && (
                  <p className="text-[11px] text-muted-foreground flex items-center justify-center gap-1">
                    <span>Preview mode: If pop-ups are blocked,</span>
                    <a
                      href={window.location.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline font-medium inline-flex items-center gap-0.5"
                    >
                      open in new tab
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </p>
                )}
              </div>
            </div>
          ) : initialMode === 'export' ? (
            /* Export to Drive View - strictly for export process */
            <div className="space-y-4 max-w-xl mx-auto py-2">
              <Card className="p-4 border-border space-y-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-foreground">File to Export</label>
                  <Input
                    type="text"
                    value={exportFileName}
                    onChange={(e) => setExportFileName(e.target.value)}
                    placeholder="Book name e.g. MyNovel.epub or Comic.cbz"
                    className="h-8.5 text-xs"
                  />
                  {exportFile?.blob && (
                    <p className="text-[11px] text-muted-foreground">
                      Size: {formatFileSize(exportFile.blob.size)} &bull; Format: {exportFile.mimeType || 'application/octet-stream'}
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-foreground">Destination Folder</label>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-[11px] text-primary gap-1"
                      onClick={() => setShowCreateFolder(prev => !prev)}
                    >
                      <FolderPlus className="w-3 h-3" />
                      New Folder
                    </Button>
                  </div>

                  {showCreateFolder && (
                    <div className="flex items-center gap-1.5 p-2 bg-muted/30 rounded-md border border-border">
                      <Input
                        type="text"
                        value={newFolderName}
                        onChange={(e) => setNewFolderName(e.target.value)}
                        placeholder="Folder name (e.g. My eBooks)"
                        className="h-7 text-xs"
                      />
                      <Button
                        size="sm"
                        className="h-7 text-xs px-2.5"
                        onClick={handleCreateNewFolder}
                        disabled={isCreatingFolder || !newFolderName.trim()}
                      >
                        {isCreatingFolder ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Create'}
                      </Button>
                    </div>
                  )}

                  <select
                    value={exportFolderId}
                    onChange={(e) => setExportFolderId(e.target.value)}
                    className="w-full h-8.5 text-xs px-2.5 rounded-md border border-input bg-background text-foreground"
                  >
                    <option value="root">My Drive (Root)</option>
                    {exportFolders.map((f) => (
                      <option key={f.id} value={f.id}>
                        📁 {f.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="pt-2">
                  <Button
                    className="w-full text-xs font-bold gap-2"
                    onClick={handleExportFile}
                    disabled={isTransferring || !exportFile?.blob}
                  >
                    {isTransferring ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Uploading to Drive...
                      </>
                    ) : (
                      <>
                        <Upload className="w-3.5 h-3.5" />
                        Export Directly to Google Drive
                      </>
                    )}
                  </Button>
                </div>
              </Card>
            </div>
          ) : activeTab === 'cache' ? (
            /* Local Cache Tab */
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  Files cached locally from Google Drive ({cachedMetas.length})
                </span>
                {cachedMetas.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[11px] text-destructive hover:bg-destructive/10"
                    onClick={handleClearCache}
                  >
                    <Trash2 className="w-3 h-3 mr-1" />
                    Clear Cache
                  </Button>
                )}
              </div>

              {cachedMetas.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground space-y-1">
                  <p className="text-xs">No cached Google Drive files.</p>
                  <p className="text-[11px] text-muted-foreground/70">
                    When you import files from Drive, they are saved locally so you don&apos;t have to re-download them.
                  </p>
                </div>
              ) : (
                <div className="border border-border rounded-md divide-y divide-border overflow-hidden">
                  {cachedMetas.map((meta) => (
                    <div key={meta.fileId} className="flex items-center justify-between p-2.5 text-xs hover:bg-muted/30">
                      <div className="truncate flex-1 mr-2">
                        <p className="font-medium text-foreground truncate">{meta.name}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {formatFileSize(meta.size)} &bull; Cached on {new Date(meta.cachedAt).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Button
                          variant="secondary"
                          size="sm"
                          className="h-6 text-[10px]"
                          onClick={() => {
                            handleImportFile({
                              id: meta.fileId,
                              name: meta.name,
                              mimeType: meta.mimeType,
                              sizeBytes: meta.size,
                            });
                          }}
                        >
                          Open
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-muted-foreground hover:text-destructive"
                          onClick={() => handleRemoveSingleCache(meta.fileId)}
                          title="Remove from cache"
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* Browse & Import Tab - strictly for import process */
            <div className="space-y-3">
              {/* Search & Filter Bar */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') fetchFiles(currentFolderId, searchQuery, filterType);
                    }}
                    placeholder="Search books & comics in Google Drive..."
                    className="h-8.5 text-xs pl-8 pr-8"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => {
                        setSearchQuery('');
                        fetchFiles(currentFolderId, '', filterType);
                      }}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-xs"
                    >
                      ×
                    </button>
                  )}
                </div>

                {/* Filter Pills */}
                <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0 shrink-0">
                  <button
                    onClick={() => {
                      setFilterType('books');
                      fetchFiles(currentFolderId, searchQuery, 'books');
                    }}
                    className={`px-2 py-1 text-[11px] rounded-md transition-colors ${
                      filterType === 'books'
                        ? 'bg-primary text-primary-foreground font-bold'
                        : 'bg-muted text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Books & Comics
                  </button>
                  <button
                    onClick={() => {
                      setFilterType('comics');
                      fetchFiles(currentFolderId, searchQuery, 'comics');
                    }}
                    className={`px-2 py-1 text-[11px] rounded-md transition-colors ${
                      filterType === 'comics'
                        ? 'bg-primary text-primary-foreground font-bold'
                        : 'bg-muted text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    CBZ/Zip
                  </button>
                  <button
                    onClick={() => {
                      setFilterType('epubs');
                      fetchFiles(currentFolderId, searchQuery, 'epubs');
                    }}
                    className={`px-2 py-1 text-[11px] rounded-md transition-colors ${
                      filterType === 'epubs'
                        ? 'bg-primary text-primary-foreground font-bold'
                        : 'bg-muted text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    EPUB
                  </button>
                  <button
                    onClick={() => {
                      setFilterType('all');
                      fetchFiles(currentFolderId, searchQuery, 'all');
                    }}
                    className={`px-2 py-1 text-[11px] rounded-md transition-colors ${
                      filterType === 'all'
                        ? 'bg-primary text-primary-foreground font-bold'
                        : 'bg-muted text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    All Files
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => fetchFiles(currentFolderId, searchQuery, filterType)}
                    title="Refresh"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>

              {/* Breadcrumb Path */}
              <div className="flex items-center gap-1 text-xs text-muted-foreground overflow-x-auto py-1 px-1">
                {breadcrumbs.map((bc, idx) => (
                  <React.Fragment key={bc.id}>
                    {idx > 0 && <ChevronRight className="w-3 h-3 text-muted-foreground/60 shrink-0" />}
                    <button
                      onClick={() => handleNavigateBreadcrumb(idx)}
                      className={`hover:text-foreground truncate max-w-[120px] transition-colors ${
                        idx === breadcrumbs.length - 1 ? 'font-bold text-foreground' : ''
                      }`}
                    >
                      {bc.name}
                    </button>
                  </React.Fragment>
                ))}
              </div>

              {/* File List */}
              <div className="border border-border rounded-md overflow-hidden bg-card divide-y divide-border min-h-[220px] max-h-[380px] overflow-y-auto">
                {loadingFiles ? (
                  <div className="py-12 flex flex-col items-center justify-center text-muted-foreground space-y-2">
                    <Loader2 className="w-6 h-6 animate-spin text-primary" />
                    <span className="text-xs">Connecting to Google Drive...</span>
                  </div>
                ) : files.length === 0 ? (
                  <div className="py-12 text-center text-muted-foreground space-y-1">
                    <p className="text-xs font-semibold">No matching books found in this folder.</p>
                    <p className="text-[11px] text-muted-foreground/70">
                      Switch filter to &quot;All Files&quot; or upload books directly to this folder in Google Drive.
                    </p>
                  </div>
                ) : (
                  files.map((file) => {
                    const isSelected = selectedFile?.id === file.id;
                    return (
                      <div
                        key={file.id}
                        onClick={() => {
                          if (file.isFolder) {
                            handleNavigateFolder(file);
                          } else {
                            setSelectedFile(file);
                          }
                        }}
                        onDoubleClick={() => {
                          if (file.isFolder) {
                            handleNavigateFolder(file);
                          } else {
                            handleImportFile(file);
                          }
                        }}
                        className={`flex items-center justify-between p-2.5 text-xs transition-colors cursor-pointer select-none ${
                          isSelected
                            ? 'bg-primary/10 text-foreground font-semibold'
                            : 'hover:bg-muted/50 text-foreground/90'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 truncate flex-1 mr-2">
                          {renderFileIcon(file)}
                          <span className="truncate">{file.name}</span>
                        </div>
                        <div className="flex items-center gap-3 shrink-0 text-[11px] text-muted-foreground">
                          {!file.isFolder && <span>{file.size}</span>}
                          {file.isFolder ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-[10px]"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleNavigateFolder(file);
                              }}
                            >
                              Open Folder
                            </Button>
                          ) : (
                            <Button
                              variant={isSelected ? 'default' : 'secondary'}
                              size="sm"
                              className="h-6 px-2 text-[10px] gap-1"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleImportFile(file);
                              }}
                              disabled={isTransferring}
                            >
                              <Download className="w-3 h-3" />
                              Import
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Bottom Action */}
              <div className="flex items-center justify-between pt-1 text-xs">
                <span className="text-[11px] text-muted-foreground truncate">
                  {selectedFile ? `Selected: ${selectedFile.name} (${selectedFile.size})` : `${files.length} items`}
                </span>
                <Button
                  variant="default"
                  size="sm"
                  disabled={!selectedFile || selectedFile.isFolder || isTransferring}
                  onClick={() => handleImportFile()}
                  className="gap-1.5"
                >
                  {isTransferring ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Download className="w-3.5 h-3.5" />
                  )}
                  Import to App
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
