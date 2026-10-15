import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  LayoutGrid,
  Pencil,
  Plus,
  Quote,
  Send,
  Sparkles,
  Trash2,
} from "lucide-react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import Modal from "@/components/ui/Modal";
import Select from "@/components/ui/Select";
import { toast } from "@/components/ui/Toast";
import { useAuthStore } from "@/stores/authStore";
import { fileAPI, apiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  PORTFOLIO_NAVIGATION,
  PORTFOLIO_DISCIPLINES,
  DEFAULT_CREATIVE_IDENTITY,
  INITIAL_PORTFOLIO_PROJECTS,
  CREATIVE_CAPABILITIES,
  CREATIVE_PROCESS_STEPS,
  SERVICE_PACKAGES,
  PLACEHOLDER_TESTIMONIALS,
  HIERARCHY_TRANSFORMATION_MAP,
} from "@/config/portfolioData";

const STORAGE_KEYS = {
  identity: "ogallo_creative_identity_v1",
  projects: "ogallo_creative_projects_v1",
  inquiries: "ogallo_creative_inquiries_v1",
};

function loadStored(key, fallback) {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveStored(key, value) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore quota errors */
  }
}

async function readGalleryImage(file) {
  if (!file) return "";
  try {
    if (fileAPI?.upload) {
      const res = await fileAPI.upload(file);
      if (res?.data?.url) return res.data.url;
    }
  } catch {
    /* fall through to local data URL */
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read image from gallery"));
    reader.readAsDataURL(file);
  });
}

export default function CreativePortfolioPage({ embedded = false }) {
  const vendor = useAuthStore((s) => s.vendor);

  const [identity, setIdentity] = useState(() => loadStored(STORAGE_KEYS.identity, DEFAULT_CREATIVE_IDENTITY));
  const [projects, setProjects] = useState(() => loadStored(STORAGE_KEYS.projects, INITIAL_PORTFOLIO_PROJECTS));
  const [inquiries, setInquiries] = useState(() => loadStored(STORAGE_KEYS.inquiries, []));

  const [surfaceMode, setSurfaceMode] = useState("portfolio"); // "portfolio" | "dashboard"
  const [activeSection, setActiveSection] = useState("overview");
  const [selectedDiscipline, setSelectedDiscipline] = useState("All");
  const [featuredIndex, setFeaturedIndex] = useState(0);
  const [activeCaseStudy, setActiveCaseStudy] = useState(null);
  const [caseSlideIndex, setCaseSlideIndex] = useState(0);

  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [identityModalOpen, setIdentityModalOpen] = useState(false);
  const [inquiryModalOpen, setInquiryModalOpen] = useState(false);
  const [inquirySubmitted, setInquirySubmitted] = useState(null);

  const workSectionRef = useRef(null);
  const caseSectionRef = useRef(null);
  const servicesSectionRef = useRef(null);
  const processSectionRef = useRef(null);
  const inquireSectionRef = useRef(null);

  const [inquiryForm, setInquiryForm] = useState({
    clientName: "",
    clientContact: "",
    discipline: "Branding",
    packageTitle: "Brand Identity System",
    budgetRange: "Custom project quote",
    timeline: "Flexible / Within 1–2 months",
    brief: "",
    referenceImage: "",
  });

  useEffect(() => {
    if (embedded || typeof document === "undefined") return;
    const prevTitle = document.title;
    const studioName = vendor?.business_name || "Creative Studio";
    document.title = `${studioName} — I design brands that people remember | Creative Portfolio & Services`;

    const setMeta = (attr, key, content) => {
      let el = document.querySelector(`meta[${attr}="${key}"]`);
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute(attr, key);
        document.head.appendChild(el);
      }
      el.setAttribute("content", content);
    };
    setMeta("name", "description", identity.subheadline);
    setMeta("property", "og:title", `${studioName} — ${identity.headline}`);
    setMeta("property", "og:description", identity.subheadline);
    setMeta("property", "og:type", "website");

    return () => {
      document.title = prevTitle;
    };
  }, [embedded, identity.headline, identity.subheadline, vendor?.business_name]);

  const featuredProjects = useMemo(() => {
    const feat = projects.filter((p) => p.featured);
    return feat.length > 0 ? feat : projects;
  }, [projects]);

  const currentFeatured = featuredProjects[featuredIndex % Math.max(1, featuredProjects.length)] || projects[0];

  const filteredProjects = useMemo(() => {
    if (selectedDiscipline === "All") return projects;
    return projects.filter((p) => p.discipline === selectedDiscipline);
  }, [projects, selectedDiscipline]);

  const disciplineCounts = useMemo(() => {
    const counts = { All: projects.length, Branding: 0, "Web Design": 0, Print: 0, Motion: 0 };
    for (const p of projects) {
      if (counts[p.discipline] != null) counts[p.discipline] += 1;
    }
    return counts;
  }, [projects]);

  const featuredCaseStudy = activeCaseStudy || currentFeatured || projects[0];
  const caseGallery = useMemo(() => {
    if (!featuredCaseStudy) return [];
    const slides = featuredCaseStudy.caseStudy?.gallery || [];
    return slides.length > 0 ? slides : [featuredCaseStudy.thumbnail];
  }, [featuredCaseStudy]);

  const jumpToSection = (id) => {
    setActiveSection(id);
    setSurfaceMode("portfolio");
    const map = {
      overview: null,
      work: workSectionRef.current,
      "case-studies": caseSectionRef.current,
      services: servicesSectionRef.current,
      process: processSectionRef.current,
      inquire: inquireSectionRef.current,
    };
    const target = map[id];
    if (target && typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const openCaseStudy = (project) => {
    setActiveCaseStudy(project);
    setCaseSlideIndex(0);
    setActiveSection("case-studies");
    if (caseSectionRef.current && typeof caseSectionRef.current.scrollIntoView === "function") {
      caseSectionRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const startProjectWithContext = ({ discipline = "Branding", packageTitle = "Brand Identity System" } = {}) => {
    setInquiryForm((prev) => ({
      ...prev,
      discipline,
      packageTitle,
    }));
    setInquirySubmitted(null);
    jumpToSection("inquire");
  };

  const handleInquirySubmit = (e) => {
    e.preventDefault();
    if (!inquiryForm.clientName.trim() || !inquiryForm.brief.trim()) {
      toast.error("Please enter your name and a short project brief.");
      return;
    }
    const record = {
      id: `inq-${Date.now()}`,
      clientName: inquiryForm.clientName.trim(),
      clientContact: inquiryForm.clientContact.trim() || "Not provided",
      discipline: inquiryForm.discipline,
      packageTitle: inquiryForm.packageTitle,
      budgetRange: inquiryForm.budgetRange,
      timeline: inquiryForm.timeline,
      brief: inquiryForm.brief.trim(),
      referenceImage: inquiryForm.referenceImage || "",
      status: "new",
      createdAt: new Date().toISOString(),
    };
    const next = [record, ...inquiries];
    setInquiries(next);
    saveStored(STORAGE_KEYS.inquiries, next);
    setInquirySubmitted(record);
    setInquiryModalOpen(false);
    toast.success("Project inquiry sent! Added to your Studio Dashboard.");
  };

  const handleAddProject = (newProj) => {
    const next = [newProj, ...projects];
    setProjects(next);
    saveStored(STORAGE_KEYS.projects, next);
    setActiveCaseStudy(newProj);
    setProjectModalOpen(false);
    toast.success(`Added "${newProj.title}" to your portfolio`);
  };

  const handleDeleteProject = (id) => {
    const next = projects.filter((p) => p.id !== id);
    setProjects(next);
    saveStored(STORAGE_KEYS.projects, next);
    if (activeCaseStudy?.id === id) setActiveCaseStudy(next[0] || null);
    toast.success("Project removed");
  };

  const handleUpdateInquiryStatus = (id, status) => {
    const next = inquiries.map((inq) => (inq.id === id ? { ...inq, status } : inq));
    setInquiries(next);
    saveStored(STORAGE_KEYS.inquiries, next);
  };

  const prevFeatured = () => {
    setFeaturedIndex((idx) => (idx - 1 + featuredProjects.length) % Math.max(1, featuredProjects.length));
  };
  const nextFeatured = () => {
    setFeaturedIndex((idx) => (idx + 1) % Math.max(1, featuredProjects.length));
  };

  return (
    <div className="space-y-8 sm:space-y-10" data-testid="creative-portfolio-platform">
      {/* ══ Simplified Portfolio Navigation (Desktop + Mobile) ═══════════ */}
      <nav
        aria-label="Portfolio navigation"
        className="sticky top-0 z-20 rounded-2xl border border-[#23392D] bg-[#0D100F]/95 backdrop-blur-md px-3.5 py-2.5 text-white shadow-lg"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="grid place-items-center w-8 h-8 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 shrink-0">
              <Sparkles size={15} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-extrabold tracking-tight text-white truncate">
                {vendor?.business_name || "Creative Studio"}
              </p>
              <p className="text-[11px] text-emerald-300/80 truncate">
                {identity.studioTagline}
              </p>
            </div>
          </div>

          {/* Primary Portfolio Section Links */}
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5" role="menubar">
            {PORTFOLIO_NAVIGATION.map((item) => {
              const active = surfaceMode === "portfolio" && activeSection === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  onClick={() => jumpToSection(item.id)}
                  className={cn(
                    "px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer",
                    active
                      ? "bg-emerald-500 text-[#081A12] font-bold"
                      : "text-[#C5D6CC] hover:text-white hover:bg-white/10"
                  )}
                >
                  {item.label}
                </button>
              );
            })}
          </div>

          {/* Hybrid Studio Dashboard Switch + Quick CTA */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setSurfaceMode((m) => (m === "portfolio" ? "dashboard" : "portfolio"))}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer",
                surfaceMode === "dashboard"
                  ? "border-emerald-400 bg-emerald-500/20 text-emerald-200"
                  : "border-white/15 bg-white/5 text-[#D1E0D7] hover:bg-white/10"
              )}
            >
              <LayoutGrid size={13} aria-hidden="true" />
              <span>Studio Dashboard</span>
              {inquiries.length > 0 && (
                <span className="rounded-full bg-emerald-400 text-[#081A12] px-1.5 py-px text-[10px] font-extrabold">
                  {inquiries.length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setInquiryModalOpen(true)}
              className="hidden sm:inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-[#071912] px-3.5 py-1.5 text-xs font-extrabold transition-colors cursor-pointer"
            >
              <span>Start a Project</span>
              <ArrowUpRight size={13} aria-hidden="true" />
            </button>
          </div>
        </div>
      </nav>

      {surfaceMode === "dashboard" ? (
        <StudioOperationsDashboard
          identity={identity}
          projects={projects}
          inquiries={inquiries}
          onBackToPortfolio={() => setSurfaceMode("portfolio")}
          onOpenAddProject={() => setProjectModalOpen(true)}
          onOpenEditIdentity={() => setIdentityModalOpen(true)}
          onDeleteProject={handleDeleteProject}
          onUpdateInquiryStatus={handleUpdateInquiryStatus}
          onSelectCaseStudy={(p) => {
            setSurfaceMode("portfolio");
            openCaseStudy(p);
          }}
        />
      ) : (
        <>
          {/* ══ 1. Homepage — Creative Identity Hero ══════════════════════ */}
          <section
            id="overview"
            aria-label="Creative identity and featured work"
            className="relative isolate overflow-hidden rounded-[2rem] border border-[#23392D] bg-[#0D100F] text-white p-6 sm:p-9 lg:p-11 shadow-xl"
          >
            <div
              aria-hidden="true"
              className="absolute inset-0 -z-10"
              style={{
                backgroundImage:
                  "radial-gradient(circle at 86% 18%, rgba(16, 185, 129, 0.24), transparent 38%), radial-gradient(circle at 12% 88%, rgba(6, 95, 70, 0.35), transparent 52%)",
              }}
            />

            <div className="grid gap-8 lg:grid-cols-12 lg:items-center">
              {/* Left Column: Who I am, what I create & how to start a project */}
              <div className="lg:col-span-7 space-y-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/35 bg-emerald-500/15 px-3 py-1 text-micro font-bold uppercase tracking-[0.12em] text-emerald-300">
                    <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" aria-hidden="true" />
                    {identity.availability.status}
                  </span>
                  {identity.isPlaceholder && (
                    <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-0.5 text-micro text-[#B8C9BF]">
                      Sample studio intro · Editable
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setIdentityModalOpen(true)}
                    className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/5 hover:bg-white/10 px-2.5 py-0.5 text-micro font-semibold text-emerald-300 cursor-pointer"
                  >
                    <Pencil size={11} aria-hidden="true" /> Edit bio
                  </button>
                </div>

                <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight leading-[1.08] text-white text-balance">
                  {identity.headline}
                </h1>

                <p className="text-sm sm:text-base leading-relaxed text-[#C6D6CD] max-w-2xl text-pretty">
                  {identity.subheadline}
                </p>

                {/* Primary CTAs: Explore My Work & Start a Project */}
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => jumpToSection("work")}
                    className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-[#071912] px-5 py-3 text-sm font-extrabold shadow-sm transition-colors cursor-pointer"
                  >
                    <span>Explore My Work</span>
                    <ArrowRight size={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => startProjectWithContext()}
                    className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-[#15261E] hover:bg-[#1C3328] text-white px-5 py-3 text-sm font-bold transition-colors cursor-pointer"
                  >
                    <span>Start a Project</span>
                    <ArrowUpRight size={16} className="text-emerald-400" aria-hidden="true" />
                  </button>
                </div>

                {/* Availability & Studio Status Card (Portfolio equivalent of Active shift / Open call-ups) */}
                <div
                  className="grid sm:grid-cols-3 gap-2.5 pt-3 border-t border-white/10"
                  aria-label="Current availability status"
                >
                  <div className="rounded-2xl border border-white/10 bg-[#14211B] px-3.5 py-3">
                    <p className="text-micro uppercase tracking-wider font-bold text-emerald-400">
                      Availability
                    </p>
                    <p className="mt-1 text-xs font-semibold text-white">
                      {identity.availability.window}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-[#14211B] px-3.5 py-3">
                    <p className="text-micro uppercase tracking-wider font-bold text-emerald-400">
                      Disciplines
                    </p>
                    <p className="mt-1 text-xs font-semibold text-white">
                      Branding · Web · Print · Motion
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-[#14211B] px-3.5 py-3">
                    <p className="text-micro uppercase tracking-wider font-bold text-emerald-400">
                      Response time
                    </p>
                    <p className="mt-1 text-xs font-semibold text-white">
                      {identity.availability.responseTime}
                    </p>
                  </div>
                </div>
              </div>

              {/* Right Column: Featured Project Visual Carousel */}
              {currentFeatured && (
                <div className="lg:col-span-5">
                  <div className="rounded-3xl border border-emerald-500/30 bg-[#13201A] p-3.5 sm:p-4 space-y-3.5 shadow-lg">
                    <div className="flex items-center justify-between gap-2 px-1">
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-emerald-500/20 border border-emerald-500/30 px-2.5 py-0.5 text-micro font-bold text-emerald-300">
                          Featured Work · {currentFeatured.discipline}
                        </span>
                        {currentFeatured.isPlaceholder && (
                          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium text-[#C5D6CC]">
                            Placeholder sample
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1" role="group" aria-label="Featured project carousel controls">
                        <button
                          type="button"
                          onClick={prevFeatured}
                          aria-label="Previous featured project"
                          className="grid place-items-center w-7 h-7 rounded-lg border border-white/15 bg-white/5 hover:bg-white/15 text-white cursor-pointer"
                        >
                          <ChevronLeft size={14} aria-hidden="true" />
                        </button>
                        <span className="text-micro font-mono text-[#B8C9BF] px-1">
                          {(featuredIndex % featuredProjects.length) + 1}/{featuredProjects.length}
                        </span>
                        <button
                          type="button"
                          onClick={nextFeatured}
                          aria-label="Next featured project"
                          className="grid place-items-center w-7 h-7 rounded-lg border border-white/15 bg-white/5 hover:bg-white/15 text-white cursor-pointer"
                        >
                          <ChevronRight size={14} aria-hidden="true" />
                        </button>
                      </div>
                    </div>

                    <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-white/10 bg-[#0D100F]">
                      <img
                        src={currentFeatured.thumbnail}
                        alt={`${currentFeatured.title} — ${currentFeatured.discipline} project preview`}
                        className="w-full h-full object-cover"
                      />
                    </div>

                    <div className="space-y-2 px-1">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h2 className="text-base font-bold text-white leading-snug">
                            {currentFeatured.title}
                          </h2>
                          <p className="mt-0.5 text-xs text-[#B8C9BF] line-clamp-2">
                            {currentFeatured.subtitle}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                        <div className="flex flex-wrap gap-1">
                          {(currentFeatured.deliverables || []).slice(0, 3).map((d) => (
                            <span
                              key={d}
                              className="rounded-md bg-white/5 border border-white/10 px-2 py-0.5 text-[11px] text-[#C5D6CC]"
                            >
                              {d}
                            </span>
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() => openCaseStudy(currentFeatured)}
                          className="inline-flex items-center gap-1 text-xs font-bold text-emerald-400 hover:text-emerald-300 cursor-pointer"
                        >
                          <span>Read case study</span>
                          <ArrowUpRight size={13} aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* ══ 2. Work — Discover Creative Projects ══════════════════════ */}
          <section
            id="work"
            ref={workSectionRef}
            aria-labelledby="portfolio-work-heading"
            className="space-y-5"
          >
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
              <div>
                <p className="text-micro font-bold uppercase tracking-[0.14em] text-brand-700 dark:text-brand-300">
                  Selected Projects
                </p>
                <h2 id="portfolio-work-heading" className="mt-1 text-2xl font-extrabold tracking-tight text-ink-1">
                  Filter projects by creative discipline
                </h2>
                <p className="mt-1 text-xs text-ink-3">
                  Explore branding systems, web flagships, tactile print publications, and motion reels. Sample projects are labeled as placeholders until you add your own work.
                </p>
              </div>
              <Button size="sm" icon={Plus} onClick={() => setProjectModalOpen(true)}>
                Add Project
              </Button>
            </div>

            {/* Category Filter Chips: All, Branding, Web Design, Print, Motion */}
            <div
              className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1"
              role="group"
              aria-label="Filter projects by creative discipline"
            >
              {PORTFOLIO_DISCIPLINES.map((disc) => {
                const active = selectedDiscipline === disc.value;
                const count = disciplineCounts[disc.value] ?? 0;
                return (
                  <button
                    key={disc.value}
                    type="button"
                    aria-pressed={active}
                    data-testid={`portfolio-filter-${disc.value.toLowerCase().replace(/\s+/g, "-")}`}
                    onClick={() => setSelectedDiscipline(disc.value)}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-bold whitespace-nowrap transition-colors cursor-pointer",
                      active
                        ? "border-emerald-500 bg-[#11241B] text-emerald-300 shadow-xs"
                        : "border-edge-2 bg-surface-0 text-ink-2 hover:border-brand-500/50 hover:text-ink-1"
                    )}
                  >
                    <span>{disc.label}</span>
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-px text-[11px] font-mono",
                        active ? "bg-emerald-500/20 text-emerald-200" : "bg-surface-2 text-ink-3"
                      )}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Rounded Dark-Green Project Card Grid */}
            <div className="grid gap-5 sm:grid-cols-2">
              {filteredProjects.map((project) => (
                <article
                  key={project.id}
                  data-testid={`portfolio-project-card-${project.id}`}
                  className="group overflow-hidden rounded-3xl border border-[#22382C] bg-[#0F1914] text-white shadow-md hover:border-emerald-500/60 transition-all flex flex-col justify-between"
                >
                  <div>
                    <div className="relative aspect-[16/10] overflow-hidden bg-[#0D100F] border-b border-white/10">
                      <img
                        src={project.thumbnail}
                        alt={`${project.title} — ${project.discipline} project thumbnail`}
                        loading="lazy"
                        className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
                      />
                      <div className="absolute top-3 left-3 flex flex-wrap items-center gap-1.5">
                        <span className="rounded-full bg-[#0D100F]/90 backdrop-blur-sm border border-emerald-500/40 px-3 py-1 text-micro font-bold text-emerald-300">
                          {project.discipline}
                        </span>
                        {project.isPlaceholder && (
                          <span className="rounded-full bg-[#0D100F]/85 backdrop-blur-sm border border-white/15 px-2.5 py-1 text-[10px] font-semibold text-[#C5D6CC]">
                            {project.placeholderLabel || "Placeholder sample"}
                          </span>
                        )}
                      </div>
                      <span className="absolute top-3 right-3 rounded-full bg-[#0D100F]/85 px-2.5 py-1 text-micro font-mono text-[#B8C9BF]">
                        {project.year}
                      </span>
                    </div>

                    <div className="p-5 space-y-3">
                      <div>
                        <p className="text-micro font-semibold text-emerald-400">
                          {project.role} · {project.timeline}
                        </p>
                        <h3 className="mt-1 text-lg font-extrabold tracking-tight text-white">
                          {project.title}
                        </h3>
                        <p className="mt-1 text-xs leading-relaxed text-[#BDCEC4]">
                          {project.subtitle}
                        </p>
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        {(project.deliverables || []).map((item) => (
                          <span
                            key={item}
                            className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-[#D1E0D7]"
                          >
                            {item}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="px-5 py-3.5 border-t border-white/10 bg-[#13211B] flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => openCaseStudy(project)}
                      className="inline-flex items-center gap-1.5 text-xs font-extrabold text-emerald-400 hover:text-emerald-300 cursor-pointer"
                    >
                      <BookOpen size={14} aria-hidden="true" />
                      <span>Explore Case Study</span>
                      <ArrowRight size={13} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        startProjectWithContext({
                          discipline: project.discipline,
                          packageTitle: `${project.discipline} Project`,
                        })
                      }
                      className="text-micro font-semibold text-[#BDCEC4] hover:text-white underline underline-offset-2 cursor-pointer"
                    >
                      Request similar work
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>

          {/* ══ 3. Case Studies — Editorial Story Layout ══════════════════ */}
          {featuredCaseStudy && (
            <section
              id="case-studies"
              ref={caseSectionRef}
              aria-labelledby="case-study-heading"
              data-testid="editorial-case-study"
              className="rounded-[2rem] border border-[#23392D] bg-[#0D100F] text-white p-6 sm:p-8 lg:p-10 space-y-7 shadow-xl"
            >
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-5">
                <div className="space-y-1.5 max-w-3xl">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-emerald-500/20 border border-emerald-500/35 px-3 py-1 text-micro font-bold uppercase tracking-wider text-emerald-300">
                      Editorial Case Study · {featuredCaseStudy.discipline}
                    </span>
                    {featuredCaseStudy.isPlaceholder && (
                      <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-0.5 text-micro text-[#BDCEC4]">
                        Placeholder sample case study
                      </span>
                    )}
                  </div>
                  <h2 id="case-study-heading" className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
                    {featuredCaseStudy.title}
                  </h2>
                  <p className="text-sm text-[#C4D4CB]">
                    {featuredCaseStudy.subtitle}
                  </p>
                </div>

                {/* Project selector pills so visitors can switch case studies */}
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Switch case study project">
                  {projects.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setActiveCaseStudy(p);
                        setCaseSlideIndex(0);
                      }}
                      className={cn(
                        "rounded-xl px-3 py-1.5 text-micro font-bold transition-colors cursor-pointer",
                        featuredCaseStudy.id === p.id
                          ? "bg-emerald-500 text-[#071912]"
                          : "border border-white/15 bg-white/5 text-[#C4D4CB] hover:bg-white/10"
                      )}
                    >
                      {p.title.split("—")[0].trim()}
                    </button>
                  ))}
                </div>
              </div>

              {/* Case Study Visual Gallery with Carousel Controls */}
              <div className="space-y-3">
                <div className="relative aspect-[16/9] max-h-[420px] w-full overflow-hidden rounded-2xl border border-white/10 bg-[#121E18]">
                  <img
                    src={caseGallery[caseSlideIndex % Math.max(1, caseGallery.length)] || featuredCaseStudy.thumbnail}
                    alt={`${featuredCaseStudy.title} — case study slide ${caseSlideIndex + 1}`}
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                  {caseGallery.length > 1 && (
                    <div className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-xl bg-[#0D100F]/85 backdrop-blur-sm border border-white/15 px-2.5 py-1.5">
                      <button
                        type="button"
                        aria-label="Previous case study slide"
                        onClick={() => setCaseSlideIndex((i) => (i - 1 + caseGallery.length) % caseGallery.length)}
                        className="p-1 rounded-lg hover:bg-white/10 text-white cursor-pointer"
                      >
                        <ChevronLeft size={15} />
                      </button>
                      <span className="text-micro font-mono text-emerald-300 px-1">
                        Slide {(caseSlideIndex % caseGallery.length) + 1} of {caseGallery.length}
                      </span>
                      <button
                        type="button"
                        aria-label="Next case study slide"
                        onClick={() => setCaseSlideIndex((i) => (i + 1) % caseGallery.length)}
                        className="p-1 rounded-lg hover:bg-white/10 text-white cursor-pointer"
                      >
                        <ChevronRight size={15} />
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* 5 Editorial Chapters: Challenge, Creative Process, Concepts, Final Deliverables, Results */}
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-[#13201A] p-5 space-y-2">
                  <p className="text-micro font-bold uppercase tracking-wider text-emerald-400">
                    01 · The Challenge
                  </p>
                  <h3 className="text-sm font-bold text-white">Problem &amp; Strategic Context</h3>
                  <p className="text-xs leading-relaxed text-[#C4D4CB]">
                    {featuredCaseStudy.caseStudy?.challenge}
                  </p>
                </div>

                <div className="rounded-2xl border border-white/10 bg-[#13201A] p-5 space-y-2">
                  <p className="text-micro font-bold uppercase tracking-wider text-emerald-400">
                    02 · Creative Process
                  </p>
                  <h3 className="text-sm font-bold text-white">Research, Craft &amp; Iteration</h3>
                  <p className="text-xs leading-relaxed text-[#C4D4CB]">
                    {featuredCaseStudy.caseStudy?.process}
                  </p>
                </div>

                <div className="rounded-2xl border border-white/10 bg-[#13201A] p-5 space-y-2">
                  <p className="text-micro font-bold uppercase tracking-wider text-emerald-400">
                    03 · Concepts
                  </p>
                  <h3 className="text-sm font-bold text-white">Visual Direction &amp; Systems</h3>
                  <p className="text-xs leading-relaxed text-[#C4D4CB]">
                    {featuredCaseStudy.caseStudy?.concepts}
                  </p>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-[#13201A] p-5 space-y-3">
                  <p className="text-micro font-bold uppercase tracking-wider text-emerald-400">
                    04 · Final Deliverables
                  </p>
                  <h3 className="text-sm font-bold text-white">Shipped Artifacts &amp; Guidelines</h3>
                  <ul className="space-y-1.5 text-xs text-[#D1E0D7]">
                    {(featuredCaseStudy.caseStudy?.finalDeliverables || featuredCaseStudy.deliverables || []).map(
                      (item) => (
                        <li key={item} className="flex items-start gap-2">
                          <CheckCircle2 size={14} className="text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
                          <span>{item}</span>
                        </li>
                      )
                    )}
                  </ul>
                </div>

                <div className="rounded-2xl border border-emerald-500/30 bg-[#13251D] p-5 flex flex-col justify-between gap-4">
                  <div className="space-y-2">
                    <p className="text-micro font-bold uppercase tracking-wider text-emerald-300">
                      05 · Results &amp; Outcome
                    </p>
                    <h3 className="text-sm font-bold text-white">Impact &amp; Client Handover</h3>
                    <p className="text-xs leading-relaxed text-[#D1E0D7]">
                      {featuredCaseStudy.caseStudy?.results}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-white/10">
                    <span className="text-micro text-emerald-300 font-semibold">
                      Timeline: {featuredCaseStudy.timeline}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        startProjectWithContext({
                          discipline: featuredCaseStudy.discipline,
                          packageTitle: `${featuredCaseStudy.discipline} Commission`,
                        })
                      }
                      className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-[#071912] px-4 py-2 text-xs font-extrabold transition-colors cursor-pointer"
                    >
                      <span>Start a similar {featuredCaseStudy.discipline} project</span>
                      <ArrowUpRight size={14} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* ══ 4. Selected Capabilities & Creative Process ═══════════════ */}
          <section
            id="process"
            ref={processSectionRef}
            aria-labelledby="capabilities-process-heading"
            className="space-y-6"
          >
            <div>
              <p className="text-micro font-bold uppercase tracking-[0.14em] text-brand-700 dark:text-brand-300">
                About, Process &amp; Capabilities
              </p>
              <h2 id="capabilities-process-heading" className="mt-1 text-2xl font-extrabold tracking-tight text-ink-1">
                Selected projects and creative capabilities
              </h2>
              <p className="mt-1 text-xs text-ink-3">
                Replacing operational skill cards and shift boards with focused creative disciplines and a transparent 4-step studio process.
              </p>
            </div>

            <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
              {CREATIVE_CAPABILITIES.map((cap) => (
                <div
                  key={cap.id}
                  className="rounded-2xl border border-edge-1 bg-surface-0 p-4 flex flex-col justify-between gap-3"
                >
                  <div className="space-y-1.5">
                    <Badge variant="brand" size="xs">
                      {cap.discipline}
                    </Badge>
                    <h3 className="text-sm font-bold text-ink-1">{cap.title}</h3>
                    <p className="text-2xs text-ink-3 leading-relaxed">{cap.description}</p>
                  </div>
                  <div className="flex flex-wrap gap-1 pt-2 border-t border-edge-1">
                    {cap.skills.map((skill) => (
                      <span
                        key={skill}
                        className="rounded-md bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-ink-2"
                      >
                        {skill}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* 4-Step Studio Process */}
            <div className="rounded-3xl border border-[#22382C] bg-[#101B16] text-white p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-micro font-bold uppercase tracking-wider text-emerald-400">
                    How We Work Together
                  </p>
                  <h3 className="text-lg font-extrabold text-white">
                    About, process, and creative services
                  </h3>
                </div>
                <span className="text-micro text-[#B8C9BF]">
                  Clear milestones from brief to final files
                </span>
              </div>
              <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
                {CREATIVE_PROCESS_STEPS.map((s) => (
                  <div
                    key={s.step}
                    className="rounded-2xl border border-white/10 bg-[#15241D] p-4 space-y-1.5"
                  >
                    <span className="font-mono text-xs font-extrabold text-emerald-400">
                      STEP {s.step}
                    </span>
                    <h4 className="text-sm font-bold text-white">{s.title}</h4>
                    <p className="text-xs text-[#C4D4CB] leading-relaxed">{s.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* ══ 5. Services, Testimonials & Start a Project ═══════════════ */}
          <section
            id="services"
            ref={servicesSectionRef}
            aria-labelledby="services-pricing-heading"
            className="space-y-6"
          >
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
              <div>
                <p className="text-micro font-bold uppercase tracking-[0.14em] text-brand-700 dark:text-brand-300">
                  Services &amp; Engagement Models
                </p>
                <h2 id="services-pricing-heading" className="mt-1 text-2xl font-extrabold tracking-tight text-ink-1">
                  Service pricing or custom project quotes
                </h2>
                <p className="mt-1 text-xs text-ink-3">
                  Structured creative packages or tailored project scopes. Select a package to pre-fill your project brief below.
                </p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {SERVICE_PACKAGES.map((pkg) => (
                <div
                  key={pkg.id}
                  data-testid={`service-card-${pkg.id}`}
                  className="rounded-3xl border border-[#23392D] bg-[#0F1914] text-white p-5 flex flex-col justify-between gap-4 shadow-md"
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-0.5 text-micro font-bold text-emerald-300">
                        {pkg.discipline}
                      </span>
                      <span className="text-micro font-mono text-[#B8C9BF]">{pkg.timeline}</span>
                    </div>
                    <div>
                      <h3 className="text-base font-extrabold text-white">{pkg.title}</h3>
                      <p className="mt-1 text-xs font-bold text-emerald-400">{pkg.priceLabel}</p>
                      <p className="mt-1.5 text-xs text-[#C4D4CB] leading-relaxed">{pkg.summary}</p>
                    </div>
                    <ul className="space-y-1.5 pt-2 border-t border-white/10 text-xs text-[#D1E0D7]">
                      {pkg.features.map((feat) => (
                        <li key={feat} className="flex items-start gap-2">
                          <CheckCircle2 size={13} className="text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
                          <span>{feat}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      startProjectWithContext({
                        discipline: pkg.discipline,
                        packageTitle: pkg.title,
                      })
                    }
                    className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-[#071912] px-4 py-2.5 text-xs font-extrabold transition-colors cursor-pointer"
                  >
                    <span>{pkg.ctaLabel}</span>
                    <ArrowRight size={13} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>

            {/* Clearly-labeled Placeholder Testimonials */}
            <div className="grid gap-4 sm:grid-cols-2">
              {PLACEHOLDER_TESTIMONIALS.map((t) => (
                <blockquote
                  key={t.id}
                  className="rounded-2xl border border-edge-1 bg-surface-1 p-5 space-y-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-micro font-bold text-brand-700 dark:text-brand-300">
                      <Quote size={13} aria-hidden="true" /> Client Feedback
                    </span>
                    <Badge variant="amber" size="xs">
                      Placeholder sample
                    </Badge>
                  </div>
                  <p className="text-xs italic text-ink-2 leading-relaxed">“{t.quote}”</p>
                  <footer className="text-micro text-ink-3">
                    <strong className="text-ink-1">{t.author}</strong> · {t.role} ({t.project})
                  </footer>
                </blockquote>
              ))}
            </div>
          </section>

          {/* ══ 6. Start a Project — Inquiry & Booking Form ═══════════════ */}
          <section
            id="inquire"
            ref={inquireSectionRef}
            aria-labelledby="start-project-heading"
            className="rounded-[2rem] border border-[#23392D] bg-[#0D100F] text-white p-6 sm:p-8 lg:p-10 shadow-xl"
          >
            <div className="grid gap-8 lg:grid-cols-12">
              <div className="lg:col-span-5 space-y-4">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/35 px-3 py-1 text-micro font-bold uppercase tracking-wider text-emerald-300">
                  <Sparkles size={12} aria-hidden="true" /> Project Inquiry &amp; Booking
                </span>
                <h2 id="start-project-heading" className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
                  Start a Project
                </h2>
                <p className="text-xs sm:text-sm text-[#C4D4CB] leading-relaxed">
                  Tell me about your brand, timeline, and what we are building together. Every inquiry lands directly in the Studio Dashboard for review within 24 hours.
                </p>

                <div className="rounded-2xl border border-white/10 bg-[#14221B] p-4 space-y-2.5 text-xs text-[#D1E0D7]">
                  <p className="font-bold text-emerald-300">What happens next?</p>
                  <ol className="space-y-1.5 list-decimal list-inside text-micro text-[#C4D4CB]">
                    <li>We review your project brief and creative goals.</li>
                    <li>We schedule a 20-minute discovery call or send a custom scope &amp; quote.</li>
                    <li>Once aligned, we lock your studio dates and kick off Discovery.</li>
                  </ol>
                </div>
              </div>

              <div className="lg:col-span-7">
                {inquirySubmitted ? (
                  <div
                    data-testid="inquiry-confirmation"
                    className="rounded-3xl border border-emerald-500/40 bg-[#13261E] p-6 space-y-4"
                  >
                    <div className="flex items-center gap-3">
                      <span className="grid place-items-center w-11 h-11 rounded-2xl bg-emerald-500 text-[#071912] shrink-0">
                        <CheckCircle2 size={22} />
                      </span>
                      <div>
                        <h3 className="text-lg font-extrabold text-white">
                          Project inquiry received
                        </h3>
                        <p className="text-xs text-emerald-300">
                          Thank you, {inquirySubmitted.clientName}. Your {inquirySubmitted.discipline} brief is logged in the Studio Dashboard.
                        </p>
                      </div>
                    </div>
                    <p className="text-xs text-[#D1E0D7] bg-black/25 rounded-xl p-3 border border-white/10">
                      “{inquirySubmitted.brief}”
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setInquirySubmitted(null)}
                        className="rounded-xl bg-emerald-500 hover:bg-emerald-400 text-[#071912] px-4 py-2 text-xs font-extrabold cursor-pointer"
                      >
                        Send another inquiry
                      </button>
                      <button
                        type="button"
                        onClick={() => setSurfaceMode("dashboard")}
                        className="rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 text-white px-4 py-2 text-xs font-semibold cursor-pointer"
                      >
                        View in Studio Dashboard ({inquiries.length})
                      </button>
                    </div>
                  </div>
                ) : (
                  <form onSubmit={handleInquirySubmit} className="space-y-4" aria-label="Start a project inquiry form">
                    <div className="grid gap-3.5 sm:grid-cols-2">
                      <div>
                        <label htmlFor="inq-client-name" className="block text-xs font-semibold text-[#D1E0D7] mb-1">
                          Your name or studio *
                        </label>
                        <input
                          id="inq-client-name"
                          type="text"
                          required
                          value={inquiryForm.clientName}
                          onChange={(e) => setInquiryForm((f) => ({ ...f, clientName: e.target.value }))}
                          placeholder="e.g. Amina Wanjiku · Kibo Studio"
                          className="w-full rounded-xl border border-white/15 bg-[#14221B] px-3.5 py-2.5 text-xs text-white placeholder:text-[#7E9689] focus:border-emerald-400 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label htmlFor="inq-client-contact" className="block text-xs font-semibold text-[#D1E0D7] mb-1">
                          Email or WhatsApp / phone
                        </label>
                        <input
                          id="inq-client-contact"
                          type="text"
                          value={inquiryForm.clientContact}
                          onChange={(e) => setInquiryForm((f) => ({ ...f, clientContact: e.target.value }))}
                          placeholder="hello@yourdomain.com"
                          className="w-full rounded-xl border border-white/15 bg-[#14221B] px-3.5 py-2.5 text-xs text-white placeholder:text-[#7E9689] focus:border-emerald-400 focus:outline-none"
                        />
                      </div>
                    </div>

                    <div className="grid gap-3.5 sm:grid-cols-3">
                      <div>
                        <label htmlFor="inq-discipline" className="block text-xs font-semibold text-[#D1E0D7] mb-1">
                          Creative discipline
                        </label>
                        <select
                          id="inq-discipline"
                          value={inquiryForm.discipline}
                          onChange={(e) => setInquiryForm((f) => ({ ...f, discipline: e.target.value }))}
                          className="w-full rounded-xl border border-white/15 bg-[#14221B] px-3 py-2.5 text-xs text-white focus:border-emerald-400 focus:outline-none"
                        >
                          <option value="Branding">Branding</option>
                          <option value="Web Design">Web Design</option>
                          <option value="Print">Print</option>
                          <option value="Motion">Motion</option>
                        </select>
                      </div>
                      <div>
                        <label htmlFor="inq-budget" className="block text-xs font-semibold text-[#D1E0D7] mb-1">
                          Budget / engagement
                        </label>
                        <select
                          id="inq-budget"
                          value={inquiryForm.budgetRange}
                          onChange={(e) => setInquiryForm((f) => ({ ...f, budgetRange: e.target.value }))}
                          className="w-full rounded-xl border border-white/15 bg-[#14221B] px-3 py-2.5 text-xs text-white focus:border-emerald-400 focus:outline-none"
                        >
                          <option value="Custom project quote">Custom project quote</option>
                          <option value="Single sprint / starter scope">Single sprint / starter scope</option>
                          <option value="Full identity or flagship build">Full identity or flagship build</option>
                          <option value="Ongoing creative retainer">Ongoing creative retainer</option>
                        </select>
                      </div>
                      <div>
                        <label htmlFor="inq-timeline" className="block text-xs font-semibold text-[#D1E0D7] mb-1">
                          Target timeline
                        </label>
                        <select
                          id="inq-timeline"
                          value={inquiryForm.timeline}
                          onChange={(e) => setInquiryForm((f) => ({ ...f, timeline: e.target.value }))}
                          className="w-full rounded-xl border border-white/15 bg-[#14221B] px-3 py-2.5 text-xs text-white focus:border-emerald-400 focus:outline-none"
                        >
                          <option value="Flexible / Within 1–2 months">Flexible / Within 1–2 months</option>
                          <option value="Immediate kickoff (next 2 weeks)">Immediate kickoff (next 2 weeks)</option>
                          <option value="Next quarter launch">Next quarter launch</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label htmlFor="inq-brief" className="block text-xs font-semibold text-[#D1E0D7] mb-1">
                        Project brief &amp; goals *
                      </label>
                      <textarea
                        id="inq-brief"
                        rows={4}
                        required
                        value={inquiryForm.brief}
                        onChange={(e) => setInquiryForm((f) => ({ ...f, brief: e.target.value }))}
                        placeholder="Share what you are building, the deliverables you need (e.g., brand identity, website, packaging, motion), and any key milestones…"
                        className="w-full rounded-xl border border-white/15 bg-[#14221B] p-3.5 text-xs text-white placeholder:text-[#7E9689] focus:border-emerald-400 focus:outline-none"
                      />
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                      <span className="text-micro text-[#9EB5A8]">
                        Selected package: <strong className="text-emerald-300">{inquiryForm.packageTitle}</strong>
                      </span>
                      <button
                        type="submit"
                        className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-[#071912] px-6 py-3 text-xs font-extrabold transition-colors cursor-pointer"
                      >
                        <Send size={14} aria-hidden="true" />
                        <span>Send Project Brief</span>
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          </section>
        </>
      )}

      {/* ══ Modals: Add Project (with Gallery Photo Picker), Edit Identity, Quick Inquiry ══ */}
      <AddPortfolioProjectModal
        open={projectModalOpen}
        onClose={() => setProjectModalOpen(false)}
        onAdd={handleAddProject}
      />

      <EditCreativeIdentityModal
        open={identityModalOpen}
        identity={identity}
        onClose={() => setIdentityModalOpen(false)}
        onSave={(next) => {
          setIdentity(next);
          saveStored(STORAGE_KEYS.identity, next);
          setIdentityModalOpen(false);
          toast.success("Creative identity updated");
        }}
      />

      <Modal
        open={inquiryModalOpen}
        onClose={() => setInquiryModalOpen(false)}
        title="Start a Project"
        description="Send a project brief to kick off a branding, web design, print, or motion collaboration."
      >
        <form onSubmit={handleInquirySubmit} className="space-y-3.5">
          <Input
            label="Your name or company *"
            required
            value={inquiryForm.clientName}
            onChange={(e) => setInquiryForm((f) => ({ ...f, clientName: e.target.value }))}
            placeholder="e.g. Amina Wanjiku"
          />
          <Input
            label="Email or phone"
            value={inquiryForm.clientContact}
            onChange={(e) => setInquiryForm((f) => ({ ...f, clientContact: e.target.value }))}
            placeholder="hello@yourdomain.com"
          />
          <Select
            label="Creative discipline"
            value={inquiryForm.discipline}
            onChange={(e) => setInquiryForm((f) => ({ ...f, discipline: e.target.value }))}
            options={PORTFOLIO_DISCIPLINES.filter((d) => d.value !== "All").map((d) => ({
              value: d.value,
              label: d.label,
            }))}
          />
          <Textarea
            label="Project brief *"
            rows={3}
            required
            value={inquiryForm.brief}
            onChange={(e) => setInquiryForm((f) => ({ ...f, brief: e.target.value }))}
            placeholder="Describe your project goals, deliverables, and timeline…"
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setInquiryModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" icon={Send}>
              Send Project Brief
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function StudioOperationsDashboard({
  projects,
  inquiries,
  onBackToPortfolio,
  onOpenAddProject,
  onOpenEditIdentity,
  onDeleteProject,
  onUpdateInquiryStatus,
  onSelectCaseStudy,
}) {
  return (
    <div className="space-y-6" data-testid="studio-operations-dashboard">
      <div className="rounded-3xl border border-[#23392D] bg-[#101C16] text-white p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-micro font-bold uppercase tracking-wider text-emerald-400">
            Hybrid Studio Operations Dashboard
          </p>
          <h2 className="mt-1 text-2xl font-extrabold text-white">
            Manage client inquiries, active projects &amp; portfolio content
          </h2>
          <p className="mt-1 text-xs text-[#C4D4CB]">
            Separate operational view so your public portfolio stays clean, personal, and editorial.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={onOpenEditIdentity}>
            Edit Bio &amp; Availability
          </Button>
          <Button size="sm" icon={Plus} onClick={onOpenAddProject}>
            Add Portfolio Project
          </Button>
          <Button size="sm" variant="ghost" onClick={onBackToPortfolio}>
            View Public Portfolio
          </Button>
        </div>
      </div>

      {/* Client Inquiries */}
      <section aria-label="Client project inquiries" className="rounded-3xl border border-edge-1 bg-surface-0 p-5 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-ink-1">
              Client Project Inquiries ({inquiries.length})
            </h3>
            <p className="text-2xs text-ink-3">
              Briefs submitted through “Start a Project” on your public portfolio.
            </p>
          </div>
        </div>

        {inquiries.length === 0 ? (
          <p className="text-xs text-ink-3 py-4">
            No client project inquiries yet. Use “Start a Project” on your portfolio to test the client booking flow.
          </p>
        ) : (
          <div className="space-y-3">
            {inquiries.map((inq) => (
              <div
                key={inq.id}
                className="rounded-2xl border border-edge-1 bg-surface-1 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-ink-1">{inq.clientName}</span>
                    <Badge variant="brand" size="xs">{inq.discipline}</Badge>
                    <Badge variant={inq.status === "booked" ? "brand" : "gray"} size="xs">
                      {inq.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-ink-2">“{inq.brief}”</p>
                  <p className="text-micro text-ink-4">
                    Contact: {inq.clientContact} · {inq.budgetRange} · {inq.timeline}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    size="xs"
                    variant={inq.status === "booked" ? "primary" : "secondary"}
                    onClick={() => onUpdateInquiryStatus(inq.id, "booked")}
                  >
                    Mark Booked
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => onUpdateInquiryStatus(inq.id, "completed")}
                  >
                    Completed
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Portfolio Projects Manager */}
      <section aria-label="Manage portfolio projects" className="rounded-3xl border border-edge-1 bg-surface-0 p-5 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-ink-1">
              Selected Projects ({projects.length})
            </h3>
            <p className="text-2xs text-ink-3">
              Add your own projects with gallery photos or remove sample placeholder projects.
            </p>
          </div>
          <Button size="xs" icon={Plus} onClick={onOpenAddProject}>
            Add Project
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {projects.map((p) => (
            <div
              key={p.id}
              className="rounded-2xl border border-edge-1 bg-surface-1 p-3.5 flex items-center justify-between gap-3"
            >
              <div className="flex items-center gap-3 min-w-0">
                <img
                  src={p.thumbnail}
                  alt={p.title}
                  className="w-14 h-14 rounded-xl object-cover border border-edge-1 shrink-0"
                />
                <div className="min-w-0">
                  <p className="text-xs font-bold text-ink-1 truncate">{p.title}</p>
                  <p className="text-micro text-ink-3">
                    {p.discipline} · {p.year} {p.isPlaceholder ? "· Placeholder" : "· Custom"}
                  </p>
                  <button
                    type="button"
                    onClick={() => onSelectCaseStudy(p)}
                    className="text-micro font-semibold text-brand-700 dark:text-brand-300 hover:underline"
                  >
                    Open case study →
                  </button>
                </div>
              </div>
              <button
                type="button"
                aria-label={`Remove ${p.title}`}
                onClick={() => onDeleteProject(p.id)}
                className="p-1.5 rounded-lg text-ink-4 hover:text-red-600 cursor-pointer"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Design System Information Hierarchy Transformation Reference */}
      <section aria-label="Information hierarchy transformation" className="rounded-3xl border border-edge-1 bg-surface-0 p-5 space-y-3">
        <h3 className="text-sm font-bold text-ink-1">
          Marketplace UI → Creative Portfolio Hierarchy
        </h3>
        <div className="grid gap-2 sm:grid-cols-2">
          {HIERARCHY_TRANSFORMATION_MAP.map((row) => (
            <div
              key={row.existing}
              className="rounded-xl border border-edge-1 bg-surface-1 px-3.5 py-2.5 flex items-center justify-between gap-2 text-2xs"
            >
              <span className="text-ink-3 line-through">{row.existing}</span>
              <span className="font-semibold text-brand-700 dark:text-brand-300 text-right">
                → {row.portfolio}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function AddPortfolioProjectModal({ open, onClose, onAdd }) {
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({
    title: "",
    subtitle: "",
    discipline: "Branding",
    year: "2026",
    role: "Lead Designer",
    timeline: "3 weeks",
    deliverables: "Brand Identity, Guidelines, Packaging",
    challenge: "",
    process: "",
    concepts: "",
    results: "",
    thumbnail: "",
  });

  const handleGalleryPick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await readGalleryImage(file);
      setForm((f) => ({ ...f, thumbnail: url }));
    } catch (err) {
      toast.error(apiError(err, "Could not load project cover from gallery"));
    } finally {
      setUploading(false);
      if (e.target) e.target.value = "";
    }
  };

  const submit = (e) => {
    e.preventDefault();
    if (!form.title.trim()) return toast.error("Project title is required");
    const delivList = form.deliverables
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const fallbackThumb = INITIAL_PORTFOLIO_PROJECTS[0].thumbnail;
    const cover = form.thumbnail || fallbackThumb;
    onAdd({
      id: `proj-custom-${Date.now()}`,
      title: form.title.trim(),
      subtitle: form.subtitle.trim() || "Custom studio project and case study.",
      discipline: form.discipline,
      year: form.year || "2026",
      role: form.role || "Creative Direction",
      timeline: form.timeline || "4 weeks",
      featured: true,
      isPlaceholder: false,
      thumbnail: cover,
      deliverables: delivList.length ? delivList : [form.discipline],
      caseStudy: {
        challenge: form.challenge.trim() || "Defined the strategic and visual challenge with the client.",
        process: form.process.trim() || "Explored typographic, spatial, and system-level design directions.",
        concepts: form.concepts.trim() || "Refined the strongest concept into a cohesive visual language.",
        finalDeliverables: delivList.length ? delivList : ["Complete design system and production files"],
        results: form.results.trim() || "Delivered on schedule with full guidelines and launch assets.",
        gallery: [cover],
      },
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add Portfolio Project"
      description="Add a real project and case study. Select your cover visual directly from your device gallery."
    >
      <form onSubmit={submit} className="space-y-3">
        <Input
          label="Project title *"
          required
          value={form.title}
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          placeholder="e.g. Zuri Botanicals — Brand World"
        />
        <div className="grid grid-cols-2 gap-2.5">
          <Select
            label="Creative discipline"
            value={form.discipline}
            onChange={(e) => setForm((f) => ({ ...f, discipline: e.target.value }))}
            options={PORTFOLIO_DISCIPLINES.filter((d) => d.value !== "All").map((d) => ({
              value: d.value,
              label: d.label,
            }))}
          />
          <Input
            label="Role"
            value={form.role}
            onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
            placeholder="Brand & Web Designer"
          />
        </div>
        <Input
          label="Short summary"
          value={form.subtitle}
          onChange={(e) => setForm((f) => ({ ...f, subtitle: e.target.value }))}
          placeholder="One-sentence summary of what you created"
        />
        <Input
          label="Deliverables (comma separated)"
          value={form.deliverables}
          onChange={(e) => setForm((f) => ({ ...f, deliverables: e.target.value }))}
        />

        {/* Gallery Photo Addition (no URL links) */}
        <div className="space-y-1.5">
          <span className="block text-xs font-medium text-ink-2">Project cover photo (from gallery)</span>
          <div className="flex items-center gap-3 rounded-xl border border-edge-1 bg-surface-1 p-2.5">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              aria-label="Project cover photo"
              onChange={handleGalleryPick}
            />
            {form.thumbnail ? (
              <img src={form.thumbnail} alt="Project cover preview" className="w-12 h-12 rounded-lg object-cover" />
            ) : (
              <span className="w-12 h-12 rounded-lg bg-brand-500/10 text-brand-700 grid place-items-center">
                <ImagePlus size={18} />
              </span>
            )}
            <div className="flex-1 min-w-0">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="text-xs font-semibold text-brand-700 dark:text-brand-300 hover:underline"
              >
                {uploading ? "Loading…" : form.thumbnail ? "Replace cover from gallery" : "Choose cover from gallery"}
              </button>
              <p className="text-micro text-ink-4">Select an image directly from your device gallery</p>
            </div>
          </div>
        </div>

        <Textarea
          label="The Challenge (Case Study)"
          rows={2}
          value={form.challenge}
          onChange={(e) => setForm((f) => ({ ...f, challenge: e.target.value }))}
          placeholder="What problem did the client need to solve?"
        />
        <Textarea
          label="Creative Process & Results"
          rows={2}
          value={form.process}
          onChange={(e) => setForm((f) => ({ ...f, process: e.target.value }))}
          placeholder="How did you approach the design and what was the outcome?"
        />

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" icon={Plus}>
            Publish to Portfolio
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function EditCreativeIdentityModal({ open, identity, onClose, onSave }) {
  const [form, setForm] = useState({
    headline: identity.headline,
    subheadline: identity.subheadline,
    status: identity.availability?.status || "Available for select projects",
    window: identity.availability?.window || "Booking new creative commissions",
  });

  useEffect(() => {
    setForm({
      headline: identity.headline,
      subheadline: identity.subheadline,
      status: identity.availability?.status || "Available for select projects",
      window: identity.availability?.window || "Booking new creative commissions",
    });
  }, [identity]);

  const submit = (e) => {
    e.preventDefault();
    onSave({
      ...identity,
      headline: form.headline.trim() || DEFAULT_CREATIVE_IDENTITY.headline,
      subheadline: form.subheadline.trim() || DEFAULT_CREATIVE_IDENTITY.subheadline,
      availability: {
        ...identity.availability,
        status: form.status.trim() || "Available for select projects",
        window: form.window.trim() || "Booking new creative commissions",
      },
      isPlaceholder: false,
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit Creative Identity"
      description="Customize your hero headline, personal introduction, and studio availability."
    >
      <form onSubmit={submit} className="space-y-3">
        <Input
          label="Hero headline"
          value={form.headline}
          onChange={(e) => setForm((f) => ({ ...f, headline: e.target.value }))}
        />
        <Textarea
          label="Personal introduction"
          rows={3}
          value={form.subheadline}
          onChange={(e) => setForm((f) => ({ ...f, subheadline: e.target.value }))}
        />
        <Input
          label="Availability badge"
          value={form.status}
          onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
        />
        <Input
          label="Booking window"
          value={form.window}
          onChange={(e) => setForm((f) => ({ ...f, window: e.target.value }))}
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">Save Identity</Button>
        </div>
      </form>
    </Modal>
  );
}
