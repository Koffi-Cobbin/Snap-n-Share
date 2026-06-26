import { useState } from "react";
import { useLocation } from "wouter";
import { useCreateEvent } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Camera, ArrowRight, Lock, Download } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { usePwaInstall } from "@/hooks/use-pwa-install";

export default function Home() {
  const [name, setName] = useState("");
  const [passcode, setPasscode] = useState("");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { canInstall, isInstalled, install } = usePwaInstall();

  const createEvent = useCreateEvent();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    createEvent.mutate(
      {
        data: {
          name: name.trim(),
          adminPasscode: passcode.trim() || null,
        },
      },
      {
        onSuccess: (data) => {
          setLocation(`/event/${data.code}`);
        },
        onError: () => {
          toast({
            title: "Error creating event",
            description: "Please try again later.",
            variant: "destructive",
          });
        },
      }
    );
  };

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center p-6 bg-background relative overflow-hidden">
      <div className="absolute inset-0 z-0 opacity-30 pointer-events-none">
        <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] rounded-full bg-primary/20 blur-[100px]" />
        <div className="absolute -bottom-[20%] -right-[10%] w-[50%] h-[50%] rounded-full bg-secondary/40 blur-[100px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md space-y-8 z-10"
      >
        <div className="text-center space-y-4">
          <div className="w-16 h-16 bg-primary text-primary-foreground rounded-2xl flex items-center justify-center mx-auto shadow-xl transform rotate-3">
            <Camera size={32} />
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-foreground">
            Shared Photo Wall
          </h1>
          <p className="text-muted-foreground text-lg">
            Create a live gallery for your event. Anyone can add photos instantly.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6 bg-card p-6 rounded-3xl shadow-sm border border-border/50">
          <div className="space-y-2">
            <Label htmlFor="name" className="text-base">Event Name</Label>
            <Input
              id="name"
              placeholder="e.g. Sarah & John's Wedding"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="text-lg py-6 rounded-xl bg-muted/50 border-transparent focus-visible:ring-primary"
              disabled={createEvent.isPending}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="passcode" className="text-base flex items-center gap-2">
              <Lock size={16} className="text-muted-foreground" />
              Admin Passcode <span className="text-muted-foreground text-sm font-normal">(Optional)</span>
            </Label>
            <Input
              id="passcode"
              type="password"
              placeholder="Secret code to delete photos"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              className="text-lg py-6 rounded-xl bg-muted/50 border-transparent focus-visible:ring-primary"
              disabled={createEvent.isPending}
            />
          </div>

          <Button
            type="submit"
            className="w-full py-6 text-lg rounded-xl shadow-md group"
            disabled={!name.trim() || createEvent.isPending}
          >
            {createEvent.isPending ? (
              "Creating..."
            ) : (
              <>
                Create Event
                <ArrowRight className="ml-2 group-hover:translate-x-1 transition-transform" size={20} />
              </>
            )}
          </Button>
        </form>

        <AnimatePresence>
          {canInstall && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
            >
              <button
                onClick={install}
                className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-2xl border border-border/60 bg-card/60 text-sm text-muted-foreground hover:text-foreground hover:bg-card transition-all"
              >
                <Download size={15} />
                Add to Home Screen
              </button>
            </motion.div>
          )}
          {isInstalled && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center text-sm text-muted-foreground"
            >
              App installed on your device
            </motion.p>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
