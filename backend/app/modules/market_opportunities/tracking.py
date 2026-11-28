"""Count only actual participant messages in opportunity-specific rooms."""
from datetime import datetime
from sqlalchemy import select
from app.modules.market_opportunities.models import OpportunityConversation


async def record_message(db, room_id, sender_id):
    conversation = (await db.execute(select(OpportunityConversation).where(
        OpportunityConversation.room_id == room_id).with_for_update())).scalar_one_or_none()
    if conversation is None:
        return
    now = datetime.utcnow()
    if sender_id == conversation.buyer_id:
        conversation.buyer_messages += 1
        if conversation.first_enquiry_at is None:
            conversation.first_enquiry_at = now
    elif sender_id == conversation.seller_id:
        conversation.seller_messages += 1
        if conversation.first_enquiry_at and conversation.first_reply_at is None:
            conversation.first_reply_at = now
