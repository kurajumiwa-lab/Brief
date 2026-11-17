from datetime import datetime, timedelta
from decimal import Decimal
import pytest
from app.services.spotted_deal_policy import exclusive_relationship, flag_weight, jury_outcome


def test_level_three_dampening_and_eligibility():
    assert flag_weight('DEAL_ENDED', 3, False) == Decimal('3.00')
    assert flag_weight('DEAL_ENDED', 3, True) == Decimal('1.50')
    assert flag_weight('FALSE_PRICE', 2, True) == Decimal('0.50')
    with pytest.raises(ValueError):
        flag_weight('SPAM', 1, False)


def test_exclusive_relationship_threshold():
    assert exclusive_relationship(4, 5, 2)
    assert exclusive_relationship(1, 1, 1)
    assert not exclusive_relationship(3, 5, 2)
    assert not exclusive_relationship(0, 0, 0)


def test_jury_preserves_prior_state_and_fails_closed():
    now = datetime.utcnow()
    end = now + timedelta(hours=2)
    deadline = now + timedelta(hours=1)
    assert jury_outcome(1, 1, end, deadline, now, False) is None
    assert jury_outcome(0, 2, end, deadline, now, False) == 'LIVE_UNVERIFIED'
    assert jury_outcome(0, 2, end, deadline, now, True) == 'RECEIPT_LINKED'
    assert jury_outcome(0, 2, now, deadline, now, True) == 'EXPIRED'
    assert jury_outcome(0, 0, end, now, now, True) == 'OPTED_OUT'
