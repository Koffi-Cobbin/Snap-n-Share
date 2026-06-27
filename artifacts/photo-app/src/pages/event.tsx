import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useRoute } from "wouter";
import {
  useGetEvent,
  getGetEventQueryKey,
  useListPhotos,
  getListPhotosQueryKey,
  useVerifyAdminPasscode,
  useDeletePhoto,
  useUpdatePhotoVisibility,
} from "@workspace/api-client-react";
import type { Photo } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import useWebSocket from "react-use-websocket";
import { Share, Shield, Camera, Image as ImageIcon, Trash2, Eye, EyeOff, ShieldCheck, AlertCircle, Download, Check } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import QRCode from "qrcode";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { UploadButton, type PendingPhoto } from "@/components/upload-button";
import { saveMyEvent, getMyEvent, touchMyEvent } from "@/lib/my-events";

function getWebSocketUrl(code: string) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws?code=${code}`;
}

type WsMessage =
  | { type: "new_photo"; photo: Photo }
  | { type: "delete_photo"; photoId: number }
  | { type: "photo_visibility_changed"; photoId: number; visibility: "public" | "hidden"; photo: Photo };

export default function EventPage() {
  const [match, params] = useRoute("/event/:code");
  const code = params?.code || "";
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [isAdmin, setIsAdmin] = useState(false);
  const [adminPasscode, setAdminPasscode] = useState("");
  const [showAdminDialog, setShowAdminDialog] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [passcodeInput, setPasscodeInput] = useState("");
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState("");

  // Pending (optimistic) photos waiting for upload to complete
  const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([]);
  // Track blob URLs so we can revoke them when done
  const blobUrlsRef = useRef<Map<string, string>>(new Map());
  // Ensure auto-auth only runs once (even in React strict mode)
  const autoAuthAttempted = useRef(false);

  const shareUrl = typeof window !== "undefined" ? window.location.href : "";
  const photosQueryKey = [...getListPhotosQueryKey(code), isAdmin ? "admin" : "guest"];

  const { data: event, isLoading: isLoadingEvent } = useGetEvent(code, {
    query: { enabled: !!code, queryKey: getGetEventQueryKey(code) },
  });

  // Set page title to event name for browser tab and when shared via some platforms
  useEffect(() => {
    if (event?.name) {
      document.title = `${event.name} — Shared Photo Wall`;
    }
    return () => { document.title = "Shared Photo Wall"; };
  }, [event?.name]);

  const { data: photos = [], isLoading: isLoadingPhotos } = useListPhotos(code, {
    query: { enabled: !!code, queryKey: photosQueryKey },
    request: isAdmin && adminPasscode ? { headers: { "x-admin-passcode": adminPasscode } } : {},
  });

  const verifyPasscode = useVerifyAdminPasscode();
  const deletePhoto = useDeletePhoto({ request: { headers: { "x-admin-passcode": adminPasscode } } });
  const updateVisibility = useUpdatePhotoVisibility({ request: { headers: { "x-admin-passcode": adminPasscode } } });

  // Upload queue callbacks
  const handlePhotoQueued = useCallback((localId: string, blobUrl: string) => {
    blobUrlsRef.current.set(localId, blobUrl);
    setPendingPhotos((prev) => [...prev, { localId, blobUrl, failed: false }]);
  }, []);

  const handlePhotoComplete = useCallback((localId: string, success: boolean) => {
    if (success) {
      // Keep preview a moment so WS real photo has time to land — no flash
      setTimeout(() => {
        setPendingPhotos((prev) => prev.filter((p) => p.localId !== localId));
        const url = blobUrlsRef.current.get(localId);
        if (url) { URL.revokeObjectURL(url); blobUrlsRef.current.delete(localId); }
      }, 600);
    } else {
      setPendingPhotos((prev) => prev.map((p) => p.localId === localId ? { ...p, failed: true } : p));
    }
  }, []);

  const dismissPending = useCallback((localId: string) => {
    setPendingPhotos((prev) => prev.filter((p) => p.localId !== localId));
    const url = blobUrlsRef.current.get(localId);
    if (url) { URL.revokeObjectURL(url); blobUrlsRef.current.delete(localId); }
  }, []);

  const activeUploads = pendingPhotos.filter((p) => !p.failed).length;

  // WebSocket
  const wsUrl = match ? getWebSocketUrl(code) : null;
  const { lastJsonMessage } = useWebSocket(wsUrl, {
    shouldReconnect: () => true,
    reconnectInterval: 3000,
  });

  useEffect(() => {
    if (!lastJsonMessage || typeof lastJsonMessage !== "object" || !("type" in lastJsonMessage)) return;
    const msg = lastJsonMessage as WsMessage;

    if (msg.type === "new_photo" && msg.photo) {
      for (const suffix of ["guest", "admin"]) {
        const key = [...getListPhotosQueryKey(code), suffix];
        queryClient.setQueryData(key, (old: Photo[] = []) =>
          old.some((p) => p.id === msg.photo.id) ? old : [msg.photo, ...old]
        );
      }
    }

    if (msg.type === "delete_photo") {
      for (const suffix of ["guest", "admin"]) {
        const key = [...getListPhotosQueryKey(code), suffix];
        queryClient.setQueryData(key, (old: Photo[] = []) => old.filter((p) => p.id !== msg.photoId));
      }
    }

    if (msg.type === "photo_visibility_changed") {
      const adminKey = [...getListPhotosQueryKey(code), "admin"];
      queryClient.setQueryData(adminKey, (old: Photo[] = []) =>
        old.map((p) => (p.id === msg.photoId ? msg.photo : p))
      );
      const guestKey = [...getListPhotosQueryKey(code), "guest"];
      if (msg.visibility === "hidden") {
        queryClient.setQueryData(guestKey, (old: Photo[] = []) => old.filter((p) => p.id !== msg.photoId));
      } else {
        queryClient.setQueryData(guestKey, (old: Photo[] = []) =>
          old.some((p) => p.id === msg.photoId) ? old : [msg.photo, ...old]
        );
      }
    }
  }, [lastJsonMessage, code, queryClient]);

  useEffect(() => {
    if (showShareDialog && shareUrl) {
      QRCode.toDataURL(shareUrl, { width: 200, margin: 2, color: { dark: "#ea580c", light: "#ffffff" } })
        .then((url) => setQrCodeDataUrl(url))
        .catch(console.error);
    }
  }, [showShareDialog, shareUrl]);

  // Auto-authenticate as admin from a previously saved passcode
  useEffect(() => {
    if (!code || autoAuthAttempted.current) return;
    autoAuthAttempted.current = true;

    const saved = getMyEvent(code);
    if (!saved?.adminPasscode) return;

    verifyPasscode.mutate(
      { code, data: { passcode: saved.adminPasscode } },
      {
        onSuccess: (res) => {
          if (res.valid) {
            setIsAdmin(true);
            setAdminPasscode(saved.adminPasscode);
            touchMyEvent(code);
          }
        },
      },
    );
  }, [code, verifyPasscode]);

  const handleAdminLogin = (e: React.FormEvent) => {
    e.preventDefault();
    verifyPasscode.mutate(
      { code, data: { passcode: passcodeInput } },
      {
        onSuccess: (res) => {
          if (res.valid) {
            setIsAdmin(true);
            setAdminPasscode(passcodeInput);
            setShowAdminDialog(false);
            saveMyEvent({
              code,
              name: event?.name ?? "Event",
              adminPasscode: passcodeInput,
              createdAt: event?.createdAt ?? new Date().toISOString(),
            });
            toast({ title: "Admin mode enabled", description: "You can now manage photos." });
          } else {
            toast({ title: "Invalid passcode", variant: "destructive" });
          }
        },
        onError: () => toast({ title: "Error verifying passcode", variant: "destructive" }),
      }
    );
  };

  const handleDelete = (photoId: number) => {
    if (!confirm("Permanently delete this photo?")) return;
    deletePhoto.mutate({ code, photoId }, {
      onError: () => toast({ title: "Failed to delete photo", variant: "destructive" }),
    });
  };

  const handleToggleVisibility = (photo: Photo) => {
    const next = photo.visibility === "public" ? "hidden" : "public";
    updateVisibility.mutate({ code, photoId: photo.id, data: { visibility: next } }, {
      onError: () => toast({ title: "Failed to update visibility", variant: "destructive" }),
    });
  };

  // ─── Selection & Download ──────────────────────────────────────────────────────

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const toggleSelection = useCallback((photoId: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(photoId)) {
        next.delete(photoId);
      } else {
        next.add(photoId);
      }
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(photos.map((p) => p.id)));
  }, [photos]);

  const isAllSelected = useMemo(
    () => photos.length > 0 && selectedIds.size === photos.length,
    [photos.length, selectedIds.size],
  );

  const handleDownloadSelected = useCallback(() => {
    const ids = [...selectedIds];
    ids.forEach((photoId, index) => {
      setTimeout(() => {
        const a = document.createElement("a");
        a.href = `/api/events/${code}/photos/${photoId}/download`;
        a.download = `photo-${photoId}.jpg`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }, index * 300);
    });
  }, [selectedIds, code]);

  if (!match) return null;

  if (isLoadingEvent) {
    return (
      <div className="min-h-screen bg-background p-4 flex flex-col space-y-4">
        <Skeleton className="h-12 w-3/4 max-w-sm rounded-xl" />
        <Skeleton className="h-8 w-1/2 rounded-lg" />
        <div className="grid grid-cols-2 gap-2 mt-8">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="aspect-square rounded-2xl" />)}
        </div>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center">
        <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
          <ImageIcon className="text-muted-foreground" size={32} />
        </div>
        <h1 className="text-2xl font-bold mb-2">Event Not Found</h1>
        <p className="text-muted-foreground">This event might have been deleted or doesn't exist.</p>
      </div>
    );
  }

  const isEmpty = photos.length === 0 && pendingPhotos.length === 0;

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col pb-24 relative">
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-md border-b border-border/50 px-4 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground truncate max-w-[200px]">{event.name}</h1>
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            Live • {photos.length} photo{photos.length !== 1 ? "s" : ""}
            {isAdmin && (
              <span className="ml-1 inline-flex items-center gap-0.5 text-orange-500 font-medium">
                <ShieldCheck size={11} /> Admin
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {event.hasAdminPasscode && !isAdmin && (
            <Button variant="ghost" size="icon" onClick={() => setShowAdminDialog(true)}>
              <Shield size={20} />
            </Button>
          )}
          <Button variant="secondary" size="icon" onClick={() => setShowShareDialog(true)}>
            <Share size={20} />
          </Button>
        </div>
      </header>

      <main className="flex-1 p-2">
        {isLoadingPhotos && pendingPhotos.length === 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="aspect-square rounded-xl" />)}
          </div>
        ) : isEmpty ? (
          <div className="flex flex-col items-center justify-center h-[50vh] text-center px-6">
            <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mb-6">
              <Camera className="text-primary" size={40} />
            </div>
            <h2 className="text-2xl font-bold mb-2 text-foreground">Gallery is empty</h2>
            <p className="text-muted-foreground text-lg mb-8 max-w-sm">
              Be the first to share a memory! Tap the button below to add a photo.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            <AnimatePresence>
              {/* Pending (optimistic) previews first */}
              {pendingPhotos.map((p) => (
                <PendingPhotoCard
                  key={p.localId}
                  pending={p}
                  onDismiss={() => dismissPending(p.localId)}
                />
              ))}
              {/* Real photos */}
              {photos.map((photo) => (
                <PhotoCard
                  key={photo.id}
                  photo={photo}
                  isAdmin={isAdmin}
                  isSelected={selectedIds.has(photo.id)}
                  onSelect={() => toggleSelection(photo.id)}
                  onDelete={() => handleDelete(photo.id)}
                  onToggleVisibility={() => handleToggleVisibility(photo)}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </main>

      {/* Selection action bar */}
      <AnimatePresence>
        {selectedIds.size > 0 && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="fixed bottom-24 left-0 right-0 px-4 z-50 pointer-events-none"
          >
            <div className="mx-auto max-w-lg bg-background/95 backdrop-blur-xl border border-border rounded-2xl shadow-xl px-4 py-3 flex items-center justify-between gap-3 pointer-events-auto">
              <span className="text-sm font-medium text-foreground whitespace-nowrap">
                {selectedIds.size} selected
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={clearSelection}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1"
                >
                  Deselect
                </button>
                <Button
                  size="sm"
                  onClick={handleDownloadSelected}
                  className="rounded-full gap-1.5"
                >
                  <Download size={16} />
                  Download ({selectedIds.size})
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="fixed bottom-6 left-0 right-0 px-6 flex justify-center z-40 pointer-events-none">
        <div className="pointer-events-auto">
          <UploadButton
            eventCode={code}
            activeUploads={activeUploads}
            onPhotoQueued={handlePhotoQueued}
            onPhotoComplete={handlePhotoComplete}
          />
        </div>
      </div>

      {/* Share Dialog */}
      <Dialog open={showShareDialog} onOpenChange={setShowShareDialog}>
        <DialogContent className="sm:max-w-md text-center flex flex-col items-center">
          <DialogHeader>
            <DialogTitle className="text-2xl">Share Gallery</DialogTitle>
            <DialogDescription>Scan this code to join the live gallery.</DialogDescription>
          </DialogHeader>
          <div className="bg-white p-4 rounded-2xl shadow-sm border mt-4 min-h-[200px] flex items-center justify-center">
            {qrCodeDataUrl ? (
              <img src={qrCodeDataUrl} alt="QR Code" className="w-[200px] h-[200px]" />
            ) : (
              <Skeleton className="w-[200px] h-[200px] rounded-lg" />
            )}
          </div>
          <div className="w-full flex items-center gap-2 mt-6">
            <Input readOnly value={shareUrl} className="text-center bg-muted/50 font-mono text-sm" />
            <Button onClick={() => { navigator.clipboard.writeText(shareUrl); toast({ title: "Link copied!" }); }}>
              Copy
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Admin Dialog */}
      <Dialog open={showAdminDialog} onOpenChange={setShowAdminDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Admin Access</DialogTitle>
            <DialogDescription>Enter the passcode to manage photos.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAdminLogin} className="space-y-4 mt-4">
            <Input
              type="password"
              placeholder="Passcode"
              value={passcodeInput}
              onChange={(e) => setPasscodeInput(e.target.value)}
              autoFocus
            />
            <Button type="submit" className="w-full" disabled={verifyPasscode.isPending}>
              {verifyPasscode.isPending ? "Verifying..." : "Verify"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Pending Photo Card ────────────────────────────────────────────────────────

function PendingPhotoCard({ pending, onDismiss }: { pending: PendingPhoto; onDismiss: () => void }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.8 }}
      transition={{ type: "spring", stiffness: 300, damping: 25 }}
      className={`relative aspect-square rounded-xl overflow-hidden bg-muted ring-2 ${
        pending.failed ? "ring-red-500" : "ring-primary"
      }`}
    >
      <img src={pending.blobUrl} alt="Uploading…" className="w-full h-full object-cover" />

      {/* Uploading overlay */}
      {!pending.failed && (
        <div className="absolute inset-0 bg-black/25 flex items-end justify-end p-2">
          <div className="w-5 h-5 rounded-full border-2 border-white border-t-transparent animate-spin" />
        </div>
      )}

      {/* Failed overlay */}
      {pending.failed && (
        <button
          onClick={onDismiss}
          className="absolute inset-0 bg-red-500/40 flex flex-col items-center justify-center gap-1 text-white"
        >
          <AlertCircle size={24} />
          <span className="text-xs font-semibold">Failed — tap to dismiss</span>
        </button>
      )}
    </motion.div>
  );
}

// ─── Photo Card ────────────────────────────────────────────────────────────────

interface PhotoCardProps {
  photo: Photo;
  isAdmin: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onToggleVisibility: () => void;
}

function PhotoCard({ photo, isAdmin, isSelected, onSelect, onDelete, onToggleVisibility }: PhotoCardProps) {
  const [showActions, setShowActions] = useState(false);
  const isHidden = photo.visibility === "hidden";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.8 }}
      transition={{ type: "spring", stiffness: 300, damping: 25 }}
      className={`relative aspect-square rounded-xl overflow-hidden bg-muted group ring-2 ring-inset transition-colors duration-150 ${
        isSelected ? "ring-primary" : "ring-transparent"
      }`}
    >
      <img
        src={`/api/storage/${photo.objectPath}`}
        alt="Event photo"
        className={`w-full h-full object-cover transition-all duration-200 ${isHidden ? "opacity-40" : ""} ${
          isSelected ? "brightness-75" : ""
        }`}
        loading="lazy"
      />

      {/* Selection checkbox */}
      <button
        onClick={(e) => { e.stopPropagation(); onSelect(); }}
        className={`absolute top-2 left-2 z-10 w-9 h-9 rounded-full flex items-center justify-center transition-all duration-150 ${
          isSelected
            ? "bg-primary text-primary-foreground shadow-md"
            : "bg-black/40 text-white opacity-0 group-hover:opacity-100 hover:opacity-100"
        }`}
        aria-label={isSelected ? "Deselect photo" : "Select photo"}
      >
        {isSelected ? <Check size={18} /> : <div className="w-5 h-5 rounded-full border-2 border-white/80" />}
      </button>

      {isHidden && (
        <div className="absolute top-2 right-2 bg-black/60 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex items-center gap-1 z-10">
          <EyeOff size={10} /> Hidden
        </div>
      )}

      {isAdmin && (
        <>
          <button
            className="absolute inset-0 w-full h-full"
            onClick={() => setShowActions((v) => !v)}
            aria-label="Show photo actions"
          />
          <AnimatePresence>
            {showActions && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.15 }}
                className="absolute bottom-0 left-0 right-0 flex items-center justify-around bg-black/70 backdrop-blur-sm py-2 px-1"
              >
                <button
                  onClick={(e) => { e.stopPropagation(); onToggleVisibility(); setShowActions(false); }}
                  className="flex flex-col items-center gap-0.5 text-white hover:text-orange-300 transition-colors"
                >
                  {isHidden ? <Eye size={18} /> : <EyeOff size={18} />}
                  <span className="text-[10px] font-medium">{isHidden ? "Show" : "Hide"}</span>
                </button>
                <div className="w-px h-8 bg-white/20" />
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(); setShowActions(false); }}
                  className="flex flex-col items-center gap-0.5 text-white hover:text-red-400 transition-colors"
                >
                  <Trash2 size={18} />
                  <span className="text-[10px] font-medium">Delete</span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </motion.div>
  );
}
