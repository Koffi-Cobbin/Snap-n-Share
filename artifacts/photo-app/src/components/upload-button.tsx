import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Camera, Upload as UploadIcon, Loader2 } from "lucide-react";
import { useRequestUploadUrl, useAddPhoto } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

interface UploadButtonProps {
  eventCode: string;
}

export function UploadButton({ eventCode }: UploadButtonProps) {
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const requestUrl = useRequestUploadUrl();
  const addPhoto = useAddPhoto();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    
    try {
      // 1. Get presigned URL
      const { uploadURL, objectPath } = await requestUrl.mutateAsync({
        data: {
          name: file.name || "photo.jpg",
          size: file.size,
          contentType: file.type || "image/jpeg",
        }
      });

      // 2. Upload file
      const uploadRes = await fetch(uploadURL, {
        method: "PUT",
        body: file,
        headers: {
          "Content-Type": file.type || "image/jpeg",
        }
      });

      if (!uploadRes.ok) throw new Error("Failed to upload to storage");

      // 3. Register photo — WebSocket broadcast will update the gallery for everyone
      await addPhoto.mutateAsync({
        code: eventCode,
        data: { objectPath }
      });

      toast({ title: "Photo added!" });
      
    } catch (err) {
      console.error("Upload error:", err);
      toast({
        title: "Upload failed",
        description: "There was a problem uploading your photo.",
        variant: "destructive"
      });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (cameraInputRef.current) cameraInputRef.current.value = "";
    }
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
        className="rounded-full h-14 px-6 gap-2 text-base font-semibold shadow-md"
        onClick={() => cameraInputRef.current?.click()}
        disabled={isUploading}
      >
        {isUploading ? <Loader2 className="animate-spin" /> : <Camera size={24} />}
        Take Photo
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
