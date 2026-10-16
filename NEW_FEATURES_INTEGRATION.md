# New Features Integration Guide

## Overview
This guide explains how to integrate the new features implemented for Byway v3.3.

## 1. Trade Overview Shelf

### Component: `TradeOverviewShelf.jsx`

**Location**: `/frontend/src/components/home/TradeOverviewShelf.jsx`

**Usage**: Replace the existing `TradePulse` component in `HomeHub.jsx`

**Already Integrated**: ✅ Yes, `HomeHub.jsx` has been updated to use this component.

**Props**: None (self-contained, uses ordersAPI)

**Features**:
- Compact shelf design
- Shows pending actions prominently
- Displays order summary
- Links to trade/order screen
- Handles loading, errors, and empty states

## 2. Simplified Business Pulse

### Component: `BusinessPulseSimplified.jsx`

**Location**: `/frontend/src/components/home/BusinessPulseSimplified.jsx`

**Usage**: Replace the existing `BusinessPulse` component in `HomeFeed.jsx`

**Already Integrated**: ✅ Yes, `HomeFeed.jsx` has been updated to use this component.

**Props**:
- `headingId` (string, optional): ID for heading element
- `className` (string, optional): Additional CSS classes

**Features**:
- Focused on business growth
- Single Growth Planner link
- No duplicate statistics
- Directs users to dedicated screens for detailed metrics

## 3. Service Template Discovery

### Component: `ServiceTemplateDiscovery.jsx`

**Location**: `/frontend/src/components/services/ServiceTemplateDiscovery.jsx`

**Usage**: Replace or enhance the existing services shelf

**Not Yet Integrated**: ⚠️ Requires manual integration

**Props**:
- `templates` (array): List of service templates
- `aiSuggestions` (array): AI-generated suggestions
- `loading` (boolean): Loading state
- `onSearch` (function): Search handler
- `onFilterChange` (function): Filter change handler
- `onRequestAI` (function): Request AI recommendations
- `onCreateTemplate` (function): Create new template

**Hook**: `useServiceTemplateDiscovery(initialTemplates)`

**Features**:
- AI-assisted template discovery
- Category and goal filtering
- AI recommendation system
- Template preview cards
- Clear AI vs verified differentiation

### Integration Steps:

1. Import the component:
```jsx
import ServiceTemplateDiscovery from "@/components/services/ServiceTemplateDiscovery";
```

2. Use in your page:
```jsx
const { 
  templates, 
  aiSuggestions, 
  loading, 
  requestAIRecommendations 
} = useServiceTemplateDiscovery();

<ServiceTemplateDiscovery
  templates={templates}
  aiSuggestions={aiSuggestions}
  loading={loading}
  onRequestAI={requestAIRecommendations}
  onCreateTemplate={() => navigate("/templates/create")}
/>
```

## 4. Notice Board

### Components:
- `NoticeBoard.jsx` - Main component
- `NoticeBoardPage.jsx` - Full page
- `NoticeCard.jsx` - Card for shelves

**Locations**:
- `/frontend/src/components/noticeboard/NoticeBoard.jsx`
- `/frontend/src/pages/noticeboard/NoticeBoardPage.jsx`
- `/frontend/src/components/home/cards/NoticeCard.jsx`

**Usage**:

### Option A: Use Full Page
**Already Configured**: ✅ Yes, the page is ready to use

Route: `/notices`

Import and add to router:
```jsx
import NoticeBoardPage from "@/pages/noticeboard/NoticeBoardPage";

// In your router configuration:
{ path: "/notices", element: <NoticeBoardPage /> }
```

### Option B: Use Component Directly

```jsx
import NoticeBoard from "@/components/noticeboard/NoticeBoard";

<NoticeBoard
  notices={notices}
  loading={loading}
  onCreate={handleCreate}
  onEdit={handleEdit}
  onDelete={handleDelete}
  onPreview={handlePreview}
  canCreate={!!user}
/>
```

### Option C: Use Shelf Card
**Already Integrated**: ✅ Yes, added to `homeShelves.js` and `cards/index.jsx`

The notice shelf will automatically appear in the "more" section of the home feed.

**Hook**: `useNoticeBoard()`

**Features**:
- AI-assisted notice creation
- Events page design compliance
- Full CRUD operations
- Draft, publish, archive states
- Filtering and search

## 5. Notice Card for Shelves

**Location**: `/frontend/src/components/home/cards/NoticeCard.jsx`

**Already Integrated**: ✅ Yes, added to `cards/index.jsx`

**Usage**: Automatically used by the "notices" shelf in home feed

**Props**:
- `item` (object): Notice data
  - `id`: Unique identifier
  - `title`: Notice title
  - `type`: Notice type (product_promotion, service_offering, event, etc.)
  - `description`: Description text
  - `organizer`: Organizer handle
  - `organizer_business`: Organizer business name
  - `start_date`: Start date (ISO string)
  - `location`: Location
  - `price`: Price (number)
  - `is_virtual`: Boolean
  - `status`: Status (draft, published, archived)
  - `view_count`: Number of views
  - `tags`: Array of tags
  - `source`: "ai" for AI-generated notices
  - `to`: Link URL

## Configuration Changes

### homeShelves.js

Added new shelf:
```js
{
  key: "notices",
  group: "more",
  card: "notice",
  title: "Byway Notice Board",
  subtitle: "AI-assisted promotions, announcements, and opportunities from vendors",
  seeAll: { to: "/notices", label: "See all notices" },
  limit: 12,
  async load() {
    // In production: return await noticeAPI.list({ limit: 12 });
    return [];
  },
}
```

### cards/index.jsx

Added NoticeCard to exports and renderers:
```js
import NoticeCard from "./NoticeCard";

export const CARD_RENDERERS = {
  // ... existing renderers
  notice: NoticeCard,
};

export {
  // ... existing exports
  NoticeCard,
};
```

## API Requirements (Backend)

### Notice Board API

Required endpoints:

```
GET    /api/notices              - List notices (with filtering)
POST   /api/notices              - Create notice
GET    /api/notices/:id          - Get notice details
PUT    /api/notices/:id          - Update notice
DELETE /api/notices/:id          - Delete notice
POST   /api/notices/:id/publish  - Publish notice
POST   /api/notices/ai-draft     - Generate AI draft
```

Request/Response schemas:

**Notice Object**:
```json
{
  "id": "string",
  "title": "string",
  "type": "product_promotion|service_offering|event|business_announcement|opportunity|user_agenda",
  "description": "string",
  "message": "string",
  "audience": "all|local|connected|category",
  "tone": "professional|friendly|urgent|informative",
  "call_to_action": "string",
  "location": "string",
  "start_date": "ISO8601",
  "end_date": "ISO8601",
  "price": number,
  "is_virtual": boolean,
  "status": "draft|published|archived|expired",
  "organizer": "string",
  "organizer_business": "string",
  "view_count": number,
  "tags": ["string"],
  "ai_assisted": boolean,
  "created_at": "ISO8601",
  "updated_at": "ISO8601"
}
```

**AI Draft Request**:
```json
{
  "type": "string",
  "message": "string",
  "audience": "string",
  "tone": "string",
  "call_to_action": "string"
}
```

**AI Draft Response**:
```json
{
  "title": "string",
  "description": "string",
  "call_to_action": "string",
  "tags": ["string"]
}
```

### Service Templates API

Required endpoints:

```
GET    /api/service-templates          - List templates
POST   /api/service-templates          - Create template
GET    /api/service-templates/:id      - Get template details
POST   /api/service-templates/ai-recommend  - Get AI recommendations
```

**Template Object**:
```json
{
  "id": "string",
  "title": "string",
  "description": "string",
  "category": "string",
  "goals": ["string"],
  "tags": ["string"],
  "status": "draft|review|verified|published",
  "source": "user|ai",
  "readiness": "string",
  "created_at": "ISO8601",
  "updated_at": "ISO8601"
}
```

## Backend Integration Notes

### AI Provider Abstraction

Create a secure server-side AI service:

```python
# Example structure
class AIService:
    def __init__(self, api_key: str):
        self.api_key = api_key  # Load from environment
        
    async def generate_notice_draft(self, prompt: dict) -> dict:
        # Validate input
        # Call AI provider securely
        # Validate output
        # Return structured draft
        pass
    
    async def recommend_templates(self, criteria: dict) -> list:
        # Validate input
        # Call AI provider
        # Validate output
        # Return template recommendations
        pass
```

**Security Requirements**:
- Never expose API keys in frontend
- Validate all AI inputs and outputs
- Handle failures gracefully
- Rate limit AI calls
- Require user confirmation before publishing

### Authentication & Authorization

All new endpoints must:
1. Require vendor authentication
2. Check permissions for actions
3. Validate ownership for updates/deletes
4. Use existing auth middleware

## Testing

### Frontend Tests

Run existing tests to ensure no regressions:
```bash
npm test
```

### Manual Testing Checklist

- [ ] Home screen loads with new compact trade overview
- [ ] Business pulse shows simplified view
- [ ] Notice board page accessible at /notices
- [ ] Notice board shelf appears in home feed (when data available)
- [ ] Service template discovery works
- [ ] AI draft generation works (simulated)
- [ ] All existing functionality still works
- [ ] Responsive design on mobile
- [ ] Loading states display correctly
- [ ] Error states handled gracefully

## Deployment

### Frontend

1. Ensure all dependencies are installed:
```bash
cd frontend
npm install
```

2. Run build:
```bash
npm run build
```

3. Deploy as usual

### Backend

1. Implement required API endpoints
2. Add database migrations for notices and templates
3. Configure AI provider
4. Update environment variables
5. Deploy as usual

## Rollback Plan

If issues arise:

1. **Frontend**: Revert to previous version of modified files:
   - `HomeHub.jsx`
   - `HomeFeed.jsx`
   - `homeShelves.js`
   - `cards/index.jsx`

2. **Backend**: New endpoints are additive, no breaking changes to existing APIs

## Support

For questions or issues with integration:

1. Check this documentation
2. Review the implementation files
3. Refer to the technical prompt for requirements
4. Check the console for errors
5. Verify API responses match expected schemas

## Version Compatibility

- **Frontend**: Compatible with existing React/Vite setup
- **Backend**: Compatible with existing FastAPI setup
- **Database**: No schema changes required for existing tables
- **Dependencies**: No new frontend dependencies added

---

**Last Updated**: 2026-10-15
**Version**: v3.3
