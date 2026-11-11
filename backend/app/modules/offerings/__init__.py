"""Offerings: one read-only view of what a person can be asked for.

Read-only aggregator. It does not create a table, write a row or change a contract:
goods come from stock_items, services from booking_services, tools from tool_listings.
Each source keeps its own create/edit endpoints, so there is still one source of truth
per kind. Public reads return only items that are already visible to the network.
"""
