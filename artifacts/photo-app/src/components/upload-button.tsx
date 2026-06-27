import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Camera, Upload as UploadIcon, Loader2 } from "lucide-react";
import { useRequestUploadUrl, useAddPhoto } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { compressImage } from "@/lib/compress-image";

interface UploadButtonProps {
  eventCode: string;
}

type UploadStage = "compressing" | "uploading" | null;

const stageLabel: Record<NonNullable<UploadStage>, string> = {
  compressing: "Compressing…",
  uploading: "Uploading…",
};

export function UploadButton({ eventCode }: UploadButtonProps) {
  const [stage, setStage] = useState<UploadStage>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const requestUrl = useRequestUploadUrl();
  const addPhoto = useAddPhoto();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      // 1. Compress client-side (Canvas resize + JPEG re-encode)
      setStage("compressing");
      const compressed = await compressImage(file);

      // 2. Get upload URL
      setStage("uploading");
      const { uploadURL, objectPath } = await requestUrl.mutateAsync({
        data: {
          name: file.name || "photo.jpg",
          size: compressed.size,
          contentType: "image/jpeg",
        },
      });

      // 3. Upload compressed blob directly to storage
      const uploadRes = await fetch(uploadURL, {
        method: "PUT",
        body: compressed,
        headers: { "Content-Type": "image/jpeg" },
      });

      if (!uploadRes.ok) throw new Error("Storage upload failed");

      // 4. Register — WebSocket broadcast updates the gallery for everyone
      await addPhoto.mutateAsync({ code: eventCode, data: { objectPath } });

      toast({ title: "Photo added!" });
    } catch (err) {
      console.error("Upload error:", err);
      toast({
        title: "Upload failed",
        description: "There was a problem uploading your photo.",
        variant: "destructive",
      });
    } finally {
      setStage(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (cameraInputRef.current) cameraInputRef.current.value = "";
    }
  };

  const isUploading = stage !== null;

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
        className="rounded-full h-14 px-6 gap-2 text-base font-semibold shadow-md min-w-[160px]"
        onClick={() => cameraInputRef.current?.click()}
        disabled={isUploading}
      >
        {isUploading ? (
          <>
            <Loader2 className="animate-spin" size={20} />
            {stageLabel[stage!]}
          </>
        ) : (
          <>
            <Camera size={24} />
            Take Photo
          </>
        )}
      </Button>

      <Button
        variant="secondary"
        size="lg"
        className="rounded-full h-14 w-14 p-0 shadow-md flex-shrink-0"
        onClick={() => fileInputRef.current?.click()}
        disabled={isUploading}
      >
        <UploadIcon size={20} />
      </Button>
    </div>
  );
}
