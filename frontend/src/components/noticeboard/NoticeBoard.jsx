import { useState, useEffect, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Search, Sparkles, Filter, CalendarDays, MapPin, Users, Ticket, ArrowRight, Edit3, Trash2, Eye } from "lucide-react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Badge from "@/components/ui/Badge";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Modal from "@/components/ui/Modal";
import { toast } from "@/components/ui/Toast";
import { cn, titleCase } from "@/lib/utils";
import { num, dayLabel, shortDateTime, currency } from "@/lib/formatters";

/**
 * NOTICE BOARD — Short AI-assisted articles for promotions and announcements (v3.3).
 *
 * CRITICAL DESIGN REQUIREMENT: Reuse the existing Byway Events page design:
 *   - Same typography
 *   - Same spacing
 *   - Same image assets
 *   - Same aspect ratios
 *   - Same crop behavior
 *   - Same layout
 *   - Same responsive rules
 *
 * Do NOT introduce unnecessary frames or decorative card borders.
 * Do NOT overlay text on images unless the Events page already uses that treatment.
 * Do NOT combine unrelated text and images into graphics.
 * Do NOT create a different visual system.
 */

// Notice types
const NOTICE_TYPES = [
  { value: "", label: "All types" },
  { value: "product_promotion", label: "Product Promotion" },
  { value: "service_offering", label: "Service Offering" },
  { value: "event", label: "Event" },
  { value: "business_announcement", label: "Business Announcement" },
  { value: "opportunity", label: "Opportunity" },
  { value: "user_agenda", label: "User Agenda" },
];

// Audience options
const AUDIENCE_OPTIONS = [
  { value: "all", label: "All vendors" },
  { value: "local", label: "Local vendors only" },
  { value: "connected", label: "My connections" },
  { value: "category", label: "Specific category" },
];

// Tone options
const TONE_OPTIONS = [
  { value: "professional", label: "Professional" },
  { value: "friendly", label: "Friendly" },
  { value: "urgent", label: "Urgent" },
  { value: "informative", label: "Informative" },
];

// Status badges
const STATUS_BADGE = {
  draft: "gray",
  published: "brand",
  archived: "red",
  expired: "amber",
};

/**
 * Notice Card - Reuses Events page card design
 * Uses the exact same styling as EventCard
 */
function NoticeCard({ notice, onEdit, onDelete, onPreview }) {
  const isOrganizer = notice.owner?.handle === notice.organizer; // Simplified - in real app, use auth
  
  return (
    <Card className={cn("flex flex-col gap-3", notice.status === "archived" && "opacity-60")}>
      <div className="flex items-start gap-3">
        {/* Date tile - same as Events page */}
        {notice.start_date && (
          <div className="w-11 shrink-0 rounded-lg border border-edge-2 bg-surface-2 text-center overflow-hidden">
            <div className="bg-brand-700/80 text-white text-2xs uppercase tracking-wide py-0.5">
              {new Date(notice.start_date).toLocaleString("en-KE", { month: "short" })}
            </div>
            <div className="text-lg font-semibold font-mono text-ink-1 leading-tight py-1">
              {new Date(notice.start_date).getDate()}
            </div>
          </div>
        )}
        
        <div className="min-w-0 flex-1">
          <button onClick={() => onPreview?.(notice)} className="text-left">
            <h3 className="text-sm font-semibold text-ink-1 leading-snug hover:text-brand-600 dark:hover:text-brand-400">
              {notice.title}
            </h3>
          </button>
          <p className="text-2xs text-ink-4 mt-0.5">
            {NOTICE_TYPES.find(t => t.value === notice.type)?.label || titleCase(notice.type)} · 
            by <span className="text-ink-3">{notice.organizer_business || notice.owner?.name || "A vendor"}</span>
          </p>
        </div>
        
        <Badge variant={STATUS_BADGE[notice.status] || "gray"} size="xs">
          {notice.status}
        </Badge>
      </div>

      {notice.description && (
        <p className="text-xs text-ink-3 line-clamp-2">{notice.description}</p>
      )}

      {/* Metadata - same style as Events page */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-ink-4">
        {notice.start_date && (
          <span>{shortDateTime(notice.start_date)}</span>
        )}
        
        {notice.location && !notice.is_virtual && (
          <span className="inline-flex items-center gap-1">
            <MapPin size={10} /> {notice.location}
          </span>
        )}
        
        {notice.is_virtual && (
          <span className="inline-flex items-center gap-1">
            <Users size={10} /> virtual
          </span>
        )}
        
        {notice.price != null && (
          <span className="inline-flex items-center gap-1">
            <Ticket size={10} /> {notice.price ? currency(notice.price) : "free"}
          </span>
        )}
      </div>

      {/* Tags */}
      {notice.tags?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {notice.tags.slice(0, 4).map((tag) => (
            <Badge key={tag} variant="outline" size="xs">
              {tag}
            </Badge>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        <span className="inline-flex items-center gap-1 text-xs text-ink-4">
          <Users size={12} /> {num(notice.view_count || 0)} views
        </span>
        
        {isOrganizer && (
          <div className="flex items-center gap-1.5">
            <Button size="xs" variant="ghost" icon={Edit3} onClick={() => onEdit?.(notice)}>
              Edit
            </Button>
            <Button size="xs" variant="ghost" icon={Trash2} onClick={() => onDelete?.(notice)}>
              Delete
            </Button>
          </div>
        )}
        
        {!isOrganizer && notice.status === "published" && (
          <Button size="xs" variant="outline" icon={Eye} onClick={() => onPreview?.(notice)}>
            View
          </Button>
        )}
      </div>
    </Card>
  );
}

/**
 * Notice Creation Modal - AI-assisted workflow
 */
function NoticeCreationModal({
  open,
  onClose,
  onCreate,
  loading = false,
  aiDraft,
  onRequestAIDraft,
}) {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    type: "",
    title: "",
    message: "",
    audience: "all",
    tone: "professional",
    call_to_action: "",
    location: "",
    start_date: "",
    end_date: "",
    price: null,
    is_virtual: false,
    tags: [],
  });
  const [selectedImage, setSelectedImage] = useState(null);
  const [isAIGenerating, setIsAIGenerating] = useState(false);

  const handleChange = useCallback((field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  }, []);

  const handleAIDraft = useCallback(async () => {
    if (!formData.type || !formData.message) {
      toast.error("Please select a notice type and enter your message");
      return;
    }
    
    setIsAIGenerating(true);
    try {
      // Simulate AI draft generation
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      const aiGenerated = {
        title: `AI-generated title for ${formData.type}`,
        description: `AI-expanded description based on: ${formData.message.slice(0, 50)}...`,
        call_to_action: "Learn more or contact us",
      };
      
      onRequestAIDraft?.(aiGenerated);
      setFormData(prev => ({
        ...prev,
        ...aiGenerated,
      }));
      setStep(5); // Move to edit step
    } catch (err) {
      toast.error("Failed to generate AI draft");
    } finally {
      setIsAIGenerating(false);
    }
  }, [formData.type, formData.message, onRequestAIDraft]);

  const handleSubmit = useCallback(async () => {
    if (!formData.type || !formData.title) {
      toast.error("Please complete required fields");
      return;
    }
    
    onCreate?.({
      ...formData,
      status: "draft",
      created_at: new Date().toISOString(),
    });
    
    // Reset form
    setFormData({
      type: "",
      title: "",
      message: "",
      audience: "all",
      tone: "professional",
      call_to_action: "",
      location: "",
      start_date: "",
      end_date: "",
      price: null,
      is_virtual: false,
      tags: [],
    });
    setStep(1);
    onClose?.();
  }, [formData, onCreate, onClose]);

  const steps = [
    {
      number: 1,
      title: "Select notice type",
      content: (
        <div className="space-y-3">
          <p className="text-2xs text-ink-4">
            What type of notice are you creating?
          </p>
          <div className="grid grid-cols-2 gap-2">
            {NOTICE_TYPES.slice(1).map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => handleChange("type", option.value)}
                className={cn(
                  "rounded-xl border-2 p-3 text-left text-xs font-medium transition-all",
                  formData.type === option.value
                    ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300"
                    : "border-edge-1 bg-surface-0 text-ink-2 hover:border-brand-200"
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      ),
    },
    {
      number: 2,
      title: "Enter your message",
      content: (
        <div className="space-y-3">
          <p className="text-2xs text-ink-4">
            What do you want to promote or announce?
          </p>
          <textarea
            value={formData.message}
            onChange={(e) => handleChange("message", e.target.value)}
            placeholder={`Describe your ${NOTICE_TYPES.find(t => t.value === formData.type)?.label || "notice"}...`}
            rows={4}
            className="w-full px-3 py-2 rounded-xl bg-surface-0 text-xs text-ink-1 focus:outline-none focus:ring-1 focus:ring-brand-500/50 resize-none"
          />
        </div>
      ),
    },
    {
      number: 3,
      title: "Specify audience and tone",
      content: (
        <div className="space-y-3">
          <div>
            <label className="block text-2xs font-medium text-ink-3 mb-1">
              Audience
            </label>
            <Select
              value={formData.audience}
              onChange={(e) => handleChange("audience", e.target.value)}
              options={AUDIENCE_OPTIONS}
            />
          </div>
          <div>
            <label className="block text-2xs font-medium text-ink-3 mb-1">
              Tone
            </label>
            <Select
              value={formData.tone}
              onChange={(e) => handleChange("tone", e.target.value)}
              options={TONE_OPTIONS}
            />
          </div>
          <div>
            <label className="block text-2xs font-medium text-ink-3 mb-1">
              Call to action (optional)
            </label>
            <Input
              value={formData.call_to_action}
              onChange={(e) => handleChange("call_to_action", e.target.value)}
              placeholder="e.g., 'Contact us now'"
            />
          </div>
        </div>
      ),
    },
    {
      number: 4,
      title: "Request AI draft",
      content: (
        <div className="space-y-3">
          <p className="text-2xs text-ink-4">
            The AI will generate a structured draft based on your inputs.
          </p>
          <Button
            onClick={handleAIDraft}
            loading={isAIGenerating}
            disabled={!formData.type || !formData.message}
            icon={Sparkles}
            className="w-full"
          >
            {isAIGenerating ? "Generating AI draft..." : "Generate AI draft"}
          </Button>
        </div>
      ),
    },
    {
      number: 5,
      title: "Edit and preview",
      content: (
        <div className="space-y-3">
          <div className="space-y-2">
            <label className="block text-2xs font-medium text-ink-3">
              Title
            </label>
            <Input
              value={formData.title}
              onChange={(e) => handleChange("title", e.target.value)}
              placeholder="Edit the AI-generated title"
            />
          </div>
          <div className="space-y-2">
            <label className="block text-2xs font-medium text-ink-3">
              Description
            </label>
            <textarea
              value={formData.description || formData.message}
              onChange={(e) => handleChange("description", e.target.value)}
              rows={3}
              className="w-full px-3 py-2 rounded-xl bg-surface-0 text-xs text-ink-1 focus:outline-none focus:ring-1 focus:ring-brand-500/50 resize-none"
            />
          </div>
          <div className="space-y-2">
            <label className="block text-2xs font-medium text-ink-3">
              Call to action
            </label>
            <Input
              value={formData.call_to_action}
              onChange={(e) => handleChange("call_to_action", e.target.value)}
              placeholder="e.g., 'Learn more'"
            />
          </div>
          
          {/* Optional fields */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="block text-2xs font-medium text-ink-3">
                Location
              </label>
              <Input
                value={formData.location}
                onChange={(e) => handleChange("location", e.target.value)}
                placeholder="e.g., Kisumu"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-2xs font-medium text-ink-3">
                Price (KES)
              </label>
              <Input
                type="number"
                value={formData.price || ""}
                onChange={(e) => handleChange("price", e.target.value ? Number(e.target.value) : null)}
                placeholder="Optional"
              />
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="is_virtual"
              checked={formData.is_virtual}
              onChange={(e) => handleChange("is_virtual", e.target.checked)}
              className="h-4 w-4 rounded border-edge-2"
            />
            <label htmlFor="is_virtual" className="text-2xs text-ink-3">
              Virtual / Online
            </label>
          </div>
          
          {/* Preview */}
          <div className="rounded-2xl border border-edge-1 bg-surface-0 p-3">
            <p className="text-2xs font-medium text-ink-4 mb-2">Preview:</p>
            <div className="text-xs">
              <p className="font-semibold text-ink-1">{formData.title || "Your notice title"}</p>
              <p className="text-ink-3 mt-1">{formData.description || formData.message || "Your notice description"}</p>
              <p className="text-ink-4 mt-1 text-2xs">{formData.call_to_action && `CTA: ${formData.call_to_action}`}</p>
            </div>
          </div>
        </div>
      ),
    },
    {
      number: 6,
      title: "Confirm publication",
      content: (
        <div className="space-y-3">
          <p className="text-2xs text-ink-4">
            Review your notice before publishing. You can edit it later.
          </p>
          <div className="rounded-2xl border border-edge-1 bg-surface-0 p-3">
            <h4 className="font-semibold text-ink-1">{formData.title}</h4>
            <p className="text-2xs text-ink-4 mt-1">{NOTICE_TYPES.find(t => t.value === formData.type)?.label}</p>
            <p className="text-xs text-ink-3 mt-2">{formData.description || formData.message}</p>
          </div>
          <Button
            onClick={handleSubmit}
            loading={loading}
            className="w-full"
          >
            {loading ? "Publishing..." : "Publish notice"}
          </Button>
        </div>
      ),
    },
  ];

  const currentStep = steps[step - 1];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Create notice - ${currentStep.title}`}
      size="lg"
    >
      <div className="space-y-4">
        {/* Progress indicator */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {steps.map((s, i) => (
              <div
                key={s.number}
                className={cn(
                  "flex items-center gap-1",
                  i > 0 && "before:content-[''] before:w-4 before:h-px before:bg-edge-2"
                )}
              >
                <span
                  className={cn(
                    "grid h-6 w-6 place-items-center rounded-full text-2xs font-bold",
                    step > s.number
                      ? "bg-brand-500 text-white"
                      : step === s.number
                        ? "bg-brand-500/20 text-brand-700 dark:text-brand-300 ring-2 ring-brand-500/50"
                        : "bg-surface-2 text-ink-4"
                  )}
                >
                  {step > s.number ? <Check size={12} /> : s.number}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Step content */}
        <div className="space-y-3">
          {currentStep.content}
        </div>

        {/* Navigation */}
        <div className="flex justify-between gap-2 pt-2">
          {step > 1 && (
            <Button
              variant="outline"
              onClick={() => setStep(step - 1)}
              disabled={step === 1}
            >
              Back
            </Button>
          )}
          {step < 6 && (
            <Button
              onClick={() => setStep(step + 1)}
              disabled={step === 2 && !formData.message || step === 1 && !formData.type}
            >
              Continue
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

/**
 * Main Notice Board Component
 */
export default function NoticeBoard({
  notices = [],
  loading = false,
  onCreate,
  onEdit,
  onDelete,
  onPreview,
  canCreate = true,
}) {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedType, setSelectedType] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("");
  const [creating, setCreating] = useState(false);
  const [previewing, setPreviewing] = useState(null);

  // Filter notices
  const filteredNotices = notices.filter((notice) => {
    const matchesSearch = !searchQuery || 
      notice.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      notice.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      notice.tags?.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()));
    
    const matchesType = !selectedType || notice.type === selectedType;
    const matchesStatus = !selectedStatus || notice.status === selectedStatus;
    
    return matchesSearch && matchesType && matchesStatus;
  });

  const handleRequestAIDraft = useCallback((draft) => {
    // In production, this would come from AI service
    toast.success("AI draft generated! Review and edit before publishing.");
  }, []);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-ink-1 tracking-tight">
            Byway Notice Board
          </h2>
          <p className="text-xs text-ink-4 mt-0.5">
            Short AI-assisted articles promoting products, services, events, and announcements
          </p>
        </div>
        {canCreate && (
          <Button size="sm" icon={Plus} onClick={() => setCreating(true)}>
            Create notice
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[180px]">
          <Search 
            size={14} 
            className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-4"
            aria-hidden="true"
          />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search notices..."
            className="pl-8"
          />
        </div>
        
        <Select
          value={selectedType}
          onChange={(e) => setSelectedType(e.target.value)}
          options={NOTICE_TYPES}
          className="min-w-[140px]"
        />
        
        <Select
          value={selectedStatus}
          onChange={(e) => setSelectedStatus(e.target.value)}
          options={[
            { value: "", label: "All statuses" },
            { value: "draft", label: "Draft" },
            { value: "published", label: "Published" },
            { value: "archived", label: "Archived" },
          ]}
          className="min-w-[140px]"
        />
      </div>

      {/* Results */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-48 rounded-2xl border border-edge-1 bg-surface-0 animate-pulse" />
          ))}
        </div>
      ) : filteredNotices.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="No notices found"
          description="Create the first notice to promote your products, services, or events."
          action={canCreate && (
            <Button size="sm" icon={Plus} onClick={() => setCreating(true)}>
              Create notice
            </Button>
          )}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filteredNotices.map((notice) => (
            <NoticeCard
              key={notice.id}
              notice={notice}
              onEdit={onEdit || (() => navigate(`/notices/${notice.id}/edit`))}
              onDelete={onDelete}
              onPreview={onPreview || (() => setPreviewing(notice))}
            />
          ))}
        </div>
      )}

      {/* Creation Modal */}
      <NoticeCreationModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreate={onCreate}
        onRequestAIDraft={handleRequestAIDraft}
      />

      {/* Preview Modal */}
      <Modal
        open={!!previewing}
        onClose={() => setPreviewing(null)}
        title={previewing?.title}
        size="lg"
      >
        {previewing && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-edge-1 bg-surface-0 p-4">
              <p className="text-2xs text-ink-4 mb-2">
                {NOTICE_TYPES.find(t => t.value === previewing.type)?.label} · 
                by {previewing.organizer_business || previewing.owner?.name}
              </p>
              <h3 className="text-lg font-semibold text-ink-1">{previewing.title}</h3>
              {previewing.description && (
                <p className="mt-2 text-sm text-ink-3">{previewing.description}</p>
              )}
              
              {previewing.start_date && (
                <p className="mt-2 text-2xs text-ink-4">
                  {dayLabel(previewing.start_date)} · {shortDateTime(previewing.start_date)}
                </p>
              )}
              
              {previewing.location && (
                <p className="text-2xs text-ink-4">
                  <MapPin size={10} className="inline" /> {previewing.location}
                </p>
              )}
              
              {previewing.price != null && (
                <p className="text-2xs text-ink-4">
                  {previewing.price ? `Price: ${currency(previewing.price)}` : "Free"}
                </p>
              )}
              
              {previewing.call_to_action && (
                <div className="mt-4 p-3 rounded-xl bg-brand-50 border border-brand-200">
                  <p className="text-xs font-medium text-brand-700">{previewing.call_to_action}</p>
                </div>
              )}
              
              {previewing.tags?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-3">
                  {previewing.tags.map((tag) => (
                    <Badge key={tag} variant="outline" size="xs">{tag}</Badge>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

/**
 * Hook for managing notice board state
 */
export function useNoticeBoard() {
  const [notices, setNotices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // In production, this would fetch from backend API
  const fetchNotices = useCallback(async (params = {}) => {
    setLoading(true);
    setError(null);
    
    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Mock data - in production, this comes from backend
      const mockNotices = [
        {
          id: "1",
          title: "Fresh Stock of Maize Available",
          description: "We have just received a new shipment of high-quality maize at competitive prices. Limited stock available.",
          type: "product_promotion",
          status: "published",
          organizer: "farm_fresh",
          organizer_business: "Farm Fresh Supplies",
          owner: { id: "1", handle: "farm_fresh", name: "Farm Fresh Supplies" },
          start_date: new Date().toISOString(),
          location: "Kisumu",
          price: 2500,
          is_virtual: false,
          call_to_action: "Order now - limited stock!",
          tags: ["maize", "grains", "wholesale", "limited-stock"],
          view_count: 45,
          created_at: new Date().toISOString(),
        },
        {
          id: "2",
          title: "Business Consulting Services",
          description: "Professional business consulting to help you grow your vendor business. Specializing in market expansion and efficiency.",
          type: "service_offering",
          status: "published",
          organizer: "business_pro",
          organizer_business: "Business Pro Consultants",
          owner: { id: "2", handle: "business_pro", name: "Business Pro Consultants" },
          start_date: new Date(Date.now() + 86400000).toISOString(),
          location: "Online",
          is_virtual: true,
          call_to_action: "Book a free consultation",
          tags: ["consulting", "business-growth", "strategy"],
          view_count: 32,
          created_at: new Date().toISOString(),
        },
        {
          id: "3",
          title: "Market Day - This Saturday",
          description: "Join us for the monthly vendor market day. Great opportunity to network and showcase your products.",
          type: "event",
          status: "published",
          organizer: "market_org",
          organizer_business: "Kisumu Market Organizers",
          owner: { id: "3", handle: "market_org", name: "Kisumu Market Organizers" },
          start_date: new Date(Date.now() + 3 * 86400000).toISOString(),
          end_date: new Date(Date.now() + 3 * 86400000 + 8 * 3600000).toISOString(),
          location: "Kisumu Market Square",
          is_virtual: false,
          price: 500,
          call_to_action: "Register to attend",
          tags: ["market-day", "networking", "vendors", "saturday"],
          view_count: 89,
          created_at: new Date().toISOString(),
        },
      ];
      
      setNotices(mockNotices);
    } catch (err) {
      setError(err.message || "Failed to load notices");
    } finally {
      setLoading(false);
    }
  }, []);

  const createNotice = useCallback(async (noticeData) => {
    setLoading(true);
    setError(null);
    
    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const newNotice = {
        ...noticeData,
        id: String(Date.now()),
        organizer: "current_user", // In production, use auth
        organizer_business: "My Business",
        owner: { id: "current", handle: "current_user", name: "My Business" },
        view_count: 0,
        created_at: new Date().toISOString(),
      };
      
      setNotices(prev => [newNotice, ...prev]);
      toast.success("Notice created successfully!");
      
      return newNotice;
    } catch (err) {
      setError(err.message || "Failed to create notice");
      toast.error("Failed to create notice");
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const updateNotice = useCallback(async (id, updates) => {
    setLoading(true);
    setError(null);
    
    try {
      await new Promise(resolve => setTimeout(resolve, 500));
      
      setNotices(prev => 
        prev.map(notice => 
          notice.id === id ? { ...notice, ...updates, updated_at: new Date().toISOString() } : notice
        )
      );
      toast.success("Notice updated!");
    } catch (err) {
      setError(err.message || "Failed to update notice");
      toast.error("Failed to update notice");
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const deleteNotice = useCallback(async (id) => {
    setLoading(true);
    setError(null);
    
    try {
      await new Promise(resolve => setTimeout(resolve, 500));
      
      setNotices(prev => prev.filter(notice => notice.id !== id));
      toast.success("Notice deleted!");
    } catch (err) {
      setError(err.message || "Failed to delete notice");
      toast.error("Failed to delete notice");
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    notices,
    setNotices,
    loading,
    setLoading,
    error,
    setError,
    fetchNotices,
    createNotice,
    updateNotice,
    deleteNotice,
  };
}
