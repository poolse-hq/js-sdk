// Drawing during a call: the shared whiteboard (CL12) and the pointer and
// pen over a shared screen (CL4). Both are SVG, so they scale with the
// view and stay sharp.
//
//     import * as Y from 'yjs';                         // optional peer
//     const board = useWhiteboard(callId, Y, { selfUserId: me.id });
//     <Whiteboard board={board} />
//
//     const ink = useScreenAnnotations(media.room, sharer.userId);
//     <div style={{ position: 'relative' }}>
//       <video … /> <AnnotationOverlay ink={ink} />
//     </div>

import type { UseScreenAnnotations, UseWhiteboard } from '@poolse/react';
import type { WhiteboardItem, WhiteboardShapeKind } from '@poolse/sdk';
import { WHITEBOARD_SIZE } from '@poolse/sdk';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

export type WhiteboardTool = 'pen' | WhiteboardShapeKind | 'text' | 'eraser';

/** The pen colours offered; any `#rrggbb` works through the API. */
export const WHITEBOARD_COLORS = [
  '#1f2328',
  '#e5484d',
  '#f76b15',
  '#30a46c',
  '#0090ff',
  '#8e4ec6',
] as const;

const TOOLS: Array<{ tool: WhiteboardTool; label: string; glyph: string }> = [
  { tool: 'pen', label: 'Pen', glyph: '✎' },
  { tool: 'line', label: 'Line', glyph: '╱' },
  { tool: 'arrow', label: 'Arrow', glyph: '→' },
  { tool: 'rect', label: 'Rectangle', glyph: '▭' },
  { tool: 'ellipse', label: 'Ellipse', glyph: '◯' },
  { tool: 'text', label: 'Text', glyph: 'T' },
  { tool: 'eraser', label: 'Eraser', glyph: '⌫' },
];

const path = (p: readonly number[]) => {
  if (p.length < 2) return '';
  let d = `M${p[0]} ${p[1]}`;
  for (let i = 2; i + 1 < p.length; i += 2) d += `L${p[i]} ${p[i + 1]}`;
  if (p.length === 2) d += `l0.01 0`;
  return d;
};

/** One board item as SVG. Exported for a read-only render of your own. */
export function WhiteboardItemSvg({ item }: { item: WhiteboardItem }) {
  switch (item.kind) {
    case 'stroke':
      return (
        <path
          d={path(item.points)}
          stroke={item.color}
          strokeWidth={item.width}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case 'rect':
      return (
        <rect
          x={Math.min(item.x, item.x + item.w)}
          y={Math.min(item.y, item.y + item.h)}
          width={Math.abs(item.w)}
          height={Math.abs(item.h)}
          stroke={item.color}
          strokeWidth={item.width}
          fill={item.fill ?? 'none'}
        />
      );
    case 'ellipse':
      return (
        <ellipse
          cx={item.x + item.w / 2}
          cy={item.y + item.h / 2}
          rx={Math.abs(item.w / 2)}
          ry={Math.abs(item.h / 2)}
          stroke={item.color}
          strokeWidth={item.width}
          fill={item.fill ?? 'none'}
        />
      );
    case 'line':
    case 'arrow': {
      const x2 = item.x + item.w;
      const y2 = item.y + item.h;
      const a = Math.atan2(item.h, item.w);
      const head = 6 + item.width * 3;
      return (
        <g stroke={item.color} strokeWidth={item.width} strokeLinecap="round" fill="none">
          <line x1={item.x} y1={item.y} x2={x2} y2={y2} />
          {item.kind === 'arrow' ? (
            <path
              d={`M${x2 - head * Math.cos(a - 0.45)} ${y2 - head * Math.sin(a - 0.45)}L${x2} ${y2}L${x2 - head * Math.cos(a + 0.45)} ${y2 - head * Math.sin(a + 0.45)}`}
            />
          ) : null}
        </g>
      );
    }
    case 'text':
      return (
        <text
          x={item.x}
          y={item.y}
          fill={item.color}
          fontSize={item.size}
          fontFamily="var(--poolse-font-body)"
        >
          {item.text}
        </text>
      );
  }
}

export interface WhiteboardProps {
  /** `useWhiteboard(callId, Y)`. */
  board: UseWhiteboard;
  /** Force view-only (the relay's rights already decide). */
  readOnly?: boolean;
  className?: string;
}

/**
 * The call's shared board: pen, line, arrow, rectangle, ellipse, text and
 * eraser in six colours, undo / redo and clear. Everyone sees every line
 * as it is drawn; the server saves the board with the meeting.
 */
export function Whiteboard({ board, readOnly, className }: WhiteboardProps) {
  const { model, items, error } = board;
  const ro = readOnly || board.readOnly || !model;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [tool, setTool] = useState<WhiteboardTool>('pen');
  const [color, setColor] = useState<string>(WHITEBOARD_COLORS[0]);
  const drawing = useRef<{ id: string | null; x: number; y: number; points: number[] } | null>(
    null,
  );

  const point = (e: ReactPointerEvent): [number, number] => {
    const svg = svgRef.current;
    const r = svg?.getBoundingClientRect();
    if (!r || r.width === 0) return [0, 0];
    return [
      Math.round(((e.clientX - r.left) / r.width) * WHITEBOARD_SIZE.width),
      Math.round(((e.clientY - r.top) / r.height) * WHITEBOARD_SIZE.height),
    ];
  };

  const down = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (ro || !model) return;
    const [x, y] = point(e);
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (tool === 'eraser') {
      model.eraseAt(x, y, { radius: 12 });
      drawing.current = { id: null, x, y, points: [] };
      return;
    }
    if (tool === 'text') {
      const text = window.prompt('Text')?.trim();
      if (text) model.add({ kind: 'text', x, y, text, color, size: 28 });
      return;
    }
    const id =
      tool === 'pen'
        ? model.add({ kind: 'stroke', points: [x, y], color, width: 3 })
        : model.add({ kind: tool, x, y, w: 0, h: 0, color, width: 3 });
    drawing.current = { id, x, y, points: [x, y] };
  };

  const move = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drawing.current;
    if (!d || !model) return;
    const [x, y] = point(e);
    if (tool === 'eraser') {
      model.eraseAt(x, y, { radius: 12 });
      return;
    }
    if (!d.id) return;
    if (tool === 'pen') {
      const last = d.points.length;
      if (Math.hypot(x - d.points[last - 2]!, y - d.points[last - 1]!) < 2) return;
      d.points.push(x, y);
      model.update(d.id, { points: d.points.slice() } as never);
    } else {
      model.update(d.id, { w: x - d.x, h: y - d.y } as never);
    }
  };

  const up = () => {
    const d = drawing.current;
    drawing.current = null;
    if (!d?.id || !model || tool === 'pen') return;
    // A click without a drag leaves a zero-size shape: remove it.
    const item = model.getItems().find((i) => i.id === d.id);
    if (item && 'w' in item && Math.abs(item.w) < 3 && Math.abs(item.h) < 3) model.remove(d.id);
  };

  useEffect(() => {
    if (ro || !model) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      if (e.shiftKey) model.redo();
      else model.undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ro, model]);

  return (
    <section
      className={['poolse-board', className].filter(Boolean).join(' ')}
      aria-label="Whiteboard"
    >
      {!ro ? (
        <div className="poolse-board__tools" role="toolbar" aria-label="Whiteboard tools">
          <div role="radiogroup" aria-label="Tool" className="poolse-board__group">
            {TOOLS.map((t) => (
              <button
                key={t.tool}
                type="button"
                role="radio"
                aria-checked={tool === t.tool}
                aria-label={t.label}
                title={t.label}
                className={`poolse-board__tool${tool === t.tool ? ' poolse-board__tool--on' : ''}`}
                onClick={() => setTool(t.tool)}
              >
                {t.glyph}
              </button>
            ))}
          </div>
          <div role="radiogroup" aria-label="Colour" className="poolse-board__group">
            {WHITEBOARD_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={`Colour ${c}`}
                className={`poolse-board__swatch${color === c ? ' poolse-board__swatch--on' : ''}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
          <div className="poolse-board__group">
            <button
              type="button"
              className="poolse-board__tool"
              aria-label="Undo"
              title="Undo"
              onClick={() => model?.undo()}
            >
              ↶
            </button>
            <button
              type="button"
              className="poolse-board__tool"
              aria-label="Redo"
              title="Redo"
              onClick={() => model?.redo()}
            >
              ↷
            </button>
            <button
              type="button"
              className="poolse-btn poolse-btn--quiet"
              disabled={items.length === 0}
              onClick={() => {
                if (window.confirm('Clear the whole board for everyone?')) model?.clear();
              }}
            >
              Clear
            </button>
          </div>
        </div>
      ) : null}
      <svg
        ref={svgRef}
        className={`poolse-board__canvas poolse-board__canvas--${ro ? 'view' : tool}`}
        viewBox={`0 0 ${WHITEBOARD_SIZE.width} ${WHITEBOARD_SIZE.height}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`Whiteboard, ${items.length} ${items.length === 1 ? 'item' : 'items'}`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        <rect
          width={WHITEBOARD_SIZE.width}
          height={WHITEBOARD_SIZE.height}
          className="poolse-board__paper"
        />
        {items.map((item) => (
          <WhiteboardItemSvg key={item.id} item={item} />
        ))}
      </svg>
      {error ? (
        <p className="poolse-panel__error" role="alert">
          The whiteboard couldn’t open: {error.message}
        </p>
      ) : !model ? (
        <p className="poolse-panel__empty">Opening the whiteboard…</p>
      ) : null}
    </section>
  );
}

export interface AnnotationOverlayProps {
  /** `useScreenAnnotations(media.room, sharerUserId)`. */
  ink: UseScreenAnnotations;
  /** Draw (and point) on the screen; off, only show what others draw. Defaults to true. */
  interactive?: boolean;
  color?: string;
  /** Names for the pointer labels. */
  nameFor?: (userId: string) => string | null | undefined;
  className?: string;
}

/**
 * Lay over the shared screen's video, same box: a pointer for everyone,
 * and a pen. Coordinates are fractions of the picture, so it lines up on
 * any screen size; keep the video `object-fit: contain` and this overlay
 * the size of the picture, not the letterbox.
 */
export function AnnotationOverlay({
  ink,
  interactive = true,
  color = '#e5484d',
  nameFor,
  className,
}: AnnotationOverlayProps) {
  const { state, annotations } = ink;
  const ref = useRef<SVGSVGElement | null>(null);
  const current = useRef<string | null>(null);
  if (!state) return null;

  const at = (e: ReactPointerEvent): [number, number] => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || r.width === 0) return [0, 0];
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  };

  return (
    <div
      className={['poolse-annotate', interactive && 'poolse-annotate--live', className]
        .filter(Boolean)
        .join(' ')}
    >
      <svg
        ref={ref}
        className="poolse-annotate__ink"
        viewBox="0 0 1000 1000"
        preserveAspectRatio="none"
        aria-hidden="true"
        onPointerDown={(e) => {
          if (!interactive || !annotations) return;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          const [x, y] = at(e);
          current.current = annotations.begin({ color });
          annotations.extend(current.current, x, y);
        }}
        onPointerMove={(e) => {
          if (!interactive || !annotations) return;
          const [x, y] = at(e);
          if (current.current) annotations.extend(current.current, x, y);
          else annotations.pointer(x, y);
        }}
        onPointerUp={() => {
          if (current.current) annotations?.end(current.current);
          current.current = null;
        }}
        onPointerLeave={() => annotations?.pointerOff()}
      >
        {state.strokes.map((s) => (
          <path
            key={s.id}
            d={path(s.points.map((v) => v * 1000))}
            stroke={s.color}
            strokeWidth={Math.max(2, s.width * 1000)}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      {state.pointers.map((p) => (
        <span
          key={p.userId}
          className="poolse-annotate__pointer"
          style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
          aria-hidden="true"
        >
          <span className="poolse-annotate__name">
            {nameFor?.(p.userId) || p.name || 'Someone'}
          </span>
        </span>
      ))}
    </div>
  );
}
