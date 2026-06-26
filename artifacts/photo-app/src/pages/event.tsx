import { useEffect, useState, useRef } from "react";
import { useRoute } from "wouter";
import { 
  useGetEvent, 
  getGetEventQueryKey,
  useListPhotos,
  getListPhotosQueryKey,
  useVerifyAdminPasscode,
  useDeletePhoto
} from "@workspace/api-client-react";
import type { Photo } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import useWebSocket from "react-use-websocket";
import { Share, Shield, Camera, Image as ImageIcon, Trash2 } from "lucide-react";
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
  const host = window.location.host;
  return `${protocol}//${host}/ws?code=${code}`;
}

export default function EventPage() {
  const [match, params] = useRoute("/event/:code");
  const code = params?.code || "";
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [isAdmin, setIsAdmin] = useState(false);
  const [showAdminDialog, setShowAdminDialog] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState("");

  const { data: event, isLoading: isLoadingEvent } = useGetEvent(code, {
    query: {
      enabled: !!code,
      queryKey: getGetEventQueryKey(code),
    }
  });

  const { data: photos = [], isLoading: isLoadingPhotos } = useListPhotos(code, {
    query: {
      enabled: !!code,
      queryKey: getListPhotosQueryKey(code),
    }
  });

  const verifyPasscode = useVerifyAdminPasscode();
  const deletePhoto = useDeletePhoto();

  // WebSocket integration
  const wsUrl = match ? getWebSocketUrl(code) : null;
  const { lastJsonMessage, readyState } = useWebSocket(wsUrl, {
    shouldReconnect: (closeEvent) => true,
    reconnectInterval: 3000,
  });

  useEffect(() => {
    if (lastJsonMessage && typeof lastJsonMessage === 'object' && 'type' in lastJsonMessage) {
      const msg = lastJsonMessage as { type: string, photo: Photo };
      if (msg.type === "new_photo" && msg.photo) {
        queryClient.setQueryData(getListPhotosQueryKey(code), (old: Photo[] = []) => {
          // check if already exists
          if (old.some(p => p.id === msg.photo.id)) return old;
          return [msg.photo, ...old];
        });
      }
    }
  }, [lastJsonMessage, code, queryClient]);

  const handleAdminLogin = (e: React.FormEvent) => {
    e.preventDefault();
    verifyPasscode.mutate({ code, data: { passcode } }, {
      onSuccess: (res) => {
        if (res.valid) {
          setIsAdmin(true);
          setShowAdminDialog(false);
          toast({ title: "Admin mode enabled" });
        } else {
          toast({ title: "Invalid passcode", variant: "destructive" });
        }
      },
      onError: () => {
        toast({ title: "Error verifying passcode", variant: "destructive" });
      }
    });
  };

  const handleDelete = (photoId: number) => {
    if (!confirm("Delete this photo?")) return;
    deletePhoto.mutate({ code, photoId }, {
      onSuccess: () => {
        queryClient.setQueryData(getListPhotosQueryKey(code), (old: Photo[] = []) => {
          return old.filter(p => p.id !== photoId);
        });
      }
    });
  };

  if (!match) return null;

  if (isLoadingEvent) {
    return (
      <div className="min-h-screen bg-background p-4 flex flex-col space-y-4">
        <Skeleton className="h-12 w-3/4 max-w-sm rounded-xl" />
        <Skeleton className="h-8 w-1/2 rounded-lg" />
        <div className="grid grid-cols-2 gap-2 mt-8">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="aspect-square rounded-2xl" />)}
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

  const shareUrl = window.location.href;

  useEffect(() => {
    if (showShareDialog && shareUrl) {
      QRCode.toDataURL(shareUrl, { width: 200, margin: 2, color: { dark: "#ea580c", light: "#ffffff" } })
        .then(url => setQrCodeDataUrl(url))
        .catch(err => console.error(err));
    }
  }, [showShareDialog, shareUrl]);

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col pb-24 relative">
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-md border-b border-border/50 px-4 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground truncate max-w-[200px]">{event.name}</h1>
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            Live • {photos.length} photos
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
            {[1, 2, 3, 4, 5, 6].map(i => <Skeleton key={i} className="aspect-square rounded-xl" />)}
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
              {photos.map(photo => (
                <motion.div
                  key={photo.id}
                  layout
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ type: "spring", stiffness: 300, damping: 25 }}
                  className="relative aspect-square rounded-xl overflow-hidden bg-muted group"
                >
                  <img 
                    src={`/api/storage/${photo.objectPath}`} 
                    alt="Event" 
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                  {isAdmin && (
                    <Button
                      variant="destructive"
                      size="icon"
                      className="absolute top-2 right-2 h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => handleDelete(photo.id)}
                    >
                      <Trash2 size={16} />
                    </Button>
                  )}
                </motion.div>
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
            <DialogDescription>
              Scan this code to join the live gallery.
            </DialogDescription>
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
            <Button onClick={() => {
              navigator.clipboard.writeText(shareUrl);
              toast({ title: "Link copied!" });
            }}>
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
            <DialogDescription>
              Enter the passcode to manage photos.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAdminLogin} className="space-y-4 mt-4">
            <Input
              type="password"
              placeholder="Passcode"
              value={passcode}
              onChange={e => setPasscode(e.target.value)}
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
