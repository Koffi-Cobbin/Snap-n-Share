import { useEffect, useState } from "react";
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
import { Share, Shield, Camera, Image as ImageIcon, Trash2, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import QRCode from "qrcode";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { UploadButton } from "@/components/upload-button";

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

  const shareUrl = typeof window !== "undefined" ? window.location.href : "";

  // Admin query key is different so React Query refetches with the passcode header
  const photosQueryKey = [...getListPhotosQueryKey(code), isAdmin ? "admin" : "guest"];

  const { data: event, isLoading: isLoadingEvent } = useGetEvent(code, {
    query: { enabled: !!code, queryKey: getGetEventQueryKey(code) },
  });

  const { data: photos = [], isLoading: isLoadingPhotos } = useListPhotos(code, {
    query: { enabled: !!code, queryKey: photosQueryKey },
    request: isAdmin && adminPasscode ? { headers: { "x-admin-passcode": adminPasscode } } : {},
  });

  const verifyPasscode = useVerifyAdminPasscode();

  const deletePhoto = useDeletePhoto({
    request: { headers: { "x-admin-passcode": adminPasscode } },
  });

  const updateVisibility = useUpdatePhotoVisibility({
    request: { headers: { "x-admin-passcode": adminPasscode } },
  });

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
      // Add to both guest and admin caches
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
        queryClient.setQueryData(key, (old: Photo[] = []) =>
          old.filter((p) => p.id !== msg.photoId)
        );
      }
    }

    if (msg.type === "photo_visibility_changed") {
      // Admin sees updated photo in-place
      const adminKey = [...getListPhotosQueryKey(code), "admin"];
      queryClient.setQueryData(adminKey, (old: Photo[] = []) =>
        old.map((p) => (p.id === msg.photoId ? msg.photo : p))
      );
      // Guests: remove if hidden, add if made public
      const guestKey = [...getListPhotosQueryKey(code), "guest"];
      if (msg.visibility === "hidden") {
        queryClient.setQueryData(guestKey, (old: Photo[] = []) =>
          old.filter((p) => p.id !== msg.photoId)
        );
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
    deletePhoto.mutate(
      { code, photoId },
      {
        onError: () => toast({ title: "Failed to delete photo", variant: "destructive" }),
      }
    );
  };

  const handleToggleVisibility = (photo: Photo) => {
    const next = photo.visibility === "public" ? "hidden" : "public";
    updateVisibility.mutate(
      { code, photoId: photo.id, data: { visibility: next } },
      {
        onError: () => toast({ title: "Failed to update visibility", variant: "destructive" }),
      }
    );
  };

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
        {isLoadingPhotos ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="aspect-square rounded-xl" />)}
          </div>
        ) : photos.length === 0 ? (
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
              {photos.map((photo) => (
                <PhotoCard
                  key={photo.id}
                  photo={photo}
                  isAdmin={isAdmin}
                  onDelete={() => handleDelete(photo.id)}
                  onToggleVisibility={() => handleToggleVisibility(photo)}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </main>

      <div className="fixed bottom-6 left-0 right-0 px-6 flex justify-center z-50 pointer-events-none">
        <div className="pointer-events-auto">
          <UploadButton eventCode={code} />
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

// ─── Photo Card ────────────────────────────────────────────────────────────────

interface PhotoCardProps {
  photo: Photo;
  isAdmin: boolean;
  onDelete: () => void;
  onToggleVisibility: () => void;
}

function PhotoCard({ photo, isAdmin, onDelete, onToggleVisibility }: PhotoCardProps) {
  const [showActions, setShowActions] = useState(false);
  const isHidden = photo.visibility === "hidden";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.8 }}
      transition={{ type: "spring", stiffness: 300, damping: 25 }}
      className="relative aspect-square rounded-xl overflow-hidden bg-muted group"
    >
      <img
        src={`/api/storage/${photo.objectPath}`}
        alt="Event photo"
        className={`w-full h-full object-cover transition-opacity duration-200 ${isHidden ? "opacity-40" : ""}`}
        loading="lazy"
      />

      {/* Hidden badge */}
      {isHidden && (
        <div className="absolute top-2 left-2 bg-black/60 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex items-center gap-1">
          <EyeOff size={10} /> Hidden
        </div>
      )}

      {/* Admin action overlay */}
      {isAdmin && (
        <>
          {/* Tap/click target to toggle action bar */}
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
                  title={isHidden ? "Make public" : "Hide photo"}
                >
                  {isHidden ? <Eye size={18} /> : <EyeOff size={18} />}
                  <span className="text-[10px] font-medium">{isHidden ? "Show" : "Hide"}</span>
                </button>

                <div className="w-px h-8 bg-white/20" />

                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(); setShowActions(false); }}
                  className="flex flex-col items-center gap-0.5 text-white hover:text-red-400 transition-colors"
                  title="Delete photo"
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
