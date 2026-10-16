import { useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { Search, Sparkles, Filter, Grid3X3, List, Plus, ArrowRight } from "lucide-react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Badge from "@/components/ui/Badge";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import { cn } from "@/lib/utils";

/**
 * SERVICE TEMPLATE DISCOVERY — AI-assisted template discovery experience (v3.3).
 *
 * Architecture and interfaces for future AI-assisted template discovery.
 * DO NOT create, hard-code, or seed actual service templates.
 *
 * Supports:
 *   - Service categories and discovery
 *   - Filtering and template previews
 *   - AI recommendations based on business goals and user requirements
 *   - Future customization and publishing workflows
 *   - Clear differentiation between AI suggestions and verified vendor offerings
 */

// Service categories for filtering
const SERVICE_CATEGORIES = [
  { value: "", label: "All categories" },
  { value: "digital_services", label: "Digital Services" },
  { value: "business_software", label: "Business Software" },
  { value: "field_operations", label: "Field Operations" },
  { value: "financial", label: "Financial Services" },
  { value: "logistics", label: "Logistics & Transport" },
  { value: "marketing", label: "Marketing & Sales" },
  { value: "consulting", label: "Consulting" },
  { value: "training", label: "Training & Education" },
];

// Business goals for AI recommendations
const BUSINESS_GOALS = [
  { value: "", label: "Any goal" },
  { value: "increase_sales", label: "Increase Sales" },
  { value: "improve_efficiency", label: "Improve Efficiency" },
  { value: "expand_reach", label: "Expand Market Reach" },
  { value: "reduce_costs", label: "Reduce Costs" },
  { value: "enhance_quality", label: "Enhance Product Quality" },
  { value: "build_brand", label: "Build Brand Awareness" },
];

// Template readiness levels
const READINESS_LEVELS = [
  { value: "", label: "Any readiness" },
  { value: "draft", label: "Draft" },
  { value: "review", label: "In Review" },
  { value: "verified", label: "Verified" },
  { value: "published", label: "Published" },
];

/**
 * Template card component - shows template preview
 * Differentiates between AI suggestions and verified offerings
 */
function TemplateCard({ template, index }) {
  const isAIGenerated = template.source === "ai";
  const isVerified = template.status === "verified" || template.status === "published";

  return (
    <Card 
      key={template.id || index}
      className={cn(
        "flex flex-col gap-3 p-4 transition-all",
        isAIGenerated && "border-brand-200 dark:border-brand-800/50",
        isVerified && "border-green-200 dark:border-green-800/50"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className={`text-2xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
              isAIGenerated 
                ? "bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300"
                : isVerified
                  ? "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300"
                  : "bg-surface-2 text-ink-4"
            }`}>
              {isAIGenerated ? "AI Suggestion" : isVerified ? "Verified" : "Template"}
            </span>
            {template.category && (
              <Badge variant="outline" size="xs">
                {SERVICE_CATEGORIES.find(c => c.value === template.category)?.label || template.category}
              </Badge>
            )}
          </div>
          <h3 className="mt-2 text-sm font-semibold text-ink-1 hover:text-brand-600 dark:hover:text-brand-400">
            {template.title || template.name || `Template ${index + 1}`}
          </h3>
          <p className="mt-1 text-2xs text-ink-4 line-clamp-2">
            {template.description || "No description available"}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 mt-auto pt-2 border-t border-edge-1">
        <div className="flex flex-wrap gap-1">
          {template.tags?.slice(0, 3).map((tag) => (
            <span 
              key={tag} 
              className="text-2xs text-ink-4 bg-surface-2 px-1.5 py-0.5 rounded"
            >
              {tag}
            </span>
          ))}
        </div>
        <Link
          to={template.to || `/storefront?template=${template.id}`}
          className="inline-flex items-center gap-1 text-2xs font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300"
        >
          View details <ArrowRight size={10} />
        </Link>
      </div>
    </Card>
  );
}

/**
 * AI Recommendation Banner - Shows when AI suggestions are available
 */
function AIRecommendationBanner({ count, onViewAll, onDismiss }) {
  if (count === 0) return null;

  return (
    <div className="rounded-xl bg-brand-50 border border-brand-200 p-3 flex items-center justify-between gap-3 dark:bg-brand-900/20 dark:border-brand-800/50">
      <div className="flex items-center gap-2">
        <span className="grid h-6 w-6 place-items-center rounded-lg bg-brand-500/20 text-brand-700 dark:text-brand-300">
          <Sparkles size={14} />
        </span>
        <span>
          <p className="text-2xs font-bold text-brand-800 dark:text-brand-200">
            AI found {count} template{count === 1 ? "" : "s"} matching your goals
          </p>
          <p className="text-2xs text-brand-700 dark:text-brand-300">
            Based on your business profile and requirements
          </p>
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Button size="xs" variant="ghost" onClick={onDismiss} className="text-2xs">
          Dismiss
        </Button>
        <Button size="xs" onClick={onViewAll} className="text-2xs">
          <Sparkles size={12} /> View AI suggestions
        </Button>
      </div>
    </div>
  );
}

/**
 * Main Service Template Discovery Component
 */
export default function ServiceTemplateDiscovery({
  templates = [],
  aiSuggestions = [],
  loading = false,
  onSearch,
  onFilterChange,
  onRequestAI,
  onCreateTemplate,
}) {
  const [viewMode, setViewMode] = useState("grid");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedGoal, setSelectedGoal] = useState("");
  const [selectedReadiness, setSelectedReadiness] = useState("");
  const [showAISuggestions, setShowAISuggestions] = useState(false);

  // Combined templates with AI suggestions
  const allTemplates = showAISuggestions ? [...aiSuggestions, ...templates] : templates;
  
  // Apply filters
  const filteredTemplates = allTemplates.filter((template) => {
    const matchesSearch = !searchQuery || 
      (template.title && template.title.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (template.description && template.description.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (template.tags && template.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase())));
    
    const matchesCategory = !selectedCategory || template.category === selectedCategory;
    const matchesGoal = !selectedGoal || template.goals?.includes(selectedGoal);
    const matchesReadiness = !selectedReadiness || template.status === selectedReadiness;
    
    return matchesSearch && matchesCategory && matchesGoal && matchesReadiness;
  });

  const handleSearch = useCallback((e) => {
    const value = e.target.value;
    setSearchQuery(value);
    onSearch?.(value);
  }, [onSearch]);

  const handleRequestAI = useCallback(() => {
    onRequestAI?.(selectedGoal, selectedCategory);
  }, [onRequestAI, selectedGoal, selectedCategory]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink-1 tracking-tight">
            Services for your business
          </h2>
          <p className="text-xs text-ink-4 mt-0.5">
            Discover templates for digital services, business software, and field operations
          </p>
        </div>
        <Button 
          size="sm" 
          icon={Plus} 
          onClick={onCreateTemplate}
        >
          Create template
        </Button>
      </div>

      {/* AI Recommendation Banner */}
      {aiSuggestions.length > 0 && !showAISuggestions && (
        <AIRecommendationBanner
          count={aiSuggestions.length}
          onViewAll={() => setShowAISuggestions(true)}
          onDismiss={() => setShowAISuggestions(false)}
        />
      )}

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
            onChange={handleSearch}
            placeholder="Search templates..."
            className="pl-8"
          />
        </div>
        
        <Select
          value={selectedCategory}
          onChange={(e) => {
            setSelectedCategory(e.target.value);
            onFilterChange?.("category", e.target.value);
          }}
          options={SERVICE_CATEGORIES}
          className="min-w-[140px]"
        />
        
        <Select
          value={selectedGoal}
          onChange={(e) => {
            setSelectedGoal(e.target.value);
            onFilterChange?.("goal", e.target.value);
          }}
          options={BUSINESS_GOALS}
          className="min-w-[140px]"
        />
        
        <Select
          value={selectedReadiness}
          onChange={(e) => {
            setSelectedReadiness(e.target.value);
            onFilterChange?.("readiness", e.target.value);
          }}
          options={READINESS_LEVELS}
          className="min-w-[140px]"
        />

        {/* View mode toggle */}
        <div className="flex items-center gap-1 p-1 rounded-lg bg-surface-2">
          <button
            type="button"
            onClick={() => setViewMode("grid")}
            className={cn(
              "p-1.5 rounded-md text-ink-4 hover:text-ink-1",
              viewMode === "grid" && "bg-surface-0 text-ink-1"
            )}
            aria-label="Grid view"
          >
            <Grid3X3 size={14} />
          </button>
          <button
            type="button"
            onClick={() => setViewMode("list")}
            className={cn(
              "p-1.5 rounded-md text-ink-4 hover:text-ink-1",
              viewMode === "list" && "bg-surface-0 text-ink-1"
            )}
            aria-label="List view"
          >
            <List size={14} />
          </button>
        </div>

        {/* AI Recommendation Button */}
        <Button 
          size="sm" 
          variant="outline" 
          icon={Sparkles} 
          onClick={handleRequestAI}
          disabled={!selectedGoal && !selectedCategory}
        >
          Get AI recommendations
        </Button>
      </div>

      {/* Results */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-40 rounded-2xl border border-edge-1 bg-surface-0 animate-pulse" />
          ))}
        </div>
      ) : filteredTemplates.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No templates found"
          description={showAISuggestions 
            ? "No AI suggestions or templates match your criteria. Try adjusting your filters."
            : "No templates match your criteria. Try adjusting your filters or request AI recommendations."
          }
          action={
            <Button size="sm" icon={Sparkles} onClick={handleRequestAI}>
              Get AI recommendations
            </Button>
          }
        />
      ) : (
        <div className={cn(
          "grid gap-3",
          viewMode === "grid" ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" : "grid-cols-1"
        )}>
          {filteredTemplates.map((template, index) => (
            <TemplateCard 
              key={template.id || index}
              template={template}
              index={index}
            />
          ))}
        </div>
      )}

      {/* Show toggle for AI suggestions */}
      {aiSuggestions.length > 0 && (
        <div className="text-center">
          <button
            type="button"
            onClick={() => setShowAISuggestions(!showAISuggestions)}
            className="inline-flex items-center gap-1 text-2xs text-brand-600 dark:text-brand-400 hover:underline"
          >
            {showAISuggestions ? "Hide AI suggestions" : "Show AI suggestions"}
            <ArrowRight size={10} className={showAISuggestions ? "rotate-90" : ""} />
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Hook for managing service template discovery state
 */
export function useServiceTemplateDiscovery(initialTemplates = []) {
  const [templates, setTemplates] = useState(initialTemplates);
  const [aiSuggestions, setAISuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Simulate AI recommendation request
  const requestAIRecommendations = useCallback(async (goal, category) => {
    setLoading(true);
    setError(null);
    
    try {
      // In production, this would call a backend AI service
      // For now, we simulate the response
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Return mock AI suggestions based on criteria
      const mockSuggestions = [
        {
          id: `ai-suggestion-1-${Date.now()}`,
          title: `AI-recommended ${category || "service"} for ${goal || "your business"}`,
          description: "Personalized recommendation based on your business goals and requirements.",
          category: category || "digital_services",
          goals: [goal || "increase_sales"],
          status: "draft",
          source: "ai",
          tags: ["ai-recommended", "personalized", goal || "general"],
          to: "/storefront",
        },
        {
          id: `ai-suggestion-2-${Date.now()}`,
          title: `Automated ${category || "workflow"} solution`,
          description: "AI-suggested workflow automation to improve efficiency.",
          category: category || "business_software",
          goals: [goal || "improve_efficiency"],
          status: "draft",
          source: "ai",
          tags: ["ai-recommended", "automation", "workflow"],
          to: "/storefront",
        },
      ];
      
      setAISuggestions(mockSuggestions);
    } catch (err) {
      setError(err.message || "Failed to get AI recommendations");
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    templates,
    setTemplates,
    aiSuggestions,
    setAISuggestions,
    loading,
    setLoading,
    error,
    setError,
    requestAIRecommendations,
  };
}
