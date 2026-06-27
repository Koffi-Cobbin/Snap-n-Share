import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useCreateEvent, getGetEventQueryKey, getEvent } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Camera, ArrowRight, Lock, Download, History, Trash2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { usePwaInstall } from "@/hooks/use-pwa-install";
import { useQueries } from "@tanstack/react-query";
import { saveMyEvent, getMyEvents, removeMyEvent, type PersistedEvent } from "@/lib/my-events";
import { Skeleton } from "@/components/ui/skeleton";

export default function Home() {
  const [name, setName] = useState("");
  const [passcode, setPasscode] = useState("");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { canInstall, isInstalled, install } = usePwaInstall();

  const createEvent = useCreateEvent();

  // ─── My Events (localStorage) ────────────────────────────────────────────

  const [myEvents, setMyEvents] = useState<PersistedEvent[]>(() => getMyEvents());

  useEffect(() => {
    // Refresh from storage on mount (e.g. after returning from event page)
    setMyEvents(getMyEvents());
  }, []);

  // Fetch live event data for each saved event (photo count, name changes)
  const eventQueries = useQueries({
    queries: myEvents.map((ev) => ({
      queryKey: getGetEventQueryKey(ev.code),
      queryFn: () => getEvent(ev.code),
      staleTime: 30_000,
    })),
  });

  const handleRemoveEvent = (code: string) => {
    removeMyEvent(code);
    setMyEvents((prev) => prev.filter((e) => e.code !== code));
  };

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
          // Persist the event so the admin can find it after closing the app
          if (passcode.trim()) {
            saveMyEvent({
              code: data.code,
              name: data.name,
              adminPasscode: passcode.trim(),
              createdAt: data.createdAt,
            });
          }
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

        {/* ─── My Events ──────────────────────────────────────────────── */}
        {myEvents.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <History size={16} />
              <span>My Events</span>
            </div>
            <div className="space-y-2">
              {myEvents.map((ev, i) => {
                const live = eventQueries[i];
                const photoCount = live?.data?.photoCount ?? 0;
                const eventName = live?.data?.name ?? ev.name;
                const dateLabel = formatRelativeDate(ev.createdAt);

                return (
                  <div
                    key={ev.code}
                    className="flex items-center justify-between gap-3 bg-card/60 border border-border/50 rounded-2xl px-4 py-3 group hover:bg-card transition-colors"
                  >
                    <button
                      onClick={() => setLocation(`/event/${ev.code}`)}
                      className="flex-1 text-left min-w-0"
                    >
                      <p className="font-semibold text-foreground truncate text-sm">
                        {eventName}
                      </p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                        {live?.isLoading ? (
                          <Skeleton className="inline-block h-3 w-20 rounded" />
                        ) : (
                          <>
                            <span>{photoCount} photo{photoCount !== 1 ? "s" : ""}</span>
                            <span>·</span>
                            <span>{dateLabel}</span>
                          </>
                        )}
                      </p>
                    </button>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-full text-xs h-8 px-3"
                        onClick={() => setLocation(`/event/${ev.code}`)}
                      >
                        Open
                      </Button>
                      <button
                        onClick={() => handleRemoveEvent(ev.code)}
                        className="p-1.5 rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100"
                        aria-label={`Remove ${ev.name} from saved events`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatRelativeDate(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffDays < 0) return "just now";
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  return new Date(isoDate).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
