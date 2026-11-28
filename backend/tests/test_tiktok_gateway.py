"""Provider contract tests only; no live account or publishing endpoint exists."""
import httpx
import pytest
from app.modules.social_publishing.tiktok import TikTokError, creator_info, publish_status

pytestmark = pytest.mark.asyncio

async def test_creator_info_and_processing_status():
    requests = []
    async def handle(request):
        requests.append(request)
        if 'creator_info' in request.url.path:
            return httpx.Response(200, json={'error': {'code':'ok'}, 'data': {'creator_nickname': 'Ada', 'privacy_level_options': ['SELF_ONLY']}})
        return httpx.Response(200, json={'error': {'code':'ok'}, 'data': {'status': 'PROCESSING_UPLOAD'}})
    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        assert (await creator_info(client, 'test-token'))['creator_nickname'] == 'Ada'
        assert (await publish_status(client, 'test-token', 'id-1'))['status'] == 'PROCESSING_UPLOAD'
        assert requests[0].headers['authorization'] == 'Bearer test-token'
        assert requests[1].url.path == '/v2/post/publish/status/fetch/'

async def test_fails_closed_on_missing_token_provider_errors_and_bad_data():
    calls = []
    async def handle(request):
        calls.append(request)
        return httpx.Response(200, json={'error': {'code':'access_token_invalid'}, 'data': {}})
    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        with pytest.raises(TikTokError): await creator_info(client, '')
        assert not calls
        with pytest.raises(TikTokError): await creator_info(client, 'secret')
        with pytest.raises(TikTokError): await publish_status(client, 'secret', '')
        assert len(calls) == 1
