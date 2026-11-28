import { useEffect, useId, useRef } from 'react';
import { easeCubicOut, select, zoom, zoomIdentity } from 'd3';
import { ageLabel } from '../../../shared/age';
import type { PrView } from '../../../shared/grouping';
import type { StackDetail } from '../../../shared/types';
import { edgeRoute, layoutStack, nextToMerge, NODE_HEIGHT, NODE_WIDTH, stackNodes } from '../lib/stackLayout';

interface StackDiagramProps {
  detail: StackDetail;
  viewsByNumber: Map<number, PrView>;
  selectedNumber?: number;
  onSelect: (number: number) => void;
  label: string;
  wheelZoom?: boolean;
  /** Changes when the theme does; fonts and radii are read from CSS variables only when drawing. */
  themeKey?: string;
}

const BUCKET_COLOR = { blocked: 'var(--c-blocked)', waiting: 'var(--c-waiting)', ready: 'var(--c-ready)', draft: 'var(--c-draft)' } as const;
const SIGNAL_COLORS = { green: ['var(--g-bg)', 'var(--g-fg)'], amber: ['var(--a-bg)', 'var(--a-fg)'], red: ['var(--r-bg)', 'var(--r-fg)'], grey: ['var(--n-bg)', 'var(--n-fg)'] } as const;
const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

export function StackDiagram({ detail, viewsByNumber, selectedNumber, onSelect, label, wheelZoom = true, themeKey }: StackDiagramProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  // The Stacks tab and the dialog can show diagrams at once, so arrow marker ids must be unique.
  const markerId = useId().replace(/:/g, '');
  // Parents rebuild these on every clock tick and snapshot; redrawing on identity changes would reset zoom and replay the animation.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const viewsRef = useRef(viewsByNumber);
  viewsRef.current = viewsByNumber;
  const detailKey = JSON.stringify(detail);
  const statusKey = [...viewsByNumber.values()]
    .map((view) => `${view.pr.number}:${view.bucket}:${view.signals.map((signal) => signal.color).join('')}`)
    .sort()
    .join('|');

  useEffect(() => {
    const svgElement = svgRef.current;
    if (!svgElement) return;
    const viewsByNumber = viewsRef.current;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const step = reduceMotion ? 0 : 45;
    const duration = reduceMotion ? 0 : 450;

    const nodes = stackNodes(detail);
    const nextKeys = nextToMerge(nodes);
    const { placed, links } = layoutStack(nodes);
    const svg = select(svgElement);
    svg.selectAll('*').remove();
    // Themes change fonts and corner radii through CSS variables; SVG attributes need concrete values.
    const style = getComputedStyle(document.documentElement);
    const radiusSmall = parseFloat(style.getPropertyValue('--radius-small')) || 6;
    const radius = parseFloat(style.getPropertyValue('--radius')) || 10;
    const fontUi = style.getPropertyValue('--font-ui').trim() || 'system-ui, sans-serif';
    const fontMono = style.getPropertyValue('--font-mono').trim() || 'monospace';
    const canvas = svg.append('g');

    const width = svgElement.clientWidth || 900;
    const height = svgElement.clientHeight || 600;
    const minX = Math.min(...placed.map((entry) => entry.x)) - NODE_WIDTH / 2;
    const maxX = Math.max(...placed.map((entry) => entry.x)) + NODE_WIDTH / 2;
    const tallest = Math.max(...placed.map((entry) => -entry.y)) + NODE_HEIGHT + 80;
    // Deep stacks start zoomed out but stay readable; the base is anchored at the bottom.
    const scale = Math.max(0.45, Math.min(1, (height - 40) / tallest, (width - 40) / (maxX - minX)));
    const zoomBehaviour = zoom<SVGSVGElement, unknown>().scaleExtent([0.25, 2])
      // Inline diagrams must not hijack page scrolling; they zoom on ctrl/cmd + wheel only.
      .filter((event: WheelEvent | MouseEvent) => (event.type === 'wheel' ? wheelZoom || event.ctrlKey || (event as WheelEvent).metaKey : !event.ctrlKey && !event.button)).on('zoom', (event) => canvas.attr('transform', event.transform));
    svg.call(zoomBehaviour);
    svg.call(zoomBehaviour.transform, zoomIdentity.translate(width / 2 - ((minX + maxX) / 2) * scale, height - 50 * scale).scale(scale));

    // Edges follow the merge direction, like the lane connectors: arrows point from a PR into what it merges into.
    const defs = svg.append('defs');
    ([['idle', 'var(--edge)'], ['merged', 'var(--edge-merged)'], ['hot', 'var(--accent)']] as const).forEach(([name, fill]) => {
      defs.append('marker').attr('id', `${markerId}-${name}`).attr('viewBox', '0 0 10 10').attr('refX', 9).attr('refY', 5)
        .attr('markerWidth', 6).attr('markerHeight', 6).attr('orient', 'auto-start-reverse')
        .append('path').attr('d', 'M0 0 L10 5 L0 10 z').style('fill', fill);
    });
    const isHot = (link: (typeof links)[number]) => [link.source.node, link.target.node].some((node) => node.kind === 'open' && node.number === selectedNumber);
    const edgeKind = (link: (typeof links)[number]) => (isHot(link) ? 'hot' : link.source.node.kind !== 'open' ? 'merged' : 'idle');
    const EDGE_COLOR = { hot: 'var(--accent)', merged: 'var(--edge-merged)', idle: 'var(--edge)' } as const;
    const edges = canvas.append('g').selectAll('g').data([...links].sort((a, b) => Number(isHot(a)) - Number(isHot(b)))).join('g');
    edges.append('path')
      .attr('d', (link) => edgeRoute(link))
      .attr('fill', 'none').attr('stroke-width', (link) => (isHot(link) ? 2.5 : 2)).attr('stroke-linejoin', 'miter')
      .attr('stroke-dasharray', (link) => (link.source.node.kind === 'merged' || link.target.node.kind === 'merged' ? '5 4' : null))
      .attr('marker-end', (link) => `url(#${markerId}-${edgeKind(link)})`)
      .style('stroke', (link) => EDGE_COLOR[edgeKind(link)])
      .style('opacity', 0)
      .transition().delay((_, index) => 150 + index * step).duration(duration / 1.3).style('opacity', 1);
    edges.filter((link) => (link.target.node.behindParent ?? 0) > 0).append('text')
      .attr('x', (link) => link.target.x + 8).attr('y', (link) => link.target.y + NODE_HEIGHT / 2 + 16)
      .attr('font-size', 11).attr('font-weight', 600).attr('font-family', fontUi).style('fill', 'var(--behind)')
      .text((link) => `${link.target.node.behindParent} behind`);

    const group = canvas.append('g').selectAll('g').data(placed).join('g')
      .attr('transform', (entry) => `translate(${entry.x},${entry.y + 24})`).style('opacity', 0);
    group.transition().delay((_, index) => index * step).duration(duration).ease(easeCubicOut)
      .attr('transform', (entry) => `translate(${entry.x},${entry.y})`)
      .style('opacity', (entry) => (entry.node.kind === 'merged' ? 0.6 : 1));

    const base = group.filter((entry) => entry.node.kind === 'base');
    base.append('rect').attr('x', -50).attr('y', -16).attr('width', 100).attr('height', 32).attr('rx', 16).style('fill', 'var(--pill)');
    base.append('text').attr('text-anchor', 'middle').attr('y', 5).attr('font-size', 13).attr('font-weight', 600).attr('font-family', fontMono)
      .style('fill', 'var(--pill-fg)').text(detail.baseRefName);

    const card = group.filter((entry) => entry.node.kind !== 'base');
    card.append('rect').attr('x', -NODE_WIDTH / 2).attr('y', -NODE_HEIGHT / 2).attr('width', NODE_WIDTH).attr('height', NODE_HEIGHT).attr('rx', radius)
      .attr('stroke-dasharray', (entry) => (entry.node.kind === 'merged' ? '5 4' : null))
      .attr('stroke-width', (entry) => (entry.node.number === selectedNumber ? 2 : 1))
      .style('fill', (entry) => (entry.node.kind === 'merged' ? 'var(--merged-card)' : 'var(--surface)'))
      .style('stroke', (entry) => (entry.node.kind === 'merged' ? 'var(--edge-merged)' : entry.node.number === selectedNumber ? 'var(--accent)' : 'var(--border)'));
    card.append('circle').attr('cx', -NODE_WIDTH / 2 + 16).attr('cy', -NODE_HEIGHT / 2 + 18).attr('r', 6)
      .style('fill', (entry) => {
        const view = entry.node.number ? viewsByNumber.get(entry.node.number) : undefined;
        return entry.node.kind === 'merged' || !view ? 'var(--c-merged)' : BUCKET_COLOR[view.bucket];
      });
    card.append('text').attr('x', -NODE_WIDTH / 2 + 30).attr('y', -NODE_HEIGHT / 2 + 22).attr('font-size', 12).attr('font-family', fontMono).style('fill', 'var(--muted)')
      .text((entry) => {
        const view = entry.node.number ? viewsByNumber.get(entry.node.number) : undefined;
        return `#${entry.node.number} · ${entry.node.kind === 'merged' ? entry.node.state : view ? ageLabel(view.ageHours) : 'open'}`;
      });
    card.append('text').attr('x', -NODE_WIDTH / 2 + 14).attr('y', -NODE_HEIGHT / 2 + 42).attr('font-size', 13).attr('font-weight', 600).attr('font-family', fontUi).style('fill', 'var(--text)')
      .text((entry) => truncate(entry.node.title ?? '', 30));

    const open = card.filter((entry) => entry.node.kind === 'open').style('cursor', 'pointer')
      .on('click', (_event, entry) => entry.node.number && onSelectRef.current(entry.node.number));
    open.each(function drawSquares(entry) {
      const view = entry.node.number ? viewsByNumber.get(entry.node.number) : undefined;
      if (!view) return;
      const squares = select(this).append('g').attr('transform', `translate(${NODE_WIDTH / 2 - view.signals.length * 19 - 8},${-NODE_HEIGHT / 2 + 10})`);
      view.signals.forEach((signal, index) => {
        squares.append('rect').attr('x', index * 19).attr('width', 16).attr('height', 16).attr('rx', Math.max(0, radiusSmall - 2)).style('fill', SIGNAL_COLORS[signal.color][0])
          .append('title').text(`${signal.label}: ${signal.detail}`);
        squares.append('text').attr('x', index * 19 + 8).attr('y', 12).attr('text-anchor', 'middle').attr('font-size', 10).attr('font-weight', 700).attr('font-family', fontUi)
          .style('fill', SIGNAL_COLORS[signal.color][1]).text(signal.glyph);
      });
    });
    const next = open.filter((entry) => nextKeys.has(entry.node.key));
    next.append('rect').attr('x', NODE_WIDTH / 2 - 104).attr('y', NODE_HEIGHT / 2 - 12).attr('width', 98).attr('height', 22).attr('rx', 11).style('fill', 'var(--accent)');
    next.append('text').attr('x', NODE_WIDTH / 2 - 55).attr('y', NODE_HEIGHT / 2 + 3).attr('text-anchor', 'middle').attr('font-size', 11).attr('font-weight', 700).attr('font-family', fontUi)
      .style('fill', 'var(--accent-fg)').text('Next to merge');

    return () => {
      svg.on('.zoom', null);
      svg.selectAll('*').remove();
    };
    // Redraw only when the stack's content, statuses or selection really change.
  }, [detailKey, statusKey, selectedNumber, wheelZoom, themeKey]);

  return <svg ref={svgRef} className="stack-svg" role="img" aria-label={label} />;
}
