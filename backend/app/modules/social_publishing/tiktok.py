"""Internal TikTok API primitives; not an endpoint or a complete publishing flow.

Callers must implement OAuth, token storage/refresh, compliant creator UI, consent,
media transfer, upload-status handling and authorization before exposing these.
Tokens are never logged or returned to a client by this module.
"""
import httpx

API = 'https://open.tiktokapis.com/v2'


class TikTokError(Exception):
    pass


async def _post(client: httpx.AsyncClient, path: str, token: str, body: dict) -> dict:
    if not token:
        raise TikTokError('TikTok account is not linked')
    try:
        response = await client.post(API + path, headers={'Authorization': 'Bearer ' + token}, json=body)
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict) or not isinstance(payload.get('error'), dict) or payload['error'].get('code') != 'ok':
            raise TikTokError('TikTok could not complete the request')
        if not isinstance(payload.get('data'), dict):
            raise TikTokError('TikTok returned an invalid response')
        return payload['data']
    except (httpx.HTTPError, ValueError, TypeError) as exc:
        raise TikTokError('TikTok is unavailable or returned an invalid response') from exc


async def creator_info(client: httpx.AsyncClient, token: str) -> dict:
    """Fetch current account identity and privacy choices immediately before UI."""
    data = await _post(client, '/post/publish/creator_info/query/', token, {})
    if not isinstance(data.get('creator_nickname'), str) or not isinstance(data.get('privacy_level_options'), list):
        raise TikTokError('TikTok creator information is incomplete')
    return data


async def publish_status(client: httpx.AsyncClient, token: str, publish_id: str) -> dict:
    """Check provider processing status; an initialized upload is not a post."""
    if not isinstance(publish_id, str) or not 1 <= len(publish_id) <= 64:
        raise TikTokError('Invalid publish identifier')
    return await _post(client, '/post/publish/status/fetch/', token, {'publish_id': publish_id})
