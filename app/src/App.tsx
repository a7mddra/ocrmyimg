import { useState, useRef, useEffect } from "react";
import { Command, open } from "@tauri-apps/plugin-shell";
import { convertFileSrc } from "@tauri-apps/api/core";
import "./index.css";

interface OCRBox {
  text: string;
  box: number[][]; // [ [x,y], [x,y], [x,y], [x,y] ]
}

function App() {
  const [path, setPath] = useState("");
  const [src, setSrc] = useState("");
  const [data, setData] = useState<OCRBox[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [showViewer, setShowViewer] = useState(false);

  // Menu State
  const [menuActive, setMenuActive] = useState(false);
  const [isSelectAllMode, setIsSelectAllMode] = useState(false);

  // Toolbar State
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Refs
  const menuRef = useRef<HTMLDivElement>(null);
  const sliderRef = useRef<HTMLDivElement>(null);
  const notchRef = useRef<SVGSVGElement>(null);
  const page1Ref = useRef<HTMLDivElement>(null);
  const page2Ref = useRef<HTMLDivElement>(null);
  const pageFlatRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const imgWrapRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const toolbarDragRef = useRef<HTMLDivElement>(null);

  const NOTCH_OFFSET = 12;
  const MENU_HEIGHT = 48;

  const scan = async () => {
    if (!path.trim()) return;
    setLoading(true);
    setError("");
    setShowViewer(true);
    hideMenu();
    setSrc(convertFileSrc(path));

    try {
      const cmd = Command.sidecar("binaries/ocr-engine", [path]);
      const out = await cmd.execute();
      if (out.code !== 0) throw new Error(out.stderr || "Failed");
      const result = JSON.parse(out.stdout.trim());
      if (result.error) throw new Error(result.error);
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  };

  const onLoad = () => {
    if (imgRef.current) {
      setSize({
        w: imgRef.current.naturalWidth,
        h: imgRef.current.naturalHeight,
      });
    }
  };

  // --- Core Menu Logic ---

  const hideMenu = () => {
    if (menuRef.current) {
      menuRef.current.classList.remove("animating-layout");
      menuRef.current.classList.remove("active");
      if (notchRef.current) notchRef.current.classList.remove("active");
    }
    setMenuActive(false);
    setIsSelectAllMode(false);
  };

  const getSelectedText = () => {
    return window.getSelection()?.toString().trim() || "";
  };

  const handleSelection = () => {
    if (isSelectAllMode) return;

    const selection = window.getSelection();
    const text = selection?.toString().trim();

    // Fix: Only show menu if selection is inside the image viewer
    if (
      imgWrapRef.current &&
      selection?.anchorNode &&
      !imgWrapRef.current.contains(selection.anchorNode)
    ) {
      return;
    }

    if (!text || !selection?.rangeCount) {
      if (menuActive) hideMenu();
      return;
    }

    showStandardMenu(selection);
  };

  const showStandardMenu = (selection: Selection) => {
    setMenuActive(true);

    const menu = menuRef.current;
    const notch = notchRef.current;
    if (!menu || !notch) return;

    menu.classList.remove("animating-layout");
    renderPage(0, false);

    const range = selection.getRangeAt(0);
    const getElementRect = (node: Node | null): DOMRect | null => {
      if (!node) return null;
      if (node.nodeType === Node.TEXT_NODE) {
        return node.parentElement?.getBoundingClientRect() || null;
      }
      return (node as Element).getBoundingClientRect();
    };

    const anchorRect = getElementRect(selection.anchorNode);
    const focusRect = getElementRect(selection.focusNode);
    let topY: number;
    if (anchorRect && focusRect) {
      topY = Math.min(anchorRect.top, focusRect.top);
    } else if (anchorRect) {
      topY = anchorRect.top;
    } else if (focusRect) {
      topY = focusRect.top;
    } else {
      topY = range.getBoundingClientRect().top;
    }
    const rects = Array.from(range.getClientRects());
    const tolerance = 50;
    const validRects = rects.filter((r) => {
      if (r.width === 0 || r.height === 0) return false;
      return (
        Math.abs(r.top - topY) < tolerance ||
        (r.top >= topY - tolerance && r.bottom <= topY + tolerance + 100)
      );
    });

    let left: number, width: number;
    if (validRects.length > 0) {
      left = Math.min(...validRects.map((r) => r.left));
      const right = Math.max(...validRects.map((r) => r.right));
      width = right - left;
    } else {
      const r = range.getBoundingClientRect();
      left = r.left;
      width = r.width;
    }

    const targetRect = {
      left,
      top: topY,
      width,
      height: 0,
    };

    positionMenu(targetRect, false);
    void menu.offsetWidth;
    requestAnimationFrame(() => {
      if (menuRef.current) menuRef.current.classList.add("active");
    });
  };

  const positionMenu = (
    selectionRectViewport: {
      left: number;
      width: number;
      top: number;
      height?: number;
    },
    isFlatMode: boolean
  ) => {
    const menu = menuRef.current;
    const notch = notchRef.current;
    if (!menu || !notch) return;

    const selectionCenterViewport =
      selectionRectViewport.left + selectionRectViewport.width / 2;
    const selectionTopViewport = selectionRectViewport.top;

    const menuWidth = menu.offsetWidth || 180;

    let menuLeftViewport = selectionCenterViewport - menuWidth / 2;
    let menuTopViewport = selectionTopViewport - MENU_HEIGHT - NOTCH_OFFSET;

    const margin = 10;

    // Clamp to viewport bounds
    if (menuLeftViewport < margin) {
      menuLeftViewport = margin;
    }
    if (menuLeftViewport + menuWidth > window.innerWidth - margin) {
      menuLeftViewport = window.innerWidth - menuWidth - margin;
    }

    if (menuTopViewport < margin) {
      menuTopViewport = margin;
    }

    const notchAbsoluteX = selectionCenterViewport;
    let notchRelativeX = notchAbsoluteX - menuLeftViewport;
    const cornerRadius = 12;
    const safeZone = cornerRadius + 6;
    notchRelativeX = Math.max(
      safeZone,
      Math.min(menuWidth - safeZone, notchRelativeX)
    );

    // Use viewport coordinates directly (fixed positioning)
    menu.style.left = `${menuLeftViewport}px`;
    menu.style.top = `${menuTopViewport}px`;

    if (!isFlatMode) {
      notch.classList.add("active");
      notch.style.left = `${notchRelativeX}px`;
    } else {
      notch.classList.remove("active");
    }
  };

  const renderPage = (pageIndex: number, animateSlider: boolean = true) => {
    const slider = sliderRef.current;
    const menu = menuRef.current;
    if (
      !slider ||
      !menu ||
      !page1Ref.current ||
      !page2Ref.current ||
      !pageFlatRef.current
    )
      return;

    const p1W = page1Ref.current.offsetWidth;
    const p2W = page2Ref.current.offsetWidth;
    const pFlatW = pageFlatRef.current.offsetWidth;

    const widths = [p1W, p2W, pFlatW];
    let targetWidth = widths[0];
    let slideOffset = 0;

    if (pageIndex === 0) {
      targetWidth = widths[0];
      slideOffset = 0;
    } else if (pageIndex === 1) {
      targetWidth = widths[1];
      slideOffset = -widths[0];
    } else if (pageIndex === 2) {
      targetWidth = widths[2];
      slideOffset = -(widths[0] + widths[1]);
    }

    menu.style.width = `${targetWidth}px`;

    if (animateSlider) {
      slider.style.transition =
        "transform 0.4s cubic-bezier(0.25, 0.8, 0.25, 1)";
    } else {
      slider.style.transition = "none";
    }
    slider.style.transform = `translateX(${slideOffset}px)`;
  };

  const switchPage = (targetIndex: number) => {
    const menu = menuRef.current;
    const notch = notchRef.current;
    if (!menu || !notch) return;

    menu.classList.add("animating-layout");

    const oldWidth = parseFloat(menu.style.width) || menu.offsetWidth;
    const p1W = page1Ref.current?.offsetWidth || 0;
    const p2W = page2Ref.current?.offsetWidth || 0;

    let newWidth = 0;
    if (targetIndex === 0) newWidth = p1W;
    if (targetIndex === 1) newWidth = p2W;

    const widthDiff = newWidth - oldWidth;
    const currentLeft = parseFloat(menu.style.left) || 0;
    const newLeft = currentLeft - widthDiff / 2;

    const margin = 10;
    let clampedLeft = newLeft;
    if (clampedLeft < margin) clampedLeft = margin;
    if (clampedLeft + newWidth > window.innerWidth - margin) {
      clampedLeft = window.innerWidth - newWidth - margin;
    }

    menu.style.width = `${newWidth}px`;
    menu.style.left = `${clampedLeft}px`;

    const moveDelta = clampedLeft - currentLeft;
    const currentNotchLeft = parseFloat(notch.style.left) || 0;
    notch.style.left = `${currentNotchLeft - moveDelta}px`;

    renderPage(targetIndex, true);
  };

  const triggerSelectAll = () => {
    const svg = document.querySelector(".text-layer");
    if (svg) {
      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        const range = document.createRange();
        range.selectNodeContents(svg);
        selection.addRange(range);
      }
    }

    setIsSelectAllMode(true);
    const menu = menuRef.current;
    const wrap = imgWrapRef.current;
    if (!menu || !wrap) return;

    menu.classList.remove("animating-layout");
    renderPage(2, false);

    const wrapRect = wrap.getBoundingClientRect();
    const menuWidth = pageFlatRef.current?.offsetWidth || 250;

    // Calculate top position based on first text line in viewport coords
    let targetTopViewport = wrapRect.top - MENU_HEIGHT - 20;
    if (data.length > 0) {
      // Get the first text box's top position in viewport coordinates
      const firstBoxY = data.reduce(
        (min, item) => Math.min(min, item.box[0][1]),
        Infinity
      );
      // Convert image coords to viewport coords
      const imgRect = imgRef.current?.getBoundingClientRect();
      if (imgRect && size.h > 0) {
        const scale = imgRect.height / size.h;
        targetTopViewport = imgRect.top + firstBoxY * scale - MENU_HEIGHT - 20;
      }
    }
    if (targetTopViewport < 10) targetTopViewport = 10;

    // Center horizontally in the viewport
    const viewerRect = viewerRef.current?.getBoundingClientRect();
    let targetLeftViewport = window.innerWidth / 2 - menuWidth / 2;
    if (viewerRect) {
      targetLeftViewport =
        viewerRect.left + viewerRect.width / 2 - menuWidth / 2;
    }

    if (targetLeftViewport < 10) targetLeftViewport = 10;
    if (targetLeftViewport + menuWidth > window.innerWidth - 10) {
      targetLeftViewport = window.innerWidth - menuWidth - 10;
    }

    menu.style.left = `${targetLeftViewport}px`;
    menu.style.top = `${targetTopViewport}px`;

    notchRef.current?.classList.remove("active");
  };

  const handleAction = (action: string) => {
    if (action === "selectAll") {
      triggerSelectAll();
    } else {
      const text = getSelectedText();
      if (action === "copy") {
        if (text) navigator.clipboard.writeText(text);
      } else if (action === "search") {
        if (text)
          open(`https://www.google.com/search?q=${encodeURIComponent(text)}`);
      } else if (action === "translate") {
        if (text)
          open(
            `https://translate.google.com/?text=${text.replace(
              / /g,
              "+"
            )}&sl=auto&tl=en&op=translate`
          );
      }
      hideMenu();
    }
  };

  // --- Custom Selection Logic ---
  const svgRef = useRef<SVGSVGElement>(null);
  const isCustomSelectingRef = useRef(false);
  const selectionModeRef = useRef<"char" | "word" | "line">("char");
  const selectionAnchorRef = useRef<{
    boxIndex: number;
    charIndex: number;
  } | null>(null);

  const getMouseInSvg = (e: MouseEvent | React.MouseEvent) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    return pt.matrixTransform(svg.getScreenCTM()?.inverse());
  };

  const getClosestTextIndex = (
    point: DOMPoint,
    boxIndex: number
  ): { boxIndex: number; charIndex: number } | null => {
    const item = data[boxIndex];
    if (!item) return null;

    const b = item.box; // [tl, tr, br, bl]
    // Project point onto the line segment (tl -> tr)
    const x0 = b[0][0];
    const y0 = b[0][1];
    const x1 = b[1][0];
    const y1 = b[1][1];

    const dx = x1 - x0;
    const dy = y1 - y0;
    const lenSq = dx * dx + dy * dy;

    // Project point onto vector
    let t = ((point.x - x0) * dx + (point.y - y0) * dy) / lenSq;

    // Clamp t to 0-1
    t = Math.max(0, Math.min(1, t));

    const totalChars = item.text.length;
    let charIndex = Math.floor(t * totalChars);

    // Boundary check
    if (charIndex < 0) charIndex = 0;
    if (charIndex > totalChars) charIndex = totalChars;

    return { boxIndex, charIndex };
  };

  const getWordRange = (text: string, index: number) => {
    // If double clicking a non-alphanumeric char (space, symbol), select just that char
    if (!/[a-zA-Z0-9]/.test(text[index])) {
      return { start: index, end: index + 1 };
    }

    let start = index;
    // Walk left
    while (start > 0 && /[a-zA-Z0-9]/.test(text[start - 1])) {
      start--;
    }
    let end = index;
    // Walk right
    while (end < text.length && /[a-zA-Z0-9]/.test(text[end])) {
      end++;
    }
    return { start, end };
  };

  const handleTextMouseDown = (e: React.MouseEvent, boxIndex: number) => {
    if (e.button !== 0) return; // Only left click
    e.preventDefault(); // Stop native selection

    const pt = getMouseInSvg(e);
    if (!pt) return;

    const target = getClosestTextIndex(pt, boxIndex);
    if (!target) return;

    isCustomSelectingRef.current = true;

    // Determine mode based on click count (Toggle logic)
    // 1 -> char, 2 -> word, 3 -> line, 4 -> word, 5 -> line, etc.
    const clicks = e.detail;
    if (clicks >= 2) {
      selectionModeRef.current = clicks % 2 === 0 ? "word" : "line";
    } else {
      selectionModeRef.current = "char";
    }

    // Handle initial selection based on mode
    if (selectionModeRef.current === "word") {
      const text = data[boxIndex].text;
      const { start, end } = getWordRange(text, target.charIndex);
      // Select word
      const anchor = { boxIndex, charIndex: start };
      const focus = { boxIndex, charIndex: end };
      selectionAnchorRef.current = anchor; // Anchor at start of word
      updateNativeSelection(anchor, focus);
    } else if (selectionModeRef.current === "line") {
      const text = data[boxIndex].text;
      const anchor = { boxIndex, charIndex: 0 };
      const focus = { boxIndex, charIndex: text.length };
      selectionAnchorRef.current = anchor;
      updateNativeSelection(anchor, focus);
    } else {
      selectionAnchorRef.current = target;
      window.getSelection()?.removeAllRanges();
    }

    document.addEventListener("mousemove", handleSelectionMouseMove);
    document.addEventListener("mouseup", handleGlobalMouseUp);
  };

  const handleSelectionMouseMove = (e: MouseEvent) => {
    if (!isCustomSelectingRef.current || !selectionAnchorRef.current) return;

    // Find which box we are hovering
    const pt = getMouseInSvg(e);
    if (!pt) return;

    // Use a simple heuristic: checking distance to all boxes or just current box?
    // For smoothness, we should probably check which box we are physically over.
    // However, since we don't have a spatial index, let's optimize:
    // Check if we are still close to the anchor box, if not search all boxes.
    // For now, let's iterate all boxes to find the closest one vertically/horizontally.

    let closestBoxIndex = -1;
    let minDist = Infinity;

    data.forEach((item, idx) => {
      const cx = (item.box[0][0] + item.box[1][0]) / 2;
      const cy = (item.box[0][1] + item.box[3][1]) / 2;
      const dist = Math.sqrt(Math.pow(pt.x - cx, 2) + Math.pow(pt.y - cy, 2));
      if (dist < minDist) {
        minDist = dist;
        closestBoxIndex = idx;
      }
    });

    if (closestBoxIndex === -1) return;

    let focus = getClosestTextIndex(pt, closestBoxIndex);
    if (!focus) return;

    // Adjust focus based on mode
    if (selectionModeRef.current === "word") {
      const text = data[closestBoxIndex].text;
      const { start, end } = getWordRange(text, focus.charIndex);
      // If we are dragging past the anchor, snap to end of word
      // If before anchor, snap to start of word
      // Simple heuristic: just encompass the word under cursor
      // But proper behavior is extending from anchor.
      // Let's just snap focus to the 'outer' bound of the word relative to anchor.

      // Simplified: just update native selection using the range logic
      // But updateNativeSelection takes (anchor, focus).
      // We'll treat Focus as the point we want to extend into.
      if (closestBoxIndex === selectionAnchorRef.current.boxIndex) {
        // Same box
        if (focus.charIndex < selectionAnchorRef.current.charIndex) {
          focus.charIndex = start;
        } else {
          focus.charIndex = end;
        }
      } else {
        // Different box logic is complex, fallback to char or just end of word
        focus.charIndex = end;
      }
    } else if (selectionModeRef.current === "line") {
      // Snap to full line
      const text = data[closestBoxIndex].text;
      // If same box as anchor, we are already selecting full line (from click).
      // If we drag to another box, select that full line too?
      // Usually triple click selects full lines.
      if (focus.charIndex < text.length / 2) {
        focus.charIndex = 0;
      } else {
        focus.charIndex = text.length;
      }
      // Actually, for line mode, we usually want to select from StartOfLine(Anchor) to EndOfLine(Focus)
      // Let's Keep it simple for now: Just char precision if dragging in line mode, OR
      // enforce full line selection. Use 0 or length.
      if (closestBoxIndex > selectionAnchorRef.current.boxIndex) {
        focus.charIndex = text.length;
      } else if (closestBoxIndex < selectionAnchorRef.current.boxIndex) {
        focus.charIndex = 0;
      } else {
        // Same box - check direction
        if (focus.charIndex < selectionAnchorRef.current.charIndex)
          focus.charIndex = 0;
        else focus.charIndex = text.length;
      }
    }

    updateNativeSelection(selectionAnchorRef.current, focus);
  };

  const updateNativeSelection = (
    anchor: { boxIndex: number; charIndex: number },
    focus: { boxIndex: number; charIndex: number }
  ) => {
    const selection = window.getSelection();
    if (!selection) return;

    // Helper to get text node
    const getTextNode = (bIdx: number) => {
      const textEl = document.getElementById(`text-${bIdx}`);
      return textEl?.firstChild || null;
    };

    const anchorNode = getTextNode(anchor.boxIndex);
    const focusNode = getTextNode(focus.boxIndex);

    if (anchorNode && focusNode) {
      try {
        if (
          selection.anchorNode !== anchorNode ||
          selection.focusNode !== focusNode ||
          selection.anchorOffset !== anchor.charIndex ||
          selection.focusOffset !== focus.charIndex
        ) {
          selection.setBaseAndExtent(
            anchorNode,
            anchor.charIndex,
            focusNode,
            focus.charIndex
          );
        }
      } catch (err) {
        // Ignore range errors
      }
    }
  };

  const handleGlobalMouseUp = () => {
    isCustomSelectingRef.current = false;
    document.removeEventListener("mousemove", handleSelectionMouseMove);
    document.removeEventListener("mouseup", handleGlobalMouseUp);

    // Trigger menu if we have a range
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.toString().trim()) {
      showStandardMenu(sel);
    }
  };

  // --- Toolbar Dragging Logic ---
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0, left: 0, top: 0 });

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const toolbar = toolbarRef.current;
    const wrap = imgWrapRef.current;
    if (!toolbar || !wrap) return;

    isDraggingRef.current = true;
    dragStartRef.current.x = e.clientX;
    dragStartRef.current.y = e.clientY;

    const wrapRect = wrap.getBoundingClientRect();
    const toolbarRect = toolbar.getBoundingClientRect();

    const offsetLeft = toolbarRect.left - wrapRect.left;
    const offsetTop = toolbarRect.top - wrapRect.top;

    toolbar.style.right = "auto";
    toolbar.style.bottom = "auto";
    toolbar.style.left = `${offsetLeft}px`;
    toolbar.style.top = `${offsetTop}px`;

    dragStartRef.current.left = offsetLeft;
    dragStartRef.current.top = offsetTop;

    document.addEventListener("mousemove", handleDrag);
    document.addEventListener("mouseup", stopDrag);
  };

  const handleDrag = (e: MouseEvent) => {
    if (!isDraggingRef.current) return;
    e.preventDefault();

    const toolbar = toolbarRef.current;
    const wrap = imgWrapRef.current;
    if (!toolbar || !wrap) return;

    const deltaX = e.clientX - dragStartRef.current.x;
    const deltaY = e.clientY - dragStartRef.current.y;

    let newLeft = dragStartRef.current.left + deltaX;
    let newTop = dragStartRef.current.top + deltaY;

    const wrapRect = wrap.getBoundingClientRect();
    const toolbarRect = toolbar.getBoundingClientRect();

    const maxLeft = wrapRect.width - toolbarRect.width;
    const maxTop = wrapRect.height - toolbarRect.height;

    newLeft = Math.max(0, Math.min(newLeft, maxLeft));
    newTop = Math.max(0, Math.min(newTop, maxTop));

    toolbar.style.left = `${newLeft}px`;
    toolbar.style.top = `${newTop}px`;
  };

  const stopDrag = () => {
    isDraggingRef.current = false;
    document.removeEventListener("mousemove", handleDrag);
    document.removeEventListener("mouseup", stopDrag);
  };

  const resetToolbarPosition = () => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return;

    toolbar.style.left = "";
    toolbar.style.top = "";
    toolbar.style.right = "16px";
    toolbar.style.bottom = "16px";
  };

  // --- Fullscreen Toggle ---
  const toggleFullscreen = (e: React.MouseEvent) => {
    e.stopPropagation();

    resetToolbarPosition();

    if (!isFullscreen) {
      setIsFullscreen(true);
    } else {
      setIsFullscreen(false);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isFullscreen) {
        resetToolbarPosition();
        setIsFullscreen(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isFullscreen]);

  useEffect(() => {
    const onMouseUp = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (menuRef.current && menuRef.current.contains(target)) return;
      setTimeout(() => handleSelection(), 10);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key.includes("Arrow")) {
        setTimeout(() => handleSelection(), 10);
      }
    };

    const onResize = () => hideMenu();

    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (menuRef.current && !menuRef.current.contains(target)) {
        // Don't clear selection if clicking on text (let the text handler handle it)
        if (!target.classList.contains("selectable-text")) {
          window.getSelection()?.removeAllRanges();
        }
        hideMenu();
      }
    };

    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("keyup", onKeyUp);
    window.addEventListener("resize", onResize);
    document.addEventListener("mousedown", onMouseDown);

    return () => {
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [menuActive, isSelectAllMode]);

  return (
    <div className="app">
      <div className="input-bar">
        <input
          type="text"
          placeholder="Image path"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && scan()}
        />
        <button onClick={scan} disabled={loading || !path.trim()}>
          {loading ? "..." : "Scan"}
        </button>
      </div>

      {showViewer ? (
        <div className="viewer" ref={viewerRef}>
          <div
            className={`image-wrap ${isFullscreen ? "is-fullscreen" : ""}`}
            ref={imgWrapRef}
          >
            <img
              ref={imgRef}
              src={src}
              alt=""
              onLoad={onLoad}
              onError={() => setError("Failed to load image")}
              draggable={false}
            />

            {data.length > 0 && size.w > 0 && (
              <svg
                ref={svgRef}
                className="text-layer"
                viewBox={`0 0 ${size.w} ${size.h}`}
                preserveAspectRatio="xMidYMid meet"
              >
                {data.map((item, i) => {
                  const b = item.box;
                  const points = b.map((p) => `${p[0]},${p[1]}`).join(" ");
                  const h = Math.abs(b[3][1] - b[0][1]);
                  const w = Math.abs(b[1][0] - b[0][0]);

                  return (
                    <g key={i}>
                      <polygon className="highlight-bg" points={points} />
                      <text
                        id={`text-${i}`}
                        x={b[0][0]}
                        y={b[0][1] + h * 0.78}
                        fontSize={h * 0.85}
                        fontFamily="'Arial Narrow', Arial, sans-serif"
                        textLength={w}
                        lengthAdjust="spacingAndGlyphs"
                        className="selectable-text"
                        onMouseDown={(e) => handleTextMouseDown(e, i)}
                      >
                        {item.text}
                      </text>
                    </g>
                  );
                })}
              </svg>
            )}

            {loading && <div className="loading">Scanning...</div>}

            <div className="image-toolbar" ref={toolbarRef}>
              <div
                className="toolbar-drag"
                ref={toolbarDragRef}
                onMouseDown={startDrag}
                title="Drag"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  style={{ transform: "rotate(90deg)" }}
                >
                  <path d="M7 19c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zM7 3c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zM7 11c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zM17 19c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zM17 3c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zM17 11c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
                </svg>
              </div>

              <div className="toolbar-separator"></div>

              <button className="tool-btn" onClick={(e) => e.stopPropagation()}>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
                  <circle cx="12" cy="13" r="3" />
                </svg>
                <span className="tooltip-text">Search with Google Lens</span>
              </button>

              <button className="tool-btn" onClick={(e) => e.stopPropagation()}>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                  <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                </svg>
                <span className="tooltip-text">Copy as Image</span>
              </button>

              <button className="tool-btn" onClick={toggleFullscreen}>
                {isFullscreen ? (
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ transform: "scaleX(-1)" }}
                  >
                    <path d="M10 4v6H4" />
                    <path d="M14 20v-6h6" />
                  </svg>
                ) : (
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ transform: "scaleX(-1)" }}
                  >
                    <path d="M4 10V4h6" />
                    <path d="M20 14v6h-6" />
                  </svg>
                )}
                <span className="tooltip-text">
                  {isFullscreen ? "Collapse" : "Expand"}
                </span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="empty">Enter image path and press Scan</div>
      )}

      {/* Context menu - positioned fixed, outside image-wrap */}
      <div id="context-menu" ref={menuRef}>
        <div className="menu-slider" id="menu-slider" ref={sliderRef}>
          <div className="menu-page" id="page-1" ref={page1Ref}>
            <div
              className="menu-item"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleAction("copy")}
            >
              Copy
            </div>
            <div className="divider"></div>
            <div
              className="menu-item"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleAction("selectAll")}
            >
              Select All
            </div>
            <div className="divider"></div>
            <div
              className="menu-item nav-arrow"
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation();
                switchPage(1);
              }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m9 18 6-6-6-6" />
              </svg>
            </div>
          </div>

          <div className="menu-page" id="page-2" ref={page2Ref}>
            <div
              className="menu-item nav-arrow"
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation();
                switchPage(0);
              }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m15 18-6-6 6-6" />
              </svg>
            </div>
            <div className="divider"></div>
            <div
              className="menu-item"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleAction("search")}
            >
              Search
            </div>
            <div className="divider"></div>
            <div
              className="menu-item"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleAction("translate")}
            >
              Translate
            </div>
          </div>

          <div className="menu-page" id="page-flat" ref={pageFlatRef}>
            <div
              className="menu-item"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleAction("copy")}
            >
              Copy
            </div>
            <div className="divider"></div>
            <div
              className="menu-item"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleAction("search")}
            >
              Search
            </div>
            <div className="divider"></div>
            <div
              className="menu-item"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleAction("translate")}
            >
              Translate
            </div>
          </div>
        </div>

        <svg
          id="notch"
          viewBox="0 0 20 10"
          xmlns="http://www.w3.org/2000/svg"
          ref={notchRef}
        >
          <path d="M0 0 C4 0 6 2 10 10 C14 2 16 0 20 0 Z" />
        </svg>
      </div>

      {error && <div className="error">{error}</div>}
    </div>
  );
}

export default App;
