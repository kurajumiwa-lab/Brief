import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";
import NoticeBoard, { useNoticeBoard } from "@/components/noticeboard/NoticeBoard";
import { toast } from "@/components/ui/Toast";
import { apiError } from "@/lib/api";

/**
 * NOTICE BOARD PAGE — Full page for AI-powered notice board (v3.3).
 *
 * Displays short AI-assisted articles promoting products, services, events,
 * business announcements, opportunities, and user-defined agendas.
 *
 * Uses the exact same design as the Events page for consistency.
 */
export default function NoticeBoardPage() {
  const [params, setParams] = useSearchParams();
  const me = useAuthStore((s) => s.vendor);
  const [searchQuery, setSearchQuery] = useState(params.get("search") || "");
  const [typeFilter, setTypeFilter] = useState(params.get("type") || "");
  const [statusFilter, setStatusFilter] = useState(params.get("status") || "");

  const {
    notices,
    loading,
    error,
    fetchNotices,
    createNotice,
    updateNotice,
    deleteNotice,
  } = useNoticeBoard();

  // Sync URL params with state
  useEffect(() => {
    setSearchQuery(params.get("search") || "");
    setTypeFilter(params.get("type") || "");
    setStatusFilter(params.get("status") || "");
  }, [params]);

  // Update URL when filters change
  const updateParams = useCallback((newParams) => {
    const next = new URLSearchParams(params);
    Object.entries(newParams).forEach(([key, value]) => {
      if (value) {
        next.set(key, value);
      } else {
        next.delete(key);
      }
    });
    setParams(next, { replace: true });
  }, [params, setParams]);

  // Load notices on mount
  useEffect(() => {
    fetchNotices({
      search: searchQuery,
      type: typeFilter,
      status: statusFilter,
    }).catch((e) => toast.error(apiError(e, "Failed to load notices")));
  }, [fetchNotices, searchQuery, typeFilter, statusFilter]);

  const handleCreate = useCallback(async (noticeData) => {
    try {
      await createNotice(noticeData);
    } catch (e) {
      toast.error(apiError(e, "Failed to create notice"));
    }
  }, [createNotice]);

  const handleEdit = useCallback(async (notice) => {
    // Navigate to edit page
    // In production: navigate(`/notices/${notice.id}/edit`);
    toast.info("Navigate to edit page");
  }, []);

  const handleDelete = useCallback(async (notice) => {
    if (!window.confirm(`Are you sure you want to delete "${notice.title}"?`)) return;
    
    try {
      await deleteNotice(notice.id);
    } catch (e) {
      toast.error(apiError(e, "Failed to delete notice"));
    }
  }, [deleteNotice]);

  const handlePreview = useCallback((notice) => {
    // Can open a modal or navigate to detail page
    toast.info(`Preview: ${notice.title}`);
  }, []);

  const handleSearch = useCallback((query) => {
    setSearchQuery(query);
    updateParams({ search: query || null });
  }, [updateParams]);

  const handleTypeChange = useCallback((type) => {
    setTypeFilter(type);
    updateParams({ type: type || null });
  }, [updateParams]);

  const handleStatusChange = useCallback((status) => {
    setStatusFilter(status);
    updateParams({ status: status || null });
  }, [updateParams]);

  return (
    <div className="space-y-6">
      <NoticeBoard
        notices={notices}
        loading={loading}
        onCreate={handleCreate}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onPreview={handlePreview}
        canCreate={!!me} // Only vendors can create
      />
    </div>
  );
}
