import { useState } from "react";
import { useSetupProgress } from "@/components/onboarding/useSetupProgress";
import HomeHeader from "@/components/home/HomeHeader";
import ActionCentre from "@/components/home/ActionCentre";
import ActivityList from "@/components/home/ActivityList";
import HomeStorefront from "@/components/home/HomeStorefront";
import DiscoveryLink from "@/components/home/DiscoveryLink";
import DailyWelcome from "@/components/home/DailyWelcome";
import CategoryRequest from "@/components/home/CategoryRequest";
import StatusShelf from "@/components/statuses/StatusShelf";
import RadarStrip from "@/components/statuses/RadarStrip";
import { CATEGORY_REQUIREMENTS, pendingCategoryRequest } from "@/config/categoryRequirements";

/**
 * HOME — for doing. Discovery is for finding.
 *
 * Five sections, in this order, and nothing else:
 *
 *   1  header         who this is, the shop's setup count (2/6), the status
 *                     shelf of businesses you follow, and the radar counts
 *   2  action centre  the next one or two things that need doing; "View all"
 *                     expands the rest in place; hidden when nothing is pending
 *   3  storefront     category chips, a hero row and the discovery shelves.
 *                     It always has something real to show (chips and the
 *                     Brief Trust door), so Home never looks blank
 *   4  activity       the three latest trades; hidden when there are none
 *   5  discovery      one line to Discovery, which owns offers, suppliers and
 *                     product browsing
 *
 * Two popups may appear over Home, never both:
 *   · a category data request, when a category needs a fact the business has
 *     not given yet. It has priority.
 *   · the daily welcome, at most once every 24 hours.
 *
 * Nothing above is hidden by a feature flag. Sections with no content render
 * nothing; there are no placeholders to scroll past.
 */
export default function HomeHub({ rules = CATEGORY_REQUIREMENTS }) {
  // One read of the shop's progress, shared by the header and the action
  // centre, so Home makes one profile request and one connections request.
  const progress = useSetupProgress();
  // Category requests answered or put off during this visit. A saved answer is
  // also visible in the profile, but a field the backend does not echo back
  // must not bring the same popup back in this session.
  const [settled, setSettled] = useState([]);

  const request = progress.loaded
    ? pendingCategoryRequest({ rules, vendor: progress.vendor, profile: progress.profile, dismissedKeys: settled })
    : null;

  const settle = (rule, value) => {
    setSettled((list) => [...list, rule.key]);
    if (value !== undefined && rule.scope !== "vendor") {
      progress.setProfile?.((prev) => ({ ...(prev || {}), [rule.field]: value }));
    }
  };

  const name = progress.vendor?.business_name || progress.vendor?.vendor_handle;

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="space-y-3">
        <HomeHeader progress={progress} />
        <StatusShelf />
        <RadarStrip />
      </div>
      <ActionCentre progress={progress} />
      <HomeStorefront />
      <ActivityList />
      <DiscoveryLink />

      {request ? (
        <CategoryRequest
          key={request.key}
          rule={request}
          onAnswered={(rule, value) => settle(rule, value)}
          onLater={(rule) => settle(rule)}
        />
      ) : progress.loaded ? (
        <DailyWelcome name={name} />
      ) : null}
    </div>
  );
}
