/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Paintbrush, Pencil, Eraser, PaintBucket, Pipette, Type,
  Square, Circle, Minus, Triangle, MousePointer2, Move,
  Wind, Pointer, ArrowUp, ArrowDown, Copy, Trash2, Plus,
  Eye, EyeOff, Download, Image as ImageIcon, Check, FolderOpen, Save, Layers,
  SprayCan, Crop, FlipHorizontal, FlipVertical, RotateCw,
  Grid3x3, Keyboard, Sunset, CircleDot, Mountain
} from "lucide-react";

// --- Types & Constants & Helpers ---
const MAX_HISTORY = 30;
const SWATCHES = [
  "#000000", "#ffffff", "#808080", "#c0c0c0", "#800000", "#ff0000", "#ff8040",
  "#ff8000", "#ffff00", "#00ff00", "#008000", "#00ffff", "#0000ff", "#800080",
  "#ff00ff", "#804000", "#ff80ff", "#e8ff47", "#47ffe8", "#ff4757",
  "#2f3542", "#57606f", "#eccc68", "#ffa502", "#ff6b81", "#70a1ff",
  "#7bed9f", "#a29bfe", "#fd79a8", "#00b894",
];
const btnClass = "h-8 px-3.5 bg-white/5 border border-white/10 rounded-xl text-white/80 font-sans text-xs font-semibold cursor-pointer whitespace-nowrap transition-all duration-150 flex items-center gap-1.5 hover:bg-white/10 hover:text-white";
const btnAccentClass = "h-8 px-3.5 bg-lime-400 text-black font-bold rounded-xl font-sans text-xs cursor-pointer whitespace-nowrap transition-all duration-150 flex items-center gap-1.5 hover:bg-lime-300";
const IconTools = {
  brush: Paintbrush, pencil: Pencil, eraser: Eraser, fill: PaintBucket,
  eyedropper: Pipette, text: Type, rect: Square, ellipse: Circle,
  line: Minus, triangle: Triangle, select: MousePointer2, move: Move,
  blur: Wind, smudge: Pointer, spray: SprayCan
};

const hexToRgba = (hex: string, alpha: number) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
};

const hexToRgbaArr = (hex: string, alpha: number) => {
  return [parseInt(hex.slice(1,3), 16), parseInt(hex.slice(3,5), 16), parseInt(hex.slice(5,7), 16), Math.round(alpha * 255)];
};

let clipboardData: ImageData | null = null;

// --- Main App ---
export default function App() {
  const mainCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const coordsRef = useRef<HTMLSpanElement>(null);
  const selOverlayRef = useRef<HTMLDivElement>(null);

  const [isOnline, setIsOnline] = useState(navigator.onLine);
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const [, setUiTick] = useState(0);
  const forceUpdate = useCallback(() => setUiTick(t => t + 1), []);

  const engine = useRef({
    canvasW: 800, canvasH: 600,
    layers: [] as { id: number, canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, name: string, visible: boolean, opacity: number }[],
    layerCounter: 1, history: [] as { snapshots: ImageData[], activeLayerIndex: number }[], historyIndex: -1,
    activeLayerIndex: 0, isDrawing: false, startX: 0, startY: 0, lastX: 0, lastY: 0,
    snapshotData: null as ImageData | null, selActive: false, selX: 0, selY: 0, selW: 0, selH: 0, selData: null as ImageData | null,
    moveStartPos: null as { x: number, y: number } | null, moveLayerSnapshot: null as ImageData | null,
    // state mirroring React for rapid sync without re-renders
    currentTool: "brush", fgColor: "#000000", bgColor: "#ffffff",
    brushSize: 10, brushOpacity: 1, brushHardness: 0.8, blendMode: "source-over" as GlobalCompositeOperation,
    shapeFilled: true, fontSize: 24, fontBold: false, zoom: 1,
    adjFilters: { brightness: 0, contrast: 0, saturation: 0, hue: 0, blur: 0 }
  }).current;

  // Dialogs
  const [showExport, setShowExport] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showGrid, setShowGrid] = useState(false);
  const [expFormat, setExpFormat] = useState("png");
  const [expName, setExpName] = useState("pixelforge-export");
  const [expQuality, setExpQuality] = useState(0.92);
  const [newW, setNewW] = useState(800);
  const [newH, setNewH] = useState(600);
  const [newBg, setNewBg] = useState("white");
  const [isDraggingFile, setIsDraggingFile] = useState(false);

  const getActiveCtx = () => engine.layers[engine.activeLayerIndex]?.ctx || null;

  const updateThumbnails = () => {
    engine.layers.forEach((l) => {
      const thumb = document.getElementById(`thumb-${l.id}`) as HTMLCanvasElement;
      if (thumb) {
        const tctx = thumb.getContext("2d");
        tctx?.clearRect(0, 0, 56, 40);
        tctx?.drawImage(l.canvas, 0, 0, 56, 40);
      }
    });
  };

  const flattenToMain = useCallback(() => {
    const ctx = mainCanvasRef.current?.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.clearRect(0, 0, engine.canvasW, engine.canvasH);
    for (let i = engine.layers.length - 1; i >= 0; i--) {
      const l = engine.layers[i];
      if (!l.visible) continue;
      ctx.globalAlpha = l.opacity;
      ctx.drawImage(l.canvas, 0, 0);
    }
    ctx.globalAlpha = 1;
  }, [engine]);

  const saveHistory = useCallback(() => {
    const snapshots = engine.layers.map(l => l.ctx.getImageData(0, 0, engine.canvasW, engine.canvasH));
    engine.history = engine.history.slice(0, engine.historyIndex + 1);
    engine.history.push({ snapshots, activeLayerIndex: engine.activeLayerIndex });
    if (engine.history.length > MAX_HISTORY) engine.history.shift();
    engine.historyIndex = engine.history.length - 1;
    forceUpdate();
  }, [engine, forceUpdate]);

  const addLayer = useCallback((name?: string) => {
    const c = document.createElement("canvas");
    c.width = engine.canvasW; c.height = engine.canvasH;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    const id = Date.now() + Math.random();
    const layer = { id, canvas: c, ctx, name: name || `Layer ${engine.layerCounter++}`, visible: true, opacity: 1 };
    engine.layers.splice(engine.activeLayerIndex, 0, layer);
    forceUpdate(); flattenToMain(); setTimeout(updateThumbnails, 0);
  }, [engine, forceUpdate, flattenToMain]);

  const resetZoom = useCallback(() => {
    if (!wrapperRef.current) return;
    const scaleX = (wrapperRef.current.clientWidth - 40) / engine.canvasW;
    const scaleY = (wrapperRef.current.clientHeight - 40) / engine.canvasH;
    engine.zoom = Math.min(scaleX, scaleY, 1);
    forceUpdate();
  }, [engine, forceUpdate]);

  const initDoc = useCallback((w: number, h: number, bg: string) => {
    engine.canvasW = w; engine.canvasH = h;
    engine.layers = []; engine.layerCounter = 1; engine.activeLayerIndex = 0;
    addLayer("Background");
    saveHistory();
    const lc = engine.layers[0].ctx;
    if (bg === "white") { lc.fillStyle = "#ffffff"; lc.fillRect(0, 0, w, h); }
    else if (bg === "black") { lc.fillStyle = "#000000"; lc.fillRect(0, 0, w, h); }
    setTimeout(resetZoom, 50);
  }, [engine, addLayer, saveHistory, resetZoom]);

  useEffect(() => { initDoc(800, 600, "white"); }, [initDoc]);

  // --- Keyboard Shortcuts & Clipboard ---
  const copySelection = useCallback(() => { if (engine.selActive && engine.selData) clipboardData = engine.selData; }, [engine]);
  const cutSelection = useCallback(() => {
    if (!engine.selActive) return;
    copySelection(); saveHistory();
    getActiveCtx()?.clearRect(engine.selX, engine.selY, engine.selW, engine.selH);
    flattenToMain();
  }, [engine, copySelection, saveHistory, flattenToMain]);
  
  const pasteSelection = useCallback(() => {
    if (!clipboardData) return;
    saveHistory();
    const lc = getActiveCtx();
    if (!lc) return;
    const tmp = document.createElement("canvas");
    tmp.width = clipboardData.width; tmp.height = clipboardData.height;
    tmp.getContext("2d")?.putImageData(clipboardData, 0, 0);
    lc.drawImage(tmp, 20, 20);
    flattenToMain();
  }, [engine, saveHistory, flattenToMain]);

  const undo = useCallback(() => {
    if (engine.historyIndex <= 0) return;
    engine.historyIndex--;
    const snap = engine.history[engine.historyIndex];
    snap.snapshots.forEach((imgData, i) => { if (engine.layers[i]) engine.layers[i].ctx.putImageData(imgData, 0, 0); });
    engine.activeLayerIndex = snap.activeLayerIndex;
    forceUpdate(); flattenToMain(); setTimeout(updateThumbnails, 0);
  }, [engine, forceUpdate, flattenToMain]);

  const redo = useCallback(() => {
    if (engine.historyIndex >= engine.history.length - 1) return;
    engine.historyIndex++;
    const snap = engine.history[engine.historyIndex];
    snap.snapshots.forEach((imgData, i) => { if (engine.layers[i]) engine.layers[i].ctx.putImageData(imgData, 0, 0); });
    engine.activeLayerIndex = snap.activeLayerIndex;
    forceUpdate(); flattenToMain(); setTimeout(updateThumbnails, 0);
  }, [engine, forceUpdate, flattenToMain]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const key = e.key.toLowerCase();
      const map: Record<string, string> = { b: "brush", p: "pencil", e: "eraser", f: "fill", i: "eyedropper", t: "text", r: "rect", c: "ellipse", l: "line", s: "select", m: "move" };
      if (!e.ctrlKey && !e.metaKey && map[key]) {
        if (key === "s" && e.shiftKey) { engine.currentTool = "spray"; }
        else { engine.currentTool = map[key]; }
        forceUpdate(); 
      }
      
      if (key === "escape") {
        engine.selActive = false;
        if (selOverlayRef.current) selOverlayRef.current.style.display = "none";
        forceUpdate();
      }

      if (e.ctrlKey || e.metaKey) {
        if (key === "z") { e.preventDefault(); undo(); }
        if (key === "y") { e.preventDefault(); redo(); }
        if (key === "c") { e.preventDefault(); copySelection(); }
        if (key === "v") { e.preventDefault(); pasteSelection(); }
        if (key === "x") { e.preventDefault(); cutSelection(); }
        if (key === "=" || key === "+") { e.preventDefault(); engine.zoom = Math.min(engine.zoom * 1.25, 16); forceUpdate(); }
        if (key === "-") { e.preventDefault(); engine.zoom = Math.max(engine.zoom / 1.25, 0.1); forceUpdate(); }
        if (key === "0") { e.preventDefault(); resetZoom(); }
      }
      if (key === "[") { engine.brushSize = Math.max(1, engine.brushSize - 2); forceUpdate(); }
      if (key === "]") { engine.brushSize = Math.min(200, engine.brushSize + 2); forceUpdate(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [engine, forceUpdate, undo, redo, copySelection, pasteSelection, cutSelection, resetZoom]);

  // --- Drawing Logic ---
  const drawDot = (lc: CanvasRenderingContext2D, x: number, y: number) => {
    const { brushSize, currentTool, brushHardness, fgColor, brushOpacity } = engine;
    const r = brushSize / 2;
    if (currentTool === "pencil" || brushHardness >= 0.99) {
      lc.fillStyle = currentTool === "eraser" ? "rgba(0,0,0,1)" : fgColor;
      lc.beginPath(); lc.arc(x, y, r, 0, Math.PI * 2); lc.fill();
    } else {
      const grad = lc.createRadialGradient(x, y, 0, x, y, r);
      const col = hexToRgba(currentTool === "eraser" ? "#000000" : fgColor, brushOpacity);
      grad.addColorStop(0, col); grad.addColorStop(brushHardness, col); grad.addColorStop(1, hexToRgba(currentTool === "eraser" ? "#000000" : fgColor, 0));
      lc.fillStyle = grad;
      lc.beginPath(); lc.arc(x, y, r, 0, Math.PI * 2); lc.fill();
    }
  };

  const drawLine = (lc: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) => {
    const dist = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.max(1, Math.ceil(dist));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps; drawDot(lc, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t);
    }
  };

  const drawShape = (lc: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, constrain: boolean) => {
    lc.globalCompositeOperation = engine.blendMode;
    lc.globalAlpha = engine.brushOpacity;
    lc.strokeStyle = engine.fgColor; lc.fillStyle = engine.fgColor;
    lc.lineWidth = engine.brushSize; lc.lineCap = "round";
    let w = x2 - x1, h = y2 - y1;
    if (constrain) { const s = Math.min(Math.abs(w), Math.abs(h)); w = Math.sign(w) * s; h = Math.sign(h) * s; }
    lc.beginPath();
    if (engine.currentTool === "rect") { lc.rect(x1, y1, w, h); }
    else if (engine.currentTool === "ellipse") { lc.ellipse(x1 + w / 2, y1 + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2); }
    else if (engine.currentTool === "line") { lc.moveTo(x1, y1); lc.lineTo(x2, y2); }
    else if (engine.currentTool === "triangle") {
      lc.moveTo(x1 + w / 2, y1); lc.lineTo(x1 + w, y1 + h); lc.lineTo(x1, y1 + h); lc.closePath();
    }
    if (engine.currentTool === "line") { lc.stroke(); }
    else if (engine.shapeFilled) { lc.fill(); lc.lineWidth = Math.max(1, engine.brushSize * 0.1); lc.stroke(); }
    else { lc.stroke(); }
    lc.globalCompositeOperation = "source-over"; lc.globalAlpha = 1;
  };

  const applyBlurAt = (lc: CanvasRenderingContext2D, x: number, y: number) => {
    const r = engine.brushSize; const img = lc.getImageData(x - r, y - r, r * 2, r * 2);
    const data = img.data; const w = img.width, h = img.height; const tmp = new Uint8ClampedArray(data);
    for (let i = 1; i < h - 1; i++) {
      for (let j = 1; j < w - 1; j++) {
        const idx = (i * w + j) * 4;
        for (let c = 0; c < 3; c++) {
          data[idx + c] = (tmp[((i - 1) * w + j - 1) * 4 + c] + tmp[((i - 1) * w + j) * 4 + c] + tmp[((i - 1) * w + j + 1) * 4 + c] +
            tmp[(i * w + j - 1) * 4 + c] + tmp[idx + c] + tmp[(i * w + j + 1) * 4 + c] +
            tmp[((i + 1) * w + j - 1) * 4 + c] + tmp[((i + 1) * w + j) * 4 + c] + tmp[((i + 1) * w + j + 1) * 4 + c]) / 9;
        }
      }
    }
    lc.putImageData(img, x - r, y - r);
  };

  const smudgeAt = (lc: CanvasRenderingContext2D, x: number, y: number, px: number, py: number) => {
    const r = engine.brushSize; const srcData = lc.getImageData(px - r / 2, py - r / 2, r, r);
    lc.globalAlpha = 0.3;
    const imgEl = document.createElement("canvas"); imgEl.width = r; imgEl.height = r;
    imgEl.getContext("2d")?.putImageData(srcData, 0, 0); lc.drawImage(imgEl, x - r / 2, y - r / 2); lc.globalAlpha = 1;
  };

  const floodFill = (x: number, y: number, fillColorHex: string) => {
    const lc = getActiveCtx(); if (!lc) return;
    const imgData = lc.getImageData(0, 0, engine.canvasW, engine.canvasH);
    const data = imgData.data; const w = engine.canvasW;
    const getP = (px: number, py: number) => { const i = (py * w + px) * 4; return [data[i], data[i + 1], data[i + 2], data[i + 3]]; };
    const setP = (px: number, py: number, col: number[]) => { const i = (py * w + px) * 4; data[i] = col[0]; data[i + 1] = col[1]; data[i + 2] = col[2]; data[i + 3] = col[3]; };
    const targetC = getP(x, y); const fillC = hexToRgbaArr(fillColorHex, engine.brushOpacity);
    const match = (c1: number[], c2: number[]) => Math.abs(c1[0] - c2[0]) + Math.abs(c1[1] - c2[1]) + Math.abs(c1[2] - c2[2]) + Math.abs(c1[3] - c2[3]) < 30;
    if (match(targetC, fillC)) return;
    const stack = [[x, y]]; const visited = new Uint8Array(w * engine.canvasH);
    while (stack.length) {
      const [cx, cy] = stack.pop()!;
      if (cx < 0 || cy < 0 || cx >= w || cy >= engine.canvasH) continue;
      const idx = cy * w + cx; if (visited[idx]) continue; visited[idx] = 1;
      if (!match(getP(cx, cy), targetC)) continue;
      setP(cx, cy, fillC); stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
    lc.putImageData(imgData, 0, 0);
  };

  const getCanvasPos = (e: React.MouseEvent) => {
    if (!mainCanvasRef.current) return { x: 0, y: 0 };
    const rect = mainCanvasRef.current.getBoundingClientRect();
    return { x: Math.round((e.clientX - rect.left) / engine.zoom), y: Math.round((e.clientY - rect.top) / engine.zoom) };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const pos = getCanvasPos(e);
    engine.isDrawing = true; engine.startX = pos.x; engine.startY = pos.y; engine.lastX = pos.x; engine.lastY = pos.y;
    const { currentTool, fgColor } = engine;

    if (currentTool === "fill") { floodFill(pos.x, pos.y, fgColor); flattenToMain(); saveHistory(); setTimeout(updateThumbnails, 0); engine.isDrawing = false; return; }
    if (currentTool === "eyedropper") {
      const ctx = mainCanvasRef.current?.getContext("2d");
      const d = ctx?.getImageData(pos.x, pos.y, 1, 1).data;
      if (d) { engine.fgColor = "#" + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, "0")).join(""); forceUpdate(); }
      engine.isDrawing = false; return;
    }
    if (currentTool === "text") {
      const t = prompt("Enter text:");
      if (t) {
        saveHistory(); const lc = getActiveCtx();
        if (lc) {
          lc.globalCompositeOperation = engine.blendMode; lc.globalAlpha = engine.brushOpacity; lc.fillStyle = fgColor;
          lc.font = `${engine.fontBold ? "bold " : ""}${engine.fontSize}px sans-serif`; lc.fillText(t, pos.x, pos.y);
          lc.globalCompositeOperation = "source-over"; lc.globalAlpha = 1; flattenToMain(); setTimeout(updateThumbnails, 0);
        }
      }
      engine.isDrawing = false; return;
    }
    if (currentTool === "select") {
      engine.selActive = false; engine.selData = null;
      if (selOverlayRef.current) selOverlayRef.current.style.display = "none"; return;
    }
    if (currentTool === "move") { engine.moveStartPos = pos; engine.moveLayerSnapshot = getActiveCtx()?.getImageData(0, 0, engine.canvasW, engine.canvasH) || null; saveHistory(); return; }

    saveHistory();
    const lc = getActiveCtx(); if (!lc) return;
    if (["rect", "ellipse", "line", "triangle"].includes(currentTool)) engine.snapshotData = lc.getImageData(0, 0, engine.canvasW, engine.canvasH);

    // Draw start handling
    if (currentTool === "brush" || currentTool === "pencil") { lc.globalCompositeOperation = engine.blendMode; lc.globalAlpha = engine.brushOpacity; drawDot(lc, pos.x, pos.y); }
    else if (currentTool === "eraser") { lc.globalCompositeOperation = "destination-out"; lc.globalAlpha = engine.brushOpacity; drawDot(lc, pos.x, pos.y); }
    else if (currentTool === "spray") {
       lc.fillStyle = engine.fgColor; lc.globalAlpha = engine.brushOpacity;
       for(let i=0; i< engine.brushSize*2; i++) {
           let r = Math.random() * (engine.brushSize/2);
           let theta = Math.random() * 2 * Math.PI;
           lc.fillRect(pos.x + r*Math.cos(theta), pos.y + r*Math.sin(theta), 1, 1);
       }
    }
    else if (currentTool === "blur") { applyBlurAt(lc, pos.x, pos.y); }
    else if (currentTool === "smudge") { smudgeAt(lc, pos.x, pos.y, pos.x, pos.y); }
    flattenToMain();
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const pos = getCanvasPos(e);
    if (coordsRef.current) coordsRef.current.textContent = `x:${pos.x} y:${pos.y}`;
    if (!engine.isDrawing) return;
    
    const { currentTool } = engine;
    if (currentTool === "select") {
      engine.selX = Math.min(engine.startX, pos.x); engine.selY = Math.min(engine.startY, pos.y);
      engine.selW = Math.abs(pos.x - engine.startX); engine.selH = Math.abs(pos.y - engine.startY);
      if (selOverlayRef.current) {
        selOverlayRef.current.style.display = "block";
        selOverlayRef.current.style.left = `${engine.selX}px`; selOverlayRef.current.style.top = `${engine.selY}px`;
        selOverlayRef.current.style.width = `${engine.selW}px`; selOverlayRef.current.style.height = `${engine.selH}px`;
      }
      return;
    }
    if (currentTool === "move") {
      if (!engine.moveStartPos || !engine.moveLayerSnapshot) return;
      const lc = getActiveCtx(); if (!lc) return;
      lc.clearRect(0, 0, engine.canvasW, engine.canvasH); lc.putImageData(engine.moveLayerSnapshot, pos.x - engine.moveStartPos.x, pos.y - engine.moveStartPos.y);
      flattenToMain(); return;
    }

    const lc = getActiveCtx(); if (!lc) return;
    if (currentTool === "brush" || currentTool === "pencil" || currentTool === "eraser") { drawLine(lc, engine.lastX, engine.lastY, pos.x, pos.y); }
    else if (currentTool === "spray") { 
       lc.fillStyle = engine.fgColor;
       lc.globalAlpha = engine.brushOpacity;
       for(let i=0; i< engine.brushSize*2; i++) {
           let r = Math.random() * (engine.brushSize/2);
           let theta = Math.random() * 2 * Math.PI;
           lc.fillRect(pos.x + r*Math.cos(theta), pos.y + r*Math.sin(theta), 1, 1);
       }
    }
    else if (["rect", "ellipse", "line", "triangle"].includes(currentTool)) { if (engine.snapshotData) lc.putImageData(engine.snapshotData, 0, 0); drawShape(lc, engine.startX, engine.startY, pos.x, pos.y, e.shiftKey); }
    else if (currentTool === "blur") { applyBlurAt(lc, pos.x, pos.y); }
    else if (currentTool === "smudge") { smudgeAt(lc, pos.x, pos.y, engine.lastX, engine.lastY); }
    flattenToMain();
    engine.lastX = pos.x; engine.lastY = pos.y;
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!engine.isDrawing) return;
    engine.isDrawing = false; const pos = getCanvasPos(e);
    if (engine.currentTool === "select") { if (engine.selW > 2 && engine.selH > 2) engine.selActive = true; engine.selData = getActiveCtx()?.getImageData(engine.selX, engine.selY, engine.selW, engine.selH) || null; return; }
    if (engine.currentTool === "move") { setTimeout(updateThumbnails, 0); return; }
    const lc = getActiveCtx();
    if (lc) { lc.globalCompositeOperation = "source-over"; lc.globalAlpha = 1; }
    flattenToMain(); setTimeout(updateThumbnails, 0);
  };

  // --- Adjustments & Filters ---
  const applyFilters = () => {
    if (mainCanvasRef.current) {
      const { brightness, contrast, saturation, hue, blur } = engine.adjFilters;
      mainCanvasRef.current.style.filter = [
        `brightness(${1 + brightness / 100})`, `contrast(${1 + contrast / 100})`,
        `saturate(${1 + saturation / 100})`, `hue-rotate(${hue}deg)`, blur > 0 ? `blur(${blur}px)` : ""
      ].filter(Boolean).join(" ");
    }
  };

  const commitAdjustments = () => {
    saveHistory();
    const tmp = document.createElement("canvas"); tmp.width = engine.canvasW; tmp.height = engine.canvasH;
    const tctx = tmp.getContext("2d");
    if (tctx) { tctx.filter = mainCanvasRef.current?.style.filter || ""; tctx.drawImage(engine.layers[engine.activeLayerIndex].canvas, 0, 0); }
    const lc = getActiveCtx(); lc?.clearRect(0, 0, engine.canvasW, engine.canvasH); lc?.drawImage(tmp, 0, 0);
    engine.adjFilters = { brightness: 0, contrast: 0, saturation: 0, hue: 0, blur: 0 };
    if (mainCanvasRef.current) mainCanvasRef.current.style.filter = "";
    forceUpdate(); flattenToMain(); setTimeout(updateThumbnails, 0);
  };

  const runEffect = (type: string) => {
    saveHistory(); const lc = getActiveCtx(); if (!lc) return;
    const d = lc.getImageData(0, 0, engine.canvasW, engine.canvasH); const a = d.data;
    for (let i = 0; i < a.length; i += 4) {
      const r = a[i], g = a[i + 1], b = a[i + 2];
      if (type === "gray") { const gr = 0.299 * r + 0.587 * g + 0.114 * b; a[i] = a[i + 1] = a[i + 2] = gr; }
      else if (type === "inv") { a[i] = 255 - r; a[i + 1] = 255 - g; a[i + 2] = 255 - b; }
      else if (type === "sepia") { a[i] = Math.min(255, 0.393 * r + 0.769 * g + 0.189 * b); a[i + 1] = Math.min(255, 0.349 * r + 0.686 * g + 0.168 * b); a[i + 2] = Math.min(255, 0.272 * r + 0.534 * g + 0.131 * b); }
    }
    lc.putImageData(d, 0, 0); flattenToMain(); setTimeout(updateThumbnails, 0);
  };

  const flipActiveLayer = (horizontal: boolean) => {
    saveHistory();
    const l = engine.layers[engine.activeLayerIndex]; if (!l) return;
    const c = l.canvas; const ctx = l.ctx;
    const temp = document.createElement("canvas");
    temp.width = c.width; temp.height = c.height;
    temp.getContext("2d")!.drawImage(c, 0, 0);
    ctx.clearRect(0,0,c.width, c.height);
    ctx.save();
    if (horizontal) { ctx.scale(-1, 1); ctx.drawImage(temp, -c.width, 0); } 
    else { ctx.scale(1, -1); ctx.drawImage(temp, 0, -c.height); }
    ctx.restore();
    flattenToMain(); forceUpdate(); setTimeout(updateThumbnails, 0);
  };

  const rotateActiveLayer = () => {
    saveHistory();
    const l = engine.layers[engine.activeLayerIndex]; if (!l) return;
    const c = l.canvas; const ctx = l.ctx;
    const newW = c.height; const newH = c.width;
    const temp = document.createElement("canvas");
    temp.width = c.width; temp.height = c.height;
    temp.getContext("2d")!.drawImage(c, 0, 0);
    
    // Resize all layers to match new dimension so they are consistent, though we just rotate active? 
    // Or just rotate the active layer around center without resizing? Let's rotate around center.
    ctx.clearRect(0,0,c.width, c.height);
    ctx.save();
    ctx.translate(c.width/2, c.height/2);
    ctx.rotate(Math.PI/2);
    ctx.translate(-c.width/2, -c.height/2);
    ctx.drawImage(temp, (c.width - temp.width)/2, (c.height - temp.height)/2);
    ctx.restore();
    flattenToMain(); forceUpdate(); setTimeout(updateThumbnails, 0);
  };

  const addNoise = (amount = 20) => {
    saveHistory(); const lc = getActiveCtx(); if (!lc) return;
    const imgData = lc.getImageData(0,0,engine.canvasW, engine.canvasH);
    for(let i=0; i<imgData.data.length; i+=4) {
      const v = (Math.random()-0.5)*2*255 * (amount/100);
      imgData.data[i] = Math.min(255, Math.max(0, imgData.data[i]+v));
      imgData.data[i+1] = Math.min(255, Math.max(0, imgData.data[i+1]+v));
      imgData.data[i+2] = Math.min(255, Math.max(0, imgData.data[i+2]+v));
    }
    lc.putImageData(imgData, 0,0);
    flattenToMain(); forceUpdate(); setTimeout(updateThumbnails, 0);
  };

  const pixelate = (size = 10) => {
    saveHistory(); const l = engine.layers[engine.activeLayerIndex]; if (!l) return;
    const t = document.createElement("canvas");
    t.width = l.canvas.width; t.height = l.canvas.height;
    const tCtx = t.getContext("2d")!;
    tCtx.imageSmoothingEnabled = false;
    tCtx.drawImage(l.canvas, 0, 0, l.canvas.width/size, l.canvas.height/size);
    l.ctx.clearRect(0,0,l.canvas.width, l.canvas.height);
    l.ctx.imageSmoothingEnabled = false;
    l.ctx.drawImage(t, 0, 0, l.canvas.width/size, l.canvas.height/size, 0, 0, l.canvas.width, l.canvas.height);
    l.ctx.imageSmoothingEnabled = true;
    flattenToMain(); forceUpdate(); setTimeout(updateThumbnails, 0);
  };

  const cropToSelection = () => {
    if (!engine.selActive || engine.selW === 0 || engine.selH === 0) return;
    saveHistory();
    const { selX: x, selY: y, selW: w, selH: h } = engine;
    engine.layers.forEach(l => {
       const t = document.createElement("canvas"); t.width = w; t.height = h;
       t.getContext("2d")!.drawImage(l.canvas, x, y, w, h, 0, 0, w, h);
       l.canvas.width = w; l.canvas.height = h;
       l.ctx.clearRect(0,0,w,h); l.ctx.drawImage(t, 0,0);
    });
    engine.canvasW = w; engine.canvasH = h;
    engine.selActive = false;
    if (selOverlayRef.current) selOverlayRef.current.style.display = "none";
    flattenToMain(); resetZoom(); forceUpdate(); setTimeout(updateThumbnails, 0);
  };

  const moveLayer = (idx: number, dir: number) => {
    saveHistory();
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= engine.layers.length) return;
    const l = engine.layers.splice(idx, 1)[0];
    engine.layers.splice(newIdx, 0, l);
    if(engine.activeLayerIndex === idx) engine.activeLayerIndex = newIdx;
    else if(engine.activeLayerIndex === newIdx) engine.activeLayerIndex = idx;
    flattenToMain(); forceUpdate(); setTimeout(updateThumbnails, 0);
  };

  const posterize = (levels = 4) => {
    saveHistory(); const lc = getActiveCtx(); if (!lc) return;
    const imgData = lc.getImageData(0,0,engine.canvasW, engine.canvasH);
    const step = 255 / (levels - 1);
    for(let i=0; i<imgData.data.length; i+=4) {
      imgData.data[i] = Math.round(imgData.data[i] / 255 * (levels - 1)) * step;
      imgData.data[i+1] = Math.round(imgData.data[i+1] / 255 * (levels - 1)) * step;
      imgData.data[i+2] = Math.round(imgData.data[i+2] / 255 * (levels - 1)) * step;
    }
    lc.putImageData(imgData, 0,0);
    flattenToMain(); forceUpdate(); setTimeout(updateThumbnails, 0);
  };

  const vignette = () => {
    saveHistory(); const lc = getActiveCtx(); if (!lc) return;
    const imgData = lc.getImageData(0,0,engine.canvasW, engine.canvasH);
    const cx = engine.canvasW / 2; const cy = engine.canvasH / 2;
    const maxDist = Math.sqrt(cx*cx + cy*cy);
    for(let y=0; y<engine.canvasH; y++) {
      for(let x=0; x<engine.canvasW; x++) {
        const dx = cx - x; const dy = cy - y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        const factor = 1 - Math.pow(dist / maxDist, 1.5);
        const i = (y * engine.canvasW + x) * 4;
        imgData.data[i] *= factor; imgData.data[i+1] *= factor; imgData.data[i+2] *= factor;
      }
    }
    lc.putImageData(imgData, 0,0);
    flattenToMain(); forceUpdate(); setTimeout(updateThumbnails, 0);
  };

  const fillSelection = () => {
    if(!engine.selActive || engine.selW === 0 || engine.selH === 0) return;
    saveHistory(); const lc = getActiveCtx(); if (!lc) return;
    lc.fillStyle = engine.fgColor;
    lc.fillRect(engine.selX, engine.selY, engine.selW, engine.selH);
    flattenToMain(); forceUpdate(); setTimeout(updateThumbnails, 0);
  };

  // --- Export and Save ---
  const handleExport = () => {
    const mimeMap: any = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" };
    let dataUrl = "";
    if (expFormat === "bmp") {
      // Basic BMP header dump skipped for output brevity in this React port, using PNG fallback visually
      // For accurate BMP, a complex buffer writes is needed. We will fallback to canvas PNG.
      dataUrl = mainCanvasRef.current?.toDataURL("image/png") || "";
    } else {
      dataUrl = mainCanvasRef.current?.toDataURL(mimeMap[expFormat], expQuality) || "";
    }
    const a = document.createElement("a"); a.download = `${expName}.${expFormat}`; a.href = dataUrl; a.click();
    setShowExport(false);
  };

  const flattenAndSave = () => {
    const a = document.createElement("a"); a.download = "pixelforge.png"; a.href = mainCanvasRef.current?.toDataURL("image/png") || ""; a.click();
  };

  const handleFileDrop = (e: React.DragEvent | null, fileFromInput?: File) => {
    if (e) { e.preventDefault(); setIsDraggingFile(false); }
    const file = fileFromInput || e?.dataTransfer?.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    const r = new FileReader();
    r.onload = ev => {
      const img = new Image();
      img.onload = () => {
        engine.canvasW = img.width; engine.canvasH = img.height;
        engine.layers = []; engine.layerCounter = 1; engine.activeLayerIndex = 0;
        addLayer("Background"); saveHistory();
        engine.layers[0].ctx.drawImage(img, 0, 0);
        flattenToMain(); setTimeout(updateThumbnails, 0); setTimeout(resetZoom, 50); forceUpdate();
      };
      img.src = ev.target?.result as string;
    };
    r.readAsDataURL(file);
  };

  return (
    <div className="flex flex-col h-[100dvh] bg-[#0A0A0B] text-white p-2 md:p-4 gap-2 md:gap-4 font-sans select-none overflow-hidden">
      <style>{`
        input[type=range] { appearance: none; height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; outline: none; cursor: pointer; }
        input[type=range]::-webkit-slider-thumb { appearance: none; width: 12px; height: 12px; border-radius: 50%; background: #a3e635; cursor: pointer; transition: transform 0.1s; border: none; }
        input[type=range]::-webkit-slider-thumb:hover { transform: scale(1.2); }
        .checkerboard {
          background-image: linear-gradient(45deg, #111 25%, transparent 25%), linear-gradient(-45deg, #111 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #111 75%), linear-gradient(-45deg, transparent 75%, #111 75%);
          background-size: 16px 16px; background-position: 0 0, 0 8px, 8px -8px, -8px 0;
        }
        ::-webkit-scrollbar { width: 4px; height: 4px; } ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; } ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
      
      {/* TOPBAR */}
      <div className="h-14 md:h-16 bg-[#161618] border border-white/5 rounded-[1.25rem] md:rounded-3xl flex items-center px-3 md:px-6 shrink-0 z-[100] shadow-sm overflow-x-auto no-scrollbar gap-2 md:gap-0">
        <div className="flex items-center gap-2 md:gap-3 shrink-0 mr-auto pr-4 md:pr-0">
          <div className="w-8 h-8 md:w-10 md:h-10 bg-lime-400 rounded-lg md:rounded-xl flex items-center justify-center text-black shrink-0">
            <Paintbrush size={18} strokeWidth={2.5} />
          </div>
          <span className="font-bold text-lg md:text-xl tracking-tight text-white">PIXELFORGE</span>
          {!isOnline && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-red-500/20 text-red-400 text-[10px] font-bold uppercase tracking-wider border border-red-500/30">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span>
              Offline
            </div>
          )}
        </div>
        
        <div className="flex items-center gap-1.5 md:gap-2 shrink-0">
          <button className={btnClass} onClick={() => setShowNew(true)}><Plus size={14}/> <span className="hidden lg:inline">New</span></button>
          <button className={btnClass} onClick={() => fileInputRef.current?.click()}><FolderOpen size={14}/> <span className="hidden lg:inline">Open</span></button>
          <button className={btnClass} onClick={flattenAndSave}><Save size={14}/> <span className="hidden lg:inline">Save</span></button>
          <button className={btnAccentClass} onClick={() => setShowExport(true)}><Download size={14}/> <span className="hidden lg:inline">Export</span></button>
          <div className="w-[1px] h-6 bg-white/10 mx-1 md:mx-2"></div>
          <button className={btnClass} onClick={undo} title="Ctrl+Z">Undo</button>
          <button className={btnClass} onClick={redo} title="Ctrl+Y">Redo</button>
          <div className="w-[1px] h-6 bg-white/10 mx-1 md:mx-2"></div>
          <button className={btnClass} onClick={() => { if(confirm("Merge layers?")) { const t = document.createElement("canvas"); t.width=engine.canvasW; t.height=engine.canvasH; const ctx=t.getContext("2d"); engine.layers.forEach(l=>{if(l.visible){ctx!.globalAlpha=l.opacity; ctx?.drawImage(l.canvas,0,0)}}); engine.layers=[{id:Date.now(),canvas:t,ctx:ctx!,name:"Merged",visible:true,opacity:1}]; engine.activeLayerIndex=0; engine.layerCounter=2; forceUpdate(); flattenToMain(); setTimeout(updateThumbnails,0); } }}><Layers size={14}/> <span className="hidden lg:inline">Flatten</span></button>
          <button className={btnClass} onClick={() => { saveHistory(); getActiveCtx()?.clearRect(0,0,engine.canvasW,engine.canvasH); flattenToMain(); }}><Trash2 size={14}/> <span className="hidden lg:inline">Clear</span></button>
          <div className="w-[1px] h-6 bg-white/10 mx-1 md:mx-2"></div>
          <button className={`${btnClass} ${showGrid ? 'bg-white/20 text-white' : ''}`} onClick={() => setShowGrid(!showGrid)} title="Toggle Grid"><Grid3x3 size={14}/></button>
          <button className={btnClass} onClick={() => setShowShortcuts(true)} title="Keyboard Shortcuts"><Keyboard size={14}/></button>
        </div>

        <div className="flex items-center gap-1.5 md:gap-2 pl-2 md:pl-4 shrink-0">
          <button className={btnClass} onClick={() => { engine.zoom = Math.min(engine.zoom * 1.25, 16); forceUpdate(); }}>+</button>
          <button className={btnClass} onClick={resetZoom}>{Math.round(engine.zoom * 100)}%</button>
          <button className={btnClass} onClick={() => { engine.zoom = Math.max(engine.zoom / 1.25, 0.1); forceUpdate(); }}>-</button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden gap-2 md:gap-4 flex-col md:flex-row">
        {/* TOOLBAR */}
        <div className="w-full md:w-[72px] bg-[#161618] border border-white/5 rounded-[1.25rem] md:rounded-3xl flex flex-row md:flex-col items-center px-4 md:px-0 py-2 md:py-5 gap-1.5 md:gap-1 shrink-0 overflow-x-auto md:overflow-y-auto no-scrollbar shadow-sm">
          {[
            ["brush", "pencil", "eraser", "spray", "fill"], ["eyedropper", "text"],
            ["rect", "ellipse", "line", "triangle"], ["select", "move"], ["blur", "smudge"]
          ].map((group, gi) => (
            <React.Fragment key={gi}>
              <div className="flex flex-row md:flex-col gap-1.5 md:mb-1.5">
                {group.map((id) => {
                  const Icon = IconTools[id as keyof typeof IconTools];
                  const act = engine.currentTool === id;
                  return (
                    <button key={id} onClick={() => { engine.currentTool = id; forceUpdate(); }} title={id}
                      className={`min-w-[40px] h-[40px] md:min-w-[44px] md:h-[44px] shrink-0 rounded-xl md:rounded-2xl cursor-pointer flex items-center justify-center transition-all ${act ? "bg-white/10 text-lime-400 shadow-[0_4px_12px_rgba(163,230,53,0.15)] border border-lime-400/20" : "text-white/40 border border-transparent hover:bg-white/5 hover:text-white"}`}>
                      <Icon size={20} />
                    </button>
                  );
                })}
              </div>
              {gi < 4 && <div className="w-[1px] h-6 md:w-8 md:h-[1px] bg-white/10 mx-1.5 md:mx-auto md:my-1.5 shrink-0" />}
            </React.Fragment>
          ))}
        </div>

        {/* CANVAS WORKSPACE */}
        <div className="flex-1 bg-[#161618] border border-white/5 rounded-[1.25rem] md:rounded-3xl overflow-hidden relative flex items-center justify-center shadow-sm" ref={wrapperRef}
          onWheel={e => { e.preventDefault(); engine.zoom = e.deltaY < 0 ? Math.min(engine.zoom * 1.25, 16) : Math.max(engine.zoom / 1.25, 0.1); forceUpdate(); }}
          onDragOver={e => { e.preventDefault(); setIsDraggingFile(true); }} onDragLeave={() => setIsDraggingFile(false)} onDrop={e => handleFileDrop(e)}>
          
          {isDraggingFile && (
            <div className="absolute inset-0 bg-lime-400/5 border-2 border-dashed border-lime-400 z-[500] flex items-center justify-center font-bold text-2xl text-lime-400 rounded-3xl pointer-events-none">
              Drop image here
            </div>
          )}
          
          <div className="relative shadow-[0_0_0_1px_rgba(255,255,255,0.05),0_8px_40px_rgba(0,0,0,0.6)]" style={{ transform: `scale(${engine.zoom})`, transformOrigin: "center", width: engine.canvasW, height: engine.canvasH }}>
            <div className="absolute inset-0 pointer-events-none -z-10 checkerboard rounded-sm" />
            <canvas ref={mainCanvasRef} width={engine.canvasW} height={engine.canvasH} className="relative z-[2]" 
              onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}
              style={{ cursor: ["brush","pencil","eraser","spray","fill"].includes(engine.currentTool) ? "crosshair" : engine.currentTool==="text" ? "text" : engine.currentTool==="move" ? "move" : "crosshair" }} />
            <div ref={selOverlayRef} className={`absolute border-2 border-dashed border-lime-400 shadow-[0_0_0_1px_rgba(0,0,0,0.5)] z-10 pointer-events-none ${engine.selActive ? "block" : "hidden"}`} style={{ left: engine.selX, top: engine.selY, width: engine.selW, height: engine.selH, animation: "marchingAnts 0.6s linear infinite" }} />
            {showGrid && (
              <div className="absolute inset-0 pointer-events-none z-20 mix-blend-difference" style={{
                backgroundImage: `linear-gradient(to right, rgba(255,255,255,0.2) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.2) 1px, transparent 1px)`,
                backgroundSize: `${engine.canvasW > 100 ? 20 : 10}px ${engine.canvasH > 100 ? 20 : 10}px`
              }} />
            )}
          </div>
        </div>

        {/* RIGHT PANEL */}
        <div className="w-full h-1/3 min-h-[250px] md:w-[260px] md:h-auto bg-[#161618] border border-white/5 rounded-[1.25rem] md:rounded-3xl flex flex-col shrink-0 overflow-y-auto shadow-sm">
          {/* Colors */}
          <div className="border-b border-white/5 p-5">
            <div className="uppercase tracking-widest text-xs font-bold text-white/30 mb-4">Color</div>
            <div className="flex gap-3 items-end mb-4">
              <div className="relative isolate">
                <div className="w-8 h-8 rounded-lg border-2 border-[#161618] cursor-pointer mb-[-10px] ml-[-20px] hover:scale-110 transition-transform shadow-md" style={{ background: engine.bgColor }} onClick={() => { const i = document.getElementById("bgColPik"); i?.click() }} />
                <div className="w-12 h-12 rounded-xl border-2 border-[#161618] cursor-pointer z-[2] relative hover:scale-105 transition-transform shadow-md" style={{ background: engine.fgColor }} onClick={() => { const i = document.getElementById("fgColPik"); i?.click() }} />
              </div>
              <button className="bg-white/5 border border-white/10 rounded-lg w-7 h-7 text-white/60 text-xs flex items-center justify-center hover:text-white hover:bg-white/10 transition-all" onClick={() => { const t = engine.fgColor; engine.fgColor = engine.bgColor; engine.bgColor = t; forceUpdate(); }}>⇄</button>
            </div>
            <div className="flex gap-2 items-center">
              <input type="text" className="flex-1 bg-white/5 border border-white/10 rounded-lg text-white/80 text-xs px-2 py-1.5 outline-none focus:border-lime-400 transition-colors" value={engine.fgColor} onChange={e => { engine.fgColor = e.target.value; forceUpdate(); }}/>
              <input type="color" id="fgColPik" className="hidden" value={engine.fgColor} onChange={e => { engine.fgColor = e.target.value; forceUpdate(); }} />
              <input type="color" id="bgColPik" className="hidden" value={engine.bgColor} onChange={e => { engine.bgColor = e.target.value; forceUpdate(); }} />
            </div>
            <div className="grid grid-cols-[repeat(10,1fr)] gap-1.5 mt-4">
              {SWATCHES.map(c => <div key={c} className="w-full aspect-square rounded-sm cursor-pointer border border-white/10 hover:scale-125 hover:z-10 transition-transform origin-center shadow-sm" style={{ background: c }} onClick={() => { engine.fgColor = c; forceUpdate(); }} onContextMenu={e => { e.preventDefault(); engine.bgColor = c; forceUpdate(); }} />)}
            </div>
          </div>

          {/* Options */}
          <div className="border-b border-white/5 p-5">
            <div className="uppercase tracking-widest text-xs font-bold text-white/30 mb-4">Options</div>
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2"><span className="text-xs font-medium text-white/60 min-w-[50px]">Size</span><input type="range" min="1" max="100" value={engine.brushSize} onChange={e=>{engine.brushSize=+e.target.value; forceUpdate();}} className="flex-1" /><span className="text-xs font-bold text-lime-400 min-w-[30px] text-right">{engine.brushSize}px</span></div>
              <div className="flex items-center gap-2"><span className="text-xs font-medium text-white/60 min-w-[50px]">Opacity</span><input type="range" min="1" max="100" value={Math.round(engine.brushOpacity*100)} onChange={e=>{engine.brushOpacity=+e.target.value/100; forceUpdate();}} className="flex-1" /><span className="text-xs font-bold text-lime-400 min-w-[30px] text-right">{Math.round(engine.brushOpacity*100)}%</span></div>
              <div className="flex items-center gap-2"><span className="text-xs font-medium text-white/60 min-w-[50px]">Hardness</span><input type="range" min="0" max="100" value={Math.round(engine.brushHardness*100)} onChange={e=>{engine.brushHardness=+e.target.value/100; forceUpdate();}} className="flex-1" /><span className="text-xs font-bold text-lime-400 min-w-[30px] text-right">{Math.round(engine.brushHardness*100)}%</span></div>
              <div className="flex items-center gap-2"><span className="text-xs font-medium text-white/60 min-w-[50px]">Blend</span>
                <select className="flex-1 bg-white/5 border border-white/10 text-xs text-white/80 p-1.5 rounded-lg outline-none focus:border-lime-400" value={engine.blendMode} onChange={e=>{engine.blendMode=e.target.value as any; forceUpdate();}}>
                  <option value="source-over">Normal</option><option value="multiply">Multiply</option><option value="screen">Screen</option><option value="overlay">Overlay</option><option value="color-dodge">Color Dodge</option>
                </select>
              </div>
              {engine.currentTool === "text" && (
                <>
                  <div className="flex items-center gap-2"><span className="text-xs font-medium text-white/60 min-w-[50px]">Font px</span><input type="range" min="8" max="120" value={engine.fontSize} onChange={e=>{engine.fontSize=+e.target.value; forceUpdate();}} className="flex-1" /><span className="text-xs font-bold text-lime-400 min-w-[30px] text-right">{engine.fontSize}</span></div>
                  <div className="flex items-center gap-2"><span className="text-xs font-medium text-white/60 min-w-[50px]">Bold</span><input type="checkbox" checked={engine.fontBold} onChange={e=>{engine.fontBold=e.target.checked; forceUpdate();}} className="accent-[#a3e635] w-4 h-4 rounded" /></div>
                </>
              )}
              {["rect","ellipse","line","triangle"].includes(engine.currentTool) && (
                 <div className="flex items-center gap-2"><span className="text-xs font-medium text-white/60 min-w-[50px]">Filled</span><input type="checkbox" checked={engine.shapeFilled} onChange={e=>{engine.shapeFilled=e.target.checked; forceUpdate();}} className="accent-[#a3e635] w-4 h-4 rounded" /></div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="border-b border-white/5 p-5">
            <div className="uppercase tracking-widest text-xs font-bold text-white/30 mb-4">Actions</div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <button className="h-8 bg-white/5 text-white/60 text-[10px] font-bold uppercase border border-white/10 rounded-lg hover:text-white hover:bg-white/10 transition-colors flex items-center justify-center gap-1.5" onClick={()=>flipActiveLayer(true)}><FlipHorizontal size={14}/> Flip H</button>
              <button className="h-8 bg-white/5 text-white/60 text-[10px] font-bold uppercase border border-white/10 rounded-lg hover:text-white hover:bg-white/10 transition-colors flex items-center justify-center gap-1.5" onClick={()=>flipActiveLayer(false)}><FlipVertical size={14}/> Flip V</button>
              <button className="h-8 bg-white/5 text-white/60 text-[10px] font-bold uppercase border border-white/10 rounded-lg hover:text-white hover:bg-white/10 transition-colors flex items-center justify-center gap-1.5" onClick={()=>rotateActiveLayer()}><RotateCw size={14}/> Rotate</button>
              <button className="h-8 bg-white/5 text-white/60 text-[10px] font-bold uppercase border border-white/10 rounded-lg hover:text-white hover:bg-white/10 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50" onClick={()=>cropToSelection()} disabled={!engine.selActive}><Crop size={14}/> Crop</button>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <button className="h-8 bg-white/5 text-white/60 text-[10px] font-bold uppercase border border-white/10 rounded-lg hover:text-white hover:bg-white/10 transition-colors flex items-center justify-center gap-1.5" onClick={()=>addNoise()}>Noise</button>
              <button className="h-8 bg-white/5 text-white/60 text-[10px] font-bold uppercase border border-white/10 rounded-lg hover:text-white hover:bg-white/10 transition-colors flex items-center justify-center gap-1.5" onClick={()=>pixelate()}>Pixelate</button>
              <button className="h-8 bg-white/5 text-white/60 text-[10px] font-bold uppercase border border-white/10 rounded-lg hover:text-white hover:bg-white/10 transition-colors flex items-center justify-center gap-1.5" onClick={()=>posterize(5)}><Sunset size={14}/> Poster</button>
              <button className="h-8 bg-white/5 text-white/60 text-[10px] font-bold uppercase border border-white/10 rounded-lg hover:text-white hover:bg-white/10 transition-colors flex items-center justify-center gap-1.5" onClick={()=>vignette()}><CircleDot size={14}/> Vignette</button>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <button className="h-8 bg-white/5 text-white/60 text-[10px] font-bold uppercase border border-white/10 rounded-lg hover:text-white hover:bg-white/10 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50" onClick={()=>fillSelection()} disabled={!engine.selActive}>Fill Sel</button>
              <button className="h-8 bg-white/5 text-white/60 text-[10px] font-bold uppercase border border-white/10 rounded-lg hover:text-white hover:bg-white/10 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50" onClick={()=>{engine.selActive=false; if(selOverlayRef.current) selOverlayRef.current.style.display="none"; forceUpdate();}} disabled={!engine.selActive}>Clear Sel</button>
            </div>
          </div>

          {/* Adjustments */}
          <div className="border-b border-white/5 p-5">
            <div className="uppercase tracking-widest text-xs font-bold text-white/30 mb-4">Adjustments</div>
            <div className="flex flex-col gap-3">
              {[ {id:"brightness",l:"Bright", min:-100, max:100, suf:""}, {id:"contrast",l:"Contrast", min:-100, max:100, suf:""}, {id:"saturation",l:"Saturat", min:-100, max:100, suf:""}, {id:"hue",l:"Hue", min:-180, max:180, suf:"°"}, {id:"blur",l:"Blur px", min:0, max:20, suf:""} ].map(adj => (
                <div key={adj.id} className="flex items-center gap-2"><span className="text-xs font-medium text-white/60 min-w-[50px]">{adj.l}</span><input type="range" min={adj.min} max={adj.max} value={(engine.adjFilters as any)[adj.id]} onChange={e=>{(engine.adjFilters as any)[adj.id]=+e.target.value; applyFilters(); forceUpdate();}} className="flex-1" /><span className="text-xs font-bold text-lime-400 min-w-[30px] text-right">{(engine.adjFilters as any)[adj.id]}{adj.suf}</span></div>
              ))}
              <div className="flex gap-2 mt-2"><button className="flex-1 h-7 bg-white/5 text-white/60 text-[10px] font-bold uppercase border border-white/10 rounded-lg hover:text-white hover:bg-white/10 transition-colors" onClick={()=>runEffect("gray")}>Gray</button><button className="flex-1 h-7 bg-white/5 text-white/60 text-[10px] font-bold uppercase border border-white/10 rounded-lg hover:text-white hover:bg-white/10 transition-colors" onClick={()=>runEffect("inv")}>Invert</button><button className="flex-1 h-7 bg-white/5 text-white/60 text-[10px] font-bold uppercase border border-white/10 rounded-lg hover:text-white hover:bg-white/10 transition-colors" onClick={()=>runEffect("sepia")}>Sepia</button></div>
              <div className="flex gap-2 mt-1"><button className="flex-1 h-7 bg-white/5 text-[#ff4757] text-[10px] font-bold uppercase border border-white/10 rounded-lg hover:border-[#ff4757] hover:bg-[#ff4757]/10 transition-colors" onClick={()=>{engine.adjFilters={brightness:0,contrast:0,saturation:0,hue:0,blur:0}; applyFilters(); forceUpdate();}}>Reset</button><button className="flex-1 h-7 bg-lime-400 text-black text-[10px] font-bold uppercase rounded-lg hover:bg-lime-300 transition-colors" onClick={commitAdjustments}>Apply</button></div>
            </div>
          </div>

          {/* Layers */}
          <div className="p-5 flex-1 flex flex-col min-h-0">
             <div className="uppercase tracking-widest text-xs font-bold text-white/30 mb-4">Layers</div>
             <div className="flex flex-col gap-2 overflow-y-auto max-h-[220px] pr-1">
               {engine.layers.map((l, i) => (
                 <div key={l.id} className={`flex items-center gap-1.5 p-1.5 rounded-xl border border-transparent cursor-pointer hover:bg-white/5 transition-colors ${i === engine.activeLayerIndex ? "!bg-white/10 !border-white/10" : ""}`} onClick={() => { engine.activeLayerIndex = i; forceUpdate(); }}>
                   <div className="w-10 h-7 rounded-sm border border-white/10 shrink-0 overflow-hidden bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0IiBoZWlnaHQ9IjQiPjxyZWN0IHdpZHRoPSI0IiBoZWlnaHQ9IjQiIGZpbGw9IiNmZmYiLz48cG9seWdvbiBmaWxsPSIjY2NjIiBwb2ludHM9IjAsMCAyLDAgMiwyIDQsMiA0LDQgMiw0IDIsMiAwLDIiLz48L3N2Zz4=')]">
                     <canvas id={`thumb-${l.id}`} width={56} height={40} className="w-full h-full object-contain mix-blend-normal opacity-100" />
                   </div>
                   <div className="flex-1 text-xs font-medium text-white/80 truncate min-w-0" onDoubleClick={(e) => { e.stopPropagation(); const n = prompt("Layer name:", l.name); if (n) { l.name = n; forceUpdate(); } }}>{l.name}</div>
                   <div className="flex gap-0.5 shrink-0">
                     <button className="text-white/40 hover:text-white" onClick={e => { e.stopPropagation(); moveLayer(i, 1); }} disabled={i===engine.layers.length-1}><ArrowUp size={14}/></button>
                     <button className="text-white/40 hover:text-white" onClick={e => { e.stopPropagation(); moveLayer(i, -1); }} disabled={i===0}><ArrowDown size={14}/></button>
                     <button className="text-white/40 hover:text-white ml-0.5" onClick={e => { e.stopPropagation(); l.visible = !l.visible; flattenToMain(); forceUpdate(); }}>{l.visible ? <Eye size={14}/> : <EyeOff size={14}/>}</button>
                   </div>
                 </div>
               ))}
             </div>
             <div className="flex gap-2 mt-4">
               <button className="flex-1 h-8 bg-white/5 text-white/60 border border-white/10 rounded-lg flex items-center justify-center hover:text-white hover:bg-white/10 transition-colors" onClick={() => addLayer()}><Plus size={14}/></button>
               <button className="flex-1 h-8 bg-white/5 text-white/60 border border-white/10 rounded-lg flex items-center justify-center hover:text-white hover:bg-white/10 transition-colors" onClick={() => { const s = engine.layers[engine.activeLayerIndex]; if(!s) return; const c=document.createElement("canvas"); c.width=engine.canvasW; c.height=engine.canvasH; const ctx=c.getContext("2d")!; ctx.drawImage(s.canvas,0,0); engine.layers.splice(engine.activeLayerIndex,0,{id:Date.now(),canvas:c,ctx,name:s.name+" copy",visible:true,opacity:s.opacity}); forceUpdate(); flattenToMain(); setTimeout(updateThumbnails,0); }}><Copy size={14}/></button>
               <button className="flex-1 h-8 bg-white/5 text-white/60 border border-white/10 rounded-lg flex items-center justify-center hover:text-[#ff4757] hover:border-[#ff4757] hover:bg-[#ff4757]/10 transition-colors" onClick={() => { if(engine.layers.length>1) { engine.layers.splice(engine.activeLayerIndex, 1); engine.activeLayerIndex = Math.min(engine.activeLayerIndex, engine.layers.length-1); forceUpdate(); flattenToMain(); } }}><Trash2 size={14}/></button>
             </div>
             {engine.layers[engine.activeLayerIndex] && (
               <div className="flex items-center gap-2 mt-4"><span className="text-xs font-medium text-white/60 min-w-[50px]">Opacity</span><input type="range" min="0" max="100" value={Math.round(engine.layers[engine.activeLayerIndex].opacity*100)} onChange={e=>{engine.layers[engine.activeLayerIndex].opacity=+e.target.value/100; forceUpdate(); flattenToMain();}} className="flex-1" /><span className="text-xs font-bold text-lime-400 min-w-[30px] text-right">{Math.round(engine.layers[engine.activeLayerIndex].opacity*100)}%</span></div>
             )}
          </div>
        </div>
      </div>

      {/* STATUS BAR */}
      <div className="flex items-center px-2 md:px-4 gap-2 md:gap-4 shrink-0 text-[10px] md:text-xs text-white/40 overflow-x-auto no-scrollbar">
        <span className="flex items-center gap-1 shrink-0">Tool: <span className="text-lime-400 font-medium">{engine.currentTool}</span></span>
        <span className="flex items-center gap-1 shrink-0">Layer: <span className="text-lime-400 font-medium truncate max-w-[80px] md:max-w-[120px]">{engine.layers[engine.activeLayerIndex]?.name}</span></span>
        <span className="flex items-center gap-1 shrink-0">Layers: <span className="text-lime-400 font-medium">{engine.layers.length}</span></span>
        <span className="flex items-center gap-1 shrink-0">History: <span className="text-lime-400 font-medium">{engine.historyIndex + 1}</span></span>
        <span ref={coordsRef} className="ml-auto text-right w-[70px] md:w-[90px] font-mono shrink-0">x:— y:—</span>
      </div>

      {/* MODALS */}
      {showExport && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[1000] flex items-center justify-center">
          <div className="bg-[#161618] border border-white/10 rounded-3xl p-8 w-[340px] shadow-2xl flex flex-col gap-4">
            <div className="font-bold text-xl tracking-tight text-white flex items-center justify-between mb-2">Export Image <Download size={20} className="text-lime-400" /></div>
            
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-white/50 uppercase tracking-wider">Filename</span>
              <input className="w-full bg-white/5 border border-white/10 rounded-xl text-white text-sm px-4 py-2 outline-none focus:border-lime-400 transition-colors" value={expName} onChange={e=>setExpName(e.target.value)} />
            </div>
            
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-white/50 uppercase tracking-wider">Format</span>
              <select className="w-full bg-white/5 border border-white/10 rounded-xl text-white text-sm px-4 py-2 outline-none focus:border-lime-400 transition-colors appearance-none" value={expFormat} onChange={e=>setExpFormat(e.target.value)}>
                <option value="png" className="bg-[#161618]">PNG (Lossless)</option>
                <option value="jpeg" className="bg-[#161618]">JPEG (Lossy)</option>
                <option value="webp" className="bg-[#161618]">WebP</option>
              </select>
            </div>
            
            {(expFormat === "jpeg" || expFormat === "webp") && (
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-white/50 uppercase tracking-wider">Quality</span>
                <input type="range" min="0.1" max="1" step="0.05" value={expQuality} onChange={e=>setExpQuality(+e.target.value)} className="w-full" />
              </div>
            )}
            
            <div className="flex gap-3 mt-4">
              <button className="flex-1 h-10 rounded-xl bg-white/5 border border-white/10 text-white/80 text-sm font-semibold hover:bg-white/10 hover:text-white transition-colors" onClick={()=>setShowExport(false)}>Cancel</button>
              <button className="flex-1 h-10 rounded-xl bg-lime-400 text-black text-sm font-bold hover:bg-lime-300 transition-colors" onClick={handleExport}>Export</button>
            </div>
          </div>
        </div>
      )}

      {showNew && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[1000] flex items-center justify-center">
          <div className="bg-[#161618] border border-white/10 rounded-3xl p-8 w-[340px] shadow-2xl flex flex-col gap-4">
            <div className="font-bold text-xl tracking-tight text-white flex items-center justify-between mb-2">New Canvas <Plus size={20} className="text-lime-400" /></div>
            
            <div className="flex space-x-3">
              <div className="flex flex-col gap-1.5 flex-1">
                <span className="text-xs font-semibold text-white/50 uppercase tracking-wider">Width</span>
                <input type="number" className="w-full bg-white/5 border border-white/10 rounded-xl text-white text-sm px-4 py-2 outline-none focus:border-lime-400 transition-colors" value={newW} onChange={e=>setNewW(+e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5 flex-1">
                <span className="text-xs font-semibold text-white/50 uppercase tracking-wider">Height</span>
                <input type="number" className="w-full bg-white/5 border border-white/10 rounded-xl text-white text-sm px-4 py-2 outline-none focus:border-lime-400 transition-colors" value={newH} onChange={e=>setNewH(+e.target.value)} />
              </div>
            </div>
            
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-white/50 uppercase tracking-wider">Background</span>
              <select className="w-full bg-white/5 border border-white/10 rounded-xl text-white text-sm px-4 py-2 outline-none focus:border-lime-400 transition-colors appearance-none" value={newBg} onChange={e=>setNewBg(e.target.value)}>
                <option value="white" className="bg-[#161618]">White</option>
                <option value="transparent" className="bg-[#161618]">Transparent</option>
                <option value="black" className="bg-[#161618]">Black</option>
              </select>
            </div>
            
            <div className="flex gap-3 mt-4">
              <button className="flex-1 h-10 rounded-xl bg-white/5 border border-white/10 text-white/80 text-sm font-semibold hover:bg-white/10 hover:text-white transition-colors" onClick={()=>setShowNew(false)}>Cancel</button>
              <button className="flex-1 h-10 rounded-xl bg-lime-400 text-black text-sm font-bold hover:bg-lime-300 transition-colors" onClick={()=>{initDoc(newW||800,newH||600,newBg); setShowNew(false);}}>Create</button>
            </div>
          </div>
        </div>
      )}

      {showShortcuts && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[1000] flex items-center justify-center p-4">
          <div className="bg-[#161618] border border-white/10 rounded-3xl p-8 w-full max-w-sm shadow-2xl flex flex-col gap-5">
            <div className="font-bold text-xl tracking-tight text-white flex items-center justify-between">Keyboard Shortcuts <Keyboard size={20} className="text-lime-400" /></div>
            
            <div className="flex flex-col gap-3 max-h-[60vh] overflow-y-auto no-scrollbar pr-2">
              <div className="flex justify-between items-center border-b border-white/5 pb-2">
                <span className="text-sm text-white/80">Brush</span><kbd className="px-2 py-1 bg-white/10 rounded-md text-xs font-mono text-lime-400">B</kbd>
              </div>
              <div className="flex justify-between items-center border-b border-white/5 pb-2">
                <span className="text-sm text-white/80">Pencil</span><kbd className="px-2 py-1 bg-white/10 rounded-md text-xs font-mono text-lime-400">P</kbd>
              </div>
              <div className="flex justify-between items-center border-b border-white/5 pb-2">
                <span className="text-sm text-white/80">Eraser</span><kbd className="px-2 py-1 bg-white/10 rounded-md text-xs font-mono text-lime-400">E</kbd>
              </div>
              <div className="flex justify-between items-center border-b border-white/5 pb-2">
                <span className="text-sm text-white/80">Fill</span><kbd className="px-2 py-1 bg-white/10 rounded-md text-xs font-mono text-lime-400">F</kbd>
              </div>
              <div className="flex justify-between items-center border-b border-white/5 pb-2">
                <span className="text-sm text-white/80">Spray</span><kbd className="px-2 py-1 bg-white/10 rounded-md text-xs font-mono text-lime-400">Shift+S</kbd>
              </div>
              <div className="flex justify-between items-center border-b border-white/5 pb-2">
                <span className="text-sm text-white/80">Eyedropper</span><kbd className="px-2 py-1 bg-white/10 rounded-md text-xs font-mono text-lime-400">I</kbd>
              </div>
              <div className="flex justify-between items-center border-b border-white/5 pb-2">
                <span className="text-sm text-white/80">Text</span><kbd className="px-2 py-1 bg-white/10 rounded-md text-xs font-mono text-lime-400">T</kbd>
              </div>
              <div className="flex justify-between items-center border-b border-white/5 pb-2">
                <span className="text-sm text-white/80">Select</span><kbd className="px-2 py-1 bg-white/10 rounded-md text-xs font-mono text-lime-400">S</kbd>
              </div>
              <div className="flex justify-between items-center border-b border-white/5 pb-2">
                <span className="text-sm text-white/80">Move</span><kbd className="px-2 py-1 bg-white/10 rounded-md text-xs font-mono text-lime-400">M</kbd>
              </div>
              <div className="flex justify-between items-center border-b border-white/5 pb-2">
                <span className="text-sm text-white/80">Undo</span><kbd className="px-2 py-1 bg-white/10 rounded-md text-xs font-mono text-lime-400">Ctrl+Z</kbd>
              </div>
              <div className="flex justify-between items-center border-b border-white/5 pb-2">
                <span className="text-sm text-white/80">Redo</span><kbd className="px-2 py-1 bg-white/10 rounded-md text-xs font-mono text-lime-400">Ctrl+Y</kbd>
              </div>
              <div className="flex justify-between items-center border-b border-white/5 pb-2">
                <span className="text-sm text-white/80">Copy</span><kbd className="px-2 py-1 bg-white/10 rounded-md text-xs font-mono text-lime-400">Ctrl+C</kbd>
              </div>
              <div className="flex justify-between items-center border-b border-white/5 pb-2">
                <span className="text-sm text-white/80">Paste</span><kbd className="px-2 py-1 bg-white/10 rounded-md text-xs font-mono text-lime-400">Ctrl+V</kbd>
              </div>
              <div className="flex justify-between items-center pb-2">
                <span className="text-sm text-white/80">Clear Selection</span><kbd className="px-2 py-1 bg-white/10 rounded-md text-xs font-mono text-lime-400">Esc</kbd>
              </div>
            </div>
            
            <button className="w-full h-10 rounded-xl bg-lime-400 text-black text-sm font-bold hover:bg-lime-300 transition-colors mt-2" onClick={()=>setShowShortcuts(false)}>Close</button>
          </div>
        </div>
      )}

      <input type="file" ref={fileInputRef} accept="image/*" className="hidden" onChange={(e) => { handleFileDrop(null, e.target.files?.[0]); e.target.value=''; }} />
    </div>
  );
}
