import ProductCard from "./ProductCard";
import ServiceCard from "./ServiceCard";
import PersonCard from "./PersonCard";
import EquipmentCard from "./EquipmentCard";
import OpportunityCard from "./OpportunityCard";
import EventCard from "./EventCard";
import CommunityCard from "./CommunityCard";
import MarketCard from "./MarketCard";
import NoticeCard from "./NoticeCard";
import CommercialCard from "./CommercialCard";

/**
 * ONE carousel, many records. A shelf names its `card`, and that name resolves
 * here — so adding a shelf is a data decision, never a new carousel.
 */
export const CARD_RENDERERS = {
  product: ProductCard,
  service: ServiceCard,
  person: PersonCard,
  equipment: EquipmentCard,
  opportunity: OpportunityCard,
  event: EventCard,
  community: CommunityCard,
  market: MarketCard,
  notice: NoticeCard,
  commercial: CommercialCard,
};

export function renderCard(kind, props) {
  const Card = CARD_RENDERERS[kind];
  return Card ? <Card {...props} /> : null;
}

export {
  ProductCard, ServiceCard, PersonCard, EquipmentCard,
  OpportunityCard, EventCard, CommunityCard, MarketCard,
  NoticeCard, CommercialCard,
};
