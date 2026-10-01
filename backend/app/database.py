from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

engine = create_async_engine(settings.DATABASE_URL, echo=settings.DEBUG, pool_pre_ping=True)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with async_session() as session:
        try:
            yield session
        finally:
            await session.close()


async def init_db():
    """Dev convenience. Production applies `alembic upgrade head` instead."""
    # Import the models so every table is registered on Base.metadata.
    import app.models  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # ORM cannot express the append-only guard on custody_ledger; install it
    # here (dev) and in alembic 0006 (production) so both paths match.
    from app.db_triggers import ensure_guardrails

    async with engine.begin() as conn:
        await ensure_guardrails(conn)
