import { useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { FileUp, FileCheck2, X } from "lucide-react";
import { cn } from "@/lib/utils";

const MIME = { ".csv": "text/csv", ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };

/** Accept either react-dropzone's `{ mime: [ext] }` map or a plain ".pdf,.png" list. */
const normaliseAccept = (accept) => {
  if (!accept || typeof accept !== "string") return accept;
  const out = {};
  accept.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean).forEach((ext) => {
    const mime = MIME[ext] || "application/octet-stream";
    out[mime] = [...(out[mime] || []), ext];
  });
  return out;
};

export default function FileUpload({ file, onFile, accept = { "text/csv": [".csv"] }, label = "Drop a CSV here, or click to choose", hint, className, maxSizeMb = 10 }) {
  const onDrop = useCallback((accepted) => accepted[0] && onFile?.(accepted[0]), [onFile]);
  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, accept: normaliseAccept(accept), multiple: false, maxSize: maxSizeMb * 1024 * 1024 });

  return (
    <div className={className}>
      <div
        {...getRootProps()}
        className={cn(
          "rounded-xl px-4 py-8 text-center cursor-pointer transition-all duration-300",
          isDragActive
            ? "bg-brand-500/[0.12] shadow-[0_0_32px_-6px_rgba(245, 158, 11,0.55)]"
            : "bg-white/[0.05] hover:bg-white/[0.08] hover:shadow-[0_0_24px_-8px_rgba(245, 158, 11,0.35)]"
        )}
      >
        <input {...getInputProps()} aria-label="Upload file" />
        {file ? (
          <div className="flex items-center justify-center gap-2 text-sm text-ink-1">
            <FileCheck2 size={16} className="text-brand-400" />
            <span className="font-mono text-xs truncate max-w-[16rem]">{file.name}</span>
            <span className="text-2xs text-ink-4">{(file.size / 1024).toFixed(1)} KB</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onFile?.(null);
              }}
              className="p-1 rounded text-ink-4 hover:text-ink-1"
              aria-label="Remove file"
            >
              <X size={12} />
            </button>
          </div>
        ) : (
          <div className="text-ink-4">
            <FileUp size={20} className="mx-auto mb-2 text-ink-4" />
            <p className="text-xs text-ink-3">{label}</p>
            {hint && <p className="text-2xs mt-1">{hint}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
