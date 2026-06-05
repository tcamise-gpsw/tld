import React, { useMemo } from 'react';
import { DiagramData } from '../data/types';

interface TooltipProps {
  nodeRef: string;
  data: DiagramData;
  x: number;
  y: number;
}

export const Tooltip: React.FC<TooltipProps> = ({ nodeRef, data, x, y }) => {
  const element = useMemo(() => data.elements.get(nodeRef), [data, nodeRef]);

  if (!element) return null;

  // Clamp to viewport
  let tooltipX = x + 12;
  let tooltipY = y + 12;

  if (tooltipX + 200 > window.innerWidth) {
    tooltipX = window.innerWidth - 200 - 12;
  }

  if (tooltipY + 100 > window.innerHeight) {
    tooltipY = window.innerHeight - 100 - 12;
  }

  return (
    <div
      className="tooltip"
      style={{
        left: `${tooltipX}px`,
        top: `${tooltipY}px`,
      }}
    >
      <div className="tooltip-title">{element.name}</div>
      <div className="tooltip-kind">{element.kind}</div>
      <div className="tooltip-description">{element.description}</div>
    </div>
  );
};
