import React, { useState, useEffect, useCallback, useId } from 'react';
import {
  X,
  Plus,
  ImagePlus,
  DollarSign,
  MapPin,
  Clock,
  Tag,
  Megaphone,
  CalendarDays,
  Sparkles,
  Trash2,
  ArrowRight,
  ArrowLeft,
  UploadCloud,
  FileText,
  Eye,
  RotateCcw,
  Maximize2,
  Star,
  Layers,
  RefreshCw,
  ShieldCheck,
  Package,
  Truck,
  Check,
  AlertTriangle,
  Info
} from 'lucide-react';
import { soundEngine } from '../../utils/SoundEngine';

// =========================================================================
// 1. DESIGN SYSTEM TOKENS & TYPOGRAPHY
// =========================================================================

export const AppColors = {
  primary: '#0D1117',
  primaryHover: '#1E293B',
  accent: '#40916C',
  accentHover: '#E04D18',
  secondary: '#40916C',
  teal: '#00BFEF',
  emerald: '#00D26A',
  surfaceLight: 'var(--color-paper)',
  surfaceSubtle: '#F8FAFC',
  surfaceMuted: '#F1F5F9',
  borderLight: '#E2E8F0',
  borderDark: '#334155',
  textPrimary: '#0F172A',
  textSecondary: '#64748B',
  textMuted: '#94A3B8',
  error: '#EF4444',
  errorBg: '#FEF2F2',
  errorBorder: '#FCA5A5',
  success: '#10B981',
  successBg: '#ECFDF5',
  warning: '#F59E0B'
} as const;

export const AppSpacing = {
  xs: '4px',
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '20px',
  xxl: '24px',
  xxxl: '32px'
} as const;

// =========================================================================
// 2. DISCRIMINATED UNION DATA MODELS (Architecture Refactor)
// =========================================================================

export type PostType = 'event' | 'product' | 'announcement';

export interface BasePost {
  id: string;
  title: string;
  description: string;
  imageUrls: string[];
  createdAt: string;
  createdBy: string;
  district: string;
  isPublished: boolean;
}

export interface EventPost extends BasePost {
  type: 'event';
  eventDate: string;
  eventTime: string;
  location: string;
  gateFeeKes: number;
  capacity?: number;
  rsvpRequired?: boolean;
}

export interface ProductPost extends BasePost {
  type: 'product';
  priceKes: number;
  category: string;
  stockUnits: number;
  isAvailable: boolean;
  courierEligible?: boolean;
}

export interface AnnouncementPost extends BasePost {
  type: 'announcement';
  priority: 'normal' | 'urgent' | 'pinned';
  targetEstate?: string;
  actionUrl?: string;
}

export type Post = EventPost | ProductPost | AnnouncementPost;

// Strongly-typed guards:
export function isEventPost(post: Post): post is EventPost {
  return post.type === 'event';
}

export function isProductPost(post: Post): post is ProductPost {
  return post.type === 'product';
}

export function isAnnouncementPost(post: Post): post is AnnouncementPost {
  return post.type === 'announcement';
}

const DRAFT_STORAGE_KEY = 'brief_universal_post_draft_v3';

// =========================================================================
// 3. REUSABLE CUSTOM TEXT FIELD WIDGET
// =========================================================================

export interface CustomTextFieldProps {
  label: string;
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  icon?: React.ReactNode;
  suffixIcon?: React.ReactNode;
  maxLines?: number;
  type?: 'text' | 'number' | 'date' | 'time' | 'tel';
  required?: boolean;
  readOnly?: boolean;
  onTap?: () => void;
  helperText?: string;
  errorMessage?: string;
  maxLength?: number;
  className?: string;
}

export function CustomTextField({
  label,
  value,
  onChange,
  placeholder,
  icon,
  suffixIcon,
  maxLines = 1,
  type = 'text',
  required = false,
  readOnly = false,
  onTap,
  helperText,
  errorMessage,
  maxLength,
  className = ''
}: CustomTextFieldProps) {
  const inputId = useId();
  const hasError = Boolean(errorMessage);

  return (
    <div className={`space-y-1.5 text-xs ${className}`}>
      <div className="flex items-center justify-between">
        <label htmlFor={inputId} className="font-bold text-slate-800 dark:text-slate-200 flex items-center space-x-1">
          <span>{label}</span>
          {required && <span className="text-red-500 font-bold">*</span>}
        </label>
        {maxLength && (
          <span className="text-[11px] text-slate-400 font-mono">
            {value.length}/{maxLength}
          </span>
        )}
      </div>

      <div
        className={`relative flex items-center rounded-2xl transition-all duration-200 ${
          hasError
            ? 'bg-red-50/70 dark:bg-red-950/30 border-2 border-red-500'
            : 'bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 focus-within:border-[#0891B2] focus-within:ring-2 focus-within:ring-blue-100 dark:focus-within:ring-blue-900/30'
        }`}
      >
        {icon && (
          <div className="absolute left-3.5 top-3.5 text-slate-400 pointer-events-none flex items-center justify-center">
            {icon}
          </div>
        )}

        {maxLines > 1 ? (
          <textarea
            id={inputId}
            rows={maxLines}
            value={value}
            maxLength={maxLength}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            readOnly={readOnly}
            onClick={onTap}
            className={`w-full bg-transparent p-3 text-xs text-[var(--brief-ink)] dark:text-slate-100 placeholder-slate-400 outline-none resize-none ${
              icon ? 'pl-10' : ''
            } ${suffixIcon ? 'pr-10' : ''}`}
          />
        ) : (
          <input
            id={inputId}
            type={type}
            value={value}
            maxLength={maxLength}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            readOnly={readOnly}
            onClick={onTap}
            className={`w-full bg-transparent py-3 px-3 text-xs text-[var(--brief-ink)] dark:text-slate-100 placeholder-slate-400 outline-none ${
              icon ? 'pl-10' : ''
            } ${suffixIcon ? 'pr-10' : ''}`}
          />
        )}

        {suffixIcon && (
          <div className="absolute right-3.5 top-3.5 text-slate-400 pointer-events-none flex items-center justify-center">
            {suffixIcon}
          </div>
        )}
      </div>

      {hasError ? (
        <p className="text-[12px] font-medium text-red-600 dark:text-red-400 flex items-center space-x-1 animate-fadeIn">
          <AlertTriangle className="w-3 h-3 shrink-0" />
          <span>{errorMessage}</span>
        </p>
      ) : helperText ? (
        <p className="text-[11px] text-slate-500 dark:text-slate-400">{helperText}</p>
      ) : null}
    </div>
  );
}

// =========================================================================
// 4. FULLSCREEN IMAGE LIGHTBOX VIEWER
// =========================================================================

interface ImageViewerModalProps {
  isOpen: boolean;
  imageUrl: string;
  index: number;
  total: number;
  onClose: () => void;
}

export function ImageViewerModal({
  isOpen,
  imageUrl,
  index,
  total,
  onClose
}: ImageViewerModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] bg-black/90 backdrop-blur-md flex flex-col items-center justify-center p-4 animate-fadeIn">
      <div className="w-full max-w-xl flex items-center justify-between text-white pb-3">
        <span className="text-xs font-mono font-bold tracking-wider text-slate-300">
          PHOTO {index + 1} OF {total}
        </span>
        <button
          type="button"
          onClick={() => { soundEngine.play('tap'); onClose(); }}
          className="w-10 h-10 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-white cursor-pointer transition-colors"
          aria-label="Close image viewer"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="relative max-w-xl max-h-[75vh] rounded-2xl overflow-hidden border border-white/20 shadow-2xl bg-black">
        <img
          src={imageUrl}
          alt={`Preview detail ${index + 1}`}
          className="w-full h-full object-contain max-h-[75vh]"
        />
      </div>
    </div>
  );
}

// =========================================================================
// 5. REUSABLE MULTI-IMAGE PICKER WIDGET
// =========================================================================

export interface MultiImagePickerProps {
  maxImages?: number;
  images: string[];
  onImagesChange: (images: string[]) => void;
}

export function MultiImagePicker({
  maxImages = 5,
  images,
  onImagesChange
}: MultiImagePickerProps) {
  const [activeViewerIdx, setActiveViewerIdx] = useState<number | null>(null);
  const [isUploadingSample, setIsUploadingSample] = useState(false);

  const samplePhotos = [
    'https://images.unsplash.com/photo-1540555700478-4be289fbecef?w=600&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1511556532299-8f662fc26c06?w=600&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1526778548025-fa2f459cd5c1?w=600&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1560769629-975ec94e6a86?w=600&auto=format&fit=crop'
  ];

  const handleAddSampleImage = () => {
    if (images.length >= maxImages) return;
    soundEngine.play('tap');
    setIsUploadingSample(true);

    setTimeout(() => {
      const picked = samplePhotos[images.length % samplePhotos.length];
      onImagesChange([...images, picked]);
      setIsUploadingSample(false);
    }, 280);
  };

  const handleRemoveImage = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    soundEngine.play('tap');
    onImagesChange(images.filter((_, i) => i !== index));
  };

  const handleSetAsCover = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (index === 0) return;
    soundEngine.play('tap');
    const selected = images[index];
    const rest = images.filter((_, i) => i !== index);
    onImagesChange([selected, ...rest]);
  };

  const handleMoveLeft = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (index === 0) return;
    soundEngine.play('tap');
    const newImgs = [...images];
    const temp = newImgs[index - 1];
    newImgs[index - 1] = newImgs[index];
    newImgs[index] = temp;
    onImagesChange(newImgs);
  };

  return (
    <div className="space-y-2 text-xs">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <label className="font-bold text-slate-800 dark:text-slate-200 block">
            Photos & Media
          </label>
          <p className="text-[11px] text-slate-500">
            Tap thumbnail to preview full-screen. First image serves as the primary cover tile.
          </p>
        </div>
        <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono font-bold bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded-md">
          {images.length}/{maxImages} images
        </span>
      </div>

      {/* Responsive Images Grid / Row */}
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2.5 pt-1">
        {images.map((img, idx) => {
          const isCover = idx === 0;
          return (
            <div
              key={idx}
              onClick={() => setActiveViewerIdx(idx)}
              className={`relative aspect-square rounded-2xl overflow-hidden border cursor-pointer transition-all hover:shadow-md group ${
                isCover
                  ? 'border-2 border-[#40916C] ring-2 ring-orange-100 dark:ring-orange-950/40'
                  : 'border-slate-200 dark:border-slate-700'
              }`}
            >
              <img
                src={img}
                alt={`Photo thumbnail ${idx + 1}`}
                className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
              />

              {/* Cover Badge */}
              {isCover && (
                <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-md bg-[#40916C] text-white text-[11px] font-black uppercase tracking-wider shadow-sm flex items-center space-x-0.5">
                  <Star className="w-2.5 h-2.5 fill-current" />
                  <span>Cover</span>
                </div>
              )}

              {/* Hover Overlay Controls */}
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-between p-1.5">
                <div className="flex items-center justify-between w-full">
                  {!isCover ? (
                    <button
                      type="button"
                      onClick={(e) => handleSetAsCover(idx, e)}
                      title="Set as Cover Photo"
                      className="px-1.5 py-1 rounded-lg bg-black/70 hover:bg-[#40916C] text-white text-[11px] font-bold flex items-center space-x-0.5 transition-colors"
                    >
                      <span>★ Cover</span>
                    </button>
                  ) : (
                    <div />
                  )}

                  {/* 44px touch target delete button */}
                  <button
                    type="button"
                    onClick={(e) => handleRemoveImage(idx, e)}
                    title="Remove Photo"
                    aria-label="Remove Photo"
                    className="w-8 h-8 rounded-full bg-red-600/90 hover:bg-red-700 text-white flex items-center justify-center shadow-md transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="flex items-center justify-between w-full">
                  {idx > 0 && (
                    <button
                      type="button"
                      onClick={(e) => handleMoveLeft(idx, e)}
                      title="Move Left"
                      className="px-1.5 py-0.5 rounded bg-black/70 hover:bg-black text-white text-[11px] font-mono"
                    >
                      ← Left
                    </button>
                  )}
                  <span className="text-[11px] text-white/90 font-mono ml-auto">
                    <Maximize2 className="w-3 h-3" />
                  </span>
                </div>
              </div>
            </div>
          );
        })}

        {/* Upload Button or Shimmer Skeleton */}
        {isUploadingSample ? (
          <div className="aspect-square rounded-2xl bg-slate-100 dark:bg-slate-800 border-2 border-dashed border-blue-400 animate-pulse flex flex-col items-center justify-center text-blue-500">
            <RefreshCw className="w-5 h-5 animate-spin" />
            <span className="text-[11px] font-bold mt-1">Uploading…</span>
          </div>
        ) : (
          images.length < maxImages && (
            <button
              type="button"
              onClick={handleAddSampleImage}
              className="aspect-square rounded-2xl bg-slate-50 dark:bg-slate-800/60 border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-[#0891B2] hover:bg-blue-50/50 dark:hover:bg-blue-950/20 flex flex-col items-center justify-center text-slate-500 hover:text-[#0891B2] cursor-pointer transition-all duration-200"
            >
              <ImagePlus className="w-5 h-5" />
              <span className="text-[11px] font-bold mt-1">Add Photo</span>
            </button>
          )
        )}
      </div>

      {/* Fullscreen Lightbox Modal */}
      {activeViewerIdx !== null && (
        <ImageViewerModal
          isOpen={activeViewerIdx !== null}
          imageUrl={images[activeViewerIdx]}
          index={activeViewerIdx}
          total={images.length}
          onClose={() => setActiveViewerIdx(null)}
        />
      )}
    </div>
  );
}

// =========================================================================
// 6. DRAFT PROTECTION & DISCARD CONFIRMATION MODAL
// =========================================================================

interface DiscardConfirmationModalProps {
  isOpen: boolean;
  onKeepEditing: () => void;
  onSaveDraftAndExit: () => void;
  onDiscardCompletely: () => void;
}

export function DiscardConfirmationModal({
  isOpen,
  onKeepEditing,
  onSaveDraftAndExit,
  onDiscardCompletely
}: DiscardConfirmationModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[80] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
      <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-5 shadow-2xl space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-amber-100 dark:bg-amber-950/50 text-amber-600 flex items-center justify-center mx-auto">
          <Info className="w-6 h-6" />
        </div>
        <div className="text-center space-y-1">
          <h4 className="font-black text-base text-slate-900 dark:text-white">
            Discard Draft?
          </h4>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            You have unsaved changes. Would you like to keep your draft saved locally to resume later, or discard completely?
          </p>
        </div>

        <div className="space-y-2 pt-2">
          <button
            type="button"
            onClick={onKeepEditing}
            className="w-full py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold text-xs cursor-pointer transition-colors"
          >
            Keep Editing
          </button>
          <button
            type="button"
            onClick={onSaveDraftAndExit}
            className="w-full py-2.5 rounded-xl bg-[color:var(--brief-ink)] hover:bg-[#1E293B] text-white font-bold text-xs cursor-pointer transition-colors"
          >
            Save Draft & Close
          </button>
          <button
            type="button"
            onClick={onDiscardCompletely}
            className="w-full py-2 rounded-xl text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 font-bold text-xs cursor-pointer transition-colors"
          >
            Discard Changes
          </button>
        </div>
      </div>
    </div>
  );
}

// =========================================================================
// 7. LIVE CARD FEED PREVIEW
// =========================================================================

interface LiveCardPreviewProps {
  post: Post;
}

export function LiveCardPreview({ post }: LiveCardPreviewProps) {
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden shadow-sm hover:shadow-md transition-shadow">
      {/* Cover Media */}
      {post.imageUrls.length > 0 && (
        <div className="relative aspect-video w-full overflow-hidden bg-slate-100 dark:bg-slate-800">
          <img
            src={post.imageUrls[0]}
            alt={post.title}
            className="w-full h-full object-cover"
          />
          <div className="absolute top-2.5 left-2.5">
            <span
              className={`px-2.5 py-1 rounded-lg text-[11px] font-black uppercase tracking-wider text-white shadow-md ${
                post.type === 'event'
                  ? 'bg-blue-600'
                  : post.type === 'product'
                  ? 'bg-emerald-600'
                  : 'bg-amber-600'
              }`}
            >
              {post.type.toUpperCase()}
            </span>
          </div>

          <div className="absolute bottom-2.5 right-2.5 bg-black/70 backdrop-blur-sm text-white px-2 py-0.5 rounded-md text-[11px] font-mono">
            {post.district}
          </div>
        </div>
      )}

      {/* Card Body */}
      <div className="p-4 space-y-3">
        <div className="space-y-1">
          <h4 className="font-black text-sm text-slate-900 dark:text-white leading-snug">
            {post.title || 'Untitled Post'}
          </h4>
          <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-2">
            {post.description || 'No description provided.'}
          </p>
        </div>

        {/* Type Meta */}
        {isEventPost(post) && (
          <div className="p-2.5 rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900/40 text-blue-900 dark:text-blue-200 flex items-center justify-between text-xs">
            <div className="flex items-center space-x-2">
              <CalendarDays className="w-4 h-4 text-blue-600" />
              <span className="font-bold">{post.eventDate} @ {post.eventTime}</span>
            </div>
            <span className="font-mono font-black text-blue-700 dark:text-blue-300">
              {post.gateFeeKes === 0 ? 'FREE ENTRY' : `KES ${post.gateFeeKes}`}
            </span>
          </div>
        )}

        {isProductPost(post) && (
          <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900/40 text-emerald-900 dark:text-emerald-200 flex items-center justify-between text-xs">
            <div className="flex items-center space-x-2">
              <Tag className="w-4 h-4 text-emerald-600" />
              <span className="font-bold">{post.category} ({post.stockUnits} in stock)</span>
            </div>
            <span className="font-mono font-black text-emerald-700 dark:text-emerald-300">
              KES {post.priceKes}
            </span>
          </div>
        )}

        {isAnnouncementPost(post) && (
          <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-100 dark:border-amber-900/40 text-amber-900 dark:text-amber-200 flex items-center justify-between text-xs">
            <div className="flex items-center space-x-2">
              <Megaphone className="w-4 h-4 text-amber-600" />
              <span className="font-bold uppercase tracking-wider">{post.priority} Civic Alert</span>
            </div>
            <span className="text-[11px] text-amber-700 dark:text-amber-300 font-mono">
              Verified Member
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// =========================================================================
// 8. MAIN UNIVERSAL CREATE POST MODAL COMPONENT
// =========================================================================

export interface UniversalCreatePostModalProps {
  isOpen?: boolean;
  initialPostType?: PostType;
  onClose: () => void;
  onPostCreated?: (post: Post) => void;
}

export function UniversalCreatePostModal({
  isOpen = true,
  initialPostType = 'event',
  onClose,
  onPostCreated
}: UniversalCreatePostModalProps) {
  // Navigation Stepper (1: Basics & Details, 2: Media & Logistics, 3: Live Preview & Verification)
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);

  // Form State
  const [postType, setPostType] = useState<PostType>(initialPostType);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [district, setDistrict] = useState('Westlands');
  const [images, setImages] = useState<string[]>([
    'https://images.unsplash.com/photo-1540555700478-4be289fbecef?w=600&auto=format&fit=crop'
  ]);

  // Event Fields
  const [eventDate, setEventDate] = useState('Tomorrow');
  const [eventTime, setEventTime] = useState('18:00');
  const [location, setLocation] = useState('Westlands Sarit Centre');
  const [gateFeeKes, setGateFeeKes] = useState('500');

  // Product Fields
  const [priceKes, setPriceKes] = useState('1200');
  const [category, setCategory] = useState('Electronics');
  const [stockUnits, setStockUnits] = useState('5');
  const [courierEligible, setCourierEligible] = useState(true);

  // Announcement Fields
  const [priority, setPriority] = useState<'normal' | 'urgent' | 'pinned'>('normal');

  // Validation States
  const [titleError, setTitleError] = useState('');
  const [descError, setDescError] = useState('');
  const [priceError, setPriceError] = useState('');
  const [bannerError, setBannerError] = useState<string | null>(null);

  // Modal Status & Draft Protection
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [discardModalOpen, setDiscardModalOpen] = useState(false);
  const [hasSavedDraftNotification, setHasSavedDraftNotification] = useState(false);

  const kenyanDistricts = [
    'Westlands',
    'Kilimani',
    'Nairobi CBD',
    'Lang\'ata',
    'Eastleigh',
    'Karen',
    'Industrial Area',
    'Parklands',
    'Upper Hill',
    'Mombasa Hub',
    'Nakuru Central',
    'Kisumu Port'
  ];

  const categories = [
    'Electronics',
    'Clothing & Fashion',
    'Food & Produce',
    'Home & Decor',
    'Beauty & Personal Care',
    'Professional Services',
    'Other'
  ];

  // Auto-check stored draft on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(DRAFT_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.title || parsed.description || (parsed.images && parsed.images.length > 0)) {
          setHasSavedDraftNotification(true);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  const handleRestoreDraft = () => {
    soundEngine.play('tap');
    try {
      const stored = localStorage.getItem(DRAFT_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.postType) setPostType(parsed.postType);
        if (parsed.title) setTitle(parsed.title);
        if (parsed.description) setDescription(parsed.description);
        if (parsed.district) setDistrict(parsed.district);
        if (parsed.images) setImages(parsed.images);
        if (parsed.eventDate) setEventDate(parsed.eventDate);
        if (parsed.eventTime) setEventTime(parsed.eventTime);
        if (parsed.location) setLocation(parsed.location);
        if (parsed.gateFeeKes) setGateFeeKes(parsed.gateFeeKes);
        if (parsed.priceKes) setPriceKes(parsed.priceKes);
        if (parsed.category) setCategory(parsed.category);
        if (parsed.stockUnits) setStockUnits(parsed.stockUnits);
        if (parsed.priority) setPriority(parsed.priority);
      }
      setHasSavedDraftNotification(false);
    } catch {
      setHasSavedDraftNotification(false);
    }
  };

  const handleDismissDraftNotice = () => {
    soundEngine.play('tap');
    setHasSavedDraftNotification(false);
    try {
      localStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch {
      // ignore
    }
  };

  const persistDraft = useCallback(() => {
    try {
      const draftData = {
        postType,
        title,
        description,
        district,
        images,
        eventDate,
        eventTime,
        location,
        gateFeeKes,
        priceKes,
        category,
        stockUnits,
        priority
      };
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draftData));
    } catch {
      // ignore
    }
  }, [postType, title, description, district, images, eventDate, eventTime, location, gateFeeKes, priceKes, category, stockUnits, priority]);

  const isFormDirty = title.trim().length > 0 || description.trim().length > 0 || images.length > 0;

  const handleRequestClose = () => {
    soundEngine.play('tap');
    if (isFormDirty) {
      setDiscardModalOpen(true);
    } else {
      onClose();
    }
  };

  const handleDiscardCompletely = () => {
    soundEngine.play('tap');
    try {
      localStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch {
      // ignore
    }
    setDiscardModalOpen(false);
    onClose();
  };

  const handleSaveDraftAndExit = () => {
    soundEngine.play('tap');
    persistDraft();
    setDiscardModalOpen(false);
    onClose();
  };

  const buildCurrentPost = (): Post => {
    const base: BasePost = {
      id: `post-${Date.now()}`,
      title: title.trim(),
      description: description.trim() || 'No description provided.',
      imageUrls: images,
      createdAt: new Date().toISOString(),
      createdBy: 'You (Verified Member)',
      district,
      isPublished: true
    };

    if (postType === 'event') {
      const eventP: EventPost = {
        ...base,
        type: 'event',
        eventDate: eventDate.trim() || 'Upcoming',
        eventTime: eventTime.trim() || '18:00',
        location: location.trim() || district,
        gateFeeKes: gateFeeKes ? Number(gateFeeKes) : 0,
        capacity: 100,
        rsvpRequired: false
      };
      return eventP;
    }

    if (postType === 'product') {
      const prodP: ProductPost = {
        ...base,
        type: 'product',
        priceKes: priceKes ? Number(priceKes) : 0,
        category,
        stockUnits: stockUnits ? Number(stockUnits) : 1,
        isAvailable: true,
        courierEligible
      };
      return prodP;
    }

    const annP: AnnouncementPost = {
      ...base,
      type: 'announcement',
      priority,
      targetEstate: district
    };
    return annP;
  };

  const validateCurrentStep = () => {
    let valid = true;
    if (!title.trim()) {
      setTitleError('Title is required.');
      valid = false;
    } else {
      setTitleError('');
    }

    if (postType === 'product' && (!priceKes || Number(priceKes) < 0)) {
      setPriceError('Please specify price in KES.');
      valid = false;
    } else {
      setPriceError('');
    }

    return valid;
  };

  const handleNextStep = () => {
    if (!validateCurrentStep()) {
      soundEngine.play('defeat');
      return;
    }
    soundEngine.play('tap');
    persistDraft();
    if (currentStep < 3) {
      setCurrentStep((prev) => (prev + 1) as 1 | 2 | 3);
    }
  };

  const handlePrevStep = () => {
    soundEngine.play('tap');
    if (currentStep > 1) {
      setCurrentStep((prev) => (prev - 1) as 1 | 2 | 3);
    }
  };

  const handleFinalPublish = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!validateCurrentStep()) {
      soundEngine.play('defeat');
      return;
    }

    soundEngine.play('victory');
    setIsSubmitting(true);
    setBannerError(null);

    const finalizedPost = buildCurrentPost();

    setTimeout(() => {
      try {
        localStorage.removeItem(DRAFT_STORAGE_KEY);
      } catch {
        // ignore
      }

      setIsSubmitting(false);
      setSuccessMsg(`✓ ${postType.toUpperCase()} published successfully to Brief local feed!`);
      onPostCreated?.(finalizedPost);

      setTimeout(() => {
        onClose();
      }, 1200);
    }, 550);
  };

  if (!isOpen) return null;

  const currentPreviewPost = buildCurrentPost();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="universal-publisher-title"
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
    >
      <div className="w-full max-w-lg bg-[color:var(--color-paper)] dark:bg-[color:var(--brief-ink)] text-[var(--accent-ink)] dark:text-slate-100 rounded-3xl border border-[#E2E8F0] dark:border-slate-800 shadow-2xl overflow-hidden my-auto animate-scaleUp transition-colors">
        
        {/* ================= MODAL HEADER ================= */}
        <div className="bg-[color:var(--brief-ink)] text-white p-4 sm:p-5 flex items-center justify-between border-b border-white/10">
          <div className="space-y-0.5">
            <div className="flex items-center space-x-2">
              <span className="text-[11px] font-mono uppercase tracking-wider text-[#40916C] font-black">
                UNIVERSAL PUBLISHER
              </span>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-white/10 text-slate-300">
                Step {currentStep} of 3
              </span>
            </div>
            <h3 id="universal-publisher-title" className="font-black text-base text-white">
              {postType === 'event'
                ? 'Publish Event & Gathering'
                : postType === 'product'
                ? 'List Marketplace Product'
                : 'Broadcast Announcement'}
            </h3>
          </div>

          <button
            type="button"
            onClick={handleRequestClose}
            aria-label="Close modal"
            className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white cursor-pointer transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ================= STEPPER PROGRESS BAR ================= */}
        <div className="bg-slate-50 dark:bg-slate-900/90 border-b border-slate-200 dark:border-slate-800 px-4 py-2 flex items-center justify-between">
          {[
            { step: 1, label: '1. Content & Type' },
            { step: 2, label: '2. Media & Logistics' },
            { step: 3, label: '3. Preview & Post' }
          ].map((s) => {
            const isActive = currentStep === s.step;
            const isCompleted = currentStep > s.step;
            return (
              <button
                key={s.step}
                type="button"
                onClick={() => {
                  soundEngine.play('tap');
                  setCurrentStep(s.step as 1 | 2 | 3);
                }}
                className={`flex items-center space-x-1.5 text-xs font-bold transition-colors cursor-pointer ${
                  isActive
                    ? 'text-[#40916C] font-black'
                    : isCompleted
                    ? 'text-slate-700 dark:text-slate-300 hover:text-[var(--brief-ink)]'
                    : 'text-slate-400 dark:text-slate-600'
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-mono font-black ${
                    isActive
                      ? 'bg-[#40916C] text-white'
                      : isCompleted
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-200 dark:bg-slate-700 text-slate-500'
                  }`}
                >
                  {isCompleted ? '✓' : s.step}
                </div>
                <span className="hidden sm:inline">{s.label}</span>
              </button>
            );
          })}
        </div>

        {/* ================= RESUME DRAFT NOTIFICATION ================= */}
        {hasSavedDraftNotification && (
          <div className="bg-blue-50 dark:bg-blue-950/40 border-b border-blue-200 dark:border-blue-900/50 p-3 flex items-center justify-between text-xs animate-fadeIn">
            <div className="flex items-center space-x-2 text-blue-900 dark:text-blue-200">
              <RotateCcw className="w-4 h-4 text-blue-600 shrink-0" />
              <span>You have a saved draft. Resume where you left off?</span>
            </div>
            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={handleRestoreDraft}
                className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-[12px] cursor-pointer transition-colors"
              >
                Resume
              </button>
              <button
                type="button"
                onClick={handleDismissDraftNotice}
                className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer"
                aria-label="Dismiss draft notice"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* ================= POST TYPE SELECTOR TABS ================= */}
        <div className="flex border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60 p-2 gap-1.5">
          {[
            { id: 'event', label: '📅 Event / Popup' },
            { id: 'product', label: '🛍️ Product / Duka' },
            { id: 'announcement', label: '📢 Announcement' }
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                soundEngine.play('tap');
                setPostType(tab.id as PostType);
              }}
              className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer text-center ${
                postType === tab.id
                  ? 'bg-white dark:bg-slate-800 text-[var(--brief-ink)] dark:text-white shadow-sm font-black border border-slate-200 dark:border-slate-700'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ================= PERSISTENT ERROR BANNER ================= */}
        {bannerError && (
          <div className="m-4 p-3 rounded-2xl bg-red-50 border border-red-200 text-red-800 text-xs font-medium flex items-center justify-between animate-shake">
            <div className="flex items-center space-x-2">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{bannerError}</span>
            </div>
            <button
              type="button"
              onClick={() => setBannerError(null)}
              className="font-bold text-red-700 underline text-[12px] cursor-pointer"
            >
              Retry
            </button>
          </div>
        )}

        {/* ================= STEP CONTENT CONTAINER & FORM ================= */}
        <form onSubmit={handleFinalPublish} className="p-4 sm:p-6 max-h-[65vh] overflow-y-auto space-y-4">
          
          {/* ----------------- STEP 1: CONTENT & CORE FIELDS ----------------- */}
          {currentStep === 1 && (
            <div className="space-y-4 animate-fadeIn">
              <CustomTextField
                label="Title"
                required
                maxLength={90}
                placeholder={
                  postType === 'event'
                    ? 'e.g. Kilimani Weekend Creators Market'
                    : postType === 'product'
                    ? 'e.g. Organic Farm Avocados (Box of 12)'
                    : 'e.g. Community Road Maintenance Meeting'
                }
                value={title}
                onChange={(v) => {
                  setTitle(v);
                  if (titleError) setTitleError('');
                }}
                errorMessage={titleError}
              />

              <CustomTextField
                label="Description & Details"
                required
                maxLines={3}
                maxLength={300}
                placeholder="Provide context, schedule, pricing breakdown, or contact instructions..."
                value={description}
                onChange={(v) => {
                  setDescription(v);
                  if (descError) setDescError('');
                }}
                errorMessage={descError}
                helperText="Be detailed and authentic for higher community trust."
              />

              {/* Photos & Media (Embedded directly in Step 1 for instant access) */}
              <MultiImagePicker
                maxImages={5}
                images={images}
                onImagesChange={setImages}
              />

              {/* District Selector */}
              <div className="space-y-1.5 text-xs">
                <label className="font-bold text-slate-800 dark:text-slate-200 block">
                  Town District / Hub
                </label>
                <select
                  value={district}
                  onChange={(e) => setDistrict(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl py-3 px-3 text-xs text-slate-800 dark:text-slate-200 outline-none focus:border-[#0891B2]"
                >
                  {kenyanDistricts.map((d) => (
                    <option key={d} value={d}>
                      📍 {d}
                    </option>
                  ))}
                </select>
              </div>

              {/* ================= CONDITIONAL TYPE FIELDS (STEP 1 SUMMARY) ================= */}
              
              {/* EVENT QUICK FIELDS */}
              {postType === 'event' && (
                <div className="p-3.5 rounded-2xl bg-blue-50/70 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/40 space-y-3">
                  <div className="flex items-center space-x-1.5 text-blue-900 dark:text-blue-200 font-bold text-xs">
                    <CalendarDays className="w-4 h-4 text-blue-600" />
                    <span>Event Schedule & Venue</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <CustomTextField
                      label="Date & Schedule"
                      placeholder="e.g. Saturday, 14 June"
                      value={eventDate}
                      onChange={setEventDate}
                      icon={<CalendarDays className="w-3.5 h-3.5" />}
                    />
                    <CustomTextField
                      label="Start Time"
                      placeholder="e.g. 18:00 EAT"
                      value={eventTime}
                      onChange={setEventTime}
                      icon={<Clock className="w-3.5 h-3.5" />}
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <CustomTextField
                      label="Venue / Landmark"
                      placeholder="e.g. Westlands Sarit Hub"
                      value={location}
                      onChange={setLocation}
                      icon={<MapPin className="w-3.5 h-3.5" />}
                    />
                    <CustomTextField
                      label="Gate Fee (KES)"
                      placeholder="0 for Free"
                      type="number"
                      value={gateFeeKes}
                      onChange={setGateFeeKes}
                      icon={<DollarSign className="w-3.5 h-3.5" />}
                    />
                  </div>
                </div>
              )}

              {/* PRODUCT QUICK FIELDS */}
              {postType === 'product' && (
                <div className="p-3.5 rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/40 space-y-3">
                  <div className="flex items-center space-x-1.5 text-emerald-900 dark:text-emerald-200 font-bold text-xs">
                    <Tag className="w-4 h-4 text-emerald-600" />
                    <span>Pricing & Inventory</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <CustomTextField
                      label="Price (KES)"
                      required
                      type="number"
                      placeholder="e.g. 1200"
                      value={priceKes}
                      onChange={(v) => {
                        setPriceKes(v);
                        if (priceError) setPriceError('');
                      }}
                      errorMessage={priceError}
                      icon={<DollarSign className="w-3.5 h-3.5" />}
                    />

                    <div className="space-y-1.5 text-xs">
                      <label className="font-bold text-slate-800 dark:text-slate-200 block">
                        Category
                      </label>
                      <select
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl py-3 px-3 text-xs outline-none focus:border-[#0891B2]"
                      >
                        {categories.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* ANNOUNCEMENT QUICK FIELDS */}
              {postType === 'announcement' && (
                <div className="p-3.5 rounded-2xl bg-amber-50/70 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/40 space-y-2">
                  <div className="flex items-center space-x-1.5 text-amber-900 dark:text-amber-200 font-bold text-xs">
                    <Megaphone className="w-4 h-4 text-amber-600" />
                    <span>Civic & Community Scope</span>
                  </div>
                  <p className="text-[12px] text-amber-800 dark:text-amber-300 leading-relaxed">
                    Announcements are highlighted in the local neighborhood bulletin and town district feed with verified member authorship.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ----------------- STEP 2: MEDIA & ADVANCED LOGISTICS ----------------- */}
          {currentStep === 2 && (
            <div className="space-y-4 animate-fadeIn">
              <MultiImagePicker
                maxImages={5}
                images={images}
                onImagesChange={setImages}
              />

              {/* Extended Event Fields */}
              {postType === 'event' && (
                <div className="p-4 rounded-2xl bg-blue-50/70 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/40 space-y-3">
                  <div className="flex items-center space-x-1.5 text-blue-900 dark:text-blue-200 font-bold text-xs">
                    <CalendarDays className="w-4 h-4 text-blue-600" />
                    <span>Event Schedule & Presets</span>
                  </div>

                  <div className="flex items-center space-x-1.5 overflow-x-auto pb-1">
                    {['Today', 'Tomorrow', 'This Weekend', 'Next Week'].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => {
                          soundEngine.play('tap');
                          setEventDate(preset);
                        }}
                        className={`px-2.5 py-1 rounded-xl text-[12px] font-bold transition-all ${
                          eventDate === preset
                            ? 'bg-blue-600 text-white'
                            : 'bg-white dark:bg-slate-800 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800'
                        }`}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <CustomTextField
                      label="Event Date"
                      value={eventDate}
                      onChange={setEventDate}
                      icon={<CalendarDays className="w-3.5 h-3.5" />}
                    />
                    <CustomTextField
                      label="Event Time"
                      value={eventTime}
                      onChange={setEventTime}
                      icon={<Clock className="w-3.5 h-3.5" />}
                    />
                  </div>
                </div>
              )}

              {/* Extended Product Fields */}
              {postType === 'product' && (
                <div className="p-4 rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/40 space-y-3">
                  <div className="flex items-center space-x-1.5 text-emerald-900 dark:text-emerald-200 font-bold text-xs">
                    <Tag className="w-4 h-4 text-emerald-600" />
                    <span>Pricing & Inventory</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <CustomTextField
                      label="Price (KES)"
                      required
                      type="number"
                      placeholder="e.g. 1200"
                      value={priceKes}
                      onChange={setPriceKes}
                      icon={<DollarSign className="w-3.5 h-3.5" />}
                    />

                    <CustomTextField
                      label="Stock Units Available"
                      type="number"
                      placeholder="e.g. 5"
                      value={stockUnits}
                      onChange={setStockUnits}
                    />
                  </div>

                  <label className="flex items-center space-x-2 pt-2 cursor-pointer text-xs font-bold text-slate-700 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={courierEligible}
                      onChange={(e) => setCourierEligible(e.target.checked)}
                      className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500"
                    />
                    <span>Wairo Ground Courier Eligible (Boda / Cargo)</span>
                  </label>
                </div>
              )}

              {/* Extended Announcement Fields */}
              {postType === 'announcement' && (
                <div className="p-4 rounded-2xl bg-amber-50/70 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/40 space-y-3">
                  <div className="flex items-center space-x-1.5 text-amber-900 dark:text-amber-200 font-bold text-xs">
                    <Megaphone className="w-4 h-4 text-amber-600" />
                    <span>Priority & Broadcast Scope</span>
                  </div>

                  <div className="flex items-center space-x-2">
                    {[
                      { id: 'normal', label: 'Normal' },
                      { id: 'urgent', label: '🚨 Urgent Alert' },
                      { id: 'pinned', label: '📌 Pinned Bulletin' }
                    ].map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          soundEngine.play('tap');
                          setPriority(p.id as 'normal' | 'urgent' | 'pinned');
                        }}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                          priority === p.id
                            ? 'bg-amber-600 text-white'
                            : 'bg-white dark:bg-slate-800 text-amber-900 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ----------------- STEP 3: LIVE PREVIEW & POST ----------------- */}
          {currentStep === 3 && (
            <div className="space-y-4 animate-fadeIn">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Live Feed Preview
                </span>
                <span className="text-[11px] text-slate-400 font-mono">
                  District: {district}
                </span>
              </div>

              <LiveCardPreview post={currentPreviewPost} />

              <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-start space-x-2 text-[12px] text-slate-600 dark:text-slate-400">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>
                  By publishing, you confirm adherence to Brief Kenya community guidelines. Your post will be synchronized across local offline mesh and online channels.
                </span>
              </div>
            </div>
          )}

          {/* SUCCESS MESSAGE */}
          {successMsg && (
            <div className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold flex items-center space-x-2 animate-fadeIn">
              <Check className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}
        </form>

        {/* ================= MODAL FOOTER & ACTION CONTROLS ================= */}
        <div className="bg-slate-50 dark:bg-slate-900/90 border-t border-slate-200 dark:border-slate-800 p-4 sm:p-5 flex items-center justify-between gap-3">
          {currentStep > 1 ? (
            <button
              type="button"
              onClick={handlePrevStep}
              className="px-4 py-3 rounded-2xl bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold text-xs flex items-center space-x-1.5 cursor-pointer transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleRequestClose}
              className="px-4 py-3 rounded-2xl text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 font-bold text-xs cursor-pointer"
            >
              Cancel
            </button>
          )}

          {currentStep < 3 ? (
            <button
              type="button"
              onClick={handleNextStep}
              className="flex-1 max-w-[220px] py-3 rounded-2xl bg-[color:var(--brief-ink)] hover:bg-[#1E293B] text-white font-black text-xs uppercase tracking-wider flex items-center justify-center space-x-1.5 shadow-md cursor-pointer transition-all active:scale-95"
            >
              <span>Next: {currentStep === 1 ? 'Media & Details' : 'Preview'}</span>
              <ArrowRight className="w-3.5 h-3.5 text-[#40916C]" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleFinalPublish}
              disabled={isSubmitting}
              className="flex-1 max-w-[240px] py-3.5 rounded-2xl bg-[color:var(--brief-ink)] hover:bg-[#1E293B] text-white font-black text-xs uppercase tracking-wider shadow-lg flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-50 transition-all active:scale-95"
            >
              <Sparkles className="w-4 h-4 text-[#40916C]" />
              <span>{isSubmitting ? 'Publishing…' : `Publish ${postType.toUpperCase()}`}</span>
            </button>
          )}
        </div>

      </div>

      {/* Draft Discard Confirmation Dialog */}
      <DiscardConfirmationModal
        isOpen={discardModalOpen}
        onKeepEditing={() => { soundEngine.play('tap'); setDiscardModalOpen(false); }}
        onSaveDraftAndExit={handleSaveDraftAndExit}
        onDiscardCompletely={handleDiscardCompletely}
      />
    </div>
  );
}

export { CreatePostSheet } from './CreatePostSheet';
