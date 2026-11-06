"""Free business blueprints: step-by-step starters for small ventures.

These are written by hand for the practical start of a small business. They are
not generated. Each step is one thing a person can do, and each becomes a line
in the daily Today window once the template is started.

Review these with a business adviser before wide promotion. They describe
steps, not legal or tax advice.
"""

BLUEPRINTS = [
    {
        "key": "market-stall",
        "title": "Market stall starter",
        "sector": "retail",
        "summary": "Start selling from a stall or table: what to sell, what it costs, and a simple daily record.",
        "steps": [
            {"key": "choose-items", "title": "Choose three things to sell",
             "detail": "Pick three items you can buy or make reliably. Write each one with its cost and the price you will sell it at."},
            {"key": "start-money", "title": "Count the money you need",
             "detail": "List what you must buy before the first day (stock, containers, a table, change money). Write what you already have. The difference is what you still need."},
            {"key": "hours-and-count", "title": "Set your hours and count stock each day",
             "detail": "Choose the days and hours you will trade. Each morning, count what you have. Each evening, count again."},
            {"key": "daily-record", "title": "Record each day's sales and costs",
             "detail": "Write every sale and every cost the same day, in a notebook or on the stock page. A week of records shows what really sells."},
            {"key": "ask-buyers", "title": "Ask three nearby businesses what they buy",
             "detail": "Ask three shops or offices what they buy regularly, how much, and what they pay. Their answers may become your first wholesale orders."},
        ],
    },
    {
        "key": "home-soap",
        "title": "Home soap maker",
        "sector": "manufacturing",
        "summary": "Make soap at home for sale: costing each bar, testing a small batch, and labelling it properly.",
        "steps": [
            {"key": "ingredients", "title": "List ingredients and safety gear",
             "detail": "Write down every ingredient with its quantity and supplier. Note the safety gear you need (gloves, goggles) and handle caustic ingredients only with it on."},
            {"key": "cost-per-bar", "title": "Work out the cost of one bar",
             "detail": "Divide the cost of one batch by the number of bars it makes. Add packaging. That is your floor price, before any profit."},
            {"key": "test-batch", "title": "Make a small test batch",
             "detail": "Make a small batch first. Note the date, the recipe and what went wrong or right. Let the bars cure for the time your recipe says before you sell any."},
            {"key": "label", "title": "Label each bar correctly",
             "detail": "Put the product name, net weight, ingredients and your business name and contact on every bar's wrapper. Check the labelling rules that apply in your county."},
            {"key": "first-ten", "title": "Sell the first ten bars to nearby shops",
             "detail": "Offer ten bars to shops and salons near you, at the floor price plus a margin. Keep a note of who buys, how often, and what they say."},
        ],
    },
    {
        "key": "food-catering",
        "title": "Food and catering starter",
        "sector": "hospitality",
        "summary": "Start a small food or catering business: menu costing, two suppliers for each key item, and first orders.",
        "steps": [
            {"key": "menu-cost", "title": "Cost every item on your menu",
             "detail": "For each dish, list ingredients and quantities, then add the cost of each. Work out the cost per plate before you set any price."},
            {"key": "two-suppliers", "title": "Find two suppliers for each key item",
             "detail": "For the items you cannot do without, find two suppliers. Compare price, quality and delivery days. Write both down."},
            {"key": "hygiene", "title": "Set up basic food hygiene",
             "detail": "Plan handwashing, cold storage and clean cutting boards. Check the food-handling licence and health rules your county requires before you sell to the public."},
            {"key": "plate-price", "title": "Set the price per plate",
             "detail": "Add your plate cost, a share of gas and transport, and your margin. Check your price against two competitors nearby."},
            {"key": "first-orders", "title": "Take your first five orders",
             "detail": "Offer to cater for five small events or regular office orders. After each one, note what was eaten, what was wasted and what the customer said."},
        ],
    },
    {
        "key": "beauty-salon",
        "title": "Beauty and hair salon starter",
        "sector": "beauty",
        "summary": "Open a small salon or home studio: services and prices, booking, supplies and a client record.",
        "steps": [
            {"key": "services-prices", "title": "List your services and their prices",
             "detail": "Write each service, how long it takes and what you charge. Keep it to the services you do well."},
            {"key": "booking-page", "title": "Set up your booking page",
             "detail": "Enter your services and opening hours in Brief's calendar so clients can book a free time. You confirm each booking."},
            {"key": "supplies", "title": "Keep a supplies list",
             "detail": "List what each service uses up. Count it weekly and reorder before you run out."},
            {"key": "client-card", "title": "Start a client record card",
             "detail": "For each client, note their name, phone, what they had done and what they liked. Ask their permission before you keep notes."},
            {"key": "weekly-review", "title": "Review your week every Friday",
             "detail": "Look at bookings, no-shows, what sold and what was costly. Change one thing for the next week."},
        ],
    },
]

BY_KEY = {b["key"]: b for b in BLUEPRINTS}


def step_keys(blueprint: dict) -> list[str]:
    return [s["key"] for s in blueprint["steps"]]
