import React from 'react';
import { WairoMark } from '../../components/WairoMark';
import './launch.css';

/** Same lockup and cool-light canvas as the first HTML paint. */
export function BrandLoading() {
  return <div className="wairo-loading" role="status" aria-label="Opening Wairo Blue Avenue">
    <div className="wairo-loading-lockup"><WairoMark size={54} title="" /><strong>Wairo</strong><span>Blue Avenue</span></div>
    <p>Opening your avenue<span aria-hidden="true">…</span></p>
  </div>;
}
