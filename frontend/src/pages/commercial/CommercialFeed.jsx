import { useEffect, useState, useCallback } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import {
  Search, PiggyBank, Users, Store, Sparkles, TrendingUp,
  Bookmark, ShoppingCart, Plus, ArrowLeft,
} from "lucide-react";
import { commercialAPI, apiError } from "@/lib/api";
import { num } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import EmptyState from "@/components/ui/EmptyState";
import { PageSpinner } from "@/components/ui/Spinner";
import CommercialPostCard from "@/components/commercial/CommercialPostCard";
import CommercialShelf from "@/components/commercial/CommercialShelf";
import CreateCommercialPost from "@/components/commercial/CreateCommercialPost";

const FILTERS = [
  { value: "all", label: "All posts", icon: Store },
  { value: "commercial", label: "Offers", icon: ShoppingCart },
  { value: "group_buy", label: "Group buys", icon: Users },
  { value: "savings", label: "Savings", icon: PiggyBank },
  { value: "saved", label: "Saved", icon: Bookmark },
];

export default function CommercialFeed() {
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = searchParams.get("filter") || "all";
  const q = searchParams.get("q") || "";

  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchInput, setSearchInput] = useState(q);
  const [showCreate, setShowCreate] = useState(false);
  const [stats, setStats] = useState(null);
  const [singlePost, setSinglePost] = useState(null);
  const [singleLoading, setSingleLoading] = useState(false);

  // If viewing single post
  useEffect(() => {
    if (!id) {
      setSinglePost(null);
      return;
    }
    setSingleLoading(true);
    commercialAPI
      .get(id)
      .then((r) => setSinglePost(r.data))
      .catch((e) => setError(apiError(e, "Post not found")))
      .finally(() => setSingleLoading(false));
  }, [id]);

  const loadFeed = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = { limit: 30 };
      if (filter === "commercial") params.commercial_only = true;
      if (filter === "group_buy") params.group_buy_only = true;
      if (filter === "saved") params.saved_only = true;
      if (filter === "savings") {
        params.commercial_only = true;
        // savings filter handled client-side for now
      }
      if (q) params.search = q;

      const res = await commercialAPI.feed(params);
      setPosts(res.data.posts || []);

      // Also load stats for moat metrics
      try {
        const s = await commercialAPI.stats();
        setStats(s.data);
      } catch {
        // ignore
      }
    } catch (e) {
      if (e?.response?.status === 404) {
        setPosts([]);
      } else {
        setError(apiError(e, "Could not load feed"));
      }
    } finally {
      setLoading(false);
    }
  }, [filter, q]);

  useEffect(() => {
    if (!id) loadFeed();
  }, [loadFeed, id]);

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => {
      if (searchInput !== q) {
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev);
          if (searchInput) next.set("q", searchInput);
          else next.delete("q");
          return next;
        });
      }
    }, 400);
    return () => clearTimeout(t);
  }, [searchInput, q, setSearchParams]);

  const handleSave = async (post) => {
    try {
      if (post.is_saved) {
        await commercialAPI.unsave(post.id);
        setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, is_saved: false, save_count: Math.max(0, (p.save_count || 1) - 1) } : p)));
        if (singlePost && singlePost.id === post.id) setSinglePost({ ...singlePost, is_saved: false });
      } else {
        await commercialAPI.save(post.id);
        setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, is_saved: true, save_count: (p.save_count || 0) + 1 } : p)));
        if (singlePost && singlePost.id === post.id) setSinglePost({ ...singlePost, is_saved: true });
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleShare = async (post) => {
    try {
      const res = await commercialAPI.share(post.id, { share_channel: "copy_link" });
      const url = res.data.share_url;
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(`${window.location.origin}${url}`);
      }
      // Show feedback - could use toast
      alert(`Link copied! Share: ${window.location.origin}${url}\nReferral: ${res.data.referral_code}\nCommission: ${post.commission_rate || 0}%`);
      setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, share_count: (p.share_count || 0) + 1 } : p)));
    } catch (e) {
      console.error(e);
    }
  };

  const handleJoin = async (post) => {
    if (post.is_interested) {
      try {
        await commercialAPI.leaveInterest(post.id);
        setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, is_interested: false, current_interested: Math.max(0, (p.current_interested || 1) - 1) } : p)));
        if (singlePost && singlePost.id === post.id) setSinglePost({ ...singlePost, is_interested: false });
      } catch (e) {
        console.error(e);
      }
      return;
    }
    const qtyStr = prompt(`How many units? (target: ${post.target_quantity || post.min_group_size || "any"})`, "1");
    if (!qtyStr) return;
    const qty = Number(qtyStr);
    if (!Number.isFinite(qty) || qty < 1) return;
    try {
      const res = await commercialAPI.joinInterest(post.id, { quantity: qty });
      setPosts((prev) =>
        prev.map((p) =>
          p.id === post.id
            ? {
                ...p,
                is_interested: true,
                current_interested: res.data.current_interested,
                current_quantity_pledged: res.data.current_quantity,
              }
            : p
        )
      );
      if (singlePost && singlePost.id === post.id) {
        setSinglePost({
          ...singlePost,
          is_interested: true,
          current_interested: res.data.current_interested,
          current_quantity_pledged: res.data.current_quantity,
        });
      }
      alert(`Joined! ${res.data.current_interested} interested · ${res.data.current_quantity}/${res.data.target_quantity || "?"} units · ${res.data.progress || 0}% to target`);
    } catch (e) {
      alert(apiError(e, "Could not join"));
    }
  };

  // Single post view
  if (id) {
    if (singleLoading) return <PageSpinner label="Loading offer…" />;
    if (error) return <EmptyState icon={Store} title="Post not found" description={error} />;
    if (!singlePost) return <EmptyState icon={Store} title="Post not found" description="This offer may have been removed" />;

    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <Link to="/commercial" className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-4 hover:text-ink-2">
          <ArrowLeft size={14} /> Back to commercial feed
        </Link>
        <CommercialPostCard post={singlePost} onSave={handleSave} onShare={handleShare} onJoin={handleJoin} />
        <InterestsList postId={singlePost.id} />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      {/* Header — moat explanation */}
      <div className="rounded-3xl bg-gradient-to-br from-brand-500/10 via-emerald-500/10 to-blue-500/10 border border-edge-1 p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-ink-1 flex items-center gap-2">
              <Store size={20} className="text-brand-600" /> Commercial Shelf
            </h1>
            <p className="text-xs text-ink-3 mt-1 max-w-xl">
              A social commerce layer built around offers, savings, and coordinated buying. Posts become actionable opportunities — salespeople share offers and earn, groups combine demand to unlock better prices.
            </p>
          </div>
          <button type="button" onClick={() => setShowCreate(true)} className="hidden sm:inline-flex h-9 px-4 rounded-xl bg-brand-600 text-white text-xs font-bold items-center gap-1.5 hover:bg-brand-700 shrink-0">
            <Plus size={14} /> New offer
          </button>
        </div>

        {stats && (
          <div className="grid grid-cols-3 gap-2 pt-2">
            <div className="rounded-2xl bg-surface-0 border border-edge-1 p-3">
              <p className="text-2xs text-ink-4 flex items-center gap-1"><Users size={10} /> Distribution</p>
              <p className="text-lg font-bold text-ink-1">{num(stats.shares_made)}</p>
              <p className="text-2xs text-ink-4">shares by you · {stats.moat_metrics?.conversion_rate || 0}% conv</p>
            </div>
            <div className="rounded-2xl bg-surface-0 border border-edge-1 p-3">
              <p className="text-2xs text-ink-4 flex items-center gap-1"><PiggyBank size={10} /> Demand</p>
              <p className="text-lg font-bold text-ink-1">{num(stats.interests_received)}</p>
              <p className="text-2xs text-ink-4">buyers on your offers</p>
            </div>
            <div className="rounded-2xl bg-surface-0 border border-edge-1 p-3">
              <p className="text-2xs text-ink-4 flex items-center gap-1"><TrendingUp size={10} /> Commission</p>
              <p className="text-lg font-bold text-emerald-700 dark:text-emerald-300">KES {num(stats.commission_earned)}</p>
              <p className="text-2xs text-ink-4">{stats.conversions_via_shares} conversions</p>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-1.5 text-2xs">
          <span className="inline-flex items-center gap-1 rounded-full bg-surface-0 border border-edge-1 px-2.5 py-1"><Store size={10} /> Social feed → commercial shelf</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-surface-0 border border-edge-1 px-2.5 py-1"><PiggyBank size={10} /> Verified savings</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-surface-0 border border-edge-1 px-2.5 py-1"><Users size={10} /> Group-buying layer</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-surface-0 border border-edge-1 px-2.5 py-1"><Sparkles size={10} /> Salesperson distribution moat</span>
        </div>
      </div>

      {/* Search + filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-4" />
          <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Search offers, products, locations…" className="w-full h-10 rounded-xl border border-edge-1 bg-surface-0 pl-10 pr-3 text-sm focus:border-brand-500 focus:outline-none" />
        </div>
        <button type="button" onClick={() => setShowCreate(true)} className="sm:hidden h-10 rounded-xl bg-brand-600 text-white text-sm font-bold inline-flex items-center justify-center gap-1.5">
          <Plus size={16} /> New offer
        </button>
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {FILTERS.map((f) => {
          const Icon = f.icon;
          const active = filter === f.value;
          return (
            <button key={f.value} type="button" onClick={() => setSearchParams((prev) => { const n = new URLSearchParams(prev); if (f.value === "all") n.delete("filter"); else n.set("filter", f.value); return n; })} className={cn("shrink-0 h-8 px-3 rounded-full text-xs font-medium inline-flex items-center gap-1.5 border", active ? "bg-brand-600 text-white border-brand-600" : "bg-surface-0 text-ink-3 border-edge-1 hover:border-edge-2")}>
              <Icon size={12} /> {f.label}
            </button>
          );
        })}
      </div>

      {/* Commercial shelf — curated */}
      {filter === "all" && !q && <CommercialShelf limit={6} />}

      {/* Feed */}
      {loading ? (
        <div className="space-y-3">
          {[1,2,3].map((i) => (
            <div key={i} className="glass rounded-2xl p-4 animate-pulse">
              <div className="flex gap-3">
                <div className="h-10 w-10 rounded-full bg-surface-2" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-surface-2 rounded w-1/3" />
                  <div className="h-3 bg-surface-2 rounded" />
                  <div className="h-3 bg-surface-2 rounded w-2/3" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <EmptyState icon={Store} title="Could not load feed" description={error} />
      ) : posts.length === 0 ? (
        <EmptyState icon={PiggyBank} title={filter === "saved" ? "No saved offers" : "No offers yet"} description={filter === "saved" ? "Save offers to find them here" : q ? `No results for "${q}"` : "Be the first to post a commercial offer. Share products with individual vs group pricing to unlock savings."} />
      ) : (
        <div className="space-y-3">
          {posts.map((post) => (
            <CommercialPostCard key={post.id} post={post} onSave={handleSave} onShare={handleShare} onJoin={handleJoin} onView={(p) => window.location.assign(`/commercial/${p.id}`)} />
          ))}
        </div>
      )}

      <CreateCommercialPost open={showCreate} onClose={() => setShowCreate(false)} onCreated={() => loadFeed()} />

      <p className="text-2xs text-ink-4 text-center px-4">
        Harnessing existing stock, collective sourcing, vendor groups, and market locks — not replacing them. The moat is distribution + aggregated demand + verified savings.
      </p>
    </div>
  );
}

function InterestsList({ postId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    commercialAPI.interests(postId).then((r) => setData(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, [postId]);

  if (loading) return <div className="text-2xs text-ink-4">Loading interests…</div>;
  if (!data || data.interests?.length === 0) return null;

  return (
    <div className="glass rounded-2xl p-4 space-y-3">
      <h4 className="text-xs font-bold text-ink-1 flex items-center gap-1.5">
        <Users size={14} /> {data.total_interested} interested · {data.total_quantity}/{data.target_quantity || data.min_group_size || "?"} units · {data.progress_pct}% to target
      </h4>
      <div className="space-y-2">
        {data.interests.map((i) => (
          <div key={i.id} className="flex items-center justify-between text-xs">
            <span className="font-medium text-ink-1">@{i.vendor_handle} · {i.vendor_business}</span>
            <span className="text-ink-4">x{i.quantity} · {i.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
