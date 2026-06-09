import React, { useState, useEffect, useRef, useMemo } from 'react';
import { RotateCw, FlipHorizontal, Trash2, LayoutGrid, Hand, Plus, PenTool, RotateCcw, Brain } from 'lucide-react';

// Math Utilities & Definitions
type Point = { x: number; y: number };

function normalizeShape(pts: Point[]): Point[] {
  const minX = Math.min(...pts.map(p => p.x));
  const minY = Math.min(...pts.map(p => p.y));
  return pts.map(p => ({ x: p.x - minX, y: p.y - minY }));
}

function rotateShape(shape: Point[]): Point[] {
  return normalizeShape(shape.map(p => ({ x: -p.y, y: p.x })));
}

function flipShape(shape: Point[], horizontal: boolean): Point[] {
  return normalizeShape(shape.map(p => ({ x: horizontal ? -p.x : p.x, y: horizontal ? p.y : -p.y })));
}

function parseShape(ascii: string[]): Point[] {
  const pts: Point[] = [];
  ascii.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] === 'X') pts.push({ x, y });
    }
  });
  return normalizeShape(pts);
}

const SHAPES = {
  monomino: { Mono: ['X'] },
  domino: { Dom: ['XX'] },
  tromino: { I3: ['XXX'], V3: ['X.', 'XX'] },
  tetromino: {
    I4: ['XXXX'],
    O4: ['XX','XX'],
    T4: ['XXX','.X.'],
    S4: ['.XX','XX.'],
    L4: ['X.','X.','XX']
  },
  pentomino: {
    F: ['.XX','XX.','.X.'],
    I: ['XXXXX'],
    L: ['X...','X...','X...','XX..'],
    P: ['XX','XX','X.'],
    N: ['.X','.X','XX','X.'],
    T: ['XXX','.X.','.X.'],
    U: ['X.X','XXX'],
    V: ['X..','X..','XXX'],
    W: ['X..','XX.','.XX'],
    X: ['.X.','XXX','.X.'],
    Y: ['.X.','XX.','.X.','.X.'],
    Z: ['XX.','.X.','.XX']
  }
};

const COLORS = [
  '#FF6B6B', '#4D96FF', '#6BCB77', '#FFD93D', '#9B5DE5', '#F15BB5', '#00BBF9', '#FF9F1C'
];

const POLY_TYPES = [
  { id: 'monomino', label: '모노미노 (1)' },
  { id: 'domino', label: '도미노 (2)' },
  { id: 'tromino', label: '트리미노 (3)' },
  { id: 'tetromino', label: '테트라미노 (4)' },
  { id: 'pentomino', label: '펜토미노 (5)' },
];

const generateUbongoPuzzleData = (difficulty: number) => {
    // 1. 조각 풀 구성
    const pool: { id: string, name: string, shape: Point[] }[] = [];
    Object.entries(SHAPES.tromino).forEach(([name, ascii]) => pool.push({ id: `tromino-${name}`, name, shape: parseShape(ascii) }));
    Object.entries(SHAPES.tetromino).forEach(([name, ascii]) => pool.push({ id: `tetromino-${name}`, name, shape: parseShape(ascii) }));
    Object.entries(SHAPES.pentomino).forEach(([name, ascii]) => pool.push({ id: `pentomino-${name}`, name, shape: parseShape(ascii) }));

    let success = false;
    let finalGrid = Array.from({length: 10}, () => Array(10).fill(false));
    let finalPieces: any[] = [];

    // [규칙 2]: 맵 내부에 고립된 구멍(Holes)이 없는지 확인 (Flood Fill)
    const hasInternalHoles = (tempGrid: number[][]) => {
        const visited = Array.from({length: 10}, () => Array(10).fill(false));
        const q: {x: number, y: number}[] = [];
        
        // 맵의 가장자리(테두리)에 있는 모든 빈 공간(-1)을 큐에 삽입
        for (let y = 0; y < 10; y++) {
            for (let x = 0; x < 10; x++) {
                if (tempGrid[y][x] === -1 && (x === 0 || x === 9 || y === 0 || y === 9)) {
                    q.push({x, y});
                    visited[y][x] = true;
                }
            }
        }
        
        // 연결된 빈 공간을 탐색
        let head = 0;
        while (head < q.length) {
            const {x, y} = q[head++];
            const dirs = [[1,0], [-1,0], [0,1], [0,-1]];
            for (const [dx, dy] of dirs) {
                const nx = x + dx, ny = y + dy;
                if (nx >= 0 && nx < 10 && ny >= 0 && ny < 10 && !visited[ny][nx] && tempGrid[ny][nx] === -1) {
                    visited[ny][nx] = true;
                    q.push({x: nx, y: ny});
                }
            }
        }
        
        // 외부 테두리와 연결되지 못한(즉 갇혀있는) 빈 공간이 있다면 에러
        for (let y = 0; y < 10; y++) {
            for (let x = 0; x < 10; x++) {
                if (tempGrid[y][x] === -1 && !visited[y][x]) {
                    return true;
                }
            }
        }
        return false;
    };

    // [규칙 3]: 배치된 모든 조각을 감싸는 박스의 크기(Bounding Box) 제한 확인
    const isWithinBoundingBox = (tempGrid: number[][], maxDim: number) => {
        let minX = 10, maxX = -1, minY = 10, maxY = -1;
        for (let y = 0; y < 10; y++) {
            for (let x = 0; x < 10; x++) {
                if (tempGrid[y][x] !== -1) {
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
            }
        }
        if (minX > maxX) return true; // 아직 조각이 없을 때
        return (maxX - minX + 1) <= maxDim && (maxY - minY + 1) <= maxDim;
    };

    // 난이도별 바운딩 박스 크기 조건 (3~4개: 최대 5, 5개: 최대 6)
    const MAX_BBOX = difficulty <= 4 ? 5 : 6;
    const MAX_ATTEMPTS = 15000; // 충분한 탐색을 보장하기 위한 횟수 증가

    for (let attempts = 0; attempts < MAX_ATTEMPTS; attempts++) {
        const shuffledPool = [...pool].sort(() => Math.random() - 0.5);
        const selectedPieces = shuffledPool.slice(0, difficulty);
        
        let grid = Array.from({length: 10}, () => Array(10).fill(-1));
        const piecesPlaced: typeof pool = [];
        const adj = Array.from({length: difficulty}, () => new Set<number>());

        const getRandomTransform = (shape: Point[]) => {
            let s = shape;
            const rotations = Math.floor(Math.random() * 4);
            for (let i = 0; i < rotations; i++) s = rotateShape(s);
            if (Math.random() > 0.5) s = flipShape(s, true);
            return s;
        };

        const canPlace = (x: number, y: number, shape: Point[], currentGrid: number[][]) => {
            for (let pt of shape) {
                const ax = x + pt.x; const ay = y + pt.y;
                if (ax < 0 || ax >= 10 || ay < 0 || ay >= 10) return false;
                if (currentGrid[ay][ax] !== -1) return false;
            }
            return true;
        };

        const place = (x: number, y: number, shape: Point[], pieceIdx: number, targetGrid: number[][]) => {
            for (let pt of shape) targetGrid[y + pt.y][x + pt.x] = pieceIdx;
        };

        let placementSuccess = true;

        for (let i = 0; i < difficulty; i++) {
            let bestPlacements: {x: number, y: number, sharedEdges: number, touches: Set<number>, shape: Point[]}[] = [];

            // 여러 변환형태를 시도 (퍼즐 결합 후보지들을 최대한 많이 뽑는다)
            for (let t = 0; t < 15; t++) {
                const transformedShape = getRandomTransform(selectedPieces[i].shape);
                
                if (i === 0) {
                    const startX = 3 + Math.floor(Math.random() * 4);
                    const startY = 3 + Math.floor(Math.random() * 4);
                    if (canPlace(startX, startY, transformedShape, grid)) {
                        bestPlacements.push({ x: startX, y: startY, sharedEdges: 0, touches: new Set(), shape: transformedShape });
                        break; 
                    }
                } else {
                    for (let y = 0; y < 10; y++) {
                        for (let x = 0; x < 10; x++) {
                            if (canPlace(x, y, transformedShape, grid)) {
                                let sharedEdges = 0;
                                let touchesPieces = new Set<number>();
                                
                                // [규칙 1]: 기존 블록들과 물리적으로 맞닿는 엣지 수 계산
                                for (let pt of transformedShape) {
                                    const ax = x + pt.x; const ay = y + pt.y;
                                    const neighbors = [
                                        {nx: ax-1, ny: ay}, {nx: ax+1, ny: ay}, 
                                        {nx: ax, ny: ay-1}, {nx: ax, ny: ay+1}
                                    ];
                                    for (const n of neighbors) {
                                        if (n.nx >= 0 && n.nx < 10 && n.ny >= 0 && n.ny < 10) {
                                            const neighborVal = grid[n.ny][n.nx];
                                            if (neighborVal !== -1) {
                                                sharedEdges++;
                                                touchesPieces.add(neighborVal);
                                            }
                                        }
                                    }
                                }
                                
                                // 최소 2개~3개 엣지 이상 맞물려야 통과하도록 허들 상향
                                // 단, 조각이 3개 뿐이거나 매우 극단적인 모양의 경우 1이어도 살려주되, 우선순위에서 밀리게 함
                                if (sharedEdges >= 1) {
                                    const tempGrid = grid.map(row => [...row]);
                                    place(x, y, transformedShape, i, tempGrid);
                                    
                                    // [규칙 2, 3 검증]: Bounding Box 한계 여부와 닫힌 구멍(Hole) 여부 확인
                                    if (!hasInternalHoles(tempGrid) && isWithinBoundingBox(tempGrid, MAX_BBOX)) {
                                        bestPlacements.push({ x, y, sharedEdges, touches: touchesPieces, shape: transformedShape });
                                    }
                                }
                            }
                        }
                    }
                }
            }

            if (bestPlacements.length > 0) {
                // 공유 모서리(sharedEdges)가 가장 많은 (즉, 가장 꽉 맞물리는) 배치를 최우선 선택
                const maxSharedEdges = Math.max(...bestPlacements.map(v => v.sharedEdges));
                // 극단적으로 뱀처럼 이어지는걸 막기 위해, 최소 sharedEdge 점수를 더 높게 주는 가중치 역할
                const candidates = bestPlacements.filter(v => v.sharedEdges === maxSharedEdges);
                
                const choice = candidates[Math.floor(Math.random() * candidates.length)];
                place(choice.x, choice.y, choice.shape, i, grid);
                choice.touches.forEach(t => { adj[i].add(t); adj[t].add(i); });
                piecesPlaced.push(selectedPieces[i]);
            } else {
                placementSuccess = false; break;
            }
        }

        if (placementSuccess) {
            let hasMutual3 = false;
            for(let a = 0; a < difficulty; a++) {
                for(let b = a + 1; b < difficulty; b++) {
                    for(let c = b + 1; c < difficulty; c++) {
                        if (adj[a].has(b) && adj[b].has(c) && adj[c].has(a)) {
                            hasMutual3 = true;
                        }
                    }
                }
            }

            // 난이도 4, 5일때만 Mutual 3을 검증하여 통과시킨다 (밀집도)
            if (difficulty > 3 && !hasMutual3) {
                continue; 
            }

            success = true;
            finalGrid = grid.map(row => row.map(v => v !== -1));
            const availableColors = [...COLORS].sort(() => Math.random() - 0.5);
            
            finalPieces = piecesPlaced.map((p, idx) => ({
                id: `ubongo-piece-${Date.now()}-${idx}`,
                defId: p.id,
                shape: p.shape,
                color: availableColors[idx],
                location: 'waiting',
                x: 0, y: 0
            }));
            break;
        }
    }

    if (success) return { grid: finalGrid, pieces: finalPieces };
    return null;
};

const getInitialTarget = () => Array.from({length: 10}, (_, y) => 
  Array.from({length: 10}, (_, x) => y >= 2 && y < 8 && x >= 2 && x < 8)
);

const cn = (...classes: (string | boolean | undefined | null)[]) => classes.filter(Boolean).join(' ');

// Core Type Definitions
interface ToolboxPiece {
  id: string;
  type: string;
  shape: Point[];
  color: string;
}

interface PlacedPiece {
  id: string;
  defId: string;
  shape: Point[];
  color: string;
  x: number;
  y: number;
  location: 'grid' | 'waiting';
}

const getAvailableColor = (placedPieces: PlacedPiece[]) => {
  const usedColors = new Set(placedPieces.map(p => p.color));
  const availableColors = COLORS.filter(c => !usedColors.has(c));
  const pool = availableColors.length > 0 ? availableColors : COLORS;
  return pool[Math.floor(Math.random() * pool.length)];
};

type XY = { x: number; y: number };

interface DragContext {
  piece: PlacedPiece;
  isNew: boolean;
  startX: number; 
  startY: number; 
  originLocation: 'grid' | 'waiting';
  offsetX: number;
  offsetY: number;
}

// Components
const PieceRenderer = ({ shape, color, cellSize, className }: { shape: Point[], color: string, cellSize: number, className?: string }) => {
  const width = Math.max(...shape.map(p => p.x)) + 1;
  const height = Math.max(...shape.map(p => p.y)) + 1;

  return (
    <svg width={width * cellSize} height={height * cellSize} className={cn("block pointer-events-none", className)}>
      {shape.map((pt, i) => (
        <rect 
          key={i}
          x={pt.x * cellSize} 
          y={pt.y * cellSize} 
          width={cellSize} 
          height={cellSize} 
          fill={color} 
          stroke="rgba(0,0,0,0.15)"
          strokeWidth="2"
          rx={Math.max(2, cellSize * 0.1)}
        />
      ))}
    </svg>
  );
};

export default function App() {
  const [selectedTypes, setSelectedTypes] = useState<string[]>(['pentomino']);
  const [appMode, setAppMode] = useState<'FREE' | 'UBONGO'>('FREE');
  const [drawMode, setDrawMode] = useState<'DRAW' | 'PLAY'>('DRAW');
  const [ubongoDifficulty, setUbongoDifficulty] = useState<3 | 4 | 5>(3);
  const [targetGrid, setTargetGrid] = useState<boolean[][]>(getInitialTarget());
  const [placedPieces, setPlacedPieces] = useState<PlacedPiece[]>([]);
  const [toolboxPieces, setToolboxPieces] = useState<ToolboxPiece[]>([]);
  const [cellSize, setCellSize] = useState(40);

  const gridRef = useRef<HTMLDivElement>(null);
  const waitingRef = useRef<HTMLDivElement>(null);

  // Responsive Grid Setup
  useEffect(() => {
     const updateSize = () => {
        if (gridRef.current) {
           setCellSize(gridRef.current.clientWidth / 10);
        }
     };
     
     if (!gridRef.current) return;
     const observer = new ResizeObserver(updateSize);
     observer.observe(gridRef.current);
     
     updateSize(); // Initial call
     
     return () => observer.disconnect();
  }, []);

  // Update Toolbox content
  useEffect(() => {
    const newToolbox: ToolboxPiece[] = [];
    // 보관함에 렌더링될 조각들의 색상 중복을 최소화하기 위해 셔플된 컬러 배열 사용
    const shuffledColors = [...COLORS].sort(() => Math.random() - 0.5);
    let colorIdx = 0;
    
    POLY_TYPES.forEach(pt => {
      if (selectedTypes.includes(pt.id)) {
        const typeShapes = SHAPES[pt.id as keyof typeof SHAPES];
        Object.entries(typeShapes).forEach(([name, ascii]) => {
          newToolbox.push({
            id: `${pt.id}-${name}`,
            type: pt.id,
            shape: parseShape(ascii),
            color: shuffledColors[colorIdx % shuffledColors.length]
          });
          colorIdx++;
        });
      }
    });
    setToolboxPieces(newToolbox);
  }, [selectedTypes]);

  // Handle Target Drawing Mode Mouse Activity
  const drawStateRef = useRef<{ isDrawing: boolean, toggleTo: boolean } | null>(null);

  const handleGridCellPointerDown = (x: number, y: number, e: React.PointerEvent) => {
     if (appMode !== 'FREE' || drawMode !== 'DRAW') return;
     if (e.pointerType === 'mouse' && e.button !== 0) return;
     
     e.preventDefault(); 
     e.stopPropagation();
     
     (e.target as HTMLElement).releasePointerCapture(e.pointerId);

     const targetVal = !targetGrid[y][x];
     drawStateRef.current = { isDrawing: true, toggleTo: targetVal };
     setTargetGrid(prev => {
        const next = prev.map(r => [...r]);
        next[y][x] = targetVal;
        return next;
     });
  };

  useEffect(() => {
     const handleGlobalMove = (e: PointerEvent) => {
        if (appMode === 'FREE' && drawMode === 'DRAW' && drawStateRef.current) {
           const currentToggleTo = drawStateRef.current.toggleTo;
           const el = document.elementFromPoint(e.clientX, e.clientY);
           if (el && el.hasAttribute('data-grid-x')) {
              const x = parseInt(el.getAttribute('data-grid-x')!);
              const y = parseInt(el.getAttribute('data-grid-y')!);
              setTargetGrid(prev => {
                 if (prev[y][x] === currentToggleTo) return prev;
                 const next = prev.map(r => [...r]);
                 next[y][x] = currentToggleTo;
                 return next;
              });
           }
        }
     };
     const handleGlobalUp = () => { drawStateRef.current = null; };
     
     // Bind globally to let user drag out of grid and back in
     window.addEventListener('pointermove', handleGlobalMove);
     window.addEventListener('pointerup', handleGlobalUp);
     window.addEventListener('pointercancel', handleGlobalUp);
     return () => {
         window.removeEventListener('pointermove', handleGlobalMove);
         window.removeEventListener('pointerup', handleGlobalUp);
         window.removeEventListener('pointercancel', handleGlobalUp);
     };
  }, [appMode, drawMode]);

  // Pointer Events & Native Drag Engine Strategy
  const [dragContext, setDragContext] = useState<DragContext | null>(null);
  const [mousePos, setMousePos] = useState<XY | null>(null);
  const [pendingToolboxDrag, setPendingToolboxDrag] = useState<{ pt: ToolboxPiece, startX: number, startY: number, target: HTMLElement } | null>(null);
  const [pendingPlacedDrag, setPendingPlacedDrag] = useState<{ p: PlacedPiece, startX: number, startY: number, target: HTMLElement } | null>(null);
  
  // Real-time refs map for Drag evaluation pointerups, preventing missing state in stale closures
  const stateRef = useRef({ placedPieces, targetGrid, appMode });
  stateRef.current = { placedPieces, targetGrid, appMode };

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
       if (pendingToolboxDrag) {
          const dist = Math.hypot(e.clientX - pendingToolboxDrag.startX, e.clientY - pendingToolboxDrag.startY);
          if (dist > 5) {
             const rect = pendingToolboxDrag.target.getBoundingClientRect();
             const newColor = getAvailableColor(stateRef.current.placedPieces);
             setDragContext({
                piece: {
                   id: `placed-${Date.now()}-${Math.random()}`,
                   defId: pendingToolboxDrag.pt.id,
                   shape: pendingToolboxDrag.pt.shape,
                   color: newColor,
                   x: 0, y: 0, location: 'waiting' // conceptually waiting until drop resolves
                },
                isNew: true,
                startX: 0, startY: 0,
                originLocation: 'waiting',
                offsetX: pendingToolboxDrag.startX - rect.left,
                offsetY: pendingToolboxDrag.startY - rect.top
             });
             setPendingToolboxDrag(null);
             setMousePos({ x: e.clientX, y: e.clientY });
          }
       } else if (pendingPlacedDrag) {
          const dist = Math.hypot(e.clientX - pendingPlacedDrag.startX, e.clientY - pendingPlacedDrag.startY);
          if (dist > 5) {
             const rect = pendingPlacedDrag.target.getBoundingClientRect();
             const p = pendingPlacedDrag.p;
             
             // Extract it out from the grid into drag context
             setPlacedPieces(prev => prev.filter(x => x.id !== p.id));
             
             setDragContext({
                piece: p,
                isNew: false,
                startX: p.x, startY: p.y,
                originLocation: p.location,
                offsetX: pendingPlacedDrag.startX - rect.left,
                offsetY: pendingPlacedDrag.startY - rect.top
             });
             setPendingPlacedDrag(null);
             setMousePos({ x: e.clientX, y: e.clientY });
          }
       } else if (dragContext) {
          setMousePos({ x: e.clientX, y: e.clientY });
       }
    };
    
    const handleUp = (e: PointerEvent) => {
       if (pendingToolboxDrag) {
          // If < 5px dragged, it is a click. Spawn to waiting area immediately
          setPlacedPieces(prev => {
             const newColor = getAvailableColor(prev);
             return [...prev, {
                  id: `placed-${Date.now()}-${Math.random()}`,
                  defId: pendingToolboxDrag.pt.id,
                  shape: pendingToolboxDrag.pt.shape,
                  color: newColor,
                  x: 0, y: 0, location: 'waiting'
             }];
          });
          setPendingToolboxDrag(null);
       } else if (pendingPlacedDrag) {
          // Simple click - do nothing, maybe it triggered focus / hover
          setPendingPlacedDrag(null);
       } else if (dragContext) {
          evalDrop(e.clientX, e.clientY, dragContext);
       }
    };

    // 추가: 드래그 중 마우스 우클릭 시 회전 지원
    const handleContextMenu = (e: MouseEvent) => {
        if (dragContext) {
            e.preventDefault();
            setDragContext(prev => prev ? { ...prev, piece: { ...prev.piece, shape: rotateShape(prev.piece.shape) } } : prev);
        }
    };
  
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    window.addEventListener('contextmenu', handleContextMenu);
    return () => {
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
        window.removeEventListener('pointercancel', handleUp);
        window.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [pendingToolboxDrag, pendingPlacedDrag, dragContext, cellSize]);

  const evalDrop = (cx: number, cy: number, ctx: DragContext) => {
    const gridRect = gridRef.current?.getBoundingClientRect();
    const waitRect = waitingRef.current?.getBoundingClientRect();
    const { placedPieces, targetGrid, appMode } = stateRef.current;
    
    const isInside = (x: number, y: number, r?: DOMRect) => r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  
    let dropped = false;
  
    // 1. Drop on Grid
    if (isInside(cx, cy, gridRect) && gridRect) {
        const dropBoxLeft = cx - ctx.offsetX;
        const dropBoxTop = cy - ctx.offsetY;
        const gridX = Math.round((dropBoxLeft - gridRect.left) / cellSize);
        const gridY = Math.round((dropBoxTop - gridRect.top) / cellSize);
        
        let overlap = false;
        if (appMode === 'UBONGO') {
            const pieceCoords = ctx.piece.shape.map(pt => ({ x: gridX + pt.x, y: gridY + pt.y }));
            const gridPieces = placedPieces.filter(p => p.id !== ctx.piece.id && p.location === 'grid');
            for (const other of gridPieces) {
                const otherCoords = other.shape.map(pt => ({ x: other.x + pt.x, y: other.y + pt.y }));
                for (const pct of pieceCoords) {
                    if (otherCoords.some(oct => oct.x === pct.x && oct.y === pct.y)) {
                        overlap = true;
                        break;
                    }
                }
                if (overlap) break;
            }
        }
        
        if (!overlap) {
            setPlacedPieces(prev => [...prev.filter(p => p.id !== ctx.piece.id), { ...ctx.piece, location: 'grid', x: gridX, y: gridY }]);
            dropped = true;
        }
    }
  
    // 2. Drop on Waiting Area
    if (!dropped && isInside(cx, cy, waitRect)) {
        setPlacedPieces(prev => [...prev.filter(p => p.id !== ctx.piece.id), { ...ctx.piece, location: 'waiting' }]);
        dropped = true;
    }
  
    // 3. Extraneous drop handling / cancellation
    if (!dropped) {
        if (!ctx.isNew) {
            // Restore origin state
            setPlacedPieces(prev => [...prev.filter(p => p.id !== ctx.piece.id), { ...ctx.piece, location: ctx.originLocation, x: ctx.startX, y: ctx.startY }]);
        }
        // Implicitly drops/deletes if ctx.isNew is true
    }
  
    setDragContext(null);
    setMousePos(null);
  };

  const handleToolboxPointerDown = (e: React.PointerEvent, pt: ToolboxPiece) => {
    // Only intercept primary clicks
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    setPendingToolboxDrag({ pt, startX: e.clientX, startY: e.clientY, target: e.currentTarget as HTMLElement });
  };

  const startDragFromPlaced = (e: React.PointerEvent, p: PlacedPiece) => {
    e.stopPropagation();
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    setPendingPlacedDrag({ p, startX: e.clientX, startY: e.clientY, target: e.currentTarget as HTMLElement });
  };

  // Mutator actions
  const toggleType = (id: string) => {
    setSelectedTypes(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const handleGenerateUbongo = (diff: 3 | 4 | 5) => {
      setUbongoDifficulty(diff);
      const puzzle = generateUbongoPuzzleData(diff);
      if (puzzle) {
          setTargetGrid(puzzle.grid);
          setPlacedPieces(puzzle.pieces);
      } else {
          alert('퍼즐 생성에 실패했습니다. 다시 시도해주세요.');
      }
  };

  const handleReset = () => {
     if (appMode === 'UBONGO') {
        setPlacedPieces(prev => prev.map(p => {
             const [type, name] = p.defId.split('-');
             let originalShape = p.shape;
             if (SHAPES[type as keyof typeof SHAPES] && (SHAPES[type as keyof typeof SHAPES] as any)[name]) {
                 originalShape = parseShape((SHAPES[type as keyof typeof SHAPES] as any)[name]);
             }
             return { ...p, location: 'waiting', x: 0, y: 0, shape: originalShape };
        }));
     } else {
        setPlacedPieces([]);
     }
  };

  const attemptTransformPlacedPiece = (id: string, transformFn: (shape: Point[]) => Point[], e: React.MouseEvent) => {
    e.stopPropagation();
    setPlacedPieces(prev => {
      const piece = prev.find(p => p.id === id);
      if (!piece) return prev;
      
      const newShape = transformFn(piece.shape);

      if (piece.location === 'grid') {
          // 1. Out of Bounds Check
          let outOfBounds = false;
          const pieceCoords = newShape.map(pt => ({ x: piece.x + pt.x, y: piece.y + pt.y }));
          for (const pct of pieceCoords) {
              if (pct.x < 0 || pct.x >= 10 || pct.y < 0 || pct.y >= 10) {
                  outOfBounds = true;
                  break;
              }
          }
          if (outOfBounds) return prev; // 범위를 벗어나면 변환(회전/뒤집기) 무시

          // 2. Overlap Check (게임 모드일 때만 다른 조각과 겹침 불가)
          if (appMode === 'UBONGO') {
              let overlap = false;
              const gridPieces = prev.filter(p => p.id !== id && p.location === 'grid');
              for (const other of gridPieces) {
                  const otherCoords = other.shape.map(pt => ({ x: other.x + pt.x, y: other.y + pt.y }));
                  for (const pct of pieceCoords) {
                      if (otherCoords.some(oct => oct.x === pct.x && oct.y === pct.y)) {
                          overlap = true;
                          break;
                      }
                  }
                  if (overlap) break;
              }
              if (overlap) return prev; // 겹치면 변환(회전/뒤집기) 무시
          }
      }

      return prev.map(p => p.id === id ? { ...p, shape: newShape } : p);
    });
  };

  const rotatePlacedPiece = (id: string, e: React.MouseEvent) => {
    attemptTransformPlacedPiece(id, rotateShape, e);
  };

  const flipPlacedPiece = (id: string, horizon: boolean, e: React.MouseEvent) => {
    attemptTransformPlacedPiece(id, (s) => flipShape(s, horizon), e);
  };

  const rotateToolboxPiece = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setToolboxPieces(prev => prev.map(p => p.id === id ? { ...p, shape: rotateShape(p.shape) } : p));
  };

  const flipToolboxPiece = (id: string, horizon: boolean, e: React.MouseEvent) => {
    e.stopPropagation();
    setToolboxPieces(prev => prev.map(p => p.id === id ? { ...p, shape: flipShape(p.shape, horizon) } : p));
  };

  const deletePlacedPiece = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setPlacedPieces(prev => prev.filter(p => p.id !== id));
  };

  // Game Progress Validation
  const isWin = useMemo(() => {
    if (appMode === 'FREE' && drawMode === 'DRAW') return false; 
    
    let targetAreaCount = 0;
    targetGrid.forEach(row => row.forEach(cell => { if (cell) targetAreaCount++; }));
    if (targetAreaCount === 0) return false;

    const gridPieces = placedPieces.filter(p => p.location === 'grid');
    let placedValidCellsCount = 0;
    const filled = Array.from({length: 10}, () => Array(10).fill(false));

    for (const piece of gridPieces) {
        for (const pt of piece.shape) {
            const absX = piece.x + pt.x;
            const absY = piece.y + pt.y;
            
            // If any cell of a piece is out of bounds, not valid
            if (absX < 0 || absX >= 10 || absY < 0 || absY >= 10) return false;
            // If placed outside target area
            if (!targetGrid[absY][absX]) return false;
            // If overlapping another piece
            if (filled[absY][absX]) return false;
            
            filled[absY][absX] = true;
            placedValidCellsCount++;
        }
    }

    return targetAreaCount === placedValidCellsCount;
  }, [targetGrid, placedPieces, appMode, drawMode]);


  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-800 tracking-tight">
      {/* Top Banner Control Panel */}
// App.tsx
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex flex-wrap items-center justify-between gap-4 shadow-sm z-30 relative select-none flex-col lg:flex-row">
         <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
            <h1 className="text-xl md:text-2xl font-black text-indigo-900 flex items-center gap-2 drop-shadow-sm min-w-max">
              <LayoutGrid className="text-indigo-600"/>
              Polyomi Logic
            </h1>
            <div className="h-6 w-px bg-gray-300 mx-2 hidden lg:block" />
            
            {/* Mode Switcher */}
            <div className="flex bg-slate-100 p-1 rounded-xl shadow-inner border border-slate-200 w-full md:w-auto justify-center md:justify-start">
               <button onClick={() => setAppMode('FREE')} className={cn("flex-1 md:flex-none px-4 py-2 rounded-lg text-sm font-bold transition-all", appMode === 'FREE' ? "bg-white text-indigo-600 shadow-sm" : "text-gray-500 hover:text-gray-700")}>자유 모드</button>
               <button onClick={() => { setAppMode('UBONGO'); handleGenerateUbongo(ubongoDifficulty); }} className={cn("flex-1 md:flex-none px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-1.5", appMode === 'UBONGO' ? "bg-white text-emerald-600 shadow-sm" : "text-gray-500 hover:text-gray-700")}><Brain size={16}/> 게임 모드</button>
            </div>
         </div>
    
         <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto justify-center lg:justify-end">
            {appMode === 'FREE' ? (
                <>
                    <div className="flex gap-1.5 flex-wrap justify-center">
                       {POLY_TYPES.map(pt => (
                          <button 
                            key={pt.id}
                            onClick={() => toggleType(pt.id)}
                            className={cn(
                               "px-3 py-1.5 text-xs md:text-sm font-bold border rounded-full transition-all flex items-center gap-1",
                               selectedTypes.includes(pt.id) ? "bg-indigo-100 border-indigo-300 text-indigo-800 shadow-sm" : "bg-white border-gray-200 text-gray-500 hover:bg-gray-100"
                            )}
                          >
                            {pt.label.split(' ')[0]}
                          </button>
                       ))}
                    </div>
                    <div className="bg-slate-100 p-1 rounded-[14px] flex gap-1 shadow-inner overflow-hidden border border-slate-200 min-w-max">
                       <button onClick={() => setDrawMode('DRAW')} className={cn("px-4 py-2 rounded-xl text-sm font-extrabold flex items-center gap-2 transition-all", drawMode === 'DRAW' ? "bg-white shadow-sm text-indigo-700" : "text-gray-400 hover:text-gray-600")}>
                          <PenTool size={16}/> 그리기
                       </button>
                       <button onClick={() => setDrawMode('PLAY')} className={cn("px-4 py-2 rounded-xl text-sm font-extrabold flex items-center gap-2 transition-all", drawMode === 'PLAY' ? "bg-white shadow-sm text-emerald-600" : "text-gray-400 hover:text-gray-600")}>
                          <Hand size={16} /> 맞추기
                       </button>
                    </div>
                </>
            ) : (
                <div className="flex gap-2 p-1 bg-slate-50 border border-slate-200 rounded-[14px] shadow-sm items-center flex-wrap justify-center w-full md:w-auto">
                    <span className="text-xs font-black text-slate-400 px-2 tracking-widest hidden sm:inline-block">난이도</span>
                    <button onClick={() => handleGenerateUbongo(3)} className={cn("px-3 py-1.5 rounded-lg text-sm font-bold transition-all whitespace-nowrap", ubongoDifficulty === 3 ? "bg-emerald-100 text-emerald-700 shadow-sm border border-emerald-200" : "text-slate-500 hover:bg-slate-100 border border-transparent")}>쉬움 (3조각)</button>
                    <button onClick={() => handleGenerateUbongo(4)} className={cn("px-3 py-1.5 rounded-lg text-sm font-bold transition-all whitespace-nowrap", ubongoDifficulty === 4 ? "bg-blue-100 text-blue-700 shadow-sm border border-blue-200" : "text-slate-500 hover:bg-slate-100 border border-transparent")}>보통 (4조각)</button>
                    <button onClick={() => handleGenerateUbongo(5)} className={cn("px-3 py-1.5 rounded-lg text-sm font-bold transition-all whitespace-nowrap", ubongoDifficulty === 5 ? "bg-purple-100 text-purple-700 shadow-sm border border-purple-200" : "text-slate-500 hover:bg-slate-100 border border-transparent")}>어려움 (5조각)</button>
                </div>
            )}
            
            <div className="flex gap-2 w-full sm:w-auto">
                {appMode === 'UBONGO' && (
                    <button onClick={() => handleGenerateUbongo(ubongoDifficulty)} className="flex-1 sm:flex-none px-4 py-2 bg-indigo-600 border border-indigo-700 hover:bg-indigo-700 text-white font-bold rounded-[14px] shadow-sm transition-all focus:ring-4 focus:ring-indigo-200 whitespace-nowrap">
                       새 문제 생성
                    </button>
                )}
                <button onClick={handleReset} className="flex-1 sm:flex-none px-4 py-2 bg-white border border-gray-200 rounded-[14px] hover:bg-red-50 hover:border-red-200 hover:text-red-600 text-gray-500 font-bold transition-colors shadow-sm focus:ring-4 focus:ring-red-100 whitespace-nowrap">
                   초기화
                </button>
            </div>
         </div>
      </header>
    
      <main className="flex-1 flex flex-col sm:flex-row overflow-hidden relative">
         {/* Left Toolbox */}
         {appMode === 'FREE' && (
         <aside className="w-full h-56 sm:h-auto sm:w-64 md:w-80 flex-shrink-0 bg-white border-b sm:border-b-0 sm:border-r border-gray-200 shadow-[4px_0_12px_rgba(0,0,0,0.02)] overflow-y-auto p-4 sm:p-5 flex flex-col z-20 select-none">
            <div className="mb-4 sm:mb-6 flex-shrink-0">
               <h2 className="text-sm font-black text-gray-400 uppercase tracking-widest mb-2 sm:mb-3 flex items-center gap-2"><LayoutGrid size={16}/> 도구함</h2>
               <p className="text-xs text-gray-500 leading-relaxed bg-slate-50 p-2 sm:p-3 rounded-xl border border-slate-100">조각을 클릭하여 보관함으로 복사하거나, 캔버스로 직접 드래그하세요.</p>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-2 gap-2 sm:gap-3">
               {toolboxPieces.map(pt => (
                  <div key={pt.id} className="relative group bg-slate-50 opacity-90 hover:opacity-100 p-4 rounded-3xl border border-slate-200 hover:border-indigo-300 hover:shadow-md hover:shadow-indigo-100/50 transition-all flex flex-col items-center justify-center min-h-[90px]">
                     <div 
                       onPointerDown={(e) => handleToolboxPointerDown(e, pt)} 
                       onContextMenu={(e) => { e.preventDefault(); rotateToolboxPiece(pt.id, e as unknown as React.MouseEvent); }}
                       className="cursor-pointer touch-none hover:scale-110 active:scale-95 transition-transform origin-center"
                       style={{ touchAction: 'none' }}
                     >
                         <PieceRenderer shape={pt.shape} color={pt.color} cellSize={22} className="drop-shadow-sm" />
                     </div>
                     <div className="absolute top-2 right-2 opacity-10 flex flex-col gap-1 group-hover:opacity-100 transition-opacity">
                        <button onClick={(e) => rotateToolboxPiece(pt.id, e)} className="p-1 bg-white border border-slate-200 shadow-sm rounded-lg text-slate-500 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200 transition-colors"><RotateCw size={12}/></button>
                        <button onClick={(e) => flipToolboxPiece(pt.id, true, e)} className="p-1 bg-white border border-slate-200 shadow-sm rounded-lg text-slate-500 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200 transition-colors"><FlipHorizontal size={12}/></button>
                     </div>
                  </div>
               ))}
            </div>
         </aside>
         )}
    
         {/* Main Render Area */}
         <section className={cn("overflow-y-auto p-4 md:p-10 flex flex-col items-center justify-start bg-[radial-gradient(#e2e8f0_1px,transparent_1px)] [background-size:24px_24px]", appMode === 'FREE' ? "flex-1" : "flex-1 w-full")}>
            {appMode === 'FREE' && drawMode === 'DRAW' && (
               <div className="animate-bounce mb-6 font-extrabold text-indigo-600 bg-white shadow-xl shadow-indigo-100/50 py-3 px-8 rounded-full border border-indigo-200 select-none drop-shadow-sm flex items-center gap-2">
                  <PenTool size={18}/> 그리드를 클릭/드래그하여 퍼즐판을 칠하세요!
               </div>
            )}
            {appMode === 'FREE' && drawMode === 'PLAY' && (
               <div className="mb-6 font-extrabold text-slate-500 bg-white shadow-sm py-2 px-6 rounded-full border border-slate-200 select-none flex items-center gap-2">
                  <LayoutGrid size={18}/> 흰색 영역을 조각으로 모두 채우세요
               </div>
            )}
            {appMode === 'UBONGO' && (
               <div className="mb-4 font-extrabold text-emerald-700 bg-emerald-50 shadow-sm py-2 px-6 rounded-full border border-emerald-200 select-none flex items-center gap-2">
                  <Brain size={18}/> 제공된 조각들을 사용해 빈 테두리를 정확히 채워보세요!
               </div>
            )}
            
            <div className={cn("relative isolate shadow-2xl rounded-2xl p-3 border", appMode === 'FREE' && drawMode === 'DRAW' ? "bg-white border-indigo-100 shadow-indigo-100/40" : "bg-[#1e293b] border-[#0f172a] shadow-slate-900/20")}>
               <div 
                  ref={gridRef}
                  className={cn("relative grid grid-cols-10 grid-rows-10 border-[4px] rounded-lg overflow-hidden touch-none",
                  appMode === 'FREE' && drawMode === 'DRAW' ? "border-indigo-400 bg-slate-50" : "border-slate-900 bg-slate-800"
                  )}
                  style={{ width: '100%', maxWidth: '540px', minWidth: '320px', aspectRatio: '1/1', touchAction: 'none' }}
               >
                 {targetGrid.map((row, y) => row.map((isTarget, x) => (
                    <div 
                      key={`${x}-${y}`} 
                      data-grid-x={x}
                      data-grid-y={y}
                      onPointerDown={(e) => handleGridCellPointerDown(x, y, e)}
                      className={cn(
                        "transition-all duration-200 box-border relative", 
                        (appMode === 'FREE' && drawMode === 'DRAW') ? (
                           isTarget ? "bg-indigo-400 border-[1.5px] border-indigo-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.1)] z-10 scale-[1.02]" : "bg-white border hover:bg-indigo-50 border-slate-200 cursor-crosshair"
                        ) : (
                           isTarget 
                              ? cn(
                                  "bg-[#f8f9fa] shadow-[inset_0_2px_4px_rgba(0,0,0,0.1)] z-10",
                                  (y === 0 || !targetGrid[y-1][x]) ? "border-t-4 border-t-slate-900" : "border-t border-t-slate-300",
                                  (x === 9 || !row[x+1])           ? "border-r-4 border-r-slate-900" : "border-r border-r-slate-300",
                                  (y === 9 || !targetGrid[y+1][x]) ? "border-b-4 border-b-slate-900" : "border-b border-b-slate-300",
                                  (x === 0 || !row[x-1])           ? "border-l-4 border-l-slate-900" : "border-l border-l-slate-300"
                                )
                              : "bg-slate-800 border-[0.5px] border-slate-800/20"
                        )
                      )}
                    />
                 )))}
                 
                 {/* Valid grid pieces attached seamlessly inside container bounds */}
                 {placedPieces.filter(p => p.location === 'grid').map(p => (
                     <div
                       key={p.id}
                       className="group absolute z-[100] transition-transform hover:z-[200] origin-center saturate-110"
                       style={{ left: p.x * cellSize, top: p.y * cellSize, touchAction: 'none' }}
                     >
                        <div 
                          className="cursor-pointer touch-none drop-shadow-md hover:drop-shadow-xl hover:scale-105 transition-transform outline-none"
                          onPointerDown={(e) => startDragFromPlaced(e, p)}
                          onContextMenu={(e) => { e.preventDefault(); rotatePlacedPiece(p.id, e as unknown as React.MouseEvent); }}
                          tabIndex={0}
                          style={{ touchAction: 'none' }}
                        >
                           <PieceRenderer shape={p.shape} color={p.color} cellSize={cellSize} />
                        </div>
                        
                        {/* Hover Tools for pieces on the grid */}
                        <div 
                           className="absolute -top-14 left-1/2 -translate-x-1/2 bg-white/95 backdrop-blur-sm p-1.5 rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.12)] border border-slate-200/80 pointer-events-none group-hover:pointer-events-auto group-focus-within:pointer-events-auto opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 transition-all flex items-center justify-center gap-1.5 z-[201] translate-y-2 group-hover:translate-y-0 group-focus-within:translate-y-0 after:content-[''] after:absolute after:-bottom-6 after:left-0 after:w-full after:h-6"
                           onPointerDown={(e) => e.stopPropagation()}
                        >
                          <button className="p-1.5 cursor-pointer hover:bg-slate-100 rounded-lg text-slate-500 hover:text-indigo-600 transition-colors focus:ring-2 focus:ring-indigo-100" onClick={(e) => rotatePlacedPiece(p.id, e)} title="회전 (90도)"><RotateCw size={16} strokeWidth={2.5}/></button>
                          <button className="p-1.5 cursor-pointer hover:bg-slate-100 rounded-lg text-slate-500 hover:text-indigo-600 transition-colors focus:ring-2 focus:ring-indigo-100" onClick={(e) => flipPlacedPiece(p.id, true, e)} title="좌우 뒤집기"><FlipHorizontal size={16} strokeWidth={2.5}/></button>
                          {appMode === 'FREE' && (
                              <>
                                  <div className="w-px h-4 bg-slate-200 mx-0.5"></div>
                                  <button className="p-1.5 cursor-pointer hover:bg-red-50 rounded-lg text-red-400 hover:text-red-500 transition-colors focus:ring-2 focus:ring-red-100" onClick={(e) => deletePlacedPiece(p.id, e)} title="삭제"><Trash2 size={16} strokeWidth={2.5}/></button>
                              </>
                          )}
                        </div>
                     </div>
                 ))}
               </div>
            </div>
    
            <div className="w-full max-w-4xl mt-12 flex flex-col items-center">
               <h3 className="text-sm font-black text-slate-500 uppercase tracking-widest flex items-center gap-2 mb-4 bg-white px-4 py-1.5 rounded-full border border-slate-200 shadow-sm select-none"><Hand size={16} className="text-indigo-500"/> {appMode === 'FREE' ? '대기 보관함' : '문제 조각 보관함'}</h3>
               <div 
                  ref={waitingRef}
                  className={cn("w-full min-h-[180px] p-8 rounded-[2rem] border-4 border-dashed bg-white shadow-sm flex flex-wrap gap-5 items-start content-start transition-all relative select-none", 
                      dragContext && dragContext.piece.location !== 'waiting' ? "border-indigo-400 bg-indigo-50 shadow-indigo-100 scale-[1.02]" : "border-slate-300 hover:border-slate-400"
                  )}
               >
                  {placedPieces.filter(p => p.location === 'waiting').length === 0 && !dragContext && <span className="absolute inset-0 flex items-center justify-center text-slate-400 font-medium text-lg tracking-tight mix-blend-multiply opacity-50 px-4 text-center select-none pointer-events-none">{appMode === 'FREE' ? "조각을 이곳으로 던져 보관하세요. 언제든 꺼내어 확인할 수 있습니다." : "모든 조각이 그리드 위에 있습니다! 빈틈이 없도록 맞춰보세요."}</span>}
                  
                  {placedPieces.filter(p => p.location === 'waiting').map(p => (
                      <div key={p.id} className="group flex flex-col items-center gap-3 bg-white p-4 rounded-3xl shadow-sm hover:shadow-lg border border-slate-200 hover:border-indigo-300 transition-all">
                        <div onPointerDown={(e) => startDragFromPlaced(e, p)} onContextMenu={(e) => { e.preventDefault(); rotatePlacedPiece(p.id, e as unknown as React.MouseEvent); }} className="cursor-pointer touch-none hover:rotate-2 hover:scale-110 transition-transform flex items-center justify-center p-2 min-h-[70px] drop-shadow-md hover:drop-shadow-xl saturate-150 relative z-10 w-full" style={{ touchAction: 'none' }}>
                           <PieceRenderer shape={p.shape} color={p.color} cellSize={26} />
                        </div>
                        <div className="flex gap-1.5 bg-slate-50 border border-slate-100 p-1.5 rounded-2xl">
                          <button className="p-2 hover:bg-white border-transparent hover:border-slate-200 hover:shadow-sm border rounded-[12px] text-slate-500 hover:text-indigo-600 transition-all font-semibold active:scale-95" onClick={(e) => rotatePlacedPiece(p.id, e)}><RotateCw size={15} strokeWidth={2.5}/></button>
                          <button className="p-2 hover:bg-white border-transparent hover:border-slate-200 hover:shadow-sm border rounded-[12px] text-slate-500 hover:text-indigo-600 transition-all font-semibold active:scale-95" onClick={(e) => flipPlacedPiece(p.id, true, e)}><FlipHorizontal size={15} strokeWidth={2.5}/></button>
                          {appMode === 'FREE' && (
                             <button className="p-2 hover:bg-red-50 border-transparent hover:border-red-200 rounded-[12px] text-red-400 hover:text-red-500 transition-all font-semibold active:scale-95" onClick={(e) => deletePlacedPiece(p.id, e)}><Trash2 size={15} strokeWidth={2.5}/></button>
                          )}
                        </div>
                      </div>
                  ))}
               </div>
            </div>
         </section>
      </main>

      {/* Absolutely Positioned Ghost Piece during Pointer drag */}
      {dragContext && mousePos && (
          <div 
             className="fixed pointer-events-none z-[9999] overflow-visible drop-shadow-[0_20px_40px_rgba(0,0,0,0.25)] scale-110 transition-transform opacity-95 saturate-150"
             style={{ left: mousePos.x - dragContext.offsetX, top: mousePos.y - dragContext.offsetY }}
          >
             <PieceRenderer shape={dragContext.piece.shape} color={dragContext.piece.color} cellSize={cellSize} />
          </div>
      )}

      {/* Win Modal Overlay */}
      {isWin && (
        <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-[1000] backdrop-blur-md animate-in fade-in duration-700" style={{ animationTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)' }}>
          <div className="bg-white p-12 rounded-[2.5rem] shadow-2xl shadow-emerald-900/20 flex flex-col items-center transform transition-all duration-700 scale-in-95 data-[state=open]:scale-100 max-w-lg w-[90%] border-t-8 border-t-emerald-400">
            <div className="w-24 h-24 mb-8 bg-gradient-to-tr from-emerald-400 to-green-500 rounded-full flex items-center justify-center shadow-lg shadow-emerald-200 ring-8 ring-emerald-50">
               <span className="text-white font-black text-5xl tracking-widest drop-shadow-md transform translate-x-1">✓</span>
            </div>
            <h2 className="text-4xl md:text-5xl font-black text-slate-800 mb-4 tracking-tight drop-shadow-sm text-center">미션 성공!</h2>
            <p className="text-lg md:text-xl font-bold text-emerald-700 bg-emerald-50 rounded-2xl p-4 mb-10 w-full text-center border border-emerald-100">조각들이 목표판에 빈틈없이 맞춰졌습니다!</p>
            <div className="flex flex-col sm:flex-row gap-4 w-full">
               {appMode === 'FREE' ? (
                   <>
                       <button 
                         onClick={() => { setPlacedPieces([]); setDrawMode('DRAW'); }}
                         className="flex-1 py-4 bg-white text-slate-600 font-extrabold rounded-2xl hover:bg-slate-50 transition-colors flex justify-center items-center gap-2 border-2 border-slate-200 hover:border-slate-300"
                       >
                         <PenTool size={20}/> 새 목표판 제작
                       </button>
                       <button 
                         onClick={() => setPlacedPieces([])}
                         className="flex-1 py-4 bg-gradient-to-b from-emerald-500 to-green-600 text-white font-extrabold rounded-2xl shadow-lg shadow-emerald-200 hover:brightness-110 transition-all flex justify-center items-center gap-2 border border-emerald-400"
                       >
                         <RotateCcw size={20}/> 다시 맞추기
                       </button>
                   </>
               ) : (
                   <>
                       <button 
                         onClick={() => handleGenerateUbongo(ubongoDifficulty)}
                         className="flex-1 py-4 bg-gradient-to-b from-indigo-500 to-indigo-600 text-white font-extrabold rounded-2xl shadow-lg shadow-indigo-200 hover:brightness-110 transition-all flex justify-center items-center gap-2 border border-indigo-400"
                       >
                         <Plus size={20}/> 새 문제 도전
                       </button>
                       <button 
                         onClick={handleReset}
                         className="flex-1 py-4 bg-white text-slate-600 font-extrabold rounded-2xl hover:bg-slate-50 transition-colors flex justify-center items-center gap-2 border-2 border-slate-200 hover:border-slate-300"
                       >
                         <RotateCcw size={20}/> 다시 풀기
                       </button>
                   </>
               )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

