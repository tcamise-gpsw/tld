import { LayoutNode } from './layout';

export const PAN_THRESHOLD = 5;

export function hitTestNodes(worldX: number, worldY: number, nodes: LayoutNode[]): string | null {
  // Test in reverse order (last drawn = visually on top = first hit)
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    const left = node.x - node.width / 2;
    const right = node.x + node.width / 2;
    const top = node.y - node.height / 2;
    const bottom = node.y + node.height / 2;

    if (worldX >= left && worldX <= right && worldY >= top && worldY <= bottom) {
      return node.ref;
    }
  }

  return null;
}

export function isDrag(startX: number, startY: number, endX: number, endY: number): boolean {
  const dx = endX - startX;
  const dy = endY - startY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  return distance > PAN_THRESHOLD;
}

export function hitTestGroupIcon(worldX: number, worldY: number, nodes: LayoutNode[]): string | null {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    if (!node.isGroup) continue;
    
    // Icon is drawn at (node.x + width/2 - 12, node.y - height/2 + 12)
    // Let's give it a hit radius of 12px
    const iconX = node.x + node.width / 2 - 12;
    const iconY = node.y - node.height / 2 + 12;
    
    const dx = worldX - iconX;
    const dy = worldY - iconY;
    if (dx * dx + dy * dy <= 144) { // 12^2
      return node.ref;
    }
  }
  return null;
}
