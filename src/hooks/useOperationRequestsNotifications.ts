import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  fetchAllResolutionRequests,
  type ResolutionRequest,
} from "@/lib/batch-allocation-storage";

export interface SeenState {
  status: string;
  seenAt: string;
}

export function useOperationRequestsNotifications() {
  const { user, roles, hasAnyRole, hasRole } = useAuth();
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [actionableRequests, setActionableRequests] = useState<ResolutionRequest[]>([]);
  const [allRequests, setAllRequests] = useState<ResolutionRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const isMountedRef = useRef(true);

  const isLabManager = Boolean(hasAnyRole && hasAnyRole(["lab_manager", "administration"]));
  const isOperations = Boolean(hasRole && hasRole("operations") && !isLabManager);

  // Local storage key per user
  const storageKey = user?.id ? `op_reqs_seen_${user.id}` : "op_reqs_seen_guest";

  const getLocalSeenMap = useCallback((): Record<string, SeenState> => {
    if (typeof window === "undefined" || !window.localStorage) {
      return {};
    }
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }, [storageKey]);

  const saveLocalSeenMap = useCallback(
    (map: Record<string, SeenState>) => {
      if (typeof window === "undefined" || !window.localStorage) {
        return;
      }
      try {
        localStorage.setItem(storageKey, JSON.stringify(map));
      } catch (err) {
        console.warn("Failed to persist seen notification map to localStorage:", err);
      }
    },
    [storageKey],
  );

  // Calculate unread count given a list of requests and seen map
  const recalculateCount = useCallback(
    (requestsList: ResolutionRequest[]) => {
      if (!isMountedRef.current) return;
      const seenMap = getLocalSeenMap();

      let actionable: ResolutionRequest[] = [];
      if (isLabManager) {
        // Lab Manager acts on pending requests needing approval
        actionable = (requestsList || []).filter((r) => r && r.status === "pending");
      } else if (isOperations) {
        // Operations acts on newly approved requests
        actionable = (requestsList || []).filter((r) => r && r.status === "approved");
      } else {
        actionable = [];
      }

      setActionableRequests(actionable);

      // Unseen if not in seenMap OR status changed since last seen
      const unseen = actionable.filter((r) => {
        if (!r || !r.id) return false;
        const seen = seenMap[r.id];
        if (!seen) return true;
        return seen.status !== r.status;
      });

      setUnreadCount(unseen.length);
    },
    [isLabManager, isOperations, getLocalSeenMap],
  );

  // Load requests
  const loadRequests = useCallback(async () => {
    try {
      const data = await fetchAllResolutionRequests();
      if (!isMountedRef.current) return;
      const safeData = Array.isArray(data) ? data : [];
      setAllRequests(safeData);
      recalculateCount(safeData);
    } catch (err) {
      console.warn("Failed to fetch resolution requests for notifications:", err);
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [recalculateCount]);

  const loadRequestsRef = useRef(loadRequests);
  useEffect(() => {
    loadRequestsRef.current = loadRequests;
  }, [loadRequests]);

  useEffect(() => {
    isMountedRef.current = true;
    loadRequestsRef.current();

    // Strict Mode mounts effects twice in development. A unique topic prevents the
    // second mount from reusing a channel that is still leaving asynchronously.
    const channelId = `op_reqs_notif_${crypto.randomUUID()}`;
    let channel: any = null;

    try {
      channel = supabase
        .channel(channelId)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "batch_resolution_requests",
          },
          () => {
            if (isMountedRef.current) {
              loadRequestsRef.current();
            }
          },
        )
        .subscribe((status) => {
          if (status === "CHANNEL_ERROR") {
            console.warn("Realtime channel error for notifications");
          }
        });
    } catch (subErr) {
      console.warn("Failed to setup realtime notification channel:", subErr);
    }

    return () => {
      isMountedRef.current = false;
      if (channel) {
        try {
          supabase.removeChannel(channel);
        } catch {
          // Ignore cleanup errors
        }
      }
    };
  }, []);

  // Mark single request as seen
  const markRequestAsSeen = useCallback(
    async (requestId: string, status: string) => {
      if (!requestId) return;
      const currentMap = getLocalSeenMap();
      currentMap[requestId] = {
        status,
        seenAt: new Date().toISOString(),
      };
      saveLocalSeenMap(currentMap);

      // Also persist to Supabase if table exists (fire and forget)
      if (user?.id) {
        try {
          await (supabase as any).from("user_request_notifications").upsert(
            {
              user_id: user.id,
              request_id: requestId,
              seen_status: status,
              seen_at: new Date().toISOString(),
            },
            { onConflict: "user_id,request_id" },
          );
        } catch {
          // Gracefully fallback to localStorage
        }
      }

      recalculateCount(allRequests);
    },
    [getLocalSeenMap, saveLocalSeenMap, user?.id, allRequests, recalculateCount],
  );

  // Mark all currently actionable requests as seen
  const markAllAsSeen = useCallback(async () => {
    const currentMap = getLocalSeenMap();
    const now = new Date().toISOString();

    actionableRequests.forEach((r) => {
      if (r && r.id) {
        currentMap[r.id] = {
          status: r.status,
          seenAt: now,
        };
      }
    });

    saveLocalSeenMap(currentMap);

    if (user?.id && actionableRequests.length > 0) {
      try {
        const rows = actionableRequests
          .filter((r) => r && r.id)
          .map((r) => ({
            user_id: user.id,
            request_id: r.id,
            seen_status: r.status,
            seen_at: now,
          }));
        await (supabase as any).from("user_request_notifications").upsert(rows, {
          onConflict: "user_id,request_id",
        });
      } catch {
        // Fallback
      }
    }

    setUnreadCount(0);
  }, [getLocalSeenMap, saveLocalSeenMap, user?.id, actionableRequests]);

  return {
    unreadCount,
    actionableRequests,
    allRequests,
    loading,
    isLabManager,
    isOperations,
    markRequestAsSeen,
    markAllAsSeen,
    refreshNotifications: loadRequests,
  };
}
