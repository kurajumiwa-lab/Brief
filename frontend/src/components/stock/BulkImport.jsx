import { useState } from "react";
import { Upload, Download } from "lucide-react";
import FileUpload from "@/components/ui/FileUpload";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import { toast } from "@/components/ui/Toast";
import { useStockStore } from "@/stores/stockStore";
import { apiError } from "@/lib/api";

const TEMPLATE = "name,sku,category,quantity_in_stock,unit_of_measure,cost_price,wholesale_price,unit_price,min_order_quantity,visible_to_network,tags\nSukuma wiki,SUK-1,vegetables,120,bunches,15,20,30,10,true,\"fresh,farm-gate\"\n";

export default function BulkImport({ onDone }) {
  const bulkImport = useStockStore((s) => s.bulkImport);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob([TEMPLATE], { type: "text/csv" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "brief_stock_template.csv" });
    a.click();
    URL.revokeObjectURL(url);
  };

  const run = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const res = await bulkImport(file);
      setResult(res);
      toast.success(`Imported: ${res.added} added, ${res.updated} updated`);
      if (!res.errors?.length) onDone?.(res);
    } catch (err) {
      toast.error(apiError(err, "Import failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-ink-3 leading-relaxed">
        One row per item. <span className="font-mono text-ink-2">name</span> is required; rows with a matching <span className="font-mono text-ink-2">sku</span> update the existing line instead of duplicating it.
      </p>
      <FileUpload file={file} onFile={setFile} hint="CSV up to 10 MB" />
      {result && (
        <div className="rounded-lg border border-edge-1 bg-surface-1 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Badge variant="brand">{result.added} added</Badge>
            <Badge variant="blue">{result.updated} updated</Badge>
            {result.errors?.length > 0 && <Badge variant="red">{result.errors.length} errors</Badge>}
          </div>
          {result.errors?.length > 0 && (
            <ul className="text-2xs text-red-600 dark:text-red-400 font-mono space-y-0.5 max-h-32 overflow-y-auto">
              {result.errors.map((e, i) => (
                <li key={i}>{typeof e === "string" ? e : JSON.stringify(e)}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" icon={Download} onClick={downloadTemplate}>
          Template
        </Button>
        <Button icon={Upload} onClick={run} loading={busy} disabled={!file}>
          Import stock
        </Button>
      </div>
    </div>
  );
}
