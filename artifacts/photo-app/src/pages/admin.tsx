import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Shield,
  ShieldCheck,
  ExternalLink,
  Pencil,
  Trash2,
  Plus,
  LogOut,
  Camera,
  Lock,
  Calendar,
  ImageIcon,
  Loader2,
  AlertTriangle,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

interface AdminEvent {
  id: number;
  code: string;
  name: string;
  hasAdminPasscode: boolean;
  photoCount: number;
  createdAt: string;
}

type PageState = "login" | "loading" | "dashboard" | "error";

// ─── Constants ──────────────────────────────────────────────────────────────

const ADMIN_NAME = "Admin";

// ─── Component ──────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  // Login state
  const [name, setName] = useState(ADMIN_NAME);
  const [passcode, setPasscode] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Session state
  const [sessionPasscode, setSessionPasscode] = useState("");
  const [pageState, setPageState] = useState<PageState>("login");
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [fetchError, setFetchError] = useState("");

  // Create event state
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPasscode, setNewPasscode] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  // Rename event state
  const [renameTarget, setRenameTarget] = useState<AdminEvent | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);

  // Delete event state
  const [deleteTarget, setDeleteTarget] = useState<AdminEvent | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // ─── Auth headers ──────────────────────────────────────────────────────

  const authHeaders = useCallback(
    (): Record<string, string> => ({
      "Content-Type": "application/json",
      "x-global-admin-passcode": sessionPasscode,
    }),
    [sessionPasscode],
  );

  // ─── Login ─────────────────────────────────────────────────────────────

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !passcode.trim()) return;

    setIsLoggingIn(true);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), passcode: passcode.trim() }),
      });
      const data = await res.json();

      if (data.valid) {
        setSessionPasscode(passcode.trim());
        setPageState("loading");
        fetchEvents(passcode.trim());
      } else {
        toast({ title: "Invalid credentials", variant: "destructive" });
      }
    } catch {
      toast({ title: "Login failed", description: "Could not connect to server.", variant: "destructive" });
    } finally {
      setIsLoggingIn(false);
    }
  };

  // ─── Fetch events ──────────────────────────────────────────────────────

  const fetchEvents = async (pass: string) => {
    setPageState("loading");
    setFetchError("");
    try {
      const res = await fetch("/api/admin/events", {
        headers: {
          "Content-Type": "application/json",
          "x-global-admin-passcode": pass,
        },
      });
      if (!res.ok) {
        if (res.status === 403) {
          setPageState("login");
          toast({ title: "Session expired", description: "Please log in again.", variant: "destructive" });
          return;
        }
        throw new Error(`Failed to fetch events: ${res.status}`);
      }
      const data: AdminEvent[] = await res.json();
      setEvents(data);
      setPageState("dashboard");
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Unknown error");
      setPageState("error");
    }
  };

  // Refresh helper using current sessionPasscode
  const refreshEvents = useCallback(() => {
    if (sessionPasscode) fetchEvents(sessionPasscode);
  }, [sessionPasscode]);

  // ─── Create event ──────────────────────────────────────────────────────

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;

    setIsCreating(true);
    try {
      const res = await fetch("/api/admin/events", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          name: newName.trim(),
          adminPasscode: newPasscode.trim() || null,
        }),
      });

      if (!res.ok) throw new Error(`Failed to create: ${res.status}`);

      const created: AdminEvent = await res.json();
      setEvents((prev) => [created, ...prev]);
      setShowCreateDialog(false);
      setNewName("");
      setNewPasscode("");
      toast({ title: `Event "${created.name}" created` });
    } catch {
      toast({ title: "Failed to create event", variant: "destructive" });
    } finally {
      setIsCreating(false);
    }
  };

  // ─── Rename event ──────────────────────────────────────────────────────

  const openRename = (event: AdminEvent) => {
    setRenameTarget(event);
    setRenameValue(event.name);
  };

  const handleRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renameTarget || !renameValue.trim()) return;

    setIsRenaming(true);
    try {
      const res = await fetch(`/api/admin/events/${renameTarget.id}`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ name: renameValue.trim() }),
      });

      if (!res.ok) throw new Error(`Failed to rename: ${res.status}`);

      const updated: AdminEvent = await res.json();
      setEvents((prev) => prev.map((ev) => (ev.id === updated.id ? updated : ev)));
      setRenameTarget(null);
      toast({ title: "Event renamed" });
    } catch {
      toast({ title: "Failed to rename event", variant: "destructive" });
    } finally {
      setIsRenaming(false);
    }
  };

  // ─── Delete event ──────────────────────────────────────────────────────

  const openDelete = (event: AdminEvent) => setDeleteTarget(event);

  const handleDelete = async () => {
    if (!deleteTarget) return;

    setIsDeleting(true);
    try {
      const res = await fetch(`/api/admin/events/${deleteTarget.id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });

      if (!res.ok) throw new Error(`Failed to delete: ${res.status}`);

      setEvents((prev) => prev.filter((ev) => ev.id !== deleteTarget.id));
      setDeleteTarget(null);
      toast({ title: `Event "${deleteTarget.name}" deleted` });
    } catch {
      toast({ title: "Failed to delete event", variant: "destructive" });
    } finally {
      setIsDeleting(false);
    }
  };

  // ─── Logout ────────────────────────────────────────────────────────────

  const handleLogout = () => {
    setSessionPasscode("");
    setEvents([]);
    setPageState("login");
    setPasscode("");
  };

  // ─── Render: Login ─────────────────────────────────────────────────────

  if (pageState === "login") {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center p-6 bg-background relative overflow-hidden">
        <div className="absolute inset-0 z-0 opacity-30 pointer-events-none">
          <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] rounded-full bg-primary/20 blur-[100px]" />
          <div className="absolute -bottom-[20%] -right-[10%] w-[50%] h-[50%] rounded-full bg-destructive/20 blur-[100px]" />
        </div>

        <div className="w-full max-w-sm space-y-8 z-10">
          <div className="text-center space-y-4">
            <div className="w-16 h-16 bg-destructive text-destructive-foreground rounded-2xl flex items-center justify-center mx-auto shadow-xl transform -rotate-3">
              <Shield size={32} />
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">
              Admin Dashboard
            </h1>
            <p className="text-muted-foreground text-sm">
              Sign in with your global admin credentials to manage all events.
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-5 bg-card p-6 rounded-3xl shadow-sm border border-border/50">
            <div className="space-y-2">
              <Label htmlFor="admin-name" className="text-sm">Event Name</Label>
              <Input
                id="admin-name"
                placeholder="Admin"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="py-5 rounded-xl bg-muted/50 border-transparent"
                disabled={isLoggingIn}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="admin-passcode" className="text-sm flex items-center gap-2">
                <Lock size={14} className="text-muted-foreground" />
                Admin Passcode
              </Label>
              <Input
                id="admin-passcode"
                type="password"
                placeholder="Enter your passcode"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                className="py-5 rounded-xl bg-muted/50 border-transparent"
                disabled={isLoggingIn}
              />
            </div>

            <Button
              type="submit"
              className="w-full py-5 text-base rounded-xl"
              disabled={!name.trim() || !passcode.trim() || isLoggingIn}
            >
              {isLoggingIn ? (
                <>
                  <Loader2 size={18} className="mr-2 animate-spin" />
                  Signing in...
                </>
              ) : (
                <>
                  <ShieldCheck size={18} className="mr-2" />
                  Sign In
                </>
              )}
            </Button>
          </form>
        </div>
      </div>
    );
  }

  // ─── Render: Loading ───────────────────────────────────────────────────

  if (pageState === "loading") {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="max-w-5xl mx-auto space-y-6">
          <Skeleton className="h-8 w-48 rounded-lg" />
          <Skeleton className="h-10 w-full rounded-xl" />
          <div className="space-y-2">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ─── Render: Error ─────────────────────────────────────────────────────

  if (pageState === "error") {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
        <div className="w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mb-4">
          <AlertTriangle className="text-destructive" size={32} />
        </div>
        <h2 className="text-xl font-bold mb-2">Failed to load events</h2>
        <p className="text-muted-foreground text-sm mb-6">{fetchError}</p>
        <div className="flex gap-3">
          <Button variant="outline" onClick={handleLogout}>Back to Login</Button>
          <Button onClick={refreshEvents}>Retry</Button>
        </div>
      </div>
    );
  }

  // ─── Render: Dashboard ─────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-md border-b border-border/50 px-4 py-3">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-destructive/10 rounded-xl flex items-center justify-center">
              <ShieldCheck size={18} className="text-destructive" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">Admin Dashboard</h1>
              <p className="text-xs text-muted-foreground">
                {events.length} event{events.length !== 1 ? "s" : ""} total
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="rounded-full gap-1.5"
              onClick={() => setShowCreateDialog(true)}
            >
              <Plus size={15} />
              New Event
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="rounded-full gap-1.5 text-muted-foreground"
              onClick={handleLogout}
            >
              <LogOut size={15} />
              Sign Out
            </Button>
          </div>
        </div>
      </header>

      {/* Table */}
      <main className="max-w-5xl mx-auto p-4">
        <div className="rounded-2xl border border-border/50 bg-card overflow-hidden shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[30%]">Event Name</TableHead>
                <TableHead className="w-[18%]">Code</TableHead>
                <TableHead className="w-[12%] text-center">Photos</TableHead>
                <TableHead className="w-[14%] text-center">Passcode</TableHead>
                <TableHead className="w-[16%] hidden md:table-cell">Created</TableHead>
                <TableHead className="w-[10%] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                    <div className="flex flex-col items-center gap-2">
                      <Camera size={32} className="opacity-30" />
                      <p className="text-sm font-medium">No events yet</p>
                      <p className="text-xs">Create your first event to get started.</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                events.map((event) => (
                  <TableRow key={event.id} className="group">
                    <TableCell className="font-medium truncate max-w-[200px]">
                      {event.name}
                    </TableCell>
                    <TableCell>
                      <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
                        {event.code}
                      </code>
                    </TableCell>
                    <TableCell className="text-center">
                      <span className="inline-flex items-center gap-1 text-sm tabular-nums">
                        <ImageIcon size={13} className="text-muted-foreground" />
                        {event.photoCount}
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      {event.hasAdminPasscode ? (
                        <Badge variant="secondary" className="text-[10px] gap-1">
                          <Lock size={10} />
                          Protected
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px]">
                          Open
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground hidden md:table-cell">
                      {formatDate(event.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-0.5 opacity-60 group-hover:opacity-100 transition-opacity">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={() => setLocation(`/event/${event.code}`)}
                          title="View event"
                        >
                          <ExternalLink size={15} />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={() => openRename(event)}
                          title="Rename event"
                        >
                          <Pencil size={15} />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => openDelete(event)}
                          title="Delete event"
                        >
                          <Trash2 size={15} />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <p className="text-xs text-muted-foreground text-center mt-6">
          Events are created on the public home page as well. Deleting an event also removes all its photos.
        </p>
      </main>

      {/* ─── Create Event Dialog ──────────────────────────────────────── */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Event</DialogTitle>
            <DialogDescription>
              Create a new event from the admin dashboard.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-name">Event Name</Label>
              <Input
                id="new-name"
                placeholder="e.g. Company Picnic"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                disabled={isCreating}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-passcode" className="flex items-center gap-2">
                <Lock size={14} className="text-muted-foreground" />
                Admin Passcode <span className="text-muted-foreground text-xs font-normal">(Optional)</span>
              </Label>
              <Input
                id="new-passcode"
                type="password"
                placeholder="Leave blank for open gallery"
                value={newPasscode}
                onChange={(e) => setNewPasscode(e.target.value)}
                disabled={isCreating}
              />
            </div>
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setShowCreateDialog(false)} disabled={isCreating}>
                Cancel
              </Button>
              <Button type="submit" disabled={!newName.trim() || isCreating}>
                {isCreating ? "Creating..." : "Create Event"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ─── Rename Event Dialog ──────────────────────────────────────── */}
      <Dialog open={renameTarget !== null} onOpenChange={(open) => { if (!open) setRenameTarget(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename Event</DialogTitle>
            <DialogDescription>
              Update the name for "{renameTarget?.name}".
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleRename} className="space-y-4">
            <Input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              disabled={isRenaming}
              autoFocus
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRenameTarget(null)} disabled={isRenaming}>
                Cancel
              </Button>
              <Button type="submit" disabled={!renameValue.trim() || isRenaming}>
                {isRenaming ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ─── Delete Event Dialog ──────────────────────────────────────── */}
      <Dialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Event</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong>"{deleteTarget?.name}"</strong>?
              This will permanently remove the event and all {deleteTarget?.photoCount} photo{deleteTarget?.photoCount !== 1 ? "s" : ""}.
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 bg-destructive/5 border border-destructive/20 rounded-lg p-3 text-sm">
            <AlertTriangle size={16} className="text-destructive shrink-0" />
            <span className="text-destructive-foreground text-xs">
              All photos uploaded to this event will be permanently deleted.
            </span>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)} disabled={isDeleting}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? "Deleting..." : "Delete Event"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(isoDate: string): string {
  try {
    return new Date(isoDate).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return isoDate;
  }
}
