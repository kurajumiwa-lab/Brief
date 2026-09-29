/**
 * Renders every page against a fake API so a runtime error in any of them
 * (undefined identifier, wrong field name, bad hook order) fails the build.
 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { vi } from 'vitest'

const VENDOR = {
  id: 'v1', business_name: 'Mama Mboga', vendor_handle: 'mama_mboga', current_role: 'both', business_categories: ['produce'],
  business_description: 'Fresh greens', physical_location: 'Nairobi', network_score: 42, parasitism_index: 12.5,
  total_sourced: 1, total_supplied: 3, total_stock_moved: 140, has_pos_connected: false, is_patron: false, is_verified: true, connected: false,
}
const OTHER = { ...VENDOR, id: 'v2', business_name: 'Kibanda Kitchen', vendor_handle: 'kibanda_kitchen', current_role: 'sourcing', connected: false }
const STOCK = {
  id: 's1', vendor_id: 'v1', vendor_handle: 'mama_mboga', vendor_business: 'Mama Mboga', name: 'Sukuma wiki', sku: 'SUK-1', category: 'produce',
  subcategory: null, description: 'Fresh', quantity_in_stock: 100, quantity_reserved: 40, quantity_available: 60, unit_of_measure: 'bunches',
  cost_price: 10, wholesale_price: 20, unit_price: 30, min_order_quantity: 10, bulk_discount_tiers: [], source: 'manual', visible_to_network: true,
  tags: ['greens'], images: [], last_pos_sync: null, updated_at: null,
}
const NET_STOCK = { ...STOCK, id: 's2', vendor_id: 'v2', vendor_handle: 'kibanda_kitchen', name: 'Chapati flour' }
const MOVEMENT = {
  id: 'm1', stock_item_id: 's1', stock_name: 'Sukuma wiki', sku: 'SUK-1', from_vendor_id: 'v1', from_handle: 'mama_mboga', to_vendor_id: 'v2', to_handle: 'kibanda_kitchen',
  quantity: 40, unit_price: 20, total_value: 800, movement_type: 'sourcing', status: 'pending', notes: 'Friday', created_at: new Date().toISOString(), completed_at: null, direction: 'outgoing',
}
const LIST = { id: 'l1', name: 'Nairobi Fresh', slug: 'nairobi-fresh', description: 'd', category: 'produce', region: 'Nairobi', patron_business: 'Mama Mboga', patron_handle: 'mama_mboga', member_count: 3, max_vendors: 20, is_open: true, requires_approval: true, is_group_created: false, creating_group_id: null, my_status: null, i_run_it: true }
const GROUP = { id: 'g1', name: 'Wakulima', slug: 'wakulima', description: 'd', group_type: 'sourcing', category: 'produce', tags: ['x'], region: 'Nairobi', member_count: 4, max_members: null, is_public: true, requires_approval: false, created_by: 'mama_mboga', chat_room_id: 'r1', my_role: 'admin' }
const ROOM = { id: 'r1', name: 'Wakulima', room_type: 'group', topic: null, topic_tags: [], group_id: 'g1', vendor_list_id: null, deal_stock_item_id: null, participant_count: 4, message_count: 1, joined: true, created_at: null }
const MESSAGE = { id: 'msg1', room_id: 'r1', sender_id: 'v2', sender_handle: 'kibanda_kitchen', sender_business: 'Kibanda', content: 'Habari', message_type: 'text', shared_stock: null, deal_data: {}, attachments: [], is_pinned: false, sent_at: new Date().toISOString() }
const TOOL = { id: 't1', vendor_id: 'v2', vendor_handle: 'kibanda_kitchen', vendor_business: 'K', category: 'warehouse', title: 'Cold room', description: null, location: 'Nairobi', price_per_unit: 1500, price_unit: 'per_day', min_booking: null, deposit_required: null, capacity: { sqm: 40 }, features: ['24h'], terms: null, is_available: true, times_booked: 2, avg_rating: null, details: null }
const COURIER = { id: 'c1', courier_name: 'Boda Express', vendor_handle: 'kibanda_kitchen', vendor_id: 'v2', registration_number: null, coverage_areas: ['CBD'], service_types: ['same_day'], price_per_kg: 50, base_rate: null, is_verified: false, rating: null, total_deliveries: 0 }
const EVENT = { id: 'e1', title: 'Market day', description: null, event_type: 'market_day', organizer: 'mama_mboga', organizer_id: 'v1', organizer_business: 'Mama Mboga', start_date: '2027-01-09T06:00:00', end_date: '2027-01-09T12:00:00', location: 'Marikiti', is_virtual: false, virtual_link: null, max_vendors: 20, registered_count: 5, entry_fee: 0, spots_left: 15, vendor_requirements: {}, vendor_list_id: null, group_id: null, status: 'upcoming', my_status: null }
const CONN = { id: 'p1', pos_type: 'csv', connection_name: 'Till export', store_id: null, has_credentials: false, auto_sync: true, sync_interval_minutes: 15, last_sync_at: null, items_synced: 3, sync_config: {}, is_active: true, mode: 'push', created_at: null }
const LOG = { id: 'log1', sync_type: 'push', status: 'success', started_at: new Date().toISOString(), completed_at: null, items_processed: 3, items_added: 1, items_updated: 2, items_removed: 0, errors: [] }

const GET = {
  '/vendors/me': VENDOR, '/vendors/me/profile': { primary_goods: ['sukuma'], sourcing_interests: [], preferred_regions: [], accepts_bulk: true, offers_credit: false },
  '/vendors/me/patron': { is_patron: true, tier: 'starter', total_vendors_managed: 3, total_events_organized: 1, reputation_score: 13, max_lists: 1, max_vendors_per_list: 20 },
  '/vendors/connections': [{ vendor_id: 'v2', vendor_handle: 'kibanda_kitchen', business_name: 'Kibanda Kitchen', business_categories: ['food'], current_role: 'sourcing', connection_type: 'trade', parasitism_score: 85, connected_at: null }],
  '/vendors/suggested': [{ vendor_id: 'v3', vendor_handle: 'duka', business_name: 'Duka', business_categories: ['books'], current_role: 'selling', network_score: 3, reasons: ['same trade'] }],
  '/vendors/stats': { vendors: 12, by_role: { both: 12 }, connections: 4 }, '/vendors/mama_mboga': VENDOR, '/vendors/kibanda_kitchen': OTHER,
  '/stock/my-stock': [STOCK], '/stock/network-stock': [NET_STOCK], '/stock/movements': [MOVEMENT], '/stock/categories': { categories: ['produce'] }, '/stock/s1': STOCK,
  '/vendor-lists/browse': [LIST], '/vendor-lists/mine': [LIST], '/vendor-lists/l1/members': [{ vendor_id: 'v2', vendor_handle: 'kibanda_kitchen', business_name: 'Kibanda', business_categories: [], status: 'pending', role_in_list: 'member', joined_at: new Date().toISOString(), approved_at: null }],
  '/groups/browse': [GROUP, { ...GROUP, id: 'g2', name: 'Textiles', my_role: null }], '/groups/mine': [GROUP], '/groups/g1': GROUP, '/groups/g1/members': [{ vendor_id: 'v1', vendor_handle: 'mama_mboga', business_name: 'Mama Mboga', role: 'admin', is_active: true, joined_at: new Date().toISOString(), messages_sent: 2, deals_made_in_group: 0 }],
  '/chat/rooms': [ROOM, { ...ROOM, id: 'r2', name: 'Import regs', room_type: 'niche', joined: false }], '/chat/r1': ROOM, '/chat/r1/messages': [MESSAGE],
  '/tools/browse': [TOOL], '/tools/mine': [{ ...TOOL, id: 't2', vendor_id: 'v1', vendor_handle: 'mama_mboga' }], '/tools/couriers': [COURIER],
  '/events/browse': [EVENT], '/events/mine': [EVENT], '/events/e1/registrations': [{ vendor_id: 'v2', vendor_handle: 'kibanda_kitchen', business_name: 'K', status: 'registered', booth_assignment: null, registered_at: new Date().toISOString() }],
  '/pos/connections': [CONN], '/pos/sync-logs/p1': [LOG],
}
const posted = []
vi.mock('../lib/api', async () => {
  const actual = await vi.importActual('../lib/api')
  const respond = (url) => {
    const key = url.split('?')[0]
    if (!(key in GET)) throw Object.assign(new Error(`unmocked GET ${key}`), { response: { status: 404, data: { detail: `unmocked ${key}` } } })
    return Promise.resolve({ data: GET[key] })
  }
  return {
    ...actual,
    api: {
      get: vi.fn(respond),
      post: vi.fn((url, body) => { posted.push([url, body]); return Promise.resolve({ data: { message: 'ok', status: 'member', room_id: 'r1', sent: MESSAGE, role: 'selling', tier: 'starter', ...LOG } }) }),
      put: vi.fn(() => Promise.resolve({ data: { message: 'ok' } })),
      delete: vi.fn(() => Promise.resolve({ data: { message: 'ok' } })),
      interceptors: { request: { use() {} }, response: { use() {} } },
    },
  }
})

// WebSocket stub: opens and stays quiet.
class FakeWS { constructor() { setTimeout(() => this.onopen?.(), 0) } send() {} close() {} }
FakeWS.OPEN = 1
window.WebSocket = FakeWS

import { useAuthStore } from '../store/authStore'
import Layout from '../components/Layout'
import Dashboard from '../pages/Dashboard'
import StockRoom from '../pages/StockRoom'
import VendorLists from '../pages/VendorLists'
import Groups from '../pages/Groups'
import Chat from '../pages/Chat'
import Tools from '../pages/Tools'
import Events from '../pages/Events'
import POSBridge from '../pages/POSBridge'
import VendorProfile from '../pages/VendorProfile'
import Login from '../pages/Login'
import Register from '../pages/Register'

beforeEach(() => {
  useAuthStore.setState({ token: 'tok', vendor: VENDOR })
  posted.length = 0
})

function mount(path, element, extra = null) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<Layout />}>
          <Route path={path.split('?')[0].startsWith('/@') ? ':handle' : path.split('?')[0]} element={element} />
          {extra}
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

test('layout renders nav, role switcher and scores', async () => {
  mount('/', <Dashboard />)
  for (const label of ['Dashboard', 'Stock Room', 'Vendor Lists', 'Groups', 'Chat', 'Tools', 'Events', 'POS Bridge']) {
    expect(screen.getAllByText(label).length).toBeGreaterThan(0)
  }
  expect(screen.getByRole('radio', { name: 'Both' })).toHaveAttribute('aria-checked', 'true')
  await waitFor(() => expect(screen.getByText(/Movements needing you/)).toBeInTheDocument())
  expect(screen.getByText('Sukuma wiki')).toBeInTheDocument()
  expect(screen.getByText('Kibanda Kitchen')).toBeInTheDocument()
  expect(screen.getByText('same trade')).toBeInTheDocument()
})

test('stock room: my shelves, network, movements, add form', async () => {
  mount('/stock', <StockRoom />)
  await waitFor(() => expect(screen.getByText('Sukuma wiki')).toBeInTheDocument())
  expect(screen.getByText('on the network')).toBeInTheDocument()
  fireEvent.click(screen.getByText('Network stock'))
  await waitFor(() => expect(screen.getByText('Chapati flour')).toBeInTheDocument())
  fireEvent.click(screen.getByText('Source'))
  expect(screen.getByText(/Request stock/)).toBeInTheDocument()
  fireEvent.click(screen.getByText('Cancel'))
  fireEvent.click(screen.getByText('Movements'))
  await waitFor(() => expect(screen.getByText('Confirm')).toBeInTheDocument())
  fireEvent.click(screen.getByText('Add stock'))
  expect(screen.getByText('Put it on the shelf')).toBeInTheDocument()
})

test('vendor lists: patron bar, manage modal with pending vendors', async () => {
  mount('/vendor-lists', <VendorLists />)
  await waitFor(() => expect(screen.getAllByText('Nairobi Fresh').length).toBeGreaterThan(0))
  expect(screen.getByText(/3 vendors managed/)).toBeInTheDocument()
  fireEvent.click(screen.getAllByText('Manage')[0])
  await waitFor(() => expect(screen.getByText('Approve')).toBeInTheDocument())
  fireEvent.click(screen.getByText('Approve'))
  await waitFor(() => expect(posted.some(([u]) => u === '/vendor-lists/l1/approve/v2')).toBe(true))
})

test('groups: mine + browse, detail with group list form', async () => {
  mount('/groups', <Groups />)
  await waitFor(() => expect(screen.getByText('Textiles')).toBeInTheDocument())
  fireEvent.click(screen.getAllByText('Wakulima')[0])
  await waitFor(() => expect(screen.getByText('Create a vendor list')).toBeInTheDocument())
  fireEvent.click(screen.getByText('Create a vendor list'))
  expect(screen.getByPlaceholderText('List name')).toBeInTheDocument()
})

test('chat: rooms list, messages, send', async () => {
  mount('/chat?room=r1', <Chat />)
  await waitFor(() => expect(screen.getByText('Habari')).toBeInTheDocument())
  expect(screen.getByText('Import regs')).toBeInTheDocument()
  await waitFor(() => expect(screen.getByText('live')).toBeInTheDocument())
  fireEvent.change(screen.getByPlaceholderText('Message the room'), { target: { value: 'Una sukuma?' } })
  fireEvent.click(screen.getByLabelText('Send'))
  await waitFor(() => expect(posted.some(([u, b]) => u === '/chat/r1/message' && b.content === 'Una sukuma?')).toBe(true))
})

test('tools: categories, couriers, list form switches per category', async () => {
  mount('/tools', <Tools />)
  await waitFor(() => expect(screen.getAllByText('Cold room').length).toBeGreaterThan(0))
  expect(screen.getByText('Boda Express')).toBeInTheDocument()
  fireEvent.click(screen.getByText('List a tool'))
  fireEvent.change(screen.getByLabelText(/Category/), { target: { value: 'transport' } })
  expect(screen.getByLabelText(/Vehicle type/)).toBeInTheDocument()
})

test('events: organizer view with registrations', async () => {
  mount('/events', <Events />)
  await waitFor(() => expect(screen.getAllByText('Market day').length).toBeGreaterThan(0))
  fireEvent.click(screen.getAllByText('Registrations')[0])
  await waitFor(() => expect(screen.getByText(/Registered vendors · 1/)).toBeInTheDocument())
  fireEvent.click(screen.getByLabelText('Close'))
  fireEvent.click(screen.getByText('New event'))
  expect(screen.getByLabelText(/Who can register/)).toBeInTheDocument()
})

test('pos bridge: connection card, logs, connect modal', async () => {
  mount('/pos', <POSBridge />)
  await waitFor(() => expect(screen.getByText('Till export')).toBeInTheDocument())
  expect(screen.getByText('Push CSV')).toBeInTheDocument()
  fireEvent.click(screen.getByText('Logs'))
  await waitFor(() => expect(screen.getByText('push')).toBeInTheDocument())
  fireEvent.click(screen.getByText('Connect a POS'))
  expect(screen.getByLabelText(/Square access token/)).toBeInTheDocument()
  fireEvent.click(screen.getByText('Shopify'))
  expect(screen.getByLabelText(/Shop domain/)).toBeInTheDocument()
})

test('vendor profile: own page with editor, other vendor with connect', async () => {
  const { unmount } = mount('/@mama_mboga', <VendorProfile />)
  await waitFor(() => expect(screen.getByText('Edit profile')).toBeInTheDocument())
  fireEvent.click(screen.getByText('Edit profile'))
  expect(screen.getByLabelText(/Primary goods/)).toBeInTheDocument()
  unmount()
  mount('/@kibanda_kitchen', <VendorProfile />)
  await waitFor(() => expect(screen.getByText('Connect')).toBeInTheDocument())
  expect(screen.getByText('Message')).toBeInTheDocument()
})

test('login and register render without a session', () => {
  useAuthStore.setState({ token: null, vendor: null })
  const { unmount } = render(<MemoryRouter><Login /></MemoryRouter>)
  expect(screen.getByText('Enter the network')).toBeInTheDocument()
  unmount()
  render(<MemoryRouter><Register /></MemoryRouter>)
  expect(screen.getByText('Join the network')).toBeInTheDocument()
})
