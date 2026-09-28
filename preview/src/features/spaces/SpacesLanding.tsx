import React from 'react';
import { MineSurface } from '../mine/MineSurface';
/** Compatibility entry: Spaces has one implementation, not a second shelf. */
export function SpacesLanding({ onOpenSpace, onOpenPublicSpace, className }: { onOpenSpace: (id: string) => void; onOpenPublicSpace?: (slug: string) => void; className?: string }) {
  return <MineSurface onOpenSpace={onOpenSpace} onOpenPublicSpace={onOpenPublicSpace} className={className} onOpenCreateSpace={() => { window.location.hash = 'new-space'; }} onOpenEntity={id => { window.location.hash = `entity/${encodeURIComponent(id)}`; }} onRequireAuth={() => { window.location.hash = 'you'; }} />;
}
export default SpacesLanding;
