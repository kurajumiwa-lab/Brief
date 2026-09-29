import { useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { FileUp, FileCheck2, X } from "lucide-react";
import { cn } from "@/lib/utils";

export default function FileUpload({ file, onFile, accept = { "text/csv": [".csv"] }, label = "Drop a CSV here, or click to choose", hint, className }) {
  const onDrop = useCallback((accepted) => accepted[0] && onFile?.(accepted[0]), [onFile]);
  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, accept, multiple: false, maxSize: 10 * 1024 * 1024 });

  return (
    <div className={className}>
      <div
        {...getRootProps()}
        className={cn(
          "rounded-xl border-2 border-dashed px-4 py-8 text-center cursor-pointer transition-colors",
          isDragActive ? "border-brand-500 bg-brand-950/30" : "border-edge-2 hover:border-edge-3 bg-surface-1"
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
