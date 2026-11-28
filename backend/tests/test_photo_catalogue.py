import io
import uuid

import pytest
from PIL import Image
from app.config import settings
from app.modules.photo_catalogue import router as vision

pytestmark = pytest.mark.asyncio


def image():
    out = io.BytesIO()
    Image.new('RGB', (20, 20), 'red').save(out, 'JPEG')
    return out.getvalue()


async def account(client):
    suffix = uuid.uuid4().hex[:10]
    res = await client.post('/api/auth/register', json={'business_name': f'Trader {suffix}', 'vendor_handle': f'p_{suffix}', 'email': f'{suffix}@example.com', 'password': 'Correct-horse-9', 'business_categories': ['groceries']})
    assert res.status_code == 201, res.text
    return {'Authorization': f"Bearer {res.json()['access_token']}"}


async def test_analysis_requires_auth_consent_and_configuration(client, monkeypatch):
    files = [('files', ('shelf.jpg', image(), 'image/jpeg'))]
    assert (await client.post('/api/photo-catalogue/analyse', files=files, data={'consent': 'true'})).status_code in (401, 403)
    headers = await account(client)
    assert (await client.post('/api/photo-catalogue/analyse', headers=headers, files=files)).status_code == 400
    monkeypatch.setattr(settings, 'PHOTO_VISION_API_KEY', '')
    result = await client.post('/api/photo-catalogue/analyse', headers=headers, files=files, data={'consent': 'true'})
    assert result.status_code == 503 and 'not configured' in result.text


async def test_multiple_products_questions_language_and_invalid_images(client, monkeypatch):
    headers = await account(client)
    monkeypatch.setattr(settings, 'PHOTO_VISION_API_KEY', 'test-key')
    calls = []
    class Response:
        def raise_for_status(self): pass
        def json(self): return {'choices': [{'message': {'content': '{"items":[{"name":"Nyanya","questions":["Ni aina gani?"]},{"name":"Vitunguu","questions":["Ni ukubwa gani?"]}]}'}}]}
    original_post = vision.httpx.AsyncClient.post
    async def post(self, url, **kw):
        if not url.startswith("https://api.openai.com/"):
            return await original_post(self, url, **kw)
        calls.append((url, kw))
        return Response()
    monkeypatch.setattr(vision.httpx.AsyncClient, 'post', post)
    files = [('files', ('shelf.jpg', image(), 'image/jpeg')), ('files', ('shelf2.jpg', image(), 'image/jpeg'))]
    res = await client.post('/api/photo-catalogue/analyse', headers=headers, files=files, data={'consent': 'true', 'language': 'sw'})
    assert res.status_code == 200, res.text
    assert res.json()['items'] == [{'name': 'Nyanya', 'questions': ['Ni aina gani?']}, {'name': 'Vitunguu', 'questions': ['Ni ukubwa gani?']}]
    payload = calls[0][1]['json']['messages'][0]['content']
    assert 'Kiswahili' in payload[0]['text'] and len(payload) == 3
    res = await client.post('/api/photo-catalogue/analyse', headers=headers, files=[('files', ('bad.jpg', b'not an image', 'image/jpeg'))], data={'consent': 'true'})
    assert res.status_code == 400 and len(calls) == 1


async def test_malformed_provider_response_is_not_presented_as_detection(client, monkeypatch):
    headers = await account(client)
    monkeypatch.setattr(settings, 'PHOTO_VISION_API_KEY', 'test-key')
    class Response:
        def raise_for_status(self): pass
        def json(self): return {'choices': [{'message': {'content': 'not json'}}]}
    original_post = vision.httpx.AsyncClient.post
    async def post(self, url, **kwargs):
        if not url.startswith("https://api.openai.com/"):
            return await original_post(self, url, **kwargs)
        return Response()
    monkeypatch.setattr(vision.httpx.AsyncClient, 'post', post)
    res = await client.post('/api/photo-catalogue/analyse', headers=headers, files=[('files', ('x.jpg', image(), 'image/jpeg'))], data={'consent': 'true'})
    assert res.status_code == 502


async def test_text_prompt_requires_consent_and_only_suggests(client, monkeypatch):
    headers = await account(client)
    monkeypatch.setattr(settings, 'PHOTO_VISION_API_KEY', 'test-key')
    calls = []
    class Response:
        def raise_for_status(self): pass
        def json(self): return {'choices': [{'message': {'content': '{"items":[{"name":"Bags","questions":["What size?"]}]}'}}]}
    original_post = vision.httpx.AsyncClient.post
    async def post(self, url, **kwargs):
        if not url.startswith('https://api.openai.com/'):
            return await original_post(self, url, **kwargs)
        calls.append(kwargs)
        return Response()
    monkeypatch.setattr(vision.httpx.AsyncClient, 'post', post)
    response = await client.post('/api/photo-catalogue/analyse', headers=headers, data={'description': 'Handmade bags', 'consent': 'false'})
    assert response.status_code == 400 and not calls
    response = await client.post('/api/photo-catalogue/analyse', headers=headers, data={'description': 'Handmade bags', 'consent': 'true'})
    assert response.status_code == 200, response.text
    assert response.json()['items'][0]['name'] == 'Bags'
    assert 'Handmade bags' in calls[0]['json']['messages'][0]['content'][1]['text']
    assert (await client.get('/api/offerings/mine', headers=headers)).json()['items'] == []


async def test_gemini_opt_in_provider_and_fail_closed(client, monkeypatch):
    headers = await account(client)
    monkeypatch.setattr(settings, 'GEMINI_CATALOGUE_API_KEY', '')
    data = {'description': 'beaded bags', 'provider': 'gemini', 'consent': 'true'}
    assert (await client.post('/api/photo-catalogue/analyse', headers=headers, data=data)).status_code == 503
    monkeypatch.setattr(settings, 'GEMINI_CATALOGUE_API_KEY', 'gemini-test-key')
    calls = []
    class Response:
        def raise_for_status(self): pass
        def json(self): return {'candidates': [{'content': {'parts': [{'text': '{"items":[{"name":"Bags","questions":[]}]}' }]}}]}
    original_post = vision.httpx.AsyncClient.post
    async def post(self, url, **kwargs):
        if not url.startswith('https://generativelanguage.googleapis.com/'):
            return await original_post(self, url, **kwargs)
        calls.append((url, kwargs))
        return Response()
    monkeypatch.setattr(vision.httpx.AsyncClient, 'post', post)
    assert (await client.post('/api/photo-catalogue/analyse', headers=headers, data={**data, 'consent':'false'})).status_code == 400
    assert calls == []
    response = await client.post('/api/photo-catalogue/analyse', headers=headers, data=data, files=[('files', ('x.jpg', image(), 'image/jpeg'))])
    assert response.status_code == 200, response.text
    assert response.json()['items'][0]['name'] == 'Bags'
    assert calls[0][1]['headers']['x-goog-api-key'] == 'gemini-test-key'
    parts = calls[0][1]['json']['contents'][0]['parts']
    assert 'beaded bags' in parts[1]['text'] and parts[2]['inline_data']['mime_type'] == 'image/jpeg'
    assert (await client.post('/api/photo-catalogue/analyse', headers=headers, data={**data, 'provider': 'unknown'})).status_code == 422
