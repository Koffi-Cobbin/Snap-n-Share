import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Camera, Upload as UploadIcon } from "lucide-react";
import { useRequestUploadUrl, useAddPhoto } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { compressImage } from "@/lib/compress-image";

export interface PendingPhoto {
  localId: string;
  blobUrl: string;
  failed: boolean;
}

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

interface UploadButtonProps {
  eventCode: string;
  activeUploads: number;
  onPhotoQueued: (localId: string, blobUrl: string) => void;
  onPhotoComplete: (localId: string, success: boolean) => void;
}

export function UploadButton({ eventCode, activeUploads, onPhotoQueued, onPhotoComplete }: UploadButtonProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const requestUrl = useRequestUploadUrl();
  const addPhoto = useAddPhoto();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset input immediately so the user can pick again if validation fails
    e.target.value = "";

    // Guard: must be an image
    if (!file.type.startsWith("image/")) {
      toast({
        title: "Not an image",
        description: "Please select a photo file (JPEG, PNG, HEIC, etc.).",
        variant: "destructive",
      });
      return;
    }

    // Guard: file too large to safely compress on-device
    if (file.size > MAX_FILE_SIZE_BYTES) {
      toast({
        title: "File too large",
        description: `This photo is ${formatBytes(file.size)}. Please use a photo under ${formatBytes(MAX_FILE_SIZE_BYTES)}.`,
        variant: "destructive",
      });
      return;
    }

    // Generate a stable local ID for tracking this upload
    const localId = crypto.randomUUID();
    const blobUrl = URL.createObjectURL(file);

    // Notify parent to show preview immediately
    onPhotoQueued(localId, blobUrl);

    // Fire-and-forget upload in the background
    void (async () => {
      try {
        const compressed = await compressImage(file);

        const { uploadURL, objectPath } = await requestUrl.mutateAsync({
          data: {
            name: file.name || "photo.jpg",
            size: compressed.size,
            contentType: "image/jpeg",
          },
        });

        const uploadRes = await fetch(uploadURL, {
          method: "PUT",
          body: compressed,
          headers: { "Content-Type": "image/jpeg" },
        });

        if (!uploadRes.ok) throw new Error("Storage upload failed");

        await addPhoto.mutateAsync({ code: eventCode, data: { objectPath } });

        onPhotoComplete(localId, true);
      } catch (err) {
        console.error("Upload error:", err);
        onPhotoComplete(localId, false);
        toast({
          title: "Upload failed",
          description: "Tap the failed photo to dismiss.",
          variant: "destructive",
        });
      }
    })();
  };

  return (
    <div className="flex gap-3 bg-background/90 p-2 rounded-full shadow-xl border border-border backdrop-blur-xl">
      <input
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        ref={cameraInputRef}
        onChange={handleFileChange}
      />
      <input
        type="file"
        accept="image/*"
        className="hidden"
        ref={fileInputRef}
        onChange={handleFileChange}
      />

      <Button
        size="lg"
        className="rounded-full h-14 px-6 gap-2 text-base font-semibold shadow-md relative"
        onClick={() => cameraInputRef.current?.click()}
      >
        <Camera size={24} />
        Take Photo
        {activeUploads > 0 && (
          <span className="absolute -top-1 -right-1 bg-orange-500 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center shadow">
            {activeUploads}
          </span>
        )}
      </Button>

      <Button
        variant="secondary"
        size="lg"
        className="rounded-full h-14 w-14 p-0 shadow-md flex-shrink-0"
        onClick={() => fileInputRef.current?.click()}
      >
        <UploadIcon size={20} />
      </Button>
    </div>
  );
}
